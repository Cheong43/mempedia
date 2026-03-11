import OpenAI from 'openai';
import crypto from 'crypto';
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
      name: 'mempedia_conversation_lookup',
      description: 'Lookup local raw conversation records mapped to a mempedia node.',
      parameters: {
        type: 'object',
        properties: {
          node_id: { type: 'string', description: 'The node ID to lookup mapped conversations for' },
          limit: { type: 'number', description: 'Max number of mapped conversation records' },
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

function createHmacClient(baseURL: string | undefined, accessKey: string, secretKey: string): ChatClient {
  if (!baseURL) {
    throw new Error('HMAC baseURL is required');
  }
  const base = baseURL.endsWith('/') ? baseURL : `${baseURL}/`;
  return {
    chat: {
      completions: {
        create: async (args: any) => {
          const url = new URL('chat/completions', base);
          const bodyJson = JSON.stringify(args ?? {});
          const digestHash = crypto.createHash('sha256').update(bodyJson).digest('base64');
          const digest = `SHA-256=${digestHash}`;
          const date = new Date().toUTCString();
          const requestPath = `${url.pathname}${url.search || ''}`;
          const requestLine = `POST ${requestPath} HTTP/1.1`;
          const host = url.host;
          const signingData = `Digest: ${digest}\nX-Date: ${date}\nhost: ${host}\n${requestLine}`;
          const signature = crypto
            .createHmac('sha256', secretKey)
            .update(signingData)
            .digest('base64');
          const authorization = `hmac username="${accessKey}", algorithm="hmac-sha256", headers="Digest X-Date host request-line", signature="${signature}"`;

          const res = await fetch(url.toString(), {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Date': date,
              Digest: digest,
              Authorization: authorization
            },
            body: bodyJson
          });
          const text = await res.text();
          if (!res.ok) {
            const error = new Error(`HMAC request failed: ${res.status} ${res.statusText} ${text}`);
            (error as any).status = res.status;
            throw error;
          }
          return JSON.parse(text);
        }
      }
    }
  };
}

function createGatewayClient(baseURL: string | undefined, gatewayApiKey: string): ChatClient {
  if (!baseURL) {
    throw new Error('Gateway baseURL is required');
  }
  const base = baseURL.endsWith('/') ? baseURL : `${baseURL}/`;
  return {
    chat: {
      completions: {
        create: async (args: any) => {
          const url = new URL('chat/completions', base);
          const bodyJson = JSON.stringify(args ?? {});
          const res = await fetch(url.toString(), {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-gatewat-apikey': `Bearer ${gatewayApiKey}`,
              'x-gateway-apikey': `Bearer ${gatewayApiKey}`
            },
            body: bodyJson
          });
          const text = await res.text();
          if (!res.ok) {
            const error = new Error(`Gateway request failed: ${res.status} ${res.statusText} ${text}`);
            (error as any).status = res.status;
            throw error;
          }
          return JSON.parse(text);
        }
      }
    }
  };
}

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
  gatewayApiKey?: string;
  memoryGatewayApiKey?: string;
  hmacAccessKey?: string;
  hmacSecretKey?: string;
  memoryHmacAccessKey?: string;
  memoryHmacSecretKey?: string;
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
  user_habits_env: Array<{ topic: string; summary: string; details: string }>;
  behavior_patterns: Array<{ pattern_key: string; summary: string; details: string; applicable_plan?: string }>;
  atomic_knowledge: Array<{ keyword: string; summary: string; details: string }>;
}

type ChatClient = {
  chat: {
    completions: {
      create: (args: any) => Promise<any>;
    };
  };
};

