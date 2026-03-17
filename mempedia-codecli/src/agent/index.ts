import OpenAI from 'openai';
import crypto from 'crypto';
import { MempediaClient } from '../mempedia/client.js';
import { ToolAction } from '../mempedia/types.js';
import { exec } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { z } from 'zod';
import { createRuntime, RuntimeHandle } from '../runtime/index.js';

dotenv.config();

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
      name: 'mempedia_search_hybrid',
      description: 'Hybrid search using BM25/keyword + vector + graph with RRF fusion.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search query' },
          limit: { type: 'number', description: 'Max number of results' },
          rrf_k: { type: 'number', description: 'RRF k parameter (optional)' },
          bm25_weight: { type: 'number', description: 'Weight for BM25 list (optional)' },
          vector_weight: { type: 'number', description: 'Weight for vector list (optional)' },
          graph_weight: { type: 'number', description: 'Weight for graph list (optional)' },
          graph_depth: { type: 'number', description: 'Graph expansion depth (optional)' },
          graph_seed_limit: { type: 'number', description: 'Seed count from lexical/vector hits (optional)' },
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
      description: 'Save or update knowledge in mempedia using structured fields. Prefer title, summary, body, facts, evidence, and relations instead of markdown sections.',
      parameters: {
        type: 'object',
        properties: {
          node_id: { type: 'string', description: 'The ID of the node (unique)' },
          title: { type: 'string', description: 'Human-readable title of the node' },
          summary: { type: 'string', description: 'Short summary for retrieval and display' },
          body: { type: 'string', description: 'Main narrative body text; do not encode facts or evidence as markdown sections here' },
          facts: {
            type: 'object',
            description: 'Structured facts as key-value pairs',
            additionalProperties: { type: 'string' },
          },
          evidence: {
            type: 'array',
            description: 'Evidence strings stored in structured fields',
            items: { type: 'string' },
          },
          relations: {
            type: 'array',
            description: 'Graph relations to other nodes',
            items: {
              type: 'object',
              properties: {
                target: { type: 'string', description: 'Target node id or keyword' },
                label: { type: 'string', description: 'Optional relation label' },
                weight: { type: 'number', description: 'Optional relation weight' },
              },
              required: ['target'],
            },
          },
          source: { type: 'string', description: 'Optional source tag for this save' },
          content: { type: 'string', description: 'Legacy markdown content. Supported for compatibility, but structured fields are preferred.' },
        },
        required: ['node_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'queue_memory_save',
      description: 'Queue an asynchronous memory save job for valuable knowledge and the raw conversation snapshot without blocking the main reasoning loop.',
      parameters: {
        type: 'object',
        properties: {
          reason: { type: 'string', description: 'Why this memory is worth saving now.' },
          focus: { type: 'string', description: 'Optional summary of the valuable information to preserve.' },
          save_habits: { type: 'boolean', description: 'Whether to extract user habits from this snapshot.' },
          save_patterns: { type: 'boolean', description: 'Whether to extract reusable behavior patterns from this snapshot.' },
          save_atomic: { type: 'boolean', description: 'Whether to extract atomic project or domain knowledge from this snapshot.' },
        },
        required: ['reason'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'mempedia_traverse',
      description: 'Traverse the knowledge graph from a start node.',
      parameters: {
        type: 'object',
        properties: {
          start_node: { type: 'string', description: 'Start node id' },
          mode: { type: 'string', description: 'Traversal mode: bfs | dfs | importance_first | confidence_filtered' },
          depth_limit: { type: 'number', description: 'Depth limit (optional)' },
          min_confidence: { type: 'number', description: 'Min confidence for confidence_filtered mode (optional)' },
        },
        required: ['start_node', 'mode'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'mempedia_history',
      description: 'Inspect the version history of a node.',
      parameters: {
        type: 'object',
        properties: {
          node_id: { type: 'string', description: 'Node id' },
          limit: { type: 'number', description: 'Max number of versions (optional)' },
        },
        required: ['node_id'],
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
  {
    type: 'function',
    function: {
      name: 'mempedia_search_episodic',
      description: 'BM25 keyword search over episodic memory records (scene-based, time-ordered).',
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
      name: 'mempedia_list_episodic',
      description: 'List recent episodic memory records in reverse-chronological order.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Max number of records (default 20)' },
          before_ts: { type: 'number', description: 'Only records before this Unix timestamp (ms)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'mempedia_read_preferences',
      description: 'Read the project-scoped user preferences markdown file.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'mempedia_update_preferences',
      description: 'Overwrite the project-scoped user preferences markdown file.',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'Full markdown content of the preferences file' },
        },
        required: ['content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'mempedia_search_skills',
      description: 'BM25 keyword search over agent skill files.',
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
      name: 'mempedia_read_skill',
      description: 'Read the full content of a specific agent skill.',
      parameters: {
        type: 'object',
        properties: {
          skill_id: { type: 'string', description: 'The skill ID to read' },
        },
        required: ['skill_id'],
      },
    },
  },
];

const AGENT_TOOL_NAMES = [
  'mempedia_search',
  'mempedia_search_hybrid',
  'mempedia_read',
  'mempedia_conversation_lookup',
  'mempedia_save',
  'queue_memory_save',
  'mempedia_traverse',
  'mempedia_history',
  'mempedia_search_episodic',
  'mempedia_list_episodic',
  'mempedia_read_preferences',
  'mempedia_update_preferences',
  'mempedia_search_skills',
  'mempedia_read_skill',
  'run_shell',
  'read_file',
  'write_file',
] as const;

const PlannerToolNameSchema = z.enum(AGENT_TOOL_NAMES);

const PlannerToolCallSchema = z.object({
  name: PlannerToolNameSchema,
  arguments: z.record(z.any()).default({}),
  goal: z.string().trim().min(1).max(240).optional(),
});

const PlannerBranchSchema = z.object({
  label: z.string().trim().min(1).max(80),
  goal: z.string().trim().min(1).max(240),
  why: z.string().trim().min(1).max(240).optional(),
  priority: z.number().min(0).max(1).optional(),
});

const PlannerDecisionSchema = z.object({
  kind: z.enum(['tool', 'branch', 'final']),
  thought: z.string().trim().min(1),
  confidence: z.number().min(0).max(1).optional(),
  tool_calls: z.array(PlannerToolCallSchema).optional(),
  branches: z.array(PlannerBranchSchema).optional(),
  final_answer: z.string().optional(),
  completion_summary: z.string().trim().min(1).max(280).optional(),
});

type PlannerDecision = z.infer<typeof PlannerDecisionSchema>;

const ContextSelectionSchema = z.object({
  relevant_node_ids: z.array(z.string()).max(4).default([]),
  rationale: z.string().trim().min(1).max(280).optional(),
});

type ContextSelection = z.infer<typeof ContextSelectionSchema>;

interface BranchTranscriptMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ContextCandidate {
  nodeId: string;
  searchScore: number;
  markdown: string;
  preview: string;
}

interface RetrievedContext {
  contextText: string;
  recalledNodeIds: string[];
  selectedNodeIds: string[];
  rationale: string;
}

interface BranchState {
  id: string;
  parentId: string | null;
  depth: number;
  label: string;
  goal: string;
  priority: number;
  steps: number;
  transcript: BranchTranscriptMessage[];
  savedNodeIds: string[];
  completionSummary?: string;
  finalAnswer?: string;
  confidence?: number;
}

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
  metadata?: {
    branchId?: string;
    parentBranchId?: string | null;
    branchLabel?: string;
    depth?: number;
    step?: number;
    toolName?: string;
    [key: string]: any;
  };
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
  atomic_knowledge: Array<{ keyword: string; summary: string; description: string; evolution: string; relations: string[] }>;
}

interface MemorySaveJob {
  input: string;
  traces: TraceEvent[];
  answer: string;
  reason: string;
  focus?: string;
  saveHabits: boolean;
  savePatterns: boolean;
  saveAtomic: boolean;
  branchId?: string;
}

interface StructuredRelationInput {
  target: string;
  label?: string;
  weight?: number;
}

interface StructuredSavePayload {
  requestedNodeId: string;
  title: string;
  summary: string;
  body: string;
  facts: Record<string, string>;
  evidence: string[];
  relations: StructuredRelationInput[];
  source: string;
  comparableText: string;
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
  private saveQueue: MemorySaveJob[] = [];
  private saveInProgress = false;
  private saveCurrentPromise: Promise<void> | null = null;
  private savePendingDrain = false;
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
  private readonly relationSearchMinScore: number;
  private readonly relationSearchLimit: number;
  private readonly relationMax: number;
  private readonly branchMaxDepth: number;
  private readonly branchMaxWidth: number;
  private readonly branchMaxSteps: number;
  private readonly branchMaxCompleted: number;
  /** Governed runtime handle — routes mempedia actions through policy + guards. */
  private readonly runtimeHandle: RuntimeHandle;

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
    const rawRelationMinScore = Number(process.env.MEMORY_RELATION_MIN_SCORE ?? 1.2);
    this.relationSearchMinScore = Number.isFinite(rawRelationMinScore) ? Math.max(0, rawRelationMinScore) : 1.2;
    const rawRelationSearchLimit = Number(process.env.MEMORY_RELATION_SEARCH_LIMIT ?? 3);
    this.relationSearchLimit = Number.isFinite(rawRelationSearchLimit) ? Math.max(1, Math.min(10, Math.floor(rawRelationSearchLimit))) : 3;
    const rawRelationMax = Number(process.env.MEMORY_RELATION_MAX ?? 6);
    this.relationMax = Number.isFinite(rawRelationMax) ? Math.max(0, Math.min(20, Math.floor(rawRelationMax))) : 6;
    const rawBranchMaxDepth = Number(process.env.REACT_BRANCH_MAX_DEPTH ?? 2);
    this.branchMaxDepth = Number.isFinite(rawBranchMaxDepth) ? Math.max(0, Math.min(4, Math.floor(rawBranchMaxDepth))) : 2;
    const rawBranchMaxWidth = Number(process.env.REACT_BRANCH_MAX_WIDTH ?? 3);
    this.branchMaxWidth = Number.isFinite(rawBranchMaxWidth) ? Math.max(1, Math.min(5, Math.floor(rawBranchMaxWidth))) : 3;
    const rawBranchMaxSteps = Number(process.env.REACT_BRANCH_MAX_STEPS ?? 8);
    this.branchMaxSteps = Number.isFinite(rawBranchMaxSteps) ? Math.max(2, Math.min(24, Math.floor(rawBranchMaxSteps))) : 8;
    const rawBranchMaxCompleted = Number(process.env.REACT_BRANCH_MAX_COMPLETED ?? 4);
    this.branchMaxCompleted = Number.isFinite(rawBranchMaxCompleted) ? Math.max(1, Math.min(8, Math.floor(rawBranchMaxCompleted))) : 4;
    this.memoryLogPath = path.join(projectRoot, '.mempedia', 'memory', 'index', 'codecli_memory_save.log');
    this.conversationLogDir = path.join(projectRoot, '.mempedia', 'memory', 'index', 'conversations');
    this.nodeConversationMapPath = path.join(projectRoot, '.mempedia', 'memory', 'index', 'node_conversations.jsonl');

    // Bootstrap the governed runtime.  The MempediaClient is shared so the
    // runtime re-uses the already-started process connection.
    this.runtimeHandle = createRuntime({ projectRoot, agentId: 'agent-main' }, this.mempedia);
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

  async sendMempediaAction(action: ToolAction) {
    // Route through the governed runtime so that every UI-driven mempedia
    // operation is subject to policy evaluation, guard checks, and audit logging.
    return this.runtimeHandle.sendMempediaAction(action);
  }

  stop() {
    this.mempedia.stop();
  }

  async shutdown(timeoutMs = 12000): Promise<void> {
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
      || lc.includes('initializing branching react context')
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

  /**
   * Merge newly extracted user habits and behavior patterns into the existing
   * preferences markdown file. Each habit/pattern is recorded under a stable
   * heading so repeated updates stay idempotent.
   */
  private mergePreferencesMarkdown(
    existing: string,
    habits: Array<{ topic: string; summary: string; details: string }>,
    patterns: Array<{ pattern_key: string; summary: string; details: string; applicable_plan?: string }>,
    updatedAt: string
  ): string {
    // Keep the existing content as the base. We'll append/replace sections.
    let content = existing || `# User Preferences\n\n_Last updated: ${updatedAt}_\n`;

    // Upsert habits under ## Habits
    for (const habit of habits) {
      const heading = `### ${habit.topic}`;
      const block = `${heading}\n- **Summary**: ${habit.summary}\n- **Details**: ${habit.details}\n- _updated: ${updatedAt}_\n`;
      const idx = content.indexOf(`### ${habit.topic}`);
      if (idx >= 0) {
        // Replace from heading to the next same-level heading or end
        const nextIdx = content.indexOf('\n### ', idx + 1);
        if (nextIdx >= 0) {
          content = content.slice(0, idx) + block + '\n' + content.slice(nextIdx + 1);
        } else {
          // Try to find end of section (next ## or end of file)
          const nextSection = content.indexOf('\n## ', idx + 1);
          if (nextSection >= 0) {
            content = content.slice(0, idx) + block + '\n' + content.slice(nextSection + 1);
          } else {
            content = content.slice(0, idx) + block;
          }
        }
      } else {
        // Append to Habits section or add the section
        const habitSection = '## Habits';
        if (content.includes(habitSection)) {
          const sIdx = content.indexOf(habitSection);
          const nextSection = content.indexOf('\n## ', sIdx + 1);
          if (nextSection >= 0) {
            content = content.slice(0, nextSection) + '\n' + block + '\n' + content.slice(nextSection);
          } else {
            content = content.trimEnd() + '\n\n' + block;
          }
        } else {
          content = content.trimEnd() + '\n\n## Habits\n\n' + block;
        }
      }
    }

    // Upsert behavior patterns under ## Behavior Patterns
    for (const pattern of patterns) {
      const heading = `### ${pattern.pattern_key}`;
      const blockLines = [
        heading,
        `- **Summary**: ${pattern.summary}`,
        `- **Details**: ${pattern.details}`,
        pattern.applicable_plan ? `- **Applicable plan**: ${pattern.applicable_plan}` : null,
        `- _updated: ${updatedAt}_`,
        '',
      ].filter((l): l is string => l !== null);
      const block = blockLines.join('\n');
      const idx = content.indexOf(heading);
      if (idx >= 0) {
        const nextIdx = content.indexOf('\n### ', idx + 1);
        if (nextIdx >= 0) {
          content = content.slice(0, idx) + block + '\n' + content.slice(nextIdx + 1);
        } else {
          const nextSection = content.indexOf('\n## ', idx + 1);
          if (nextSection >= 0) {
            content = content.slice(0, idx) + block + '\n' + content.slice(nextSection + 1);
          } else {
            content = content.slice(0, idx) + block;
          }
        }
      } else {
        const patternSection = '## Behavior Patterns';
        if (content.includes(patternSection)) {
          const sIdx = content.indexOf(patternSection);
          const nextSection = content.indexOf('\n## ', sIdx + 1);
          if (nextSection >= 0) {
            content = content.slice(0, nextSection) + '\n' + block + '\n' + content.slice(nextSection);
          } else {
            content = content.trimEnd() + '\n\n' + block;
          }
        } else {
          content = content.trimEnd() + '\n\n## Behavior Patterns\n\n' + block;
        }
      }
    }

    return content;
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

  private normalizeOptional(details: unknown): string {
    const raw = typeof details === 'string' ? details : '';
    return raw.trim();
  }

  private yamlEscape(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, ' ').trim();
  }

  private normalizeRelations(relations: string[]): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const rel of relations) {
      const cleaned = rel.replace(/\s+/g, ' ').trim();
      if (!cleaned) {
        continue;
      }
      const slug = this.toSlug(cleaned);
      if (seen.has(slug)) {
        continue;
      }
      seen.add(slug);
      out.push(cleaned);
      if (out.length >= this.relationMax) {
        break;
      }
    }
    return out;
  }

  private async resolveRelationTargets(
    relations: string[]
  ): Promise<Array<{ label: string; target?: string }>> {
    const normalized = this.normalizeRelations(relations);
    const resolved: Array<{ label: string; target?: string }> = [];
    for (const rel of normalized) {
      let target: string | undefined;
      const directId = rel.trim();
      const maybeIds = [directId, `kg_atomic_${this.toSlug(rel)}`];
      for (const candidate of maybeIds) {
        if (!candidate || candidate.length < 2) {
          continue;
        }
        try {
          const open = await this.withTimeout(
            this.mempedia.send({ action: 'open_node', node_id: candidate, markdown: false }),
            this.memoryActionTimeoutMs,
            'relation open'
          );
          if (open && (open as any).kind !== 'error') {
            target = candidate;
            break;
          }
        } catch {}
      }
      if (!target) {
        try {
          const search = await this.withTimeout(
            this.mempedia.send({
              action: 'search_nodes',
              query: rel,
              limit: this.relationSearchLimit,
              include_highlight: false
            }),
            this.memoryActionTimeoutMs,
            'relation search'
          );
          if (search && (search as any).kind === 'search_results') {
            const results = (search as any).results || [];
            if (results.length > 0) {
              const top = results[0];
              const score = typeof top?.score === 'number' ? top.score : null;
              if (score === null || score >= this.relationSearchMinScore) {
                target = top.node_id;
              }
            }
          }
        } catch {}
      }
      resolved.push({ label: rel, target });
    }
    return resolved;
  }

  private firstSentence(text: string): string {
    const trimmed = text.replace(/\s+/g, ' ').trim();
    if (!trimmed) {
      return '';
    }
    const match = trimmed.match(/^[^。.!?\n]{12,200}[。.!?\n]/u);
    if (match) {
      return match[0].replace(/[\n\r]+/g, ' ').trim();
    }
    return trimmed.slice(0, 200);
  }

  private collectAtomicCandidates(input: string, answer: string): string[] {
    const candidates: string[] = [];
    const seen = new Set<string>();
    const push = (value: string) => {
      const cleaned = value.replace(/\s+/g, ' ').trim();
      if (cleaned.length < 2 || cleaned.length > 80) {
        return;
      }
      if (this.isPreferenceLine(cleaned)) {
        return;
      }
      const slug = this.toSlug(cleaned);
      if (seen.has(slug)) {
        return;
      }
      seen.add(slug);
      candidates.push(cleaned);
    };

    const backtickRegex = /`([^`]{2,80})`/g;
    const quotedRegex = /"([^"]{2,80})"/g;
    const pathRegex = /\b[\w.-]+\/[\w./-]+\b/g;

    const textPool = `${answer}\n${input}`;
    let match: RegExpExecArray | null = null;
    while ((match = backtickRegex.exec(textPool))) {
      push(match[1]);
    }
    while ((match = quotedRegex.exec(textPool))) {
      push(match[1]);
    }
    while ((match = pathRegex.exec(textPool))) {
      push(match[0]);
    }

    const answerLines = answer.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    for (const line of answerLines) {
      if (line.startsWith('#')) {
        push(line.replace(/^#+\s*/, ''));
        continue;
      }
      const colonIndex = line.indexOf(':') >= 0 ? line.indexOf(':') : line.indexOf('：');
      if (colonIndex > 1 && colonIndex < 60) {
        push(line.slice(0, colonIndex));
        continue;
      }
      if (line.includes(' - ')) {
        const [left] = line.split(' - ');
        push(left);
      }
    }

    const inputLine = input.split(/\r?\n/).map((line) => line.trim()).find((line) => line.length >= 8);
    if (inputLine) {
      const trimmed = inputLine.replace(/[\p{P}\p{S}]+/gu, ' ').trim();
      push(trimmed.slice(0, 60));
    }

    return candidates.slice(0, 8);
  }

  private fallbackExtractAtomic(input: string, answer: string): Array<{ keyword: string; summary: string; description: string; evolution: string; relations: string[] }> {
    const candidates = this.collectAtomicCandidates(input, answer);
    if (candidates.length === 0) {
      return [];
    }
    const answerLines = answer
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && this.isValuableKnowledgeLine(line));
    const summarySeed = this.firstSentence(answer) || this.firstSentence(input) || '';
    const candidateSet = new Set(candidates.map((c) => c.toLowerCase()));

    return candidates.map((candidate) => {
      const candidateLower = candidate.toLowerCase();
      const matchingLines = answerLines.filter((line) => line.toLowerCase().includes(candidateLower));
      const detailsSource = matchingLines.slice(0, 3).join('\n') || answerLines.slice(0, 3).join('\n') || summarySeed || candidate;
      const summarySource = matchingLines[0] || summarySeed || candidate;
      const evolutionSource = detailsSource === summarySource ? '' : detailsSource;
      const relations = candidates
        .filter((other) => other.toLowerCase() !== candidateLower && candidateSet.has(other.toLowerCase()))
        .slice(0, 4);
      return {
        keyword: candidate,
        summary: this.normalizeSummary(summarySource, candidate),
        description: this.normalizeDetails(detailsSource, candidate),
        evolution: this.normalizeOptional(evolutionSource),
        relations
      };
    }).filter((item) => item.keyword && item.summary);
  }

  private clipText(value: string, maxChars: number): string {
    if (maxChars <= 0 || value.length <= maxChars) {
      return value;
    }
    return value.slice(value.length - maxChars);
  }

  private parseFrontmatter(markdown: string): { frontmatter: Record<string, string>; body: string } {
    const match = markdown.match(/^---\s*[\r\n]+([\s\S]*?)\s*[\r\n]+---\s*[\r\n]*/);
    if (!match) {
      return { frontmatter: {}, body: markdown };
    }
    const frontmatter: Record<string, string> = {};
    for (const line of match[1].split(/\r?\n/)) {
      const [rawKey, ...rest] = line.split(':');
      if (!rawKey || rest.length === 0) {
        continue;
      }
      frontmatter[rawKey.trim()] = rest.join(':').trim().replace(/^"|"$/g, '');
    }
    return { frontmatter, body: markdown.slice(match[0].length) };
  }

  private extractMarkdownTitle(markdown: string): string {
    const { frontmatter, body } = this.parseFrontmatter(markdown);
    if (frontmatter.title) {
      return frontmatter.title.trim();
    }
    const heading = body.match(/^#\s+(.+)$/m);
    if (heading) {
      return heading[1].trim();
    }
    return '';
  }

  private parseStructuredRelation(value: unknown): StructuredRelationInput | null {
    if (!value) {
      return null;
    }
    if (typeof value === 'object' && !Array.isArray(value)) {
      const record = value as Record<string, unknown>;
      const target = typeof record.target === 'string' ? record.target.trim() : '';
      if (!target) {
        return null;
      }
      const label = typeof record.label === 'string' && record.label.trim() ? record.label.trim() : undefined;
      const weight = Number(record.weight);
      return {
        target,
        label,
        weight: Number.isFinite(weight) ? weight : undefined,
      };
    }
    const raw = String(value).trim().replace(/^[-*+]\s+/, '');
    if (!raw) {
      return null;
    }
    if (raw.includes('|')) {
      const parts = raw.split('|').map((part) => part.trim());
      const target = parts[0];
      if (!target) {
        return null;
      }
      const label = parts[1] || undefined;
      const weight = Number(parts[2]);
      return {
        target,
        label,
        weight: Number.isFinite(weight) ? weight : undefined,
      };
    }
    const fnStyle = raw.match(/^(.*?)\((.*)\)$/);
    if (fnStyle) {
      const target = fnStyle[1].trim();
      if (!target) {
        return null;
      }
      let label: string | undefined;
      let weight: number | undefined;
      for (const part of fnStyle[2].split(',')) {
        const [key, rawValue] = part.split('=').map((item) => item?.trim());
        if (!key || !rawValue) {
          continue;
        }
        if (key === 'label') {
          label = rawValue;
        }
        if (key === 'weight') {
          const parsed = Number(rawValue);
          if (Number.isFinite(parsed)) {
            weight = parsed;
          }
        }
      }
      return { target, label, weight };
    }
    return { target: raw };
  }

  private normalizeStructuredRelations(value: unknown): StructuredRelationInput[] {
    const input = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/\r?\n/) : [];
    const seen = new Set<string>();
    const out: StructuredRelationInput[] = [];
    for (const item of input) {
      const parsed = this.parseStructuredRelation(item);
      if (!parsed) {
        continue;
      }
      const key = `${this.toSlug(parsed.target)}__${this.toSlug(parsed.label || 'related')}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      out.push(parsed);
    }
    return out;
  }

  private normalizeStructuredFacts(value: unknown): Record<string, string> {
    const out: Record<string, string> = {};
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
        const factKey = String(key || '').trim();
        const factValue = typeof raw === 'string' ? raw.trim() : String(raw ?? '').trim();
        if (factKey && factValue) {
          out[factKey] = factValue;
        }
      }
      return out;
    }
    const lines = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/\r?\n/) : [];
    for (const item of lines) {
      const raw = String(item || '').trim().replace(/^[-*+]\s+/, '');
      if (!raw) {
        continue;
      }
      const match = raw.match(/^([^:=]+)\s*[:=]\s*(.+)$/);
      if (!match) {
        continue;
      }
      const key = match[1].trim();
      const factValue = match[2].trim();
      if (key && factValue) {
        out[key] = factValue;
      }
    }
    return out;
  }

  private normalizeStructuredEvidence(value: unknown): string[] {
    const input = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/\r?\n/) : [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of input) {
      const evidence = String(item || '').trim().replace(/^[-*+]\s+/, '');
      if (!evidence) {
        continue;
      }
      const key = evidence.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      out.push(evidence);
    }
    return out;
  }

  private normalizeStructuredSectionName(name: string): 'facts' | 'relations' | 'evidence' | null {
    const lower = name.trim().toLowerCase();
    if (['facts', 'fact', 'claims', 'claim'].includes(lower)) {
      return 'facts';
    }
    if (['relations', 'relation', 'links', 'link', 'related', 'related nodes', 'connections'].includes(lower)) {
      return 'relations';
    }
    if (['evidence', 'sources', 'source'].includes(lower)) {
      return 'evidence';
    }
    return null;
  }

  private extractStructuredSaveSections(body: string): {
    narrative: string;
    facts: Record<string, string>;
    evidence: string[];
    relations: StructuredRelationInput[];
  } {
    const facts: Record<string, string> = {};
    const evidence: string[] = [];
    const relations: StructuredRelationInput[] = [];
    const narrative: string[] = [];
    let current: 'facts' | 'relations' | 'evidence' | null = null;

    for (const rawLine of body.split(/\r?\n/)) {
      const trimmed = rawLine.trim();
      const heading = trimmed.match(/^#{2,3}\s+(.+)$/);
      if (heading) {
        const section = this.normalizeStructuredSectionName(heading[1]);
        if (section) {
          current = section;
          continue;
        }
        current = null;
        narrative.push(rawLine);
        continue;
      }

      if (current === 'facts') {
        const match = trimmed.replace(/^[-*+]\s+/, '').match(/^([^:=]+)\s*[:=]\s*(.+)$/);
        if (match) {
          facts[match[1].trim()] = match[2].trim();
        }
        continue;
      }

      if (current === 'relations') {
        const relation = this.parseStructuredRelation(trimmed);
        if (relation) {
          relations.push(relation);
        }
        continue;
      }

      if (current === 'evidence') {
        const item = trimmed.replace(/^[-*+]\s+/, '').trim();
        if (item) {
          evidence.push(item);
        }
        continue;
      }

      narrative.push(rawLine);
    }

    return {
      narrative: narrative.join('\n').trim(),
      facts,
      evidence: this.normalizeStructuredEvidence(evidence),
      relations: this.normalizeStructuredRelations(relations),
    };
  }

  private normalizeTextForSimilarity(value: string): string[] {
    return String(value || '')
      .toLowerCase()
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/[`#>*_\-:[\]()/\\|.,!?]/g, ' ')
      .replace(/\s+/g, ' ')
      .split(' ')
      .map((item) => item.trim())
      .filter((item) => item.length >= 3);
  }

  private lexicalOverlapScore(left: string, right: string): number {
    const leftTokens = new Set(this.normalizeTextForSimilarity(left));
    const rightTokens = new Set(this.normalizeTextForSimilarity(right));
    if (leftTokens.size === 0 || rightTokens.size === 0) {
      return 0;
    }
    let shared = 0;
    for (const token of leftTokens) {
      if (rightTokens.has(token)) {
        shared += 1;
      }
    }
    return shared / Math.max(1, Math.min(leftTokens.size, rightTokens.size));
  }

  private buildStructuredSavePayload(rawArgs: Record<string, unknown>): StructuredSavePayload {
    const requestedNodeId = String(rawArgs.node_id || '').trim();
    const explicitFacts = this.normalizeStructuredFacts(rawArgs.facts);
    const explicitEvidence = this.normalizeStructuredEvidence(rawArgs.evidence);
    const explicitRelations = this.normalizeStructuredRelations(rawArgs.relations);
    const legacyContent = typeof rawArgs.content === 'string' ? rawArgs.content.trim() : '';

    let title = typeof rawArgs.title === 'string' ? rawArgs.title.trim() : '';
    let summary = typeof rawArgs.summary === 'string' ? rawArgs.summary.trim() : '';
    let body = typeof rawArgs.body === 'string' ? rawArgs.body.trim() : '';
    let facts: Record<string, string> = { ...explicitFacts };
    let evidence = [...explicitEvidence];
    let relations = [...explicitRelations];

    if (legacyContent) {
      const { frontmatter, body: markdownBody } = this.parseFrontmatter(legacyContent);
      const structured = this.extractStructuredSaveSections(markdownBody);
      title = title || frontmatter.title?.trim() || this.extractMarkdownTitle(legacyContent) || '';
      summary = summary || frontmatter.summary?.trim() || this.firstSentence(structured.narrative || markdownBody) || '';
      body = body || structured.narrative || markdownBody.trim();
      facts = { ...structured.facts, ...facts };
      evidence = this.normalizeStructuredEvidence([...structured.evidence, ...evidence]);
      relations = this.normalizeStructuredRelations([...structured.relations, ...relations]);
    }

    title = title || requestedNodeId || this.firstSentence(body) || 'Untitled';
    summary = summary || this.firstSentence(body) || title;
    body = body || summary;

    const comparableText = [
      title,
      summary,
      body,
      ...Object.entries(facts).map(([key, value]) => `${key}: ${value}`),
      ...evidence,
      ...relations.map((relation) => `${relation.target} ${relation.label || 'related'} ${relation.weight ?? ''}`.trim()),
    ].filter(Boolean).join('\n');

    return {
      requestedNodeId,
      title,
      summary,
      body,
      facts,
      evidence,
      relations,
      source: typeof rawArgs.source === 'string' && rawArgs.source.trim() ? rawArgs.source.trim() : 'agent',
      comparableText,
    };
  }

  private deriveSaveNodeId(requestedNodeId: string, payload: StructuredSavePayload): string {
    const requested = requestedNodeId.trim();
    if (requested) {
      return requested;
    }
    const slug = this.toSlug(payload.title || this.firstSentence(payload.body) || payload.summary || 'saved_note');
    if (slug.includes('dir') || slug.includes('directory') || slug.includes('structure') || slug.includes('source')) {
      return `kg_code_${slug}`;
    }
    return `kg_doc_${slug}`;
  }

  private async guardedMempediaSave(rawArgs: Record<string, unknown>): Promise<Record<string, unknown>> {
    const payload = this.buildStructuredSavePayload(rawArgs);
    const originalNodeId = this.deriveSaveNodeId(payload.requestedNodeId, payload);
    const title = payload.title || originalNodeId;
    let resolvedNodeId = originalNodeId;
    let redirected = false;
    let redirectReason = '';

    const titleAlignment = this.lexicalOverlapScore(originalNodeId.replace(/_/g, ' '), title);
    if (payload.requestedNodeId.trim() && titleAlignment < 0.18) {
      resolvedNodeId = this.deriveSaveNodeId('', payload);
      redirected = resolvedNodeId !== originalNodeId;
      redirectReason = `save redirected from ${originalNodeId} to ${resolvedNodeId} because requested node id does not align with markdown title`;
    }

    try {
      const existing = await this.mempedia.send({
        action: 'open_node',
        node_id: redirected ? resolvedNodeId : originalNodeId,
        markdown: true,
      });
      if ((existing as any)?.kind === 'markdown' && typeof (existing as any)?.markdown === 'string') {
        const existingMarkdown = String((existing as any).markdown || '');
        const overlap = this.lexicalOverlapScore(payload.comparableText, existingMarkdown);
        const titleSlug = this.toSlug(title);
        const idLooksAligned = resolvedNodeId.includes(titleSlug) || titleSlug.includes(this.toSlug(resolvedNodeId));
        if (overlap < 0.16 && !idLooksAligned) {
          resolvedNodeId = this.deriveSaveNodeId('', payload);
          redirected = resolvedNodeId !== originalNodeId;
          redirectReason = `save redirected from ${originalNodeId} to ${resolvedNodeId} due to low content overlap (${overlap.toFixed(2)})`;
        }
      }
    } catch {
      // missing node is acceptable; keep original node id
    }

    const result = await this.mempedia.send({
      action: 'ingest',
      node_id: resolvedNodeId,
      title: title,
      text: payload.body,
      summary: payload.summary,
      facts: Object.keys(payload.facts).length > 0 ? payload.facts : undefined,
      relations: payload.relations.length > 0 ? payload.relations : undefined,
      evidence: payload.evidence.length > 0 ? payload.evidence : undefined,
      source: payload.source,
      agent_id: 'mempedia-codecli',
      reason: redirected ? `Branching ReAct task completion (${redirectReason})` : 'Branching ReAct task completion',
      confidence: 1.0,
      importance: 1.0,
    });

    return {
      requested_node_id: payload.requestedNodeId || originalNodeId,
      resolved_node_id: resolvedNodeId,
      stored_mode: 'structured_fields',
      redirected,
      redirect_reason: redirectReason || undefined,
      result,
    };
  }

  private extractSavedNodeId(payload: string): string | null {
    try {
      const parsed = JSON.parse(payload);
      const direct = parsed?.resolved_node_id || parsed?.node_id || parsed?.version?.node_id || parsed?.result?.version?.node_id;
      return typeof direct === 'string' && direct.trim() ? direct.trim() : null;
    } catch {
      return null;
    }
  }

  private isLikelyFollowUp(input: string): boolean {
    const text = input.trim().toLowerCase();
    if (!text) {
      return false;
    }
    const explicitMarkers = [
      '继续', '接着', '刚才', '上一个', '上个问题', '上述', '前面', '这个', '那个', '它', '他们', '这些',
      'that', 'those', 'it', 'them', 'previous', 'earlier', 'continue', 'follow up', 'same topic', 'also', 'then'
    ];
    if (explicitMarkers.some((marker) => text.includes(marker))) {
      return true;
    }
    const compactTokens = this.normalizeTextForSimilarity(text);
    return compactTokens.length <= 4;
  }

  private selectRelevantConversationTurns(input: string): ConversationTurn[] {
    if (this.conversationTurns.length === 0) {
      return [];
    }
    const followUp = this.isLikelyFollowUp(input);
    const scored = this.conversationTurns
      .map((turn, index) => {
        const combined = `${turn.user}\n${turn.assistant}`;
        const overlap = this.lexicalOverlapScore(input, combined);
        const recency = (index + 1) / Math.max(1, this.conversationTurns.length) * 0.18;
        const score = overlap + (followUp ? recency : recency * 0.5);
        return { turn, score, index };
      })
      .sort((a, b) => b.score - a.score || b.index - a.index);

    const threshold = followUp ? 0.06 : 0.12;
    const selected = scored.filter((item) => item.score >= threshold).slice(0, followUp ? 2 : 1);
    if (selected.length > 0) {
      return selected
        .sort((a, b) => a.index - b.index)
        .map((item) => item.turn);
    }
    if (followUp) {
      return this.conversationTurns.slice(-1);
    }
    return [];
  }

  private buildContextCandidatePreview(markdown: string): string {
    const title = this.extractMarkdownTitle(markdown);
    const compact = this.clipText(markdown.replace(/\s+/g, ' ').trim(), 1200);
    return title ? `${title} :: ${compact}` : compact;
  }

  private heuristicSelectContextCandidates(input: string, candidates: ContextCandidate[], selectedTurns: ConversationTurn[]): ContextCandidate[] {
    const anchor = [
      input,
      ...selectedTurns.flatMap((turn) => [turn.user, turn.assistant]),
    ].join('\n');
    return candidates
      .map((candidate) => {
        const overlap = this.lexicalOverlapScore(anchor, candidate.preview || candidate.markdown);
        const score = candidate.searchScore + overlap * 2.2;
        return { candidate, score };
      })
      .sort((a, b) => b.score - a.score)
      .filter((item, index) => item.score >= 0.18 || index < 2)
      .slice(0, 3)
      .map((item) => item.candidate);
  }

  private async selectRelevantContextCandidates(
    input: string,
    candidates: ContextCandidate[],
    selectedTurns: ConversationTurn[],
    perfEntries: PerfEntry[] | null,
  ): Promise<{ selected: ContextCandidate[]; rationale: string }> {
    if (candidates.length <= 1) {
      return {
        selected: candidates,
        rationale: candidates.length === 1 ? 'Only one recalled context candidate was available.' : 'No recalled context candidates were available.',
      };
    }

    const candidateList = candidates.map((candidate, index) => [
      `${index + 1}. node_id=${candidate.nodeId}`,
      `score=${candidate.searchScore.toFixed(2)}`,
      `preview=${this.clipText(candidate.preview, 600)}`,
    ].join('\n')).join('\n\n');

    const recentTurnsText = selectedTurns.length > 0
      ? selectedTurns.map((turn, index) => `Turn ${index + 1}\nUser: ${turn.user}\nAssistant: ${turn.assistant}`).join('\n\n')
      : '(none)';

    try {
      const completion = await this.measure(perfEntries, 'context_selection', async () =>
        this.openai.chat.completions.create({
          model: this.model,
          messages: [
            {
              role: 'system',
              content: 'You are a context selector. First assume all recalled context may be noisy. Then choose only the context candidates that are directly relevant to the current user request. Return JSON only: {"relevant_node_ids":[...],"rationale":"..."}. Select at most 3 node ids.',
            },
            {
              role: 'user',
              content: `Current user request:\n${input}\n\nSelected recent conversation turns:\n${recentTurnsText}\n\nRecalled context candidates:\n${candidateList}`,
            },
          ] as any,
        })
      );
      const raw = String(completion.choices[0]?.message?.content || '').trim();
      const jsonText = raw.startsWith('{') ? raw : raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
      const parsed = ContextSelectionSchema.parse(JSON.parse(jsonText));
      const allowed = new Set(parsed.relevant_node_ids);
      const selected = candidates.filter((candidate) => allowed.has(candidate.nodeId)).slice(0, 3);
      if (selected.length > 0) {
        return {
          selected,
          rationale: parsed.rationale || `Selected ${selected.length} context candidates after relevance filtering.`,
        };
      }
    } catch {
      // fall through to heuristic selection
    }

    const selected = this.heuristicSelectContextCandidates(input, candidates, selectedTurns);
    return {
      selected,
      rationale: `Selected ${selected.length} context candidates with heuristic relevance filtering.`,
    };
  }

  private async retrieveRelevantContext(
    input: string,
    selectedTurns: ConversationTurn[],
    perfEntries: PerfEntry[] | null,
  ): Promise<RetrievedContext> {
    const query = [input, ...selectedTurns.map((turn) => turn.user)].filter(Boolean).join('\n');
    const searchResults = await this.mempedia.send({
      action: 'search_hybrid',
      query,
      limit: 10,
    });

    if (searchResults.kind !== 'search_results' || !Array.isArray(searchResults.results) || searchResults.results.length === 0) {
      return {
        contextText: '',
        recalledNodeIds: [],
        selectedNodeIds: [],
        rationale: 'No context candidates were recalled from Mempedia.',
      };
    }

    const recalledNodeIds = searchResults.results.map((item: any) => String(item.node_id));
    const candidates: ContextCandidate[] = [];
    for (const hit of searchResults.results.slice(0, 5)) {
      const opened = await this.mempedia.send({
        action: 'open_node',
        node_id: String(hit.node_id),
        markdown: true,
      });
      if (opened.kind !== 'markdown' || !opened.markdown) {
        continue;
      }
      candidates.push({
        nodeId: String(hit.node_id),
        searchScore: typeof hit.score === 'number' ? hit.score : 0,
        markdown: String(opened.markdown),
        preview: this.buildContextCandidatePreview(String(opened.markdown)),
      });
    }

    const { selected, rationale } = await this.selectRelevantContextCandidates(input, candidates, selectedTurns, perfEntries);
    const contextText = selected
      .map((candidate) => `--- Context: ${candidate.nodeId} (score=${candidate.searchScore.toFixed(2)}) ---\n${candidate.markdown}\n--- End Context: ${candidate.nodeId} ---`)
      .join('\n\n');

    return {
      contextText,
      recalledNodeIds,
      selectedNodeIds: selected.map((candidate) => candidate.nodeId),
      rationale,
    };
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
     { "keyword": "关键词(唯一标识)", "summary": "准确简短的摘要(必须)", "description": "较完整的描述", "evolution": "历史变迁/版本沿革/发展", "relations": ["相关关键词1", "相关关键词2"] }
  ]
}

规则：
1. **user_habits_env (用户习惯与环境)**: 记录目前的环境信息与用户偏好，使用稳定topic归档并持续补充。
2. **behavior_patterns (行为模式)**: 模型在尝试完成某种用户计划时减去无意义尝试，只留下有用行为总结形成pattern；pattern_key必须稳定，后续持续更新同一node。
3. **atomic_knowledge (原子化知识)**: 
    - 所有知识node都应该由一个独立的关键词确认。
    - 关键词下包含摘要、描述、变迁、关联关系，类似wikipedia一样。
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
            const rawRelations = Array.isArray(item?.relations)
              ? item.relations
              : Array.isArray(item?.related_keywords)
                ? item.related_keywords
                : [];
            const relations = rawRelations
              .map((rel: any) => typeof rel === 'string' ? rel.replace(/\s+/g, ' ').trim() : '')
              .filter((rel: string) => rel.length > 0 && rel.toLowerCase() !== keyword.toLowerCase())
              .slice(0, 8);
            return {
              keyword,
              summary: this.normalizeSummary(item?.summary || item?.description, keyword),
              description: this.normalizeDetails(item?.description || item?.summary, keyword),
              evolution: this.normalizeOptional(item?.evolution || item?.details),
              relations
            };
          }).filter((x: any) => Boolean(x))
        : [];
      
      return {
        user_habits_env: habits.slice(0, 10),
        behavior_patterns: patterns.slice(0, 10),
      atomic_knowledge: atomic.slice(0, 20) as Array<{ keyword: string; summary: string; description: string; evolution: string; relations: string[] }>
    };
  } catch (_) {
    return this.fallbackExtractMemory(input, answer);
  }
  }

  private fallbackExtractMemory(input: string, answer: string): MemoryExtraction {
    const text = `${input}\n${answer}`;
    const habits: Array<{ topic: string; summary: string; details: string }> = [];
    const patterns: Array<{ pattern_key: string; summary: string; details: string; applicable_plan?: string }> = [];

    const habitRegex = /(偏好|喜欢|习惯|不喜欢|讨厌|避免)[^。\\n]{0,120}/;
    const habitMatch = text.match(habitRegex);
    if (habitMatch) {
      const phrase = habitMatch[0].trim();
      const topic = phrase.slice(0, 32);
      habits.push({
        topic,
        summary: this.normalizeSummary(phrase, topic),
        details: this.normalizeDetails(phrase, topic)
      });
    }

    const hasSteps = /步骤|流程|最佳实践|注意事项|操作方法|建议/.test(text) || /\\n\\s*\\d+\\./.test(text);
    if (hasSteps) {
      const key = this.toSlug(answer.slice(0, 64) || 'behavior_pattern').slice(0, 64) || 'behavior_pattern';
      patterns.push({
        pattern_key: key,
        summary: this.normalizeSummary(answer.slice(0, 200), key),
        details: this.normalizeDetails(answer.slice(0, 600), key),
        applicable_plan: ''
      });
    }

    return {
      user_habits_env: habits.slice(0, 5),
      behavior_patterns: patterns.slice(0, 5),
      atomic_knowledge: this.fallbackExtractAtomic(input, answer)
    };
  }

  private async persistInteractionMemory(
    job: MemorySaveJob,
    perfEntries: PerfEntry[] | null
  ): Promise<void> {
    const input = job.input;
    const traces = job.traces;
    const answer = job.answer;
    this.notifyBackgroundTask('Saving memory...', 'started');
    const runId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const startedAt = Date.now();
    const conversationId = this.appendConversationLog(runId, input, traces, answer);
    this.appendMemoryLog(runId, 'memory_save_started', {
      reason: job.reason,
      focus: job.focus || '',
      branch_id: job.branchId || null,
      save_habits: job.saveHabits,
      save_patterns: job.savePatterns,
      save_atomic: job.saveAtomic,
      input_chars: input.length,
      traces_count: traces.length,
      answer_chars: answer.length
    });
    try {
      await this.withTimeout((async () => {
        const extractionStartedAt = Date.now();
        const extractionInput = [
          `保存原因: ${job.reason}`,
          job.focus ? `保存重点: ${job.focus}` : '',
          `类别选择: habits=${job.saveHabits} patterns=${job.savePatterns} atomic=${job.saveAtomic}`,
          '',
          input,
        ].filter(Boolean).join('\n');
        let payload = await this.measure(perfEntries, 'memory_extract', async () =>
          this.withTimeout(
            this.extractMemoryPayload(extractionInput, traces, answer),
            this.memoryExtractTimeoutMs,
            'memory extraction'
          )
        );
        if (!job.saveHabits) {
          payload.user_habits_env = [];
        }
        if (!job.savePatterns) {
          payload.behavior_patterns = [];
        }
        if (!job.saveAtomic) {
          payload.atomic_knowledge = [];
        }
        if (
          payload.user_habits_env.length === 0 &&
          payload.behavior_patterns.length === 0 &&
          payload.atomic_knowledge.length === 0
        ) {
          const fallbackPayload = this.fallbackExtractMemory(extractionInput, answer);
          if (!job.saveHabits) {
            fallbackPayload.user_habits_env = [];
          }
          if (!job.savePatterns) {
            fallbackPayload.behavior_patterns = [];
          }
          if (!job.saveAtomic) {
            fallbackPayload.atomic_knowledge = [];
          }
          if (
            fallbackPayload.user_habits_env.length > 0 ||
            fallbackPayload.behavior_patterns.length > 0 ||
            fallbackPayload.atomic_knowledge.length > 0
          ) {
            payload = fallbackPayload;
          }
        }
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
          const result = await sendWithTimeout(action);
          if (result && (result as any).kind === 'error') {
            this.appendMemoryLog(runId, `${stage}_error`, {
              action: action.action,
              node_id: typeof nodeId === 'string' ? nodeId : null,
              message: (result as any).message || 'unknown error'
            });
          }
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
          const atomicMap = new Map<string, { keyword: string; summary: string; description: string; evolution: string; relations: string[] }>();
          for (const item of payload.atomic_knowledge) {
            atomicMap.set(this.stableNodeId('atomic', item.keyword), item);
          }
          for (const [nodeId, item] of atomicMap) {
            const resolvedRelations = await this.resolveRelationTargets(item.relations || []);
            const evolutionSection = item.evolution && item.evolution.trim().length > 0
              ? item.evolution
              : '暂无';
            const descriptionSection = item.description && item.description.trim().length > 0
              ? item.description
              : item.summary;
            await runAction('atomic_upsert', {
              action: 'ingest',
              node_id: nodeId,
              title: item.keyword,
              text: `${descriptionSection}\n\nEvolution\n${evolutionSection}`,
              summary: item.summary,
              facts: {
                type: 'atomic_knowledge',
                updated_at: nowIso,
              },
              relations: resolvedRelations
                .filter((rel) => rel.target)
                .map((rel) => ({ target: rel.target as string, label: 'related', weight: 0.8 })),
              evidence: [
                `conversation:${conversationId}`,
                `memory_run:${runId}`,
              ],
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
          this.appendMemoryLog(runId, 'memory_payload_empty', { note: 'no selected memory nodes generated' });
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

        // ── Record episodic memory (Layer 2) ─────────────────────────────────
        // Always record an episodic entry for this interaction so the timeline is
        // preserved. The entry stores the compressed answer as its summary and
        // links back to any core-knowledge nodes created/updated in this run.
        try {
          const episodicSummary = this.clipText(answer, 400) || this.clipText(input, 200) || 'interaction';
          const episodicTags = [
            ...payload.atomic_knowledge.slice(0, 5).map((k) => k.keyword),
            ...payload.user_habits_env.slice(0, 3).map((h) => h.topic),
          ].filter(Boolean);
          await sendWithTimeout({
            action: 'record_episodic',
            scene_type: 'conversation',
            summary: episodicSummary,
            raw_conversation_id: conversationId,
            importance: 1.0,
            core_knowledge_nodes: Array.from(linkedNodes),
            tags: episodicTags,
            agent_id: 'mempedia-codecli',
          });
          this.appendMemoryLog(runId, 'episodic_recorded', {
            conversation_id: conversationId,
            core_nodes: linkedNodes.size,
          });
        } catch (e: any) {
          this.appendMemoryLog(runId, 'episodic_record_failed', {
            error: String(e?.message || e || 'unknown')
          });
        }

        // ── Sync user preferences to markdown file (Layer 3) ─────────────────
        // If habits were captured, append/update the preferences markdown file so
        // that the user's preferences live in one human-readable location.
        if (payload.user_habits_env.length > 0) {
          try {
            const prefRes = await sendWithTimeout({ action: 'read_user_preferences' });
            const existing = (prefRes as any).kind === 'user_preferences'
              ? String((prefRes as any).content || '')
              : '';
            const updatedPrefs = this.mergePreferencesMarkdown(
              existing,
              payload.user_habits_env,
              payload.behavior_patterns,
              nowIso
            );
            await sendWithTimeout({
              action: 'update_user_preferences',
              content: updatedPrefs,
            });
            this.appendMemoryLog(runId, 'preferences_synced', {
              habits: payload.user_habits_env.length,
              patterns: payload.behavior_patterns.length,
            });
          } catch (e: any) {
            this.appendMemoryLog(runId, 'preferences_sync_failed', {
              error: String(e?.message || e || 'unknown')
            });
          }
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

  private drainSaveQueue() {
    if (this.saveInProgress) {
      this.savePendingDrain = true;
      return;
    }
    if (this.saveQueue.length === 0) {
      return;
    }
    const job = this.saveQueue.shift()!;
    this.saveInProgress = true;
    this.savePendingDrain = false;

    this.saveCurrentPromise = this.persistInteractionMemory(job, null);
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
          this.drainSaveQueue();
        }
      });
  }

  private scheduleMemorySave(job: MemorySaveJob) {
    this.saveQueue.push({
      ...job,
      traces: job.traces.slice(),
    });
    this.appendMemoryLog(`${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, 'memory_save_enqueued', {
      reason: job.reason,
      focus: job.focus || '',
      branch_id: job.branchId || null,
      save_habits: job.saveHabits,
      save_patterns: job.savePatterns,
      save_atomic: job.saveAtomic,
      queue_depth: this.saveQueue.length,
    });
    if (!this.saveInProgress) {
      this.drainSaveQueue();
    }
  }

  async run(input: string, onTrace: (event: TraceEvent) => void): Promise<string> {
    const perfEnabled = process.env.AGENT_PERF !== '0';
    const perfEntries: PerfEntry[] | null = perfEnabled ? [] : null;
    const traceBuffer: TraceEvent[] = [];
    const emitTrace = (event: TraceEvent) => {
      traceBuffer.push(event);
      onTrace(event);
    };
    emitTrace({ type: 'thought', content: 'Initializing branching ReAct context from Mempedia...' });

    const selectedConversationTurns = this.selectRelevantConversationTurns(input);
    emitTrace({
      type: 'observation',
      content: selectedConversationTurns.length > 0
        ? `Selected ${selectedConversationTurns.length} relevant recent conversation turn(s) for follow-up grounding.`
        : 'Selected 0 recent conversation turns; treating this request as context-isolated.',
    });

    let context = '';
    let recalledNodeIds: string[] = [];
    let selectedNodeIds: string[] = [];
    try {
      const retrieved = await this.measure(perfEntries, 'context_retrieval', async () =>
        this.retrieveRelevantContext(input, selectedConversationTurns, perfEntries)
      );
      context = retrieved.contextText;
      recalledNodeIds = retrieved.recalledNodeIds;
      selectedNodeIds = retrieved.selectedNodeIds;
      emitTrace({
        type: 'observation',
        content: `Recalled ${recalledNodeIds.length} context candidate(s); selected ${selectedNodeIds.length} relevant node(s). ${retrieved.rationale}`,
      });
    } catch (e: any) {
      console.error('Context retrieval failed:', e);
      context = 'Failed to retrieve context from Mempedia.';
    }

    const recentConversationMessages = selectedConversationTurns.flatMap((turn) => [
      { role: 'user', content: turn.user },
      { role: 'assistant', content: turn.assistant }
    ]);

    const toolCatalog = TOOLS.map((tool) => {
      const fn = (tool as any).function;
      return `- ${fn.name}: ${fn.description}\n  params: ${JSON.stringify(fn.parameters)}`;
    }).join('\n');

    const systemPrompt = `You are a branching ReAct agent powered by Mempedia.
Treat ReAct as a functional loop. A branch is an independent child loop with its own thought -> action -> observation state.

You have access to a 4-layer knowledge system stored in Mempedia and local tools:
  Layer 1 – Core Knowledge: hierarchical graph nodes (mempedia_search_hybrid, mempedia_read, mempedia_save, mempedia_traverse)
  Layer 2 – Episodic Memory: time-ordered scene records with BM25 search (mempedia_search_episodic, mempedia_list_episodic)
  Layer 3 – User Preferences: single markdown config file per project (mempedia_read_preferences, mempedia_update_preferences)
  Layer 4 – Agent Skills: fast-retrieval skill files (mempedia_search_skills, mempedia_read_skill)

You must return exactly one JSON object on every loop iteration. Do not use markdown fences.

Allowed JSON schema:
{
  "kind": "tool" | "branch" | "final",
  "thought": "string",
  "confidence": 0.0,
  "tool_calls": [{ "name": "tool_name", "arguments": {}, "goal": "optional" }],
  "branches": [{ "label": "short label", "goal": "what this child branch should try", "why": "optional", "priority": 0.0 }],
  "final_answer": "string",
  "completion_summary": "optional short summary"
}

Rules:
1. Prefer kind="tool" when one next action is clearly best.
2. Use kind="branch" only when there are multiple materially distinct strategies worth trying.
3. A branch must represent a genuinely different hypothesis, search path, or execution strategy.
4. Never create more than ${this.branchMaxWidth} child branches in one step.
5. Prefer mempedia_search_hybrid for high-recall core-knowledge retrieval, then mempedia_read, mempedia_traverse, mempedia_history.
6. Use mempedia_search_episodic or mempedia_list_episodic to recall past interactions or time-bound context.
7. Use mempedia_read_preferences to check user preferences before making assumptions about user habits.
8. Use mempedia_search_skills or mempedia_read_skill to find relevant agent skills.
9. When you finish, return kind="final" with a direct user-facing answer.
10. Consider mempedia_save only for atomic reusable knowledge, not transient chatter. When you call it, prefer structured fields (title, summary, body, facts, evidence, relations) instead of markdown sections.
11. If needed, use mempedia_conversation_lookup to inspect raw local conversation records mapped to a node.
12. Never reuse an unrelated personal, preference, or habit node for project/code documentation. Prefer descriptive ids such as kg_code_*, kg_project_*, or kg_doc_*.
13. Use queue_memory_save when a branch has discovered valuable reusable information worth preserving asynchronously. Do not wait for the whole session to end. Use it sparingly.

Available tools:
${toolCatalog}

Shared Mempedia context for this request:
${context || '(no context found)'}

Selected context node ids:
${selectedNodeIds.length > 0 ? selectedNodeIds.join(', ') : '(none)'}
`;

    const rootBranch: BranchState = {
      id: 'B0',
      parentId: null,
      depth: 0,
      label: 'root',
      goal: 'Solve the user request end-to-end.',
      priority: 1,
      steps: 0,
      savedNodeIds: [],
      transcript: [
        {
          role: 'user',
          content: `Original user request:\n${input}\n\nStart with the root loop. Branch only when multiple distinct approaches are worth exploring.`,
        },
      ],
    };

    const queue: BranchState[] = [rootBranch];
    const completed: BranchState[] = [];
    let lastTouchedBranch: BranchState | null = rootBranch;
    let totalLoopSteps = 0;
    const totalLoopBudget = Math.max(this.branchMaxSteps, this.branchMaxSteps * this.branchMaxWidth * (this.branchMaxDepth + 1));

    const extractText = (content: any): string => {
      if (typeof content === 'string') {
        return content;
      }
      if (Array.isArray(content)) {
        return content.map((item) => {
          if (typeof item === 'string') {
            return item;
          }
          if (item && typeof item === 'object' && typeof item.text === 'string') {
            return item.text;
          }
          return JSON.stringify(item);
        }).join('\n');
      }
      if (content == null) {
        return '';
      }
      return String(content);
    };

    const traceMeta = (branch: BranchState, extra: Record<string, unknown> = {}) => ({
      branchId: branch.id,
      parentBranchId: branch.parentId,
      branchLabel: branch.label,
      depth: branch.depth,
      step: branch.steps,
      ...extra,
    });

    const emitBranchTrace = (
      type: TraceEvent['type'],
      branch: BranchState,
      content: string,
      extra: Record<string, unknown> = {}
    ) => {
      emitTrace({ type, content, metadata: traceMeta(branch, extra) });
    };

    const parseDecision = (raw: string): PlannerDecision => {
      const trimmed = raw.trim();
      const withoutFence = trimmed
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/```$/i, '')
        .trim();
      let jsonText = withoutFence;
      if (!jsonText.startsWith('{')) {
        const start = jsonText.indexOf('{');
        const end = jsonText.lastIndexOf('}');
        if (start >= 0 && end > start) {
          jsonText = jsonText.slice(start, end + 1);
        }
      }
      return PlannerDecisionSchema.parse(JSON.parse(jsonText));
    };

    const buildBranchMemoryJob = (
      branch: BranchState,
      reason: string,
      focus?: string,
      flags?: { saveHabits?: boolean; savePatterns?: boolean; saveAtomic?: boolean }
    ): MemorySaveJob => {
      const branchTraces = traceBuffer.filter((event) => {
        const eventBranchId = event.metadata?.branchId;
        return typeof eventBranchId === 'string' ? eventBranchId.startsWith(branch.id) : branch.id === 'B0';
      });
      const branchSummary = branch.finalAnswer || branch.completionSummary || branch.transcript.slice(-6).map((item) => item.content).join('\n\n');
      return {
        input: `Original user request:\n${input}\n\nActive branch: ${branch.id} (${branch.label})\nBranch goal: ${branch.goal}`,
        traces: branchTraces,
        answer: branchSummary,
        reason,
        focus: focus?.trim() || branch.goal,
        saveHabits: flags?.saveHabits ?? true,
        savePatterns: flags?.savePatterns ?? true,
        saveAtomic: flags?.saveAtomic ?? true,
        branchId: branch.id,
      };
    };

    const buildMessages = (branch: BranchState) => ([
      { role: 'system', content: systemPrompt },
      ...recentConversationMessages,
      ...branch.transcript,
      {
        role: 'user',
        content: `Current branch state:\n- branch_id: ${branch.id}\n- parent_branch_id: ${branch.parentId || 'none'}\n- depth: ${branch.depth}/${this.branchMaxDepth}\n- label: ${branch.label}\n- goal: ${branch.goal}\n- step_budget: ${branch.steps}/${this.branchMaxSteps}\n\nReturn exactly one JSON object. If branching is still useful, only emit materially distinct branches.`,
      },
    ]);

    const executeToolCall = async (branch: BranchState, toolCall: z.infer<typeof PlannerToolCallSchema>): Promise<string> => {
      const args = toolCall.arguments || {};
      const fnName = toolCall.name;
      emitBranchTrace('action', branch, `Calling ${fnName}${toolCall.goal ? ` — ${toolCall.goal}` : ''}`, {
        toolName: fnName,
        args,
      });

      const toolStart = Date.now();
      let result = '';
      try {
        if (fnName === 'mempedia_search') {
          const res = await this.mempedia.send({
            action: 'search_nodes',
            query: args.query,
            limit: args.limit,
          });
          result = JSON.stringify(res);
        } else if (fnName === 'mempedia_search_hybrid') {
          const res = await this.mempedia.send({
            action: 'search_hybrid',
            query: args.query,
            limit: args.limit,
            rrf_k: args.rrf_k,
            bm25_weight: args.bm25_weight,
            vector_weight: args.vector_weight,
            graph_weight: args.graph_weight,
            graph_depth: args.graph_depth,
            graph_seed_limit: args.graph_seed_limit,
          });
          result = JSON.stringify(res);
        } else if (fnName === 'mempedia_read') {
          const res = await this.mempedia.send({
            action: 'open_node',
            node_id: args.node_id,
            markdown: true,
          });
          result = JSON.stringify(res);
        } else if (fnName === 'mempedia_traverse') {
          const res = await this.mempedia.send({
            action: 'traverse',
            start_node: args.start_node,
            mode: args.mode,
            depth_limit: args.depth_limit,
            min_confidence: args.min_confidence,
          });
          result = JSON.stringify(res);
        } else if (fnName === 'mempedia_history') {
          const res = await this.mempedia.send({
            action: 'node_history',
            node_id: args.node_id,
            limit: args.limit,
          });
          result = JSON.stringify(res);
        } else if (fnName === 'mempedia_conversation_lookup') {
          const records = this.lookupMappedConversations(String(args.node_id || ''), Number(args.limit || 3));
          result = JSON.stringify({ kind: 'local_conversation_records', node_id: args.node_id, records });
        } else if (fnName === 'mempedia_save') {
          const res = await this.guardedMempediaSave(args as Record<string, unknown>);
          result = JSON.stringify(res);
        } else if (fnName === 'queue_memory_save') {
          const reason = String(args.reason || '').trim();
          if (!reason) {
            result = JSON.stringify({ kind: 'error', message: 'queue_memory_save requires reason' });
          } else {
            const job = buildBranchMemoryJob(branch, reason, typeof args.focus === 'string' ? args.focus : '', {
              saveHabits: typeof args.save_habits === 'boolean' ? args.save_habits : false,
              savePatterns: typeof args.save_patterns === 'boolean' ? args.save_patterns : true,
              saveAtomic: typeof args.save_atomic === 'boolean' ? args.save_atomic : true,
            });
            this.scheduleMemorySave(job);
            result = JSON.stringify({
              kind: 'queued_memory_save',
              branch_id: branch.id,
              reason,
              focus: job.focus,
              save_habits: job.saveHabits,
              save_patterns: job.savePatterns,
              save_atomic: job.saveAtomic,
              traces_count: job.traces.length,
            });
          }
        } else if (fnName === 'run_shell') {
          result = await new Promise((resolve) => {
            exec(String(args.command || ''), (error, stdout, stderr) => {
              if (error) {
                resolve(`Error: ${error.message}\nStderr: ${stderr}`);
                return;
              }
              resolve(stdout || stderr || 'Command executed successfully.');
            });
          });
        } else if (fnName === 'read_file') {
          try {
            result = fs.readFileSync(String(args.path || ''), 'utf-8');
          } catch (error: any) {
            result = `Error reading file: ${error.message}`;
          }
        } else if (fnName === 'write_file') {
          try {
            fs.mkdirSync(path.dirname(String(args.path || '')), { recursive: true });
            fs.writeFileSync(String(args.path || ''), String(args.content || ''));
            result = `File written to ${args.path}`;
          } catch (error: any) {
            result = `Error writing file: ${error.message}`;
          }
        } else if (fnName === 'mempedia_search_episodic') {
          const res = await this.mempedia.send({
            action: 'search_episodic',
            query: args.query,
            limit: args.limit,
          });
          result = JSON.stringify(res);
        } else if (fnName === 'mempedia_list_episodic') {
          const res = await this.mempedia.send({
            action: 'list_episodic',
            limit: args.limit,
            before_ts: args.before_ts,
          });
          result = JSON.stringify(res);
        } else if (fnName === 'mempedia_read_preferences') {
          const res = await this.mempedia.send({ action: 'read_user_preferences' });
          result = JSON.stringify(res);
        } else if (fnName === 'mempedia_update_preferences') {
          const res = await this.mempedia.send({
            action: 'update_user_preferences',
            content: String(args.content || ''),
          });
          result = JSON.stringify(res);
        } else if (fnName === 'mempedia_search_skills') {
          const res = await this.mempedia.send({
            action: 'search_skills',
            query: args.query,
            limit: args.limit,
          });
          result = JSON.stringify(res);
        } else if (fnName === 'mempedia_read_skill') {
          const res = await this.mempedia.send({
            action: 'read_skill',
            skill_id: String(args.skill_id || ''),
          });
          result = JSON.stringify(res);
        } else {
          result = `Unknown tool: ${fnName}`;
        }
      } catch (error: any) {
        result = `Error executing tool: ${error.message}`;
      }

      if (perfEntries) {
        perfEntries.push({ label: `tool_${branch.id}_${fnName}`, ms: Date.now() - toolStart });
      }

      const clipped = this.clipText(String(result), 7000);
      const savedNodeId = fnName === 'mempedia_save' ? this.extractSavedNodeId(clipped) : null;
      if (savedNodeId && !branch.savedNodeIds.includes(savedNodeId)) {
        branch.savedNodeIds.push(savedNodeId);
      }
      emitBranchTrace('observation', branch, clipped, { toolName: fnName });
      return clipped;
    };

    const finalizeFromBranch = async (branch: BranchState, reason: string): Promise<string> => {
      emitBranchTrace('thought', branch, `Forcing finalization for ${branch.id}: ${reason}`);
      const completion = await this.measure(perfEntries, `finalize_${branch.id}`, async () =>
        this.openai.chat.completions.create({
          model: this.model,
          messages: [
            { role: 'system', content: `${systemPrompt}\nYou must now finish. Do not branch. Do not call tools. Return plain text only.` },
            ...recentConversationMessages,
            ...branch.transcript,
            { role: 'user', content: `Finalize branch ${branch.id}. User request:\n${input}\n\nReason: ${reason}` },
          ] as any,
        })
      );
      return extractText(completion.choices[0]?.message?.content).trim();
    };

    const synthesizeCompletedBranches = async (branches: BranchState[]): Promise<string> => {
      if (branches.length === 1 && branches[0].finalAnswer) {
        return branches[0].finalAnswer;
      }
      emitTrace({ type: 'thought', content: `Synthesizing ${branches.length} completed branches into one final answer...` });
      const branchSummary = branches
        .sort((a, b) => (b.confidence ?? 0.5) - (a.confidence ?? 0.5))
        .map((branch) => [
          `Branch ${branch.id}`,
          `label: ${branch.label}`,
          `goal: ${branch.goal}`,
          `confidence: ${branch.confidence ?? 0.5}`,
          `saved_nodes: ${branch.savedNodeIds.length ? branch.savedNodeIds.join(', ') : '(none)'}`,
          `summary: ${branch.completionSummary || '(none)'}`,
          `answer:\n${branch.finalAnswer || ''}`,
        ].join('\n'))
        .join('\n\n---\n\n');

      const completion = await this.measure(perfEntries, 'branch_synthesis', async () =>
        this.openai.chat.completions.create({
          model: this.model,
          messages: [
            {
              role: 'system',
              content: 'You are the synthesis stage for a branching ReAct agent. Merge completed branches into the best possible final answer. Prefer correctness and directness. Mention uncertainty only when branches genuinely disagree. If you mention saved node ids, use only ids explicitly listed in saved_nodes. Do not invent node ids.',
            },
            {
              role: 'user',
              content: `User request:\n${input}\n\nShared context:\n${this.clipText(context || '(no shared context)', 4000)}\n\nCompleted branches:\n${branchSummary}`,
            },
          ] as any,
        })
      );

      return extractText(completion.choices[0]?.message?.content).trim();
    };

    while (queue.length > 0 && completed.length < this.branchMaxCompleted && totalLoopSteps < totalLoopBudget) {
      queue.sort((a, b) => (b.priority - a.priority) || (a.depth - b.depth) || (a.steps - b.steps));
      const branch = queue.shift()!;
      lastTouchedBranch = branch;

      if (branch.steps >= this.branchMaxSteps) {
        const forced = await finalizeFromBranch(branch, 'step budget reached');
        branch.finalAnswer = forced || branch.finalAnswer || 'I reached the reasoning budget without a stronger answer.';
        branch.completionSummary = branch.completionSummary || 'Forced finalization after step budget.';
        branch.confidence = branch.confidence ?? 0.45;
        completed.push(branch);
        emitBranchTrace('observation', branch, `Branch completed after hitting step budget.`);
        continue;
      }

      branch.steps += 1;
      totalLoopSteps += 1;

      let decision: PlannerDecision;
      try {
        const completion = await this.measure(perfEntries, `llm_${branch.id}_step_${branch.steps}`, async () =>
          this.openai.chat.completions.create({
            model: this.model,
            messages: buildMessages(branch) as any,
          })
        );
        const raw = extractText(completion.choices[0]?.message?.content);
        decision = parseDecision(raw);
      } catch (error: any) {
        emitBranchTrace('error', branch, `Failed to parse branch step: ${error.message}`);
        branch.transcript.push({
          role: 'user',
          content: `Your last response was invalid. Error: ${error.message}. Return exactly one valid JSON object next.`,
        });
        queue.push(branch);
        continue;
      }

      branch.confidence = decision.confidence ?? branch.confidence;
      branch.transcript.push({ role: 'assistant', content: JSON.stringify(decision) });
      emitBranchTrace('thought', branch, decision.thought);

      if (decision.kind === 'tool') {
        const toolCalls = (decision.tool_calls || []).slice(0, this.branchMaxWidth);
        if (toolCalls.length === 0) {
          branch.transcript.push({
            role: 'user',
            content: 'You selected kind="tool" but provided no tool_calls. Either provide tool_calls or finish with kind="final".',
          });
          queue.push(branch);
          continue;
        }

        for (const toolCall of toolCalls) {
          const observation = await executeToolCall(branch, toolCall);
          branch.transcript.push({
            role: 'user',
            content: `TOOL OBSERVATION for ${toolCall.name}:\n${observation}`,
          });
        }
        queue.push(branch);
        continue;
      }

      if (decision.kind === 'branch') {
        const children = (decision.branches || []).slice(0, this.branchMaxWidth);
        if (branch.depth >= this.branchMaxDepth || children.length < 2) {
          branch.transcript.push({
            role: 'user',
            content: `Branching was rejected because ${branch.depth >= this.branchMaxDepth ? 'the branch depth budget is exhausted' : 'fewer than two valid child branches were provided'}. Continue this branch without further splitting unless necessary.`,
          });
          queue.push(branch);
          continue;
        }

        emitBranchTrace('action', branch, `Spawning ${children.length} child branches.`, { childCount: children.length });
        children.forEach((child, index) => {
          const childBranch: BranchState = {
            id: `${branch.id}.${index + 1}`,
            parentId: branch.id,
            depth: branch.depth + 1,
            label: child.label,
            goal: child.goal,
            priority: Math.max(0.05, branch.priority * (child.priority ?? Math.max(0.2, 1 - index * 0.2))),
            steps: branch.steps,
            savedNodeIds: branch.savedNodeIds.slice(),
            transcript: [
              ...branch.transcript,
              {
                role: 'user',
                content: `Continue only this child branch.\nChild label: ${child.label}\nChild goal: ${child.goal}\nWhy this branch exists: ${child.why || 'Distinct strategy'}\nDo not repeat sibling work unless needed.`,
              },
            ],
          };
          queue.push(childBranch);
          emitTrace({
            type: 'observation',
            content: `Spawned child branch ${childBranch.id}: ${child.label}`,
            metadata: traceMeta(childBranch),
          });
        });
        continue;
      }

      const finalAnswer = (decision.final_answer || '').trim();
      if (!finalAnswer) {
        branch.transcript.push({
          role: 'user',
          content: 'You selected kind="final" but did not provide final_answer. Return a complete final answer.',
        });
        queue.push(branch);
        continue;
      }

      branch.finalAnswer = finalAnswer;
      branch.completionSummary = decision.completion_summary || this.firstSentence(finalAnswer) || `Completed branch ${branch.id}`;
      branch.confidence = decision.confidence ?? branch.confidence ?? 0.65;
      completed.push(branch);
      emitBranchTrace('observation', branch, `Branch completed: ${branch.completionSummary}`);
    }

    if (totalLoopSteps >= totalLoopBudget) {
      emitTrace({ type: 'error', content: `Reached total branch loop budget (${totalLoopBudget}). Finalizing best available result.` });
    }

    if (completed.length === 0 && lastTouchedBranch) {
      const forced = await finalizeFromBranch(lastTouchedBranch, 'no branch produced a final answer');
      lastTouchedBranch.finalAnswer = forced || 'I could not complete the branching loop.';
      lastTouchedBranch.completionSummary = lastTouchedBranch.completionSummary || 'Forced finalization because no branch returned final output.';
      lastTouchedBranch.confidence = lastTouchedBranch.confidence ?? 0.35;
      completed.push(lastTouchedBranch);
    }

    const finalAnswer = await synthesizeCompletedBranches(completed.slice(0, this.branchMaxCompleted));
    this.conversationTurns.push({ user: input, assistant: finalAnswer });
    if (this.conversationTurns.length > this.maxConversationTurns) {
      this.conversationTurns = this.conversationTurns.slice(-this.maxConversationTurns);
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
