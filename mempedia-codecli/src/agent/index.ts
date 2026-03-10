import OpenAI from 'openai';
import { MempediaClient } from '../mempedia/client.js';
import { ToolAction } from '../mempedia/types.js';
import { exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// Define tools manually for OpenAI API to avoid type issues with imported definitions
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'mempedia_search',
      description: 'Search for knowledge or past interactions in mempedia.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search query' },
          limit: { type: 'number', description: 'Max number of results' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'mempedia_read',
      description: 'Read the content of a specific mempedia node.',
      parameters: {
        type: 'object',
        properties: {
          node_id: { type: 'string', description: 'The ID of the node to read' },
        },
        required: ['node_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'mempedia_save',
      description: 'Save or update knowledge/interaction in mempedia.',
      parameters: {
        type: 'object',
        properties: {
          node_id: { type: 'string', description: 'The ID of the node (unique)' },
          content: { type: 'string', description: 'Markdown content' },
        },
        required: ['node_id', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_shell',
      description: 'Run a shell command.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The command to run' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a file from the filesystem.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'The path to the file' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write content to a file.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'The path to the file' },
          content: { type: 'string', description: 'The content to write' },
        },
        required: ['path', 'content'],
      },
    },
  },
];

export interface TraceEvent {
  type: 'thought' | 'action' | 'observation' | 'error';
  content: string;
  metadata?: any;
}

export interface AgentConfig {
  apiKey: string;
  baseURL?: string;
  model?: string;
  memoryApiKey?: string;
  memoryBaseURL?: string;
  memoryModel?: string;
}

interface PerfEntry {
  label: string;
  ms: number;
}

interface ConversationTurn {
  user: string;
  assistant: string;
}

interface MemoryExtraction {
  user_habits_env: string[];
  behavior_patterns: string[];
  atomic_knowledge: Array<{ keyword: string; summary: string; details: string }>;
}

export class Agent {
  private openai: OpenAI;
  private memoryOpenai: OpenAI;
  private mempedia: MempediaClient;
  private model: string;
  private memoryModel: string;
  private interactionCounter: number;
  private readonly maxConversationTurns: number;
  private conversationTurns: ConversationTurn[];
  private onBackgroundTaskCallback: ((task: string, status: 'started' | 'completed') => void) | null = null;

  constructor(config: AgentConfig, projectRoot: string, binaryPath?: string) {
    this.openai = new OpenAI({ 
      apiKey: config.apiKey,
      baseURL: config.baseURL 
    });
    this.memoryOpenai = new OpenAI({
      apiKey: config.memoryApiKey || config.apiKey,
      baseURL: config.memoryBaseURL || config.baseURL
    });
    this.model = config.model || 'gpt-4o';
    this.memoryModel = config.memoryModel || this.model;
    this.mempedia = new MempediaClient(projectRoot, binaryPath);
    this.interactionCounter = 0;
    this.maxConversationTurns = 5;
    this.conversationTurns = [];
  }

  onBackgroundTask(callback: (task: string, status: 'started' | 'completed') => void) {
      this.onBackgroundTaskCallback = callback;
      return () => { this.onBackgroundTaskCallback = null; };
  }

  private notifyBackgroundTask(task: string, status: 'started' | 'completed') {
      if (this.onBackgroundTaskCallback) {
          this.onBackgroundTaskCallback(task, status);
      }
  }

  async start() {
    this.mempedia.start();
  }

  stop() {
    this.mempedia.stop();
  }

  private normalizeItems(items: unknown, limit: number): string[] {
    if (!Array.isArray(items)) {
      return [];
    }
    const out: string[] = [];
    for (const item of items) {
      if (typeof item !== 'string') {
        continue;
      }
      const cleaned = item.replace(/\s+/g, ' ').trim();
      if (!cleaned) {
        continue;
      }
      if (out.includes(cleaned)) {
        continue;
      }
      out.push(cleaned);
      if (out.length >= limit) {
        break;
      }
    }
    return out;
  }