export class Agent {
  private openai: ChatClient;
  private memoryOpenai: ChatClient;
  private mempedia: MempediaClient;
  private model: string;
  private memoryModel: string;
  private interactionCounter: number;
  private readonly maxConversationTurns: number;
  private conversationTurns: ConversationTurn[];
  private onBackgroundTaskCallback: ((task: string, status: 'started' | 'completed') => void) | null = null;
  private saveQueue: Array<{ input: string; traces: TraceEvent[]; answer: string }> = [];
  private saveInProgress = false;
  private saveCurrentPromise: Promise<void> | null = null;
  private saveDebounceTimer: NodeJS.Timeout | null = null;
  private savePendingDrain = false;
  private readonly saveDebounceMs: number;
  private readonly saveBatchTurnsLimit: number;
  private readonly extractionMaxChars: number;
  private readonly autoLinkEnabled: boolean;
  private readonly autoLinkMaxNodes: number;
  private readonly autoLinkLimit: number;
  private readonly memoryTaskTimeoutMs: number;
  private readonly memoryExtractTimeoutMs: number;
  private readonly memoryActionTimeoutMs: number;
  private readonly memoryLogPath: string;
  private readonly conversationLogDir: string;
  private readonly nodeConversationMapPath: string;

  constructor(config: AgentConfig, projectRoot: string, binaryPath?: string) {
    this.openai = config.hmacAccessKey && config.hmacSecretKey
      ? createHmacClient(config.baseURL, config.hmacAccessKey, config.hmacSecretKey)
      : config.gatewayApiKey
        ? createGatewayClient(config.baseURL, config.gatewayApiKey)
        : new OpenAI({
            apiKey: config.apiKey,
            baseURL: config.baseURL
          });
    const memoryBaseURL = config.memoryBaseURL || config.baseURL;
    const memoryAccessKey = config.memoryHmacAccessKey || config.hmacAccessKey;
    const memorySecretKey = config.memoryHmacSecretKey || config.hmacSecretKey;
    const memoryGatewayKey = config.memoryGatewayApiKey || config.gatewayApiKey;
    this.memoryOpenai = memoryAccessKey && memorySecretKey
      ? createHmacClient(memoryBaseURL, memoryAccessKey, memorySecretKey)
      : memoryGatewayKey
        ? createGatewayClient(memoryBaseURL, memoryGatewayKey)
        : new OpenAI({
            apiKey: config.memoryApiKey || config.apiKey,
            baseURL: memoryBaseURL
          });
    this.model = config.model || 'gpt-4o';
    this.memoryModel = config.memoryModel || this.model;
    this.mempedia = new MempediaClient(projectRoot, binaryPath);
    this.interactionCounter = 0;
    this.maxConversationTurns = 5;
    this.conversationTurns = [];
    const rawDebounce = Number(process.env.MEMORY_SAVE_DEBOUNCE_MS ?? 3000);
    this.saveDebounceMs = Number.isFinite(rawDebounce) ? Math.max(0, rawDebounce) : 3000;
    const rawBatchTurns = Number(process.env.MEMORY_SAVE_BATCH_TURNS ?? 4);
    this.saveBatchTurnsLimit = Number.isFinite(rawBatchTurns) ? Math.max(1, Math.min(20, Math.floor(rawBatchTurns))) : 4;
    const rawExtractionMaxChars = Number(process.env.MEMORY_EXTRACTION_MAX_CHARS ?? 12000);
    this.extractionMaxChars = Number.isFinite(rawExtractionMaxChars) ? Math.max(2000, Math.floor(rawExtractionMaxChars)) : 12000;
    const rawAutoLinkEnabled = String(process.env.MEMORY_AUTO_LINK_ENABLED ?? '1').toLowerCase();
    this.autoLinkEnabled = rawAutoLinkEnabled !== '0' && rawAutoLinkEnabled !== 'false' && rawAutoLinkEnabled !== 'off';
    const rawAutoLinkMaxNodes = Number(process.env.MEMORY_AUTO_LINK_MAX_NODES ?? 6);
    this.autoLinkMaxNodes = Number.isFinite(rawAutoLinkMaxNodes) ? Math.max(0, Math.min(50, Math.floor(rawAutoLinkMaxNodes))) : 6;
    const rawAutoLinkLimit = Number(process.env.MEMORY_AUTO_LINK_LIMIT ?? 5);
    this.autoLinkLimit = Number.isFinite(rawAutoLinkLimit) ? Math.max(1, Math.min(20, Math.floor(rawAutoLinkLimit))) : 5;
    const rawMemoryTaskTimeoutMs = Number(process.env.MEMORY_TASK_TIMEOUT_MS ?? 180000);
    this.memoryTaskTimeoutMs = Number.isFinite(rawMemoryTaskTimeoutMs) ? Math.max(1000, Math.floor(rawMemoryTaskTimeoutMs)) : 180000;
    const rawMemoryExtractTimeoutMs = Number(process.env.MEMORY_EXTRACT_TIMEOUT_MS ?? 90000);
    this.memoryExtractTimeoutMs = Number.isFinite(rawMemoryExtractTimeoutMs) ? Math.max(1000, Math.floor(rawMemoryExtractTimeoutMs)) : 90000;
    const rawMemoryActionTimeoutMs = Number(process.env.MEMORY_SAVE_ACTION_TIMEOUT_MS ?? 20000);
    this.memoryActionTimeoutMs = Number.isFinite(rawMemoryActionTimeoutMs) ? Math.max(1000, Math.floor(rawMemoryActionTimeoutMs)) : 20000;
    this.memoryLogPath = path.join(projectRoot, '.mempedia', 'memory', 'index', 'codecli_memory_save.log');
    this.conversationLogDir = path.join(projectRoot, '.mempedia', 'memory', 'index', 'conversations');
    this.nodeConversationMapPath = path.join(projectRoot, '.mempedia', 'memory', 'index', 'node_conversations.jsonl');
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

  async shutdown(timeoutMs = 12000): Promise<void> {
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
      this.saveDebounceTimer = null;
    }
    if (this.saveQueue.length > 0 && !this.saveInProgress) {
      this.drainSaveQueue();
    }
    const startedAt = Date.now();
    while ((this.saveInProgress || this.saveCurrentPromise) && Date.now() - startedAt < timeoutMs) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    this.stop();
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

  private normalizeSummary(summary: unknown, fallback: string): string {
    const raw = typeof summary === 'string' ? summary : '';
    const compact = raw.replace(/\s+/g, ' ').trim();
    if (compact.length >= 8) {
      return compact.slice(0, 140);
    }
    const fb = fallback.replace(/\s+/g, ' ').trim();
    if (fb.length >= 8) {
      return fb.slice(0, 140);
    }
    return `${(fb || 'memory').slice(0, 120)} summary`;
  }

  private normalizeDetails(details: unknown, fallback: string): string {
    const raw = typeof details === 'string' ? details : '';
    const compact = raw.trim();
    if (compact.length > 0) {
      return compact;
    }
    return fallback;
  }

  private clipText(value: string, maxChars: number): string {
    if (maxChars <= 0 || value.length <= maxChars) {
      return value;
    }
    return value.slice(value.length - maxChars);
  }

  private appendMemoryLog(runId: string, phase: string, data: Record<string, unknown> = {}) {
    try {
      fs.mkdirSync(path.dirname(this.memoryLogPath), { recursive: true });
      const row = {
        ts: new Date().toISOString(),
        run_id: runId,
        phase,
        ...data
      };
      fs.appendFileSync(this.memoryLogPath, `${JSON.stringify(row)}\n`, 'utf-8');
    } catch {}
  }

  private appendConversationLog(runId: string, input: string, traces: TraceEvent[], answer: string): string {
    const conversationId = `conv_${runId}`;
    try {
      fs.mkdirSync(this.conversationLogDir, { recursive: true });
      const payload = {
        id: conversationId,
        timestamp: new Date().toISOString(),
        input,
        answer,
        traces
      };
      const filePath = path.join(this.conversationLogDir, `${conversationId}.json`);
      fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');
    } catch {}
    return conversationId;
  }

  private appendNodeConversationMap(nodeId: string, conversationId: string, reason: string) {
    try {
      fs.mkdirSync(path.dirname(this.nodeConversationMapPath), { recursive: true });
      const row = {
        ts: new Date().toISOString(),
        node_id: nodeId,
        conversation_id: conversationId,
        reason
      };
      fs.appendFileSync(this.nodeConversationMapPath, `${JSON.stringify(row)}\n`, 'utf-8');
    } catch {}
  }

  private readNodeConversationRows(limit = 200): Array<{ node_id: string; conversation_id: string; reason?: string; ts?: string }> {
    try {
      if (!fs.existsSync(this.nodeConversationMapPath)) {
        return [];
      }
      const text = fs.readFileSync(this.nodeConversationMapPath, 'utf-8');
      const rows = text
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter((row) => row && typeof row.node_id === 'string' && typeof row.conversation_id === 'string');
      return rows.slice(-Math.max(1, limit));
    } catch {
      return [];
    }
  }

  private lookupMappedConversations(nodeId: string, limit = 3): Array<{
    node_id: string;
    conversation_id: string;
    ts?: string;
    reason?: string;
    input?: string;
    answer?: string;
  }> {
    const rows = this.readNodeConversationRows(400)
      .filter((row) => row.node_id === nodeId)
      .reverse();
    const seen = new Set<string>();
    const picked: Array<{ node_id: string; conversation_id: string; ts?: string; reason?: string }> = [];
    for (const row of rows) {
      if (seen.has(row.conversation_id)) {
        continue;
      }
      seen.add(row.conversation_id);
      picked.push(row);
      if (picked.length >= Math.max(1, limit)) {
        break;
      }
    }
    return picked.map((row) => {
      const filePath = path.join(this.conversationLogDir, `${row.conversation_id}.json`);
      if (!fs.existsSync(filePath)) {
        return row;
      }
      try {
        const payload = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        return {
          ...row,
          input: this.clipText(String(payload?.input || ''), 500),
          answer: this.clipText(String(payload?.answer || ''), 500),
        };
      } catch {
        return row;
      }
    });
  }

  private async extractMemoryPayload(input: string, traces: TraceEvent[], answer: string): Promise<MemoryExtraction> {
    const traceLines = traces
      .slice(-30)
      .map((t) => `${t.type.toUpperCase()}: ${t.content}`)
      .join('\n');
    const compactInput = this.clipText(input, this.extractionMaxChars);
    const compactTraces = this.clipText(traceLines, Math.max(2000, Math.floor(this.extractionMaxChars / 2)));
    const compactAnswer = this.clipText(answer, Math.max(1000, Math.floor(this.extractionMaxChars / 3)));
    const extractionPrompt = `请提取以下对话中应长期保存到知识库的信息。
输出必须是 JSON（不要 markdown）并使用这个结构：
{
  "user_habits_env": [
    { "topic": "环境或偏好关键词", "summary": "准确简短描述(必须)", "details": "证据与细节" }
  ],
  "behavior_patterns": [
    { "pattern_key": "稳定模式键(唯一)", "summary": "准确简短描述(必须)", "details": "可复用步骤与触发条件", "applicable_plan": "适用计划类型" }
  ],
  "atomic_knowledge": [
     { "keyword": "关键词(唯一标识)", "summary": "准确简短的描述(必须)", "details": "详细解释、事实、历史变迁、引申等" }
  ]
}

规则：
1. **user_habits_env (用户习惯与环境)**: 记录目前的环境信息与用户偏好，使用稳定topic归档并持续补充。
2. **behavior_patterns (行为模式)**: 模型在尝试完成某种用户计划时减去无意义尝试，只留下有用行为总结形成pattern；pattern_key必须稳定，后续持续更新同一node。
3. **atomic_knowledge (原子化知识)**: 
    - 所有知识node都应该由一个独立的关键词确认。
    - 关键词下可以有关联关系和更详细的描述，类似wikipedia一样。
    - 每个核心关键词知识都有系统性的知识（解释、事实、历史变迁、引申）记录并不断维护。
    - 如有重名的关键词知识，则在摘要中区分开。
    - **必须**包含 summary 字段，且为准确简短描述（8-140字）。

约束：
- 只有 atomic_knowledge 会被写入知识图谱节点；user_habits_env 与 behavior_patterns 会写入专用结构。
- 不要把原始对话逐字写入任何字段；只保留抽象、可复用的长期知识。

严禁输出寒暄、执行日志、临时上下文、错误堆栈。只保留长期有价值的信息。`;

    const userPayload = `用户输入:\n${compactInput}\n\n执行轨迹:\n${compactTraces}\n\n最终回答:\n${compactAnswer}`;
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
      const habits = Array.isArray(parsed.user_habits_env)
        ? parsed.user_habits_env.map((item: any) => {
            if (typeof item === 'string') {
              const topic = item.replace(/\s+/g, ' ').trim().slice(0, 64) || 'habit_env';
              return {
                topic,
                summary: this.normalizeSummary(item, topic),
                details: this.normalizeDetails(item, topic)
              };
            }
            const topic = typeof item?.topic === 'string'
              ? item.topic.replace(/\s+/g, ' ').trim().slice(0, 64)
              : '';
            const fallback = topic || item?.summary || 'habit_env';
            return {
              topic: topic || this.toSlug(String(fallback)).slice(0, 64),
              summary: this.normalizeSummary(item?.summary, String(fallback)),
              details: this.normalizeDetails(item?.details, String(fallback))
            };
          }).filter((x: any) => x.topic && x.summary)
        : [];
      const patterns = Array.isArray(parsed.behavior_patterns)
        ? parsed.behavior_patterns.map((item: any) => {
            if (typeof item === 'string') {
              const key = this.toSlug(item).slice(0, 64) || 'behavior_pattern';
              return {
                pattern_key: key,
                summary: this.normalizeSummary(item, key),
                details: this.normalizeDetails(item, key),
                applicable_plan: ''
              };
            }
            const rawKey = typeof item?.pattern_key === 'string' ? item.pattern_key : '';
            const fallback = rawKey || item?.summary || 'behavior_pattern';
            return {
              pattern_key: this.toSlug(String(rawKey || fallback)).slice(0, 64) || 'behavior_pattern',
              summary: this.normalizeSummary(item?.summary, String(fallback)),
              details: this.normalizeDetails(item?.details, String(fallback)),
              applicable_plan: typeof item?.applicable_plan === 'string' ? item.applicable_plan.trim() : ''
            };
          }).filter((x: any) => x.pattern_key && x.summary)
        : [];
      const atomic = Array.isArray(parsed.atomic_knowledge)
        ? parsed.atomic_knowledge.map((item: any) => {
            const keyword = typeof item?.keyword === 'string' ? item.keyword.replace(/\s+/g, ' ').trim() : '';
            if (!keyword) {
              return null;
            }
            return {
              keyword,
              summary: this.normalizeSummary(item?.summary, keyword),
              details: this.normalizeDetails(item?.details, keyword)
            };
          }).filter((x: any) => Boolean(x))
        : [];
      
      return {
        user_habits_env: habits.slice(0, 10),
        behavior_patterns: patterns.slice(0, 10),
        atomic_knowledge: atomic.slice(0, 20) as Array<{ keyword: string; summary: string; details: string }>
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
    this.notifyBackgroundTask('Saving memory...', 'started');
    const runId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const startedAt = Date.now();
    const conversationId = this.appendConversationLog(runId, input, traces, answer);
    this.appendMemoryLog(runId, 'memory_save_started', {
      input_chars: input.length,
      traces_count: traces.length,
      answer_chars: answer.length
    });
    try {
      await this.withTimeout((async () => {
        const extractionStartedAt = Date.now();
        const payload = await this.measure(perfEntries, 'memory_extract', async () =>
          this.withTimeout(
            this.extractMemoryPayload(input, traces, answer),
            this.memoryExtractTimeoutMs,
            'memory extraction'
          )
        );
        this.appendMemoryLog(runId, 'memory_extract_done', {
          elapsed_ms: Date.now() - extractionStartedAt,
          habits: payload.user_habits_env.length,
          patterns: payload.behavior_patterns.length,
          atomic: payload.atomic_knowledge.length
        });

        const nowIso = new Date().toISOString();
        const sendWithTimeout = (action: ToolAction) =>
          this.withTimeout(
            this.mempedia.send(action),
            this.memoryActionTimeoutMs,
            `memory action ${action.action}`
          );
        const runAction = async (stage: string, action: ToolAction) => {
          const stageStartedAt = Date.now();
          const nodeId = (action as any).node_id;
          this.appendMemoryLog(runId, `${stage}_started`, {
            action: action.action,
            node_id: typeof nodeId === 'string' ? nodeId : null
          });
          await sendWithTimeout(action);
          this.appendMemoryLog(runId, `${stage}_done`, {
            action: action.action,
            node_id: typeof nodeId === 'string' ? nodeId : null,
            elapsed_ms: Date.now() - stageStartedAt
          });
        };
        const linkedNodes = new Set<string>();

        if (payload.user_habits_env.length > 0) {
          const habitMap = new Map<string, { topic: string; summary: string; details: string }>();
          for (const item of payload.user_habits_env) {
            habitMap.set(this.toSlug(item.topic), item);
          }
          for (const item of habitMap.values()) {
            await runAction('habit_record', {
              action: 'record_user_habit',
              topic: item.topic,
              summary: item.summary,
              details: item.details,
              agent_id: 'mempedia-codecli',
              source: 'kg_habit_env'
            });
          }
        }

        if (payload.behavior_patterns.length > 0) {
          const patternMap = new Map<string, { pattern_key: string; summary: string; details: string; applicable_plan?: string }>();
          for (const item of payload.behavior_patterns) {
            patternMap.set(this.toSlug(item.pattern_key), {
              ...item,
              pattern_key: this.toSlug(item.pattern_key)
            });
          }
          for (const item of patternMap.values()) {
            await runAction('pattern_record', {
              action: 'record_behavior_pattern',
              pattern_key: item.pattern_key,
              summary: item.summary,
              details: item.details,
              applicable_plan: item.applicable_plan || '',
              agent_id: 'mempedia-codecli',
              source: 'kg_pattern_success'
            });
          }
        }

        if (payload.atomic_knowledge.length > 0) {
          const atomicMap = new Map<string, { keyword: string; summary: string; details: string }>();
          for (const item of payload.atomic_knowledge) {
            atomicMap.set(this.stableNodeId('atomic', item.keyword), item);
          }
          for (const [nodeId, item] of atomicMap) {
            const markdown = `# ${item.keyword}\n\n## Summary\n\n${item.summary}\n\n## Details\n\n${item.details}\n\n## Updated at\n\n${nowIso}\n\n## Type\n\natomic_knowledge`;
            await runAction('atomic_upsert', {
              action: 'agent_upsert_markdown',
              node_id: nodeId,
              markdown,
              confidence: 0.98,
              importance: 1.9,
              agent_id: 'mempedia-codecli',
              reason: 'Atomic knowledge update',
              source: 'kg_atomic'
            });
            linkedNodes.add(nodeId);
            this.appendNodeConversationMap(nodeId, conversationId, 'atomic_knowledge');
          }
        }

        if (linkedNodes.size === 0) {
          this.appendMemoryLog(runId, 'memory_payload_empty', { note: 'no atomic nodes generated' });
        }

        if (this.autoLinkEnabled && this.autoLinkMaxNodes > 0 && linkedNodes.size > 0) {
          const nodeIds = Array.from(linkedNodes).slice(0, this.autoLinkMaxNodes);
          this.appendMemoryLog(runId, 'auto_link_batch_started', {
            node_count: nodeIds.length,
            limit: this.autoLinkLimit
          });
          for (const nodeId of nodeIds) {
            await runAction('auto_link', {
              action: 'auto_link_related',
              node_id: nodeId,
              limit: this.autoLinkLimit,
              min_score: 0.6
            });
          }
          this.appendMemoryLog(runId, 'auto_link_batch_done', { node_count: nodeIds.length });
        }
      })(), this.memoryTaskTimeoutMs, 'memory background task');
      this.appendMemoryLog(runId, 'memory_save_done', {
        elapsed_ms: Date.now() - startedAt
      });
      this.notifyBackgroundTask('Memory saved', 'completed');
    } catch (e: any) {
      this.appendMemoryLog(runId, 'memory_save_failed', {
        elapsed_ms: Date.now() - startedAt,
        error: String(e?.message || e || 'unknown error')
      });
      console.error('Background memory save failed:', e);
      this.notifyBackgroundTask('Memory save failed', 'completed');
    }
  }

  private startSaveDebounce() {
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
    }
    this.saveDebounceTimer = setTimeout(() => {
      this.saveDebounceTimer = null;
      this.drainSaveQueue();
    }, this.saveDebounceMs);
  }

  private drainSaveQueue() {
    if (this.saveInProgress) {
      this.savePendingDrain = true;
      return;
    }
    if (this.saveQueue.length === 0) {
      return;
    }
    const batch = this.saveQueue.splice(0);
    this.saveInProgress = true;
    this.savePendingDrain = false;

    const effectiveBatch = batch.slice(-this.saveBatchTurnsLimit);
    const runId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.appendMemoryLog(runId, 'drain_save_queue', {
      queued_turns: batch.length,
      effective_turns: effectiveBatch.length,
      batch_turn_limit: this.saveBatchTurnsLimit
    });
    const combinedInput = effectiveBatch
      .map((item, index) => `Turn ${index + 1}\nUser:\n${item.input}\nAssistant:\n${item.answer}`)
      .join('\n\n---\n\n');
    const combinedAnswer = effectiveBatch[effectiveBatch.length - 1]?.answer || '';
    const combinedTraces = effectiveBatch.flatMap((item) => item.traces);

    this.saveCurrentPromise = this.persistInteractionMemory(combinedInput, combinedTraces, combinedAnswer, null);
    this.saveCurrentPromise
      .catch(() => {
        // errors are already logged inside persistInteractionMemory
      })
      .finally(() => {
        this.saveCurrentPromise = null;
        this.saveInProgress = false;
        if (this.savePendingDrain) {
          this.savePendingDrain = false;
        }
        if (this.saveQueue.length > 0) {
          this.startSaveDebounce();
          if (this.saveDebounceMs === 0) {
            this.drainSaveQueue();
          }
        }
      });
  }

  private scheduleMemorySave(input: string, traces: TraceEvent[], answer: string) {
    this.saveQueue.push({
      input,
      traces: traces.slice(),
      answer,
    });
    this.startSaveDebounce();
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
Save only atomic, reusable knowledge as nodes. Do not store raw conversation logs or transient context in nodes.
User habits and behavior patterns are stored by the system in separate structures; do not save them as nodes.
If needed, use 'mempedia_conversation_lookup' to inspect raw local conversation records mapped to a node.
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
            } else if (fnName === 'mempedia_conversation_lookup') {
              const records = this.lookupMappedConversations(String(args.node_id || ''), Number(args.limit || 3));
              result = JSON.stringify({ kind: 'local_conversation_records', node_id: args.node_id, records });
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
        this.scheduleMemorySave(input, traceBuffer, finalAnswer);
        emitTrace({ type: 'observation', content: 'Memory save queued (debounced + serialized).' });
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
