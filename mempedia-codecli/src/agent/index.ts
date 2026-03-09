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
}

interface MemoryExtraction {
  intent: string;
  thoughts: string[];
  facts: string[];
  omit: string[];
}

export class Agent {
  private openai: OpenAI;
  private mempedia: MempediaClient;
  private model: string;
  private interactionCounter: number;

  constructor(config: AgentConfig, projectRoot: string) {
    this.openai = new OpenAI({ 
      apiKey: config.apiKey,
      baseURL: config.baseURL 
    });
    this.model = config.model || 'gpt-4o';
    this.mempedia = new MempediaClient(projectRoot);
    this.interactionCounter = 0;
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

  private async extractMemoryPayload(input: string, traces: TraceEvent[], answer: string): Promise<MemoryExtraction> {
    const traceLines = traces
      .slice(-30)
      .map((t) => `${t.type.toUpperCase()}: ${t.content}`)
      .join('\n');
    const extractionPrompt = `请提取以下对话中应长期保存到知识库的信息。\n输出必须是 JSON（不要 markdown）并使用这个结构：\n{"intent":"...","thoughts":["..."],"facts":["..."],"omit":["..."]}\n规则：\n1) intent 必须概括用户真实目标。\n2) thoughts 只保留与任务策略有关的高价值想法，去掉寒暄和重复。\n3) facts 只保留可复用的重要事实，不要日志噪音。\n4) omit 列出你主动忽略的杂音类型。\n5) 所有字段必须存在。`;
    const userPayload = `用户输入:\n${input}\n\n执行轨迹:\n${traceLines}\n\n最终回答:\n${answer}`;
    try {
      const extraction = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: extractionPrompt },
          { role: 'user', content: userPayload }
        ]
      });
      const content = extraction.choices[0]?.message?.content || '{}';
      const parsed = JSON.parse(content);
      const intent = typeof parsed.intent === 'string' ? parsed.intent.trim() : input.trim();
      const thoughts = this.normalizeItems(parsed.thoughts, 8).filter((line) => !this.isNoiseLine(line));
      const facts = this.normalizeItems(parsed.facts, 12).filter((line) => !this.isNoiseLine(line));
      const omit = this.normalizeItems(parsed.omit, 8);
      return {
        intent: intent || input.trim(),
        thoughts,
        facts,
        omit
      };
    } catch (_) {
      const fallbackThoughts = this.normalizeItems(
        traces.filter((t) => t.type === 'thought').map((t) => t.content),
        8
      ).filter((line) => !this.isNoiseLine(line));
      const fallbackFacts = this.normalizeItems(
        traces.filter((t) => t.type === 'observation').map((t) => t.content),
        10
      ).filter((line) => !this.isNoiseLine(line));
      return {
        intent: input.trim(),
        thoughts: fallbackThoughts,
        facts: fallbackFacts,
        omit: ['重复寒暄', '运行日志噪音', '无信息量输出']
      };
    }
  }

  private async persistInteractionMemory(input: string, traces: TraceEvent[], answer: string): Promise<void> {
    const payload = await this.extractMemoryPayload(input, traces, answer);
    const intentNodeId = this.buildNodeId('intent');
    const intentMarkdown = `# User Intent\n\n${payload.intent}\n\n## Original Input\n\n${input}`;
    await this.mempedia.send({
      action: 'agent_upsert_markdown',
      node_id: intentNodeId,
      markdown: intentMarkdown,
      confidence: 0.95,
      importance: 1.4,
      agent_id: 'mempedia-codecli',
      reason: 'Capture user intent for future retrieval',
      source: 'interaction_intent'
    });
    const factLines = payload.facts.length > 0 ? payload.facts.map((f) => `- ${f}`).join('\n') : '- 无';
    const thoughtLines = payload.thoughts.length > 0 ? payload.thoughts.map((f) => `- ${f}`).join('\n') : '- 无';
    const omitLines = payload.omit.length > 0 ? payload.omit.map((f) => `- ${f}`).join('\n') : '- 无';
    const knowledgeNodeId = this.buildNodeId('knowledge');
    const knowledgeMarkdown = `# Interaction Memory\n\n## Intent\n\n${payload.intent}\n\n## Strategic Thoughts\n\n${thoughtLines}\n\n## Important Facts\n\n${factLines}\n\n## Omitted Noise\n\n${omitLines}\n\n## Final Answer Snapshot\n\n${answer}`;
    await this.mempedia.send({
      action: 'agent_upsert_markdown',
      node_id: knowledgeNodeId,
      markdown: knowledgeMarkdown,
      confidence: 0.92,
      importance: 1.6,
      agent_id: 'mempedia-codecli',
      reason: 'Persist high-value thoughts and facts with noise filtering',
      source: 'interaction_memory'
    });
  }

  async run(input: string, onTrace: (event: TraceEvent) => void): Promise<string> {
    const traceBuffer: TraceEvent[] = [];
    const emitTrace = (event: TraceEvent) => {
      traceBuffer.push(event);
      onTrace(event);
    };
    emitTrace({ type: 'thought', content: 'Initializing ReAct agent context from Mempedia...' });
    
    let context = '';
    try {
      const searchResults = await this.mempedia.send({
        action: 'search_nodes',
        query: input,
        limit: 5,
        include_highlight: true,
      });

      if (searchResults.kind === 'search_results') {
        context = searchResults.results
          .map((r: any) => `- Node: ${r.node_id} (Score: ${r.score.toFixed(2)})`)
          .join('\n');
        
        for (const res of searchResults.results.slice(0, 2)) {
          const node = await this.mempedia.send({
            action: 'open_node',
            node_id: res.node_id,
            markdown: true,
          });
          if (node.kind === 'markdown' && node.markdown) {
              context += `\n\n--- Content of ${res.node_id} ---\n${node.markdown}\n--- End of ${res.node_id} ---\n`;
          }
        }
      }
    } catch (e: any) {
      console.error('Context retrieval failed:', e);
      context = 'Failed to retrieve context from Mempedia.';
    }

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
      { role: 'user', content: input },
    ];

    while (true) {
      const completion = await this.openai.chat.completions.create({
        model: this.model,
        messages: messages as any,
        tools: TOOLS as any,
      });

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

          emitTrace({ type: 'observation', content: String(result) });

          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: String(result),
          });
        }
      } else {
        const finalAnswer = message.content || '';
        try {
          await this.persistInteractionMemory(input, traceBuffer, finalAnswer);
          emitTrace({ type: 'observation', content: 'Memory saved: intent, strategic thoughts, and important facts were persisted to Mempedia.' });
        } catch (e: any) {
          emitTrace({ type: 'error', content: `Memory save failed: ${e?.message || 'unknown error'}` });
        }
        return finalAnswer;
      }
    }
  }
}