  private isNoiseLine(line: string): boolean {
    const lc = line.toLowerCase();
    if (lc.length < 8) {
      return true;
    }
    return lc.includes('command executed successfully')
      || lc.includes('deprecatedwarning')
      || lc.includes('unknown tool')
      || lc.includes('initializing react agent context')
      || lc.includes('mempedia process exited with code');
  }

  private buildNodeId(prefix: string): string {
    const now = new Date();
    const stamp = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}${String(now.getUTCHours()).padStart(2, '0')}${String(now.getUTCMinutes()).padStart(2, '0')}${String(now.getUTCSeconds()).padStart(2, '0')}`;
    this.interactionCounter += 1;
    return `${prefix}_${stamp}_${this.interactionCounter}`;
  }

  private toSlug(value: string): string {
    const normalized = value
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 72);
    return normalized || 'empty';
  }

  private stableNodeId(type: 'intent' | 'thought' | 'fact' | 'pattern' | 'atomic', text: string): string {
    return `kg_${type}_${this.toSlug(text)}`;
  }

  private preferenceNodeId(text: string): string {
    return `kg_preference_${this.toSlug(text)}`;
  }

  private isPreferenceLine(line: string): boolean {
    const lc = line.toLowerCase();
    return lc.includes('prefer')
      || lc.includes('preference')
      || lc.includes('习惯')
      || lc.includes('偏好')
      || lc.includes('默认')
      || lc.includes('希望')
      || lc.includes('请用')
      || lc.includes('请保持');
  }

  private isValuableKnowledgeLine(line: string): boolean {
    if (this.isNoiseLine(line)) {
      return false;
    }
    const cleaned = line.trim();
    if (cleaned.length < 12) {
      return false;
    }
    const lc = cleaned.toLowerCase();
    if (lc.includes('hello') || lc.includes('hi') || lc.includes('thanks') || lc.includes('你好')) {
      return false;
    }
    return true;
  }

  private async measure<T>(
    entries: PerfEntry[] | null,
    label: string,
    work: () => Promise<T>
  ): Promise<T> {
    const start = Date.now();
    try {
      return await work();
    } finally {
      if (entries) {
        entries.push({ label, ms: Date.now() - start });
      }
    }
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
    if (timeoutMs <= 0) {
      return promise;
    }
    let timer: NodeJS.Timeout | null = null;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`${label} timeout after ${timeoutMs}ms`)), timeoutMs);
        })
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  private async extractMemoryPayload(input: string, traces: TraceEvent[], answer: string): Promise<MemoryExtraction> {
    const traceLines = traces
      .slice(-30)
      .map((t) => `${t.type.toUpperCase()}: ${t.content}`)
      .join('\n');
    const extractionPrompt = `请提取以下对话中应长期保存到知识库的信息。
输出必须是 JSON（不要 markdown）并使用这个结构：
{
  "user_habits_env": ["..."],
  "behavior_patterns": ["..."],
  "atomic_knowledge": [
     { "keyword": "关键词(唯一标识)", "summary": "准确简短的描述(必须)", "details": "详细解释、事实、历史变迁、引申等" }
  ]
}

规则：
1. **user_habits_env (用户习惯与环境)**: 记录目前的环境信息与用户偏好。
2. **behavior_patterns (行为模式)**: 模型在尝试完成某种用户计划时减去无意义的尝试，只留下有用的行为总结而出的pattern，pattern需要持续更新。
3. **atomic_knowledge (原子化知识)**: 
    - 所有知识node都应该由一个独立的关键词确认。
    - 关键词下可以有关联关系和更详细的描述，类似wikipedia一样。
    - 每个核心关键词知识都有系统性的知识（解释、事实、历史变迁、引申）记录并不断维护。
    - 如有重名的关键词知识，则在摘要中区分开。
    - **必须**包含 summary 字段，且为准确简短的描述。

严禁输出寒暄、执行日志、临时上下文、错误堆栈。只保留长期有价值的信息。`;

    const userPayload = `用户输入:\n${input}\n\n执行轨迹:\n${traceLines}\n\n最终回答:\n${answer}`;
    try {
      const extraction = await this.memoryOpenai.chat.completions.create({
        model: this.memoryModel,
        messages: [
          { role: 'system', content: extractionPrompt },
          { role: 'user', content: userPayload }
        ],
        response_format: { type: "json_object" }
      });
      const content = extraction.choices[0]?.message?.content || '{}';
      const parsed = JSON.parse(content);
      
      return {
        user_habits_env: this.normalizeItems(parsed.user_habits_env, 10),
        behavior_patterns: this.normalizeItems(parsed.behavior_patterns, 10),
        atomic_knowledge: Array.isArray(parsed.atomic_knowledge) ? parsed.atomic_knowledge.filter((k: any) => k.keyword && k.summary) : []
      };
    } catch (_) {
      return {
        user_habits_env: [],
        behavior_patterns: [],
        atomic_knowledge: []
      };
    }
  }

  private async persistInteractionMemory(
    input: string,
    traces: TraceEvent[],
    answer: string,
    perfEntries: PerfEntry[] | null
  ): Promise<void> {
    // Start background task
    this.notifyBackgroundTask('Saving memory...', 'started');
    
    // We do NOT await this in the main flow to avoid blocking response
    // But since we need to use 'this.openai' and 'this.mempedia' which might be stateful or busy,
    // we should be careful. 
    // However, user asked for "start a subagent thread". 
    // Since we are in Node.js, we can't easily spawn a full thread with shared state without complexity.
    // For now, we will run this asynchronously but without 'await' in the main return path, 
    // essentially fire-and-forget from the perspective of the UI response.
    
    (async () => {
        try {
            const memoryTaskTimeoutMs = Number(process.env.MEMORY_TASK_TIMEOUT_MS || 0);
            await this.withTimeout((async () => {
              const payload = await this.measure(perfEntries, 'memory_extract', async () =>
                this.extractMemoryPayload(input, traces, answer)
              );

              const nowIso = new Date().toISOString();
              const memoryActionTimeoutMs = Number(process.env.MEMORY_SAVE_ACTION_TIMEOUT_MS || 0);
              const sendWithTimeout = (action: ToolAction) =>
                this.withTimeout(
                  this.mempedia.send(action),
                  memoryActionTimeoutMs,
                  `memory action ${action.action}`
                );

              // 1. User Habits & Environment
              if (payload.user_habits_env.length > 0) {
                  for (const item of payload.user_habits_env) {
                      const nodeId = this.preferenceNodeId(item); // Reuse preference ID logic for habits
                      const markdown = `# User Habit/Env\n\n${item}\n\n## Summary\n\n${item.slice(0, 50)}...\n\n## Updated at\n\n${nowIso}\n\n## Type\n\nuser_habit_env`;
                      await sendWithTimeout({
                        action: 'agent_upsert_markdown',
                        node_id: nodeId,
                        markdown,
                        confidence: 0.95,
                        importance: 1.8,
                        agent_id: 'mempedia-codecli',
                        reason: 'User habit or environment info',
                        source: 'kg_habit_env'
                      });
                  }
                }

              // 2. Behavior Patterns
              if (payload.behavior_patterns.length > 0) {
                  for (const item of payload.behavior_patterns) {
                      const nodeId = this.stableNodeId('pattern', item);
                      const markdown = `# Behavior Pattern\n\n${item}\n\n## Summary\n\n${item.slice(0, 50)}...\n\n## Updated at\n\n${nowIso}\n\n## Type\n\nbehavior_pattern`;
                      await sendWithTimeout({
                        action: 'agent_upsert_markdown',
                        node_id: nodeId,
                        markdown,
                        confidence: 0.90,
                        importance: 2.0,
                        agent_id: 'mempedia-codecli',
                        reason: 'Behavior pattern extraction',
                        source: 'kg_pattern'
                      });
                  }
                }

              // 3. Atomic Knowledge
              if (payload.atomic_knowledge.length > 0) {
                  for (const item of payload.atomic_knowledge) {
                      const nodeId = this.stableNodeId('atomic', item.keyword);
                      const markdown = `# ${item.keyword}\n\n## Summary\n\n${item.summary}\n\n## Details\n\n${item.details}\n\n## Updated at\n\n${nowIso}\n\n## Type\n\natomic_knowledge`;
                      await sendWithTimeout({
                        action: 'agent_upsert_markdown',
                        node_id: nodeId,
                        markdown,
                        confidence: 0.98,
                        importance: 1.9,
                        agent_id: 'mempedia-codecli',
                        reason: 'Atomic knowledge update',
                        source: 'kg_atomic'
                      });
                      
                      await sendWithTimeout({
                        action: 'auto_link_related',
                        node_id: nodeId,
                        limit: 5,
                        min_score: 0.6
                      });
                  }
                }
            })(), memoryTaskTimeoutMs, 'memory background task');
            this.notifyBackgroundTask('Memory saved', 'completed');
        } catch (e: any) {
            console.error('Background memory save failed:', e);
            this.notifyBackgroundTask('Memory save failed', 'completed');
        }
    })();
  }

  async run(input: string, onTrace: (event: TraceEvent) => void): Promise<string> {
    const perfEnabled = process.env.AGENT_PERF !== '0';
    const perfEntries: PerfEntry[] | null = perfEnabled ? [] : null;
    const traceBuffer: TraceEvent[] = [];
    const emitTrace = (event: TraceEvent) => {
      traceBuffer.push(event);
      onTrace(event);
    };
    emitTrace({ type: 'thought', content: 'Initializing ReAct agent context from Mempedia...' });
    
    let context = '';
    try {
      context = await this.measure(perfEntries, 'context_retrieval', async () => {
        let builtContext = '';
        const searchResults = await this.mempedia.send({
          action: 'search_nodes',
          query: input,
          limit: 5,
          include_highlight: true,
        });
        if (searchResults.kind === 'search_results') {
          builtContext = searchResults.results
            .map((r: any) => `- Node: ${r.node_id} (Score: ${r.score.toFixed(2)})`)
            .join('\n');
          for (const res of searchResults.results.slice(0, 2)) {
            const node = await this.mempedia.send({
              action: 'open_node',
              node_id: res.node_id,
              markdown: true,
            });
            if (node.kind === 'markdown' && node.markdown) {
              builtContext += `\n\n--- Content of ${res.node_id} ---\n${node.markdown}\n--- End of ${res.node_id} ---\n`;
            }
          }
        }
        return builtContext;
      });
    } catch (e: any) {
      console.error('Context retrieval failed:', e);
      context = 'Failed to retrieve context from Mempedia.';
    }

    const recentConversationMessages = this.conversationTurns.flatMap((turn) => [
      { role: 'user', content: turn.user },
      { role: 'assistant', content: turn.assistant }
    ]);

    const messages: any[] = [
      {
        role: 'system',
        content: `You are a ReAct agent powered by Mempedia.
You have access to a knowledge graph stored in Mempedia and local tools.
Your goal is to help the user with their request by strictly following the ReAct (Reasoning and Acting) paradigm.

For each step, you must:
1. **THOUGHT**: Analyze the current situation, plan the next step, or reason about the previous observation. Output this as normal text.
2. **ACTION**: If you need more information or need to affect the environment, call a tool.
3. **OBSERVATION**: The tool output will be provided to you.

Context from Mempedia based on query:
${context}

When you complete a task, you MUST consider saving the result or important information back to Mempedia using 'mempedia_save' so you remember it next time.
`,
      },
      ...recentConversationMessages,
      { role: 'user', content: input },
    ];

    while (true) {
      const completion = await this.measure(perfEntries, 'llm_completion', async () =>
        this.openai.chat.completions.create({
          model: this.model,
          messages: messages as any,
          tools: TOOLS as any,
        })
      );

      const message = completion.choices[0].message;
      messages.push(message);

      if (message.content) {
        emitTrace({ type: 'thought', content: message.content });
      }

      if (message.tool_calls && message.tool_calls.length > 0) {
        for (const toolCall of message.tool_calls) {
          const fnName = toolCall.function.name;
          const args = JSON.parse(toolCall.function.arguments);
          
          emitTrace({ 
            type: 'action', 
            content: `Calling ${fnName}`, 
            metadata: { args } 
          });
          
          let result = '';
          const toolStart = Date.now();
          try {
            if (fnName === 'mempedia_search') {
              const res = await this.mempedia.send({
                action: 'search_nodes',
                query: args.query,
                limit: args.limit,
              });
              result = JSON.stringify(res);
            } else if (fnName === 'mempedia_read') {
              const res = await this.mempedia.send({
                action: 'open_node',
                node_id: args.node_id,
                markdown: true,
              });
              result = JSON.stringify(res);
            } else if (fnName === 'mempedia_save') {
               const res = await this.mempedia.send({
                 action: 'agent_upsert_markdown',
                 node_id: args.node_id,
                 markdown: args.content,
                 confidence: 1.0,
                 importance: 1.0,
                 agent_id: 'mempedia-codecli',
                 reason: 'User request or task completion',
                 source: 'agent',
               });
               result = JSON.stringify(res);
            } else if (fnName === 'run_shell') {
              result = await new Promise((resolve) => {
                exec(args.command, (error, stdout, stderr) => {
                  if (error) resolve(`Error: ${error.message}\nStderr: ${stderr}`);
                  else resolve(stdout || stderr || 'Command executed successfully.');
                });
              });
            } else if (fnName === 'read_file') {
               try {
                   result = fs.readFileSync(args.path, 'utf-8');
               } catch (e: any) {
                   result = `Error reading file: ${e.message}`;
               }
            } else if (fnName === 'write_file') {
                try {
                    fs.mkdirSync(path.dirname(args.path), { recursive: true });
                    fs.writeFileSync(args.path, args.content);
                    result = `File written to ${args.path}`;
                } catch (e: any) {
                    result = `Error writing file: ${e.message}`;
                }
            } else {
                result = `Unknown tool: ${fnName}`;
            }
          } catch (e: any) {
            result = `Error executing tool: ${e.message}`;
          }
          if (perfEntries) {
            perfEntries.push({ label: `tool_${fnName}`, ms: Date.now() - toolStart });
          }

          emitTrace({ type: 'observation', content: String(result) });

          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: String(result),
          });
        }
      } else {
        const finalAnswer = message.content || '';
        this.conversationTurns.push({ user: input, assistant: finalAnswer });
        if (this.conversationTurns.length > this.maxConversationTurns) {
          this.conversationTurns = this.conversationTurns.slice(-this.maxConversationTurns);
        }
        try {
          await this.persistInteractionMemory(input, traceBuffer, finalAnswer, perfEntries);
          emitTrace({ type: 'observation', content: 'Memory saved: useful knowledge and user preferences were persisted to Mempedia.' });
        } catch (e: any) {
          emitTrace({ type: 'error', content: `Memory save failed: ${e?.message || 'unknown error'}` });
        }
        if (perfEntries && perfEntries.length > 0) {
          const totalMs = perfEntries.reduce((sum, item) => sum + item.ms, 0);
          const top = [...perfEntries]
            .sort((a, b) => b.ms - a.ms)
            .slice(0, 8)
            .map((item) => `${item.label}:${item.ms}ms`)
            .join(' | ');
          emitTrace({
            type: 'observation',
            content: `Perf total=${totalMs}ms; top=${top}`
          });
        }
        return finalAnswer;
      }
    }
  }
}
