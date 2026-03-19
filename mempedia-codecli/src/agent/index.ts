import OpenAI from 'openai';
import crypto from 'crypto';
import { MempediaClient } from '../mempedia/client.js';
import { ToolAction } from '../mempedia/types.js';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { z } from 'zod';
import { resolveCodeCliRoot } from '../config/projectPaths.js';
import { AgentRuntime, createRuntime, RuntimeHandle } from '../runtime/index.js';
import type { AgentBranchState, BranchSynthesisInput } from '../runtime/agent/AgentRuntime.js';
import { TOOLS, TOOL_NAMES } from '../tools/definitions.js';
import { installWorkspaceSkillFromLibraryViaCli } from '../mempedia/cli.js';
import { MemoryClassifierAgent } from './MemoryClassifierAgent.js';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const PlannerToolNameSchema = z.enum(TOOL_NAMES);

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

export interface AgentRunOptions {
  conversationId?: string;
  agentId?: string;
  sessionId?: string;
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
  user_preferences: Array<{ topic: string; preference: string; evidence: string }>;
  agent_skills: Array<{ skill_id: string; title: string; content: string; tags: string[] }>;
  atomic_knowledge: Array<{ keyword: string; summary: string; description: string; evolution: string; relations: string[] }>;
}

interface MemorySaveJob {
  input: string;
  traces: TraceEvent[];
  answer: string;
  reason: string;
  focus?: string;
  savePreferences: boolean;
  saveSkills: boolean;
  saveAtomic: boolean;
  saveEpisodic: boolean;
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

type MempediaActionSender = (action: ToolAction) => Promise<any>;

export class Agent {
  private readonly projectRoot: string;
  private readonly codeCliRoot: string;
  private openai: ChatClient;
  private memoryOpenai: ChatClient;
  private mempedia: MempediaClient;
  private model: string;
  private memoryModel: string;
  private interactionCounter: number;
  private readonly maxConversationTurns: number;
  private readonly conversationTurnsByConversation: Map<string, ConversationTurn[]>;
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
  private readonly branchConcurrency: number;
  /** Governed runtime handle — routes mempedia actions through policy + guards. */
  private readonly runtimeHandle: RuntimeHandle;
  private readonly memoryClassifier: MemoryClassifierAgent;

  constructor(config: AgentConfig, projectRoot: string, binaryPath?: string) {
    this.projectRoot = projectRoot;
    this.codeCliRoot = resolveCodeCliRoot(__dirname);
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
    this.conversationTurnsByConversation = new Map();
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
    const rawBranchConcurrency = Number(process.env.REACT_BRANCH_CONCURRENCY ?? 3);
    this.branchConcurrency = Number.isFinite(rawBranchConcurrency) ? Math.max(1, Math.min(8, Math.floor(rawBranchConcurrency))) : 3;
    this.memoryLogPath = path.join(projectRoot, '.mempedia', 'memory', 'index', 'codecli_memory_save.log');
    this.conversationLogDir = path.join(projectRoot, '.mempedia', 'memory', 'index', 'conversations');
    this.nodeConversationMapPath = path.join(projectRoot, '.mempedia', 'memory', 'index', 'node_conversations.jsonl');

    // Bootstrap the governed runtime.  The MempediaClient is shared so the
    // runtime re-uses the already-started process connection.
    this.runtimeHandle = createRuntime({ projectRoot, agentId: 'agent-main' }, this.mempedia);
    this.memoryClassifier = new MemoryClassifierAgent({
      chatClient: this.memoryOpenai,
      model: this.memoryModel,
      codeCliRoot: this.codeCliRoot,
      extractionMaxChars: this.extractionMaxChars,
      memoryExtractTimeoutMs: this.memoryExtractTimeoutMs,
      memoryActionTimeoutMs: this.memoryActionTimeoutMs,
      autoLinkEnabled: this.autoLinkEnabled,
      autoLinkMaxNodes: this.autoLinkMaxNodes,
      autoLinkLimit: this.autoLinkLimit,
    });
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

  private stableNodeId(type: 'atomic', text: string): string {
    return `kg_${type}_${this.toSlug(text)}`;
  }

  async installWorkspaceSkillFromLibrary(skillId: string, overwrite = false): Promise<{ kind: string; skill_id: string; path?: string; message: string }> {
    return installWorkspaceSkillFromLibraryViaCli(__dirname, this.projectRoot, skillId, overwrite, this.codeCliRoot);
  }

  private loadSoulsMarkdown(): string {
    const candidates = [
      path.join(this.codeCliRoot, 'souls.md'),
    ];
    for (const candidate of candidates) {
      try {
        if (!fs.existsSync(candidate)) {
          continue;
        }
        const content = fs.readFileSync(candidate, 'utf-8').trim();
        if (content) {
          return this.clipText(content, 8000);
        }
      } catch {}
    }
    return '';
  }

  /**
   * Merge extracted user preferences into the project preferences markdown file.
   * Each topic is maintained under a stable heading for idempotent updates.
   */
  private mergeUserPreferencesMarkdown(
    existing: string,
    preferences: Array<{ topic: string; preference: string; evidence: string }>,
    updatedAt: string
  ): string {
    let content = existing || `# User Preferences\n\n_Last updated: ${updatedAt}_\n`;

    for (const pref of preferences) {
      const topic = pref.topic.replace(/\s+/g, ' ').trim();
      if (!topic) {
        continue;
      }
      const heading = `### ${topic}`;
      const preference = pref.preference.replace(/\s+/g, ' ').trim();
      const evidence = pref.evidence.replace(/\s+/g, ' ').trim();
      const blockLines = [
        heading,
        `- **Preference**: ${preference}`,
        evidence ? `- **Evidence**: ${evidence}` : null,
        `- _updated: ${updatedAt}_`,
        '',
      ].filter((line): line is string => line !== null);
      const block = blockLines.join('\n');
      const idx = content.indexOf(heading);
      if (idx >= 0) {
        const nextIdx = content.indexOf('\n### ', idx + 1);
        if (nextIdx >= 0) {
          content = content.slice(0, idx) + block + content.slice(nextIdx);
        } else {
          const nextSection = content.indexOf('\n## ', idx + 1);
          if (nextSection >= 0) {
            content = content.slice(0, idx) + block + content.slice(nextSection);
          } else {
            content = content.slice(0, idx) + block;
          }
        }
      } else {
        const prefSection = '## Preferences';
        if (content.includes(prefSection)) {
          const sIdx = content.indexOf(prefSection);
          const nextSection = content.indexOf('\n## ', sIdx + 1);
          if (nextSection >= 0) {
            content = content.slice(0, nextSection) + '\n' + block + '\n' + content.slice(nextSection);
          } else {
            content = content.trimEnd() + '\n\n' + block;
          }
        } else {
          content = content.trimEnd() + '\n\n## Preferences\n\n' + block;
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
            this.sendMempediaAction({ action: 'open_node', node_id: candidate, markdown: false }),
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
            this.sendMempediaAction({
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

  private isIgnoredWorkspacePath(relativePath: string): boolean {
    return relativePath.startsWith('.git/')
      || relativePath === '.git'
      || relativePath.startsWith('node_modules/')
      || relativePath === 'node_modules'
      || relativePath.startsWith('target/')
      || relativePath === 'target'
      || relativePath.startsWith('.mempedia/sandbox/')
      || relativePath === '.mempedia/sandbox';
  }

  private listWorkspaceFiles(dir = this.projectRoot, prefix = ''): string[] {
    if (!fs.existsSync(dir)) {
      return [];
    }
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (this.isIgnoredWorkspacePath(relativePath)) {
        continue;
      }
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...this.listWorkspaceFiles(fullPath, relativePath));
      } else {
        files.push(relativePath.replace(/\\/g, '/'));
      }
    }
    return files;
  }

  private globToRegExp(pattern: string): RegExp {
    let regex = '^';
    for (let index = 0; index < pattern.length; index += 1) {
      const char = pattern[index];
      const next = pattern[index + 1];
      if (char === '*') {
        if (next === '*') {
          regex += '.*';
          index += 1;
        } else {
          regex += '[^/]*';
        }
      } else if (char === '?') {
        regex += '.';
      } else if ('\\^$+.|(){}[]'.includes(char)) {
        regex += `\\${char}`;
      } else {
        regex += char;
      }
    }
    regex += '$';
    return new RegExp(regex, 'i');
  }

  private async executeReadTool(args: Record<string, unknown>, runtimeHandle: RuntimeHandle): Promise<string> {
    const target = String(args.target || '').trim();
    if (target === 'workspace') {
      const toolRes = await runtimeHandle.executeTool('read_file', { path: String(args.path || '') });
      if (!toolRes.success) {
        return `Error: ${toolRes.error ?? 'workspace read failed'}`;
      }
      return typeof toolRes.result === 'string' ? toolRes.result : JSON.stringify(toolRes.result);
    }
    return 'Error: read only supports target=workspace. Use bash with mempedia CLI for Mempedia operations.';
  }

  private async executeSearchTool(args: Record<string, unknown>, runtimeHandle: RuntimeHandle): Promise<string> {
    const target = String(args.target || '').trim();
    const mode = String(args.mode || '').trim();
    const limit = Number(args.limit || 20);
    if (target === 'workspace' && mode === 'glob') {
      const pattern = String(args.pattern || '**/*').trim() || '**/*';
      const matcher = this.globToRegExp(pattern);
      const files = this.listWorkspaceFiles()
        .filter((filePath) => matcher.test(filePath))
        .slice(0, Math.max(1, Math.min(200, Number.isFinite(limit) ? Math.floor(limit) : 20)));
      return JSON.stringify({ kind: 'workspace_glob_results', pattern, results: files });
    }
    if (target === 'workspace' && mode === 'grep') {
      const query = String(args.query || '').trim();
      if (!query) {
        return JSON.stringify({ kind: 'error', message: 'search grep requires query' });
      }
      const results: Array<{ path: string; line: number; text: string }> = [];
      const matcher = new RegExp(query, 'i');
      for (const relativePath of this.listWorkspaceFiles()) {
        if (results.length >= Math.max(1, Math.min(200, Number.isFinite(limit) ? Math.floor(limit) : 20))) {
          break;
        }
        const absolutePath = path.join(this.projectRoot, relativePath);
        let content = '';
        try {
          content = fs.readFileSync(absolutePath, 'utf-8');
        } catch {
          continue;
        }
        const lines = content.split(/\r?\n/);
        for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
          if (!matcher.test(lines[lineIndex])) {
            continue;
          }
          results.push({
            path: relativePath,
            line: lineIndex + 1,
            text: lines[lineIndex].trim().slice(0, 240),
          });
          if (results.length >= Math.max(1, Math.min(200, Number.isFinite(limit) ? Math.floor(limit) : 20))) {
            break;
          }
        }
      }
      return JSON.stringify({ kind: 'workspace_grep_results', query, results });
    }
    return JSON.stringify({ kind: 'error', message: 'search only supports workspace grep/glob. Use bash with mempedia CLI for Mempedia operations.' });
  }

  private async executeEditTool(args: Record<string, unknown>, runtimeHandle: RuntimeHandle): Promise<string> {
    const target = String(args.target || '').trim();
    if (target === 'workspace') {
      const toolRes = await runtimeHandle.executeTool('write_file', {
        path: String(args.path || ''),
        content: String(args.content || ''),
      });
      if (!toolRes.success) {
        return `Error: ${toolRes.error ?? 'workspace edit failed'}`;
      }
      return typeof toolRes.result === 'string' ? toolRes.result : JSON.stringify(toolRes.result);
    }
    return JSON.stringify({ kind: 'error', message: 'edit only supports target=workspace. Use bash with mempedia CLI for Mempedia operations.' });
  }

  private stripHtml(html: string): string {
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private async executeWebTool(args: Record<string, unknown>): Promise<string> {
    const mode = String(args.mode || '').trim();
    if (mode === 'fetch') {
      const url = String(args.url || '').trim();
      if (!url) {
        return JSON.stringify({ kind: 'error', message: 'web fetch requires url' });
      }
      const response = await fetch(url, { headers: { 'User-Agent': 'mempedia-codecli' } });
      const html = await response.text();
      if (!response.ok) {
        return JSON.stringify({ kind: 'error', message: `HTTP ${response.status} ${response.statusText}` });
      }
      const title = html.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim() || url;
      return JSON.stringify({
        kind: 'web_fetch',
        url,
        title,
        content: this.stripHtml(html).slice(0, 8000),
      });
    }

    if (mode === 'search') {
      const query = String(args.query || '').trim();
      if (!query) {
        return JSON.stringify({ kind: 'error', message: 'web search requires query' });
      }
      const limit = Math.max(1, Math.min(10, Number.isFinite(Number(args.limit)) ? Math.floor(Number(args.limit)) : 5));
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const response = await fetch(url, { headers: { 'User-Agent': 'mempedia-codecli' } });
      const html = await response.text();
      if (!response.ok) {
        return JSON.stringify({ kind: 'error', message: `HTTP ${response.status} ${response.statusText}` });
      }
      const results: Array<{ title: string; url: string }> = [];
      const linkRegex = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
      let match: RegExpExecArray | null = null;
      while ((match = linkRegex.exec(html)) && results.length < limit) {
        results.push({
          url: match[1],
          title: this.stripHtml(match[2]),
        });
      }
      return JSON.stringify({ kind: 'web_search', query, results });
    }

    return JSON.stringify({ kind: 'error', message: 'unsupported web mode' });
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
    return this.guardedMempediaSaveWithSender(rawArgs, (action) => this.sendMempediaAction(action));
  }

  private async guardedMempediaSaveWithSender(
    rawArgs: Record<string, unknown>,
    sendAction: MempediaActionSender,
  ): Promise<Record<string, unknown>> {
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
      const existing = await sendAction({
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

    const result = await sendAction({
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

  private extractOriginalUserRequest(input: string): string {
    const match = input.match(/^Original user request:\n([\s\S]*?)(?:\n\nActive branch:|$)/);
    return (match?.[1] || input).trim();
  }

  private isTrivialMemoryCandidate(text: string): boolean {
    const compact = text.replace(/\s+/g, ' ').trim().toLowerCase();
    if (!compact) {
      return true;
    }
    if (compact.length <= 24 && compact.split(/\s+/).length <= 5) {
      return /^(hi|hello|hey|thanks|thank you|yo|sup|你好|嗨|哈喽|谢谢|在吗|早上好|下午好|晚上好)\b/.test(compact);
    }
    return /^(hi|hello|hey|yo|sup|你好|嗨|哈喽)\b/.test(compact);
  }

  private shouldAutoSaveAtomicKnowledge(input: string, traces: TraceEvent[], answer: string): boolean {
    const request = this.extractOriginalUserRequest(input);
    const normalizedAnswer = answer.replace(/\s+/g, ' ').trim();
    if (normalizedAnswer.length < 140) {
      return false;
    }
    if (this.isTrivialMemoryCandidate(request) || this.isTrivialMemoryCandidate(normalizedAnswer)) {
      return false;
    }

    const groundedInProjectFiles = traces.some((trace) => {
      const toolName = String(trace.metadata?.toolName || '');
      if (toolName === 'read') {
        const args = trace.metadata?.args as Record<string, unknown> | undefined;
        const target = typeof args?.target === 'string' ? args.target.toLowerCase() : '';
        const filePath = typeof args?.path === 'string' ? args.path.toLowerCase() : '';
        if (target === 'memory' || target === 'project' || target === 'preferences' || target === 'skill') {
          return true;
        }
        return /readme|package\.json|cargo\.toml|tsconfig\.json|requirements\.txt|src\/|docs?\/|policies\/|mempedia-codecli\/|mempedia-ui\//.test(filePath);
      }
      if (toolName === 'search') {
        const args = trace.metadata?.args as Record<string, unknown> | undefined;
        const target = typeof args?.target === 'string' ? args.target.toLowerCase() : '';
        return target === 'memory' || target === 'workspace' || target === 'projects';
      }
      return false;
    });
    if (!groundedInProjectFiles) {
      return false;
    }

    const requestLooksLikeProjectDiscovery = /(check|inspect|summari[sz]e|what(?:'s| is)? in|readme|repo|repository|project|codebase|architecture|structure|features|documentation|analy[sz]e|查看|总结|项目|仓库|代码库|结构|功能|文档)/i.test(request);
    const answerLooksReusable = /(implements|architecture|storage structure|key features|knowledge system|api|layer|module|repository|project|rust|typescript|markdown|jsonl|目录|结构|功能|实现|支持|接口|存储|分层)/i.test(normalizedAnswer)
      || /(^|\n)\d+\./.test(answer)
      || answer.includes('- ');

    return requestLooksLikeProjectDiscovery && answerLooksReusable;
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

  private getConversationTurns(conversationId = 'default'): ConversationTurn[] {
    return this.conversationTurnsByConversation.get(conversationId) || [];
  }

  private appendConversationTurn(conversationId: string, turn: ConversationTurn): void {
    const current = this.getConversationTurns(conversationId);
    const next = [...current, turn];
    const bounded = next.length > this.maxConversationTurns ? next.slice(-this.maxConversationTurns) : next;
    this.conversationTurnsByConversation.set(conversationId, bounded);
  }

  private selectRelevantConversationTurns(input: string, conversationId = 'default'): ConversationTurn[] {
    const conversationTurns = this.getConversationTurns(conversationId);
    if (conversationTurns.length === 0) {
      return [];
    }
    const followUp = this.isLikelyFollowUp(input);
    const scored = conversationTurns
      .map((turn, index) => {
        const combined = `${turn.user}\n${turn.assistant}`;
        const overlap = this.lexicalOverlapScore(input, combined);
        const recency = (index + 1) / Math.max(1, conversationTurns.length) * 0.18;
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
      return conversationTurns.slice(-1);
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
    sendAction: MempediaActionSender = (action) => this.sendMempediaAction(action),
  ): Promise<RetrievedContext> {
    const query = [input, ...selectedTurns.map((turn) => turn.user)].filter(Boolean).join('\n');
    const searchResults = await sendAction({
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
      const opened = await sendAction({
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
    const extractionPrompt = `请按 Mempedia 最新四层模型提取长期记忆，输出必须是 JSON（不要 markdown）：
{
  "user_preferences": [
    { "topic": "偏好主题", "preference": "稳定偏好结论", "evidence": "证据摘要" }
  ],
  "agent_skills": [
    { "skill_id": "稳定技能ID", "title": "技能标题", "content": "可复用步骤", "tags": ["tag1", "tag2"] }
  ],
  "atomic_knowledge": [
    { "keyword": "核心关键词", "summary": "短摘要", "description": "完整描述", "evolution": "演进信息", "relations": ["相关项"] }
  ]
}

规则：
1. Layer 1 Core Knowledge：atomic_knowledge 必须是可独立复用的知识点。
1.1 如果内容明确来自 README、源码、配置、项目目录或其他仓库文件，并且回答总结了项目架构、模块职责、存储结构、接口能力、构建方式等稳定事实，应优先提取到 atomic_knowledge。
2. Layer 3 User Preferences：仅提取稳定偏好，不要临时状态。
3. Layer 4 Agent Skills：只提取可复用流程/策略，避免一次性日志。
4. 不要逐字复制对话；保留抽象、可复用长期知识。
5. 严禁输出寒暄、临时上下文、错误堆栈。
6. 忽略类似“Original user request”“Active branch”“Branch goal”这类调度包装文本，不要把它们当作知识点。`;

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
      const preferences = Array.isArray(parsed.user_preferences)
        ? parsed.user_preferences.map((item: any) => {
            if (typeof item === 'string') {
              const topic = item.replace(/\s+/g, ' ').trim().slice(0, 64) || 'general';
              return {
                topic,
                preference: this.normalizeSummary(item, topic),
                evidence: this.normalizeDetails(item, topic),
              };
            }
            const topic = typeof item?.topic === 'string'
              ? item.topic.replace(/\s+/g, ' ').trim().slice(0, 64)
              : '';
            const fallback = topic || item?.preference || 'general';
            return {
              topic: topic || this.toSlug(String(fallback)).slice(0, 64),
              preference: this.normalizeSummary(item?.preference, String(fallback)),
              evidence: this.normalizeDetails(item?.evidence, String(fallback)),
            };
          }).filter((x: any) => x.topic && x.preference)
        : [];
      const skills = Array.isArray(parsed.agent_skills)
        ? parsed.agent_skills.map((item: any) => {
            if (typeof item === 'string') {
              const skillId = `skill_${this.toSlug(item).slice(0, 56) || 'general'}`;
              return {
                skill_id: skillId,
                title: this.normalizeSummary(item, skillId),
                content: this.normalizeDetails(item, skillId),
                tags: ['auto'],
              };
            }
            const rawTitle = typeof item?.title === 'string' ? item.title.trim() : '';
            const rawSkillId = typeof item?.skill_id === 'string' ? item.skill_id.trim() : '';
            const fallback = rawTitle || rawSkillId || 'general_skill';
            const tags = Array.isArray(item?.tags)
              ? item.tags.map((tag: any) => String(tag || '').trim()).filter((tag: string) => tag.length > 0).slice(0, 8)
              : [];
            return {
              skill_id: rawSkillId || `skill_${this.toSlug(fallback).slice(0, 56) || 'general'}`,
              title: rawTitle || this.normalizeSummary(fallback, fallback),
              content: this.normalizeDetails(item?.content || item?.details || item?.summary, fallback),
              tags,
            };
          }).filter((x: any) => x.skill_id && x.title && x.content)
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
        user_preferences: preferences.slice(0, 12),
        agent_skills: skills.slice(0, 12),
        atomic_knowledge: atomic.slice(0, 20) as Array<{ keyword: string; summary: string; description: string; evolution: string; relations: string[] }>
      };
  } catch (_) {
    return this.fallbackExtractMemory(input, answer);
  }
  }

  private fallbackExtractMemory(input: string, answer: string): MemoryExtraction {
    const text = `${input}\n${answer}`;
    const preferences: Array<{ topic: string; preference: string; evidence: string }> = [];
    const skills: Array<{ skill_id: string; title: string; content: string; tags: string[] }> = [];

    const habitRegex = /(偏好|喜欢|习惯|不喜欢|讨厌|避免)[^。\\n]{0,120}/;
    const habitMatch = text.match(habitRegex);
    if (habitMatch) {
      const phrase = habitMatch[0].trim();
      const topic = phrase.slice(0, 32);
      preferences.push({
        topic,
        preference: this.normalizeSummary(phrase, topic),
        evidence: this.normalizeDetails(phrase, topic)
      });
    }

    const hasSteps = /步骤|流程|最佳实践|注意事项|操作方法|建议/.test(text) || /\\n\\s*\\d+\\./.test(text);
    if (hasSteps) {
      const key = this.toSlug(answer.slice(0, 64) || 'general_skill').slice(0, 56) || 'general_skill';
      skills.push({
        skill_id: `skill_${key}`,
        title: this.normalizeSummary(answer.slice(0, 120), key),
        content: this.normalizeDetails(answer.slice(0, 600), key),
        tags: ['auto'],
      });
    }

    return {
      user_preferences: preferences.slice(0, 8),
      agent_skills: skills.slice(0, 8),
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
      save_preferences: job.savePreferences,
      save_skills: job.saveSkills,
      save_atomic: job.saveAtomic,
      save_episodic: job.saveEpisodic,
      input_chars: input.length,
      traces_count: traces.length,
      answer_chars: answer.length
    });
    try {
      await this.withTimeout(
        this.measure(perfEntries, 'memory_classifier_persist', async () =>
          this.memoryClassifier.persist(job, {
            runId,
            conversationId,
            sendAction: (action) => this.sendMempediaAction(action),
            appendMemoryLog: (phase, data = {}) => this.appendMemoryLog(runId, phase, data),
            appendNodeConversationMap: (nodeId, mappedConversationId, reason) =>
              this.appendNodeConversationMap(nodeId, mappedConversationId, reason),
            resolveRelationTargets: (relations) => this.resolveRelationTargets(relations),
            mergeUserPreferencesMarkdown: (existing, preferences, updatedAt) =>
              this.mergeUserPreferencesMarkdown(existing, preferences, updatedAt),
          })
        ),
        this.memoryTaskTimeoutMs,
        'memory background task'
      );
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
      save_preferences: job.savePreferences,
      save_skills: job.saveSkills,
      save_atomic: job.saveAtomic,
      save_episodic: job.saveEpisodic,
      queue_depth: this.saveQueue.length,
    });
    if (!this.saveInProgress) {
      this.drainSaveQueue();
    }
  }

  async run(input: string, onTrace: (event: TraceEvent) => void, options: AgentRunOptions = {}): Promise<string> {
    const perfEnabled = process.env.AGENT_PERF !== '0';
    const perfEntries: PerfEntry[] | null = perfEnabled ? [] : null;
    const traceBuffer: TraceEvent[] = [];
    const conversationId = options.conversationId || 'default';
    const runAgentId = options.agentId || 'agent-main';
    const runSessionId = options.sessionId || `agent-run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const runRuntimeHandle = createRuntime({ projectRoot: this.projectRoot, agentId: runAgentId, sessionId: runSessionId }, this.mempedia);
    const emitTrace = (event: TraceEvent) => {
      traceBuffer.push(event);
      onTrace(event);
    };
    emitTrace({ type: 'thought', content: 'Initializing branching ReAct context from Mempedia...' });

    const selectedConversationTurns = this.selectRelevantConversationTurns(input, conversationId);
    emitTrace({
      type: 'observation',
      content: selectedConversationTurns.length > 0
        ? `Selected ${selectedConversationTurns.length} relevant recent conversation turn(s) for follow-up grounding.`
        : 'Selected 0 recent conversation turns; treating this request as context-isolated.',
    });

    let context = '';
    let recalledNodeIds: string[] = [];
    let selectedNodeIds: string[] = [];
    const soulsGuidance = this.loadSoulsMarkdown();
    const rawAutoQueueMemorySave = String(process.env.AUTO_QUEUE_MEMORY_SAVE ?? '1').toLowerCase();
    const autoQueueMemorySave = rawAutoQueueMemorySave !== '0' && rawAutoQueueMemorySave !== 'false' && rawAutoQueueMemorySave !== 'off';
    let memoryQueuedThisRun = false;
    try {
      const retrieved = await this.measure(perfEntries, 'context_retrieval', async () =>
        this.retrieveRelevantContext(input, selectedConversationTurns, perfEntries, (action) => runRuntimeHandle.sendMempediaAction(action))
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

    const systemPrompt = `You are a branching ReAct agent operating inside Mempedia, an enterprise knowledge base.
Treat ReAct as a functional loop. A branch is an independent child loop with its own thought -> action -> observation state.

Mempedia uses a four-layer memory model:
  Layer 1 - Core Knowledge: stable reusable project knowledge
  Layer 2 - Episodic Memory: time-ordered conversation or task events
  Layer 3 - User Preferences: stable user constraints and working style
  Layer 4 - Skills Library: reusable project procedures and skill documents

You only use five top-level tools:
  read   -> read workspace files
  search -> grep/glob workspace files
  edit   -> edit workspace files
  bash   -> run sandboxed shell commands
  web    -> search/fetch external web content when repository evidence is insufficient

Important: do not use built-in codecli routing for Mempedia operations. If you need to read, search, or update Mempedia memory, preferences, skills, or projects, use bash to call the mempedia CLI, following the active SKILL.md guidance.

Local codecli skills come from workspace SKILL.md files under mempedia-codecli/skills/*/SKILL.md and are available by default.
Mempedia Layer 4 is the project skill library. It is part of the enterprise KB, but not every library skill is auto-installed locally.
Skills are guidance documents, not tool names. Never emit skill names such as project-discovery in tool_calls.name.
If skill guidance has been injected for the turn, treat it as internal policy only. Do not inspect the skills directory, verify skill files, or summarize skill text back to the user unless the user explicitly asked about skills.
An independent post-turn MemoryClassifierAgent handles automatic four-layer memory classification and persistence after the answer is complete.
When you save or promote Layer 1 core knowledge, prefer markdown-first nodes that preserve concrete facts, numbers, data points, historical changes, viewpoints, evidence, and explicit uncertainties instead of terse summaries.
Separate facts from opinions or viewpoints. Never fabricate facts; if something is uncertain, attribute it or mark it as uncertain.

You must return exactly one JSON object on every loop iteration. Do not use markdown fences.

Allowed JSON schema:
{
  "kind": "tool" | "branch" | "final",
  "thought": "string",
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
5. Prefer search before edit when the correct answer may already exist in repository files or in Mempedia.
6. For repository discovery, prefer read and search on workspace evidence before using web.
7. Prefer relative file paths rooted at the current project. Use absolute paths only when necessary for clarity or when the tool requires them.
8. If you need Layer 1, Layer 2, Layer 3, Layer 4, or project operations, use bash with the mempedia CLI instead of read/search/edit routing.
9. Local skills that are already auto-injected usually do not need to be read again manually.
10. Do not answer a project-overview question by listing local skills unless the user explicitly asked about the skill system.
11. Use bash whenever shell is the practical tool, but remember dangerous shell operations are sandboxed and should require confirmation.
12. Use web only when repository and Mempedia evidence are insufficient.
13. The independent post-turn memory agent will classify the completed turn across all four layers. Do not invent your own background save workflow.
14. When writing markdown knowledge, prefer structured sections such as Facts, Data, History, Viewpoints, Relations, and Evidence when the material supports them.
15. When you finish, return kind="final" with a direct user-facing answer.

Available tools:
${toolCatalog}

Shared Mempedia context for this request:
${context || '(no context found)'}

Selected context node ids:
${selectedNodeIds.length > 0 ? selectedNodeIds.join(', ') : '(none)'}

${soulsGuidance ? `Global souls.md guidance:
${soulsGuidance}
` : ''}`;

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
      const parsed = JSON.parse(jsonText);
      const obj = Array.isArray(parsed) ? (parsed[0] || {}) : parsed;
      const normalized: Record<string, unknown> = obj && typeof obj === 'object' ? { ...obj } : {};

      if (typeof normalized.kind !== 'string') {
        if (typeof normalized.final_answer === 'string') {
          normalized.kind = 'final';
        } else if (Array.isArray(normalized.tool_calls)) {
          normalized.kind = 'tool';
        } else if (Array.isArray(normalized.branches)) {
          normalized.kind = 'branch';
        } else {
          normalized.kind = 'final';
        }
      }

      if (typeof normalized.thought !== 'string' || !normalized.thought.trim()) {
        const kind = String(normalized.kind || 'tool');
        if (kind === 'tool' && Array.isArray(normalized.tool_calls)) {
          const names = normalized.tool_calls
            .map((call: any) => (call && typeof call.name === 'string' ? call.name : 'tool'))
            .filter((name: string) => name.length > 0)
            .slice(0, 3)
            .join(', ');
          normalized.thought = names
            ? `Call tools for progress: ${names}`
            : 'Call tool to gather required context.';
        } else if (kind === 'branch') {
          normalized.thought = 'Split into distinct strategies to improve solution quality.';
        } else {
          normalized.thought = 'Provide the final answer for the user.';
        }
      }

      return PlannerDecisionSchema.parse(normalized);
    };

    const buildBranchMemoryJob = (
      branch: BranchState,
      reason: string,
      focus?: string,
      flags?: { savePreferences?: boolean; saveSkills?: boolean; saveAtomic?: boolean; saveEpisodic?: boolean }
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
        savePreferences: flags?.savePreferences ?? false,
        saveSkills: flags?.saveSkills ?? false,
        saveAtomic: flags?.saveAtomic ?? false,
        saveEpisodic: flags?.saveEpisodic ?? true,
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
        if (fnName === 'read') {
          result = await this.executeReadTool(args as Record<string, unknown>, runRuntimeHandle);
        } else if (fnName === 'search') {
          result = await this.executeSearchTool(args as Record<string, unknown>, runRuntimeHandle);
        } else if (fnName === 'edit') {
          result = await this.executeEditTool(args as Record<string, unknown>, runRuntimeHandle);
        } else if (fnName === 'bash') {
          const toolRes = await runRuntimeHandle.executeTool('run_shell', { command: String(args.command || '') });
          if (!toolRes.success) {
            result = `Error: ${toolRes.error ?? 'unknown tool error'}`;
          } else if (typeof toolRes.result === 'string') {
            result = toolRes.result;
          } else {
            result = JSON.stringify(toolRes.result);
          }
        } else if (fnName === 'web') {
          result = await this.executeWebTool(args as Record<string, unknown>);
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
      const savedNodeId = fnName === 'edit' && String(args.target || '') === 'memory'
        ? this.extractSavedNodeId(clipped)
        : null;
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
        .map((branch) => [
          `Branch ${branch.id}`,
          `label: ${branch.label}`,
          `goal: ${branch.goal}`,
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
    let completedBranchesForRun: Array<BranchSynthesisInput['branches'][number]> = [];
    const runtime = new AgentRuntime({
      planner: { plan: async (transcript) => ({ kind: 'final', content: transcript.at(-1)?.content || '' }) },
      toolRuntime: {
        execute: async () => ({ success: false, error: 'unreachable tool runtime fallback', durationMs: 0 }),
        resetSession: () => runRuntimeHandle.toolRuntime.resetSession(),
      },
      maxSteps: this.branchMaxSteps,
      maxBranchDepth: this.branchMaxDepth,
      maxBranchWidth: this.branchMaxWidth,
      maxCompletedBranches: this.branchMaxCompleted,
      branchConcurrency: this.branchConcurrency,
      planBranch: async ({ branch }) => {
        const completion = await this.measure(perfEntries, `llm_${branch.id}_step_${branch.steps + 1}`, async () =>
          this.openai.chat.completions.create({
            model: this.model,
            messages: buildMessages(branch as BranchState) as any,
          })
        );
        const raw = extractText(completion.choices[0]?.message?.content);
        const decision = parseDecision(raw);
        return decision.kind === 'tool'
          ? { kind: 'tool', thought: decision.thought, toolCalls: decision.tool_calls || [] }
          : decision.kind === 'branch'
            ? { kind: 'branch', thought: decision.thought, branches: decision.branches || [] }
            : { kind: 'final', thought: decision.thought, content: String(decision.final_answer || ''), completionSummary: decision.completion_summary };
      },
      executeToolCall: async ({ branch, toolCall }) => {
        const result = await executeToolCall(branch as BranchState, toolCall as z.infer<typeof PlannerToolCallSchema>);
        return {
          toolName: toolCall.name,
          result,
          success: !/^Error[:\s]|^ERROR:/.test(result),
        };
      },
      finalizeBranch: async ({ branch, reason }) => finalizeFromBranch(branch as BranchState, reason),
      synthesizeFinal: async (inputData) => {
        completedBranchesForRun = inputData.branches;
        const branches = inputData.branches.map((branch) => ({
          id: branch.id,
          parentId: null,
          depth: 0,
          label: branch.label,
          goal: branch.goal,
          priority: 1,
          steps: 0,
          transcript: [],
          savedNodeIds: branch.savedNodeIds,
          completionSummary: branch.completionSummary,
          finalAnswer: branch.finalAnswer,
        })) as BranchState[];
        return synthesizeCompletedBranches(branches);
      },
      onTrace: (event) => {
        if (event.type === 'final') {
          return;
        }
        emitTrace({
          type: event.type,
          content: event.content,
          metadata: event.metadata,
        });
      }
    });
    const finalAnswer = await runtime.run(`Original user request:\n${input}\n\nStart with the root loop. Branch only when multiple distinct approaches are worth exploring.`);
    if (autoQueueMemorySave && !memoryQueuedThisRun) {
      const bestBranch = completedBranchesForRun[0];
      const autoBranch = bestBranch
        ? {
          id: bestBranch.id,
          parentId: null,
          depth: 0,
          label: bestBranch.label,
          goal: bestBranch.goal,
          priority: 1,
          steps: 0,
          transcript: [],
          savedNodeIds: bestBranch.savedNodeIds,
          completionSummary: bestBranch.completionSummary,
          finalAnswer: bestBranch.finalAnswer,
        }
        : {
          id: 'B0',
          parentId: null,
          depth: 0,
          label: 'root',
          goal: 'Solve the user request end-to-end.',
          priority: 1,
          steps: 0,
          transcript: [],
          savedNodeIds: [],
          finalAnswer,
        };
      const autoJob = buildBranchMemoryJob(
        autoBranch,
        'automatic post-turn four-layer memory classification',
        this.firstSentence(finalAnswer),
        { savePreferences: true, saveSkills: true, saveAtomic: true, saveEpisodic: true }
      );
      this.scheduleMemorySave(autoJob);
      memoryQueuedThisRun = true;
      emitTrace({
        type: 'observation',
        content: `Auto-queued independent four-layer memory classification from branch ${(bestBranch?.id) || 'B0'}.`,
      });
    }
    this.appendConversationTurn(conversationId, { user: input, assistant: finalAnswer });
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
