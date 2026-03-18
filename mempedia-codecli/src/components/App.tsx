import React, { useState, useEffect, useRef } from 'react';
import { Box, Text, useApp } from 'ink';
import TextInput from 'ink-text-input';
import { Agent, TraceEvent } from '../agent/index.js';
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';

interface AppProps {
  apiKey: string;
  projectRoot: string;
  baseURL?: string;
  model?: string;
  memoryApiKey?: string;
  memoryBaseURL?: string;
  memoryModel?: string;
}

interface HistoryItem {
  type: 'user' | 'agent' | 'info' | 'trace';
  content: string;
  traceType?: 'thought' | 'action' | 'observation' | 'error';
  traceMeta?: TraceEvent['metadata'];
}

interface LocalSkill {
  name: string;
  description: string;
  content: string;
  source?: 'local' | 'remote';
  location?: string;
  repository?: string;
}

interface GitHubCodeSearchItem {
  path?: string;
  html_url?: string;
  url?: string;
  repository?: {
    full_name?: string;
    html_url?: string;
  };
}

interface GitHubCodeSearchResponse {
  items?: GitHubCodeSearchItem[];
  message?: string;
}

interface GitHubContentResponse {
  content?: string;
  encoding?: string;
  download_url?: string;
}

interface WebConversationItem {
  role: 'user' | 'assistant' | 'trace';
  content: string;
  traceType?: 'thought' | 'action' | 'observation' | 'error';
  traceMeta?: TraceEvent['metadata'];
  timestamp: number;
}

type BranchVisualStatus = 'queued' | 'active' | 'completed' | 'finalizing' | 'error';

interface BranchVisualNode {
  id: string;
  parentId: string | null;
  label: string;
  depth: number;
  step: number;
  status: BranchVisualStatus;
}

interface BranchLoopVisualState {
  round: number;
  totalSteps: number;
  totalBudget: number;
  completed: number;
  maxCompleted: number;
  /** Last branch to emit a non-completed event — used for single-node highlight. */
  activeBranchId: string | null;
  /** All branches currently running steps concurrently. */
  activeBranchIds: string[];
  queueCount: number;
  nodes: Record<string, BranchVisualNode>;
}

interface BranchTreeRow {
  node: BranchVisualNode;
  isLast: boolean;
  ancestorHasNext: boolean[];
}

interface ThreadRound {
  id: string;
  timestamp: number;
  user_input: string;
  agent_response: string;
  traces: Array<{ type: string; content: string; metadata?: TraceEvent['metadata'] }>;
  branch_snapshot: BranchLoopVisualState | null;
}

interface ConversationThread {
  id: string;
  title: string;
  created_at: number;
  last_updated: number;
  rounds: ThreadRound[];
}

export const App: React.FC<AppProps> = ({ apiKey, projectRoot, baseURL, model, memoryApiKey, memoryBaseURL, memoryModel }) => {
  const { exit } = useApp();
  const hmacAccessKey = process.env.HMAC_ACCESS_KEY?.trim();
  const hmacSecretKey = process.env.HMAC_SECRET_KEY?.trim();
  const memoryHmacAccessKey = process.env.MEMORY_HMAC_ACCESS_KEY?.trim();
  const memoryHmacSecretKey = process.env.MEMORY_HMAC_SECRET_KEY?.trim();
  const gatewayApiKey = process.env.GATEWAY_API_KEY?.trim();
  const memoryGatewayApiKey = process.env.MEMORY_GATEWAY_API_KEY?.trim();
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<string>('Ready');
  const [history, setHistory] = useState<Array<HistoryItem>>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [agent] = useState(() => new Agent({
    apiKey,
    baseURL,
    model,
    memoryApiKey,
    memoryBaseURL,
    memoryModel,
    hmacAccessKey,
    hmacSecretKey,
    memoryHmacAccessKey,
    memoryHmacSecretKey,
    gatewayApiKey,
    memoryGatewayApiKey
  }, projectRoot));
  const [backgroundTasks, setBackgroundTasks] = useState<string[]>([]);
  const [skills, setSkills] = useState<LocalSkill[]>([]);
  const [remoteSkills, setRemoteSkills] = useState<LocalSkill[]>([]);
  const [activeSkill, setActiveSkill] = useState<LocalSkill | null>(null);
  const [runRound, setRunRound] = useState(0);
  const [branchLoop, setBranchLoop] = useState<BranchLoopVisualState | null>(null);
  const [traceLogExpanded, setTraceLogExpanded] = useState(false);
  const [uiUrl, setUiUrl] = useState<string | null>(null);
  const uiServerRef = useRef<http.Server | null>(null);
  const uiBusyRef = useRef(false);
  const activeThreadRunsRef = useRef<Set<string>>(new Set());
  const webConversationRef = useRef<WebConversationItem[]>([]);
  const branchStepSeenRef = useRef<Set<string>>(new Set());

  const envBranchMaxDepth = Number(process.env.REACT_BRANCH_MAX_DEPTH ?? 2);
  const branchMaxDepth = Number.isFinite(envBranchMaxDepth) ? Math.max(0, Math.min(4, Math.floor(envBranchMaxDepth))) : 2;
  const envBranchMaxWidth = Number(process.env.REACT_BRANCH_MAX_WIDTH ?? 3);
  const branchMaxWidth = Number.isFinite(envBranchMaxWidth) ? Math.max(1, Math.min(5, Math.floor(envBranchMaxWidth))) : 3;
  const envBranchMaxSteps = Number(process.env.REACT_BRANCH_MAX_STEPS ?? 8);
  const branchMaxSteps = Number.isFinite(envBranchMaxSteps) ? Math.max(2, Math.min(24, Math.floor(envBranchMaxSteps))) : 8;
  const envBranchMaxCompleted = Number(process.env.REACT_BRANCH_MAX_COMPLETED ?? 4);
  const branchMaxCompleted = Number.isFinite(envBranchMaxCompleted) ? Math.max(1, Math.min(8, Math.floor(envBranchMaxCompleted))) : 4;
  const branchTotalBudget = Math.max(branchMaxSteps, branchMaxSteps * branchMaxWidth * (branchMaxDepth + 1));

  useEffect(() => {
    agent.start().catch((err: any) => {
      setHistory((prev: HistoryItem[]) => [...prev, { type: 'info', content: `Error starting agent: ${err.message}` }]);
    });
    
    // Subscribe to background task updates
    const unsubscribe = agent.onBackgroundTask((task, status) => {
        if (status === 'started') {
            setBackgroundTasks(prev => (prev.includes(task) ? prev : [...prev, task]));
        } else {
            setBackgroundTasks(prev => prev.filter(t => t !== task));
        }
    });

    return () => {
      if (uiServerRef.current) {
        uiServerRef.current.close();
        uiServerRef.current = null;
      }
      unsubscribe();
      agent.stop();
    };
  }, [agent]);

  useEffect(() => {
    const loadSkills = () => {
      const skillsRoot = path.join(projectRoot, 'skills');
      if (!fs.existsSync(skillsRoot)) {
        setSkills([]);
        return;
      }
      const entries = fs.readdirSync(skillsRoot, { withFileTypes: true });
      const parsed: LocalSkill[] = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }
        const skillPath = path.join(skillsRoot, entry.name, 'SKILL.md');
        if (!fs.existsSync(skillPath)) {
          continue;
        }
        const raw = fs.readFileSync(skillPath, 'utf-8');
        parsed.push(parseSkillMarkdown(raw, entry.name, {
          source: 'local',
          location: normalizePath(path.relative(projectRoot, skillPath))
        }));
      }
      setSkills(sortSkills(parsed));
    };
    loadSkills();
  }, [projectRoot]);

  const mimeType = (filePath: string) => {
    if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
    if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
    if (filePath.endsWith('.js')) return 'application/javascript; charset=utf-8';
    if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
    if (filePath.endsWith('.svg')) return 'image/svg+xml';
    if (filePath.endsWith('.png')) return 'image/png';
    return 'application/octet-stream';
  };

  const writeJson = (res: http.ServerResponse, code: number, data: unknown) => {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
  };

  const readBody = async (req: http.IncomingMessage) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const raw = Buffer.concat(chunks).toString('utf-8').trim();
    return raw ? JSON.parse(raw) : {};
  };

  const parseFrontmatterNodeId = (markdown: string) => {
    const frontmatter = markdown.match(/^---\s*[\r\n]+([\s\S]*?)\s*[\r\n]+---\s*[\r\n]*/);
    if (!frontmatter) return '';
    const meta = frontmatter[1];
    const nodeId = meta.match(/node_id:\s*"?([^"\n]+)"?/i)?.[1];
    return nodeId ? nodeId.trim() : '';
  };

  const readJsonOptional = (filePath: string) => {
    if (!fs.existsSync(filePath)) return null;
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch {
      return null;
    }
  };

  const readJsonLines = (filePath: string, validator?: (row: any) => boolean) => {
    if (!fs.existsSync(filePath)) return [];
    const text = fs.readFileSync(filePath, 'utf-8');
    const rows: any[] = [];
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed);
        if (!validator || validator(parsed)) rows.push(parsed);
      } catch {}
    }
    return rows;
  };

  const listFiles = (dir: string): string[] => {
    if (!fs.existsSync(dir)) return [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...listFiles(full));
      } else {
        files.push(full);
      }
    }
    return files;
  };

  const loadMemorySnapshot = () => {
    const memoryRoot = path.join(projectRoot, '.mempedia', 'memory');
    const indexDir = path.join(memoryRoot, 'index');
    const objectsDir = path.join(memoryRoot, 'objects');
    const knowledgeDir = path.join(memoryRoot, 'knowledge', 'nodes');
    const statePath = path.join(indexDir, 'state.json');
    const headsPath = path.join(indexDir, 'heads.json');
    const nodesPath = path.join(indexDir, 'nodes.json');
    const state = readJsonOptional(statePath);
    const heads = state?.heads || readJsonOptional(headsPath) || {};
    const nodes = state?.nodes || readJsonOptional(nodesPath) || {};
    const versions: Array<[string, any]> = [];
    if (fs.existsSync(objectsDir)) {
      const objectFiles = listFiles(objectsDir).filter((f) => f.endsWith('.json'));
      for (const file of objectFiles) {
        try {
          const id = path.basename(file, '.json');
          versions.push([id, JSON.parse(fs.readFileSync(file, 'utf-8'))]);
        } catch {}
      }
    }
    const accessLogs = readJsonLines(path.join(indexDir, 'access.log'), (row) => row && typeof row.node_id === 'string');
    const agentActions = readJsonLines(path.join(indexDir, 'agent_actions.log'), (row) => row && typeof row.node_id === 'string');
    const preferencesPath = path.join(memoryRoot, 'preferences.md');
    const preferences = fs.existsSync(preferencesPath) ? fs.readFileSync(preferencesPath, 'utf-8') : '';
    const skillsDir = path.join(memoryRoot, 'skills');
    const skills: Array<{ skill_id: string; title?: string; tags?: string[]; updated_at?: number }> = [];
    if (fs.existsSync(skillsDir)) {
      const skillFiles = listFiles(skillsDir).filter((f) => f.endsWith('.md'));
      for (const file of skillFiles) {
        try {
          const raw = fs.readFileSync(file, 'utf-8');
          const frontmatter = raw.match(/^---\s*[\r\n]+([\s\S]*?)\s*[\r\n]+---\s*[\r\n]*/);
          const meta = frontmatter ? frontmatter[1] : '';
          const skillId = path.basename(file).replace(/-[0-9a-f]{8}\.md$/i, '');
          const title = meta.match(/title:\s*"?([^"\n]+)"?/i)?.[1]?.trim();
          const tagsLine = meta.match(/tags:\s*\[(.*?)\]/i)?.[1] || '';
          const tags = tagsLine
            .split(',')
            .map((item) => item.replace(/["']/g, '').trim())
            .filter(Boolean);
          const updatedAtRaw = meta.match(/updated_at:\s*(\d+)/i)?.[1];
          skills.push({
            skill_id: skillId,
            title,
            tags,
            updated_at: updatedAtRaw ? Number(updatedAtRaw) : undefined,
          });
        } catch {}
      }
    }
    const nodeConversations = readJsonLines(path.join(indexDir, 'node_conversations.jsonl'), (row) => row && typeof row.node_id === 'string');
    const conversationDir = path.join(indexDir, 'conversations');
    const conversations: Array<{ id: string; timestamp?: string; input?: string; answer?: string }> = [];
    if (fs.existsSync(conversationDir)) {
      const conversationFiles = listFiles(conversationDir).filter((f) => f.endsWith('.json'));
      for (const file of conversationFiles) {
        try {
          const parsed = JSON.parse(fs.readFileSync(file, 'utf-8'));
          if (parsed?.id) {
            conversations.push({
              id: String(parsed.id),
              timestamp: typeof parsed.timestamp === 'string' ? parsed.timestamp : undefined,
              input: typeof parsed.input === 'string' ? parsed.input : undefined,
              answer: typeof parsed.answer === 'string' ? parsed.answer : undefined,
            });
          }
        } catch {}
      }
      conversations.sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));
    }
    const markdownByNode: Array<[string, { path: string; markdown: string }]> = [];
    if (fs.existsSync(knowledgeDir)) {
      const markdownFiles = listFiles(knowledgeDir).filter((f) => f.endsWith('.md'));
      for (const file of markdownFiles) {
        try {
          const markdown = fs.readFileSync(file, 'utf-8');
          let nodeId = parseFrontmatterNodeId(markdown);
          if (!nodeId) {
            const filename = path.basename(file);
            nodeId = filename.replace(/-[0-9a-f]{8}\.md$/i, '');
          }
          if (!nodeId) continue;
          const relPath = normalizePath(path.relative(memoryRoot, file));
          markdownByNode.push([nodeId, { path: relPath, markdown }]);
        } catch {}
      }
    }
    return {
      memoryRoot: normalizePath(memoryRoot),
      snapshot: { heads, nodes },
      versions,
      accessLogs,
      agentActions,
      preferences,
      skills,
      nodeConversations,
      conversations,
      markdownByNode,
    };
  };

  const normalizePath = (target: string) => target.replace(/\\/g, '/');

  const parseSkillMarkdown = (raw: string, fallbackName: string, extra: Partial<LocalSkill> = {}): LocalSkill => {
    const frontmatter = raw.match(/^---\s*[\r\n]+([\s\S]*?)\s*[\r\n]+---\s*[\r\n]*/);
    const body = frontmatter ? raw.slice(frontmatter[0].length).trim() : raw.trim();
    const meta = frontmatter ? frontmatter[1] : '';
    const name = meta.match(/name:\s*"?([^"\n]+)"?/i)?.[1]?.trim() || fallbackName;
    const description = meta.match(/description:\s*"?([^"\n]+)"?/i)?.[1]?.trim() || 'No description';
    return {
      name,
      description,
      content: body,
      ...extra,
    };
  };

  const sortSkills = (items: LocalSkill[]) => [...items].sort((a, b) => a.name.localeCompare(b.name));

  const mergeSkills = (...groups: LocalSkill[][]) => {
    const merged = new Map<string, LocalSkill>();
    for (const group of groups) {
      for (const skill of group) {
        const key = `${skill.source || 'local'}::${skill.location || skill.name}`;
        if (!merged.has(key)) {
          merged.set(key, skill);
        }
      }
    }
    return sortSkills([...merged.values()]);
  };

  const availableSkills = () => mergeSkills(skills, remoteSkills);

  const formatSkillLabel = (skill: LocalSkill) => {
    const source = skill.source === 'remote' ? `remote${skill.repository ? `:${skill.repository}` : ''}` : 'local';
    return `${skill.name} [${source}]`;
  };

  const findSkill = (targetName: string) => {
    const normalized = targetName.trim().toLowerCase();
    return availableSkills().find((skill) => {
      const name = skill.name.toLowerCase();
      const repository = skill.repository?.toLowerCase() || '';
      return name === normalized || name.endsWith(`/${normalized}`) || name.includes(normalized) || repository.includes(normalized);
    });
  };

  const githubHeaders = () => {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'mempedia-codecli',
    };
    const token = process.env.GITHUB_TOKEN?.trim();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    return headers;
  };

  const fetchJson = async <T,>(url: string): Promise<T> => {
    const response = await fetch(url, { headers: githubHeaders() });
    if (!response.ok) {
      const detail = (await response.text()).trim();
      const rateLimited = response.status === 403 ? ' GitHub API rate limit may apply; set GITHUB_TOKEN to raise it.' : '';
      throw new Error(`HTTP ${response.status} ${response.statusText}.${rateLimited}${detail ? ` ${detail}` : ''}`.trim());
    }
    return response.json() as Promise<T>;
  };

  const fetchText = async (url: string) => {
    const response = await fetch(url, { headers: { 'User-Agent': 'mempedia-codecli' } });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    return response.text();
  };

  const searchOnlineSkills = async (searchQuery: string) => {
    const query = searchQuery.trim();
    if (!query) return [];
    const searchUrl = `https://api.github.com/search/code?q=${encodeURIComponent(`${query} filename:SKILL.md`)}&per_page=8`;
    const searchResponse = await fetchJson<GitHubCodeSearchResponse>(searchUrl);
    const items = Array.isArray(searchResponse.items) ? searchResponse.items : [];
    const loaded = await Promise.all(items.map(async (item) => {
      if (!item.url) {
        return null;
      }
      try {
        const contentResponse = await fetchJson<GitHubContentResponse>(item.url);
        let markdown = '';
        if (contentResponse.encoding === 'base64' && typeof contentResponse.content === 'string') {
          markdown = Buffer.from(contentResponse.content.replace(/\s+/g, ''), 'base64').toString('utf-8');
        } else if (contentResponse.download_url) {
          markdown = await fetchText(contentResponse.download_url);
        }
        if (!markdown.trim()) {
          return null;
        }
        return parseSkillMarkdown(markdown, item.path || 'remote-skill', {
          source: 'remote',
          repository: item.repository?.full_name,
          location: item.html_url || item.repository?.html_url || item.url,
        });
      } catch {
        return null;
      }
    }));
    return mergeSkills(loaded.filter((skill): skill is LocalSkill => Boolean(skill)));
  };

  const formatPromptWithSkill = (query: string, oneShotSkill?: LocalSkill | null) => {
    const skillToUse = oneShotSkill || activeSkill;
    return skillToUse
      ? `Claude Code Skill Active: ${skillToUse.name}

Skill Description:
${skillToUse.description}

Skill Content:
${skillToUse.content}

User Request:
${query}`
      : query;
  };

  // ── Branch state pure updater (shared by terminal UI and thread chat) ────────
  const applyBranchTraceEvent = (
    prev: BranchLoopVisualState,
    event: TraceEvent,
    seenKeys: Set<string>
  ): BranchLoopVisualState => {
    const next: BranchLoopVisualState = { ...prev, nodes: { ...prev.nodes } };
    const meta = event.metadata;
    const content = String(event.content || '');

    if (meta?.branchId) {
      const branchId = meta.branchId;
      const existing = next.nodes[branchId];
      const node: BranchVisualNode = existing
        ? { ...existing }
        : {
            id: branchId,
            parentId: typeof meta.parentBranchId === 'string' ? meta.parentBranchId : null,
            label: meta.branchLabel || branchId,
            depth: typeof meta.depth === 'number' ? meta.depth : 0,
            step: typeof meta.step === 'number' ? meta.step : 0,
            status: 'queued',
          };

      if (meta.branchLabel) node.label = meta.branchLabel;
      if (typeof meta.depth === 'number') node.depth = meta.depth;
      if (typeof meta.step === 'number') {
        node.step = meta.step;
        const stepKey = `${branchId}:${meta.step}`;
        if (!seenKeys.has(stepKey) && event.type === 'thought') {
          seenKeys.add(stepKey);
          next.totalSteps += 1;
        }
      }

      if (event.type === 'error') {
        node.status = 'error';
      } else if (content.startsWith('Forcing finalization')) {
        node.status = 'finalizing';
      } else if (content.startsWith('Branch completed')) {
        node.status = 'completed';
      } else if (node.status !== 'completed' && node.status !== 'finalizing') {
        node.status = 'active';
      }

      next.nodes[branchId] = node;
      next.activeBranchId = node.status === 'completed' ? next.activeBranchId : branchId;
    }

    if (content.startsWith('Spawned child branch')) {
      const spawnedMatch = content.match(/^Spawned child branch\s+([^:]+):\s*(.+)$/i);
      if (spawnedMatch) {
        const childId = spawnedMatch[1].trim();
        const childLabel = spawnedMatch[2].trim();
        const existing = next.nodes[childId];
        next.nodes[childId] = {
          id: childId,
          parentId: existing?.parentId || (meta?.parentBranchId ?? null),
          label: childLabel || existing?.label || childId,
          depth: typeof meta?.depth === 'number' ? meta.depth : (existing?.depth ?? 0),
          step: typeof meta?.step === 'number' ? meta.step : (existing?.step ?? 0),
          status: existing?.status === 'completed' ? 'completed' : 'queued',
        };
      }
    }

    const allNodes = Object.values(next.nodes);
    next.completed = allNodes.filter((n) => n.status === 'completed').length;
    next.queueCount = allNodes.filter((n) => n.status === 'queued').length;
    // Track all concurrently active branches (for multi-highlight in the UI).
    next.activeBranchIds = allNodes
      .filter((n) => n.status === 'active' || n.status === 'finalizing')
      .map((n) => n.id);

    if (content.startsWith('Synthesizing ') || content.startsWith('Reached total branch loop budget')) {
      next.activeBranchId = null;
      next.activeBranchIds = [];
    }

    return next;
  };

  // ── Thread persistence helpers ────────────────────────────────────────────────
  const getThreadsDir = () => path.join(projectRoot, '.mempedia', 'threads');

  const generateThreadId = () =>
    `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  const threadLoadIndex = (): Array<{ id: string; title: string; created_at: number; last_updated: number }> => {
    const indexPath = path.join(getThreadsDir(), 'index.json');
    if (!fs.existsSync(indexPath)) return [];
    try { return JSON.parse(fs.readFileSync(indexPath, 'utf-8')); } catch { return []; }
  };

  const threadSaveIndex = (index: Array<{ id: string; title: string; created_at: number; last_updated: number }>) => {
    fs.mkdirSync(getThreadsDir(), { recursive: true });
    fs.writeFileSync(path.join(getThreadsDir(), 'index.json'), JSON.stringify(index, null, 2));
  };

  const threadLoad = (id: string): ConversationThread | null => {
    const sanitized = id.replace(/[^a-zA-Z0-9_-]/g, '');
    if (!sanitized) return null;
    const p = path.join(getThreadsDir(), `${sanitized}.json`);
    if (!fs.existsSync(p)) return null;
    try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return null; }
  };

  const threadSave = (thread: ConversationThread) => {
    fs.mkdirSync(getThreadsDir(), { recursive: true });
    const sanitized = thread.id.replace(/[^a-zA-Z0-9_-]/g, '');
    fs.writeFileSync(path.join(getThreadsDir(), `${sanitized}.json`), JSON.stringify(thread, null, 2));
  };

  const threadDelete = (id: string) => {
    const sanitized = id.replace(/[^a-zA-Z0-9_-]/g, '');
    if (!sanitized) return;
    const p = path.join(getThreadsDir(), `${sanitized}.json`);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  };

  const createUiServer = (uiRoot: string) => {
    const safeRoot = path.resolve(uiRoot);
    const safePrefix = `${safeRoot}${path.sep}`;
    return http.createServer(async (req, res) => {
      const method = req.method || 'GET';
      const requestUrl = new URL(req.url || '/', 'http://127.0.0.1');
      const rawPath = requestUrl.pathname;
      if (rawPath === '/api/cli/status' && method === 'GET') {
        writeJson(res, 200, {
          ok: true,
          activeSkill: activeSkill?.name || null,
          memoryRoot: normalizePath(path.join(projectRoot, '.mempedia', 'memory')),
          conversationSize: webConversationRef.current.length,
        });
        return;
      }
      if (rawPath === '/api/cli/conversation' && method === 'GET') {
        writeJson(res, 200, { conversation: webConversationRef.current });
        return;
      }
      if (rawPath === '/api/memory/snapshot' && method === 'GET') {
        try {
          writeJson(res, 200, { ok: true, ...loadMemorySnapshot() });
        } catch (error: any) {
          writeJson(res, 500, { ok: false, error: error?.message || String(error) });
        }
        return;
      }
      if (rawPath === '/api/memory/node' && method === 'GET') {
        try {
          const nodeId = String(requestUrl.searchParams.get('node_id') || '').trim();
          if (!nodeId) {
            writeJson(res, 400, { ok: false, error: 'node_id is required' });
            return;
          }
          const result = await agent.sendMempediaAction({
            action: 'open_node',
            node_id: nodeId,
            markdown: true,
            agent_id: 'ui-editor',
          });
          if ((result as any)?.kind === 'error') {
            writeJson(res, 400, { ok: false, error: (result as any).message || 'Failed to open node' });
            return;
          }
          if ((result as any)?.kind !== 'markdown') {
            writeJson(res, 500, { ok: false, error: 'Unexpected response while opening node' });
            return;
          }
          writeJson(res, 200, { ok: true, ...(result as any) });
        } catch (error: any) {
          writeJson(res, 500, { ok: false, error: error?.message || String(error) });
        }
        return;
      }
      if (rawPath === '/api/memory/node/save' && method === 'POST') {
        try {
          const body = await readBody(req);
          const markdown = String(body?.markdown || '');
          const nodeId = String(body?.node_id || parseFrontmatterNodeId(markdown) || '').trim();
          const graphLinks = Array.isArray(body?.graph_links) ? body.graph_links : [];
          const agentId = String(body?.agent_id || 'ui-editor').trim() || 'ui-editor';
          const reason = String(body?.reason || 'ui autosave sync').trim() || 'ui autosave sync';
          const source = String(body?.source || 'mempedia-ui').trim() || 'mempedia-ui';
          const importance = Number(body?.importance);
          if (!markdown.trim()) {
            writeJson(res, 400, { ok: false, error: 'markdown is required' });
            return;
          }
          if (!nodeId) {
            writeJson(res, 400, { ok: false, error: 'node_id is required in request or markdown frontmatter' });
            return;
          }
          const result = await agent.sendMempediaAction({
            action: 'sync_markdown',
            node_id: nodeId,
            markdown,
            agent_id: agentId,
            reason,
            source,
            importance: Number.isFinite(importance) ? importance : undefined,
          });
          if ((result as any)?.kind === 'error') {
            writeJson(res, 400, { ok: false, error: (result as any).message || 'Failed to save markdown' });
            return;
          }
          const linkResult = await agent.sendMempediaAction({
            action: 'set_node_links',
            node_id: nodeId,
            links: graphLinks
              .map((link: any) => ({
                target: String(link?.target || '').trim(),
                label: String(link?.label || '').trim() || undefined,
                weight: Number.isFinite(Number(link?.weight)) ? Number(link.weight) : undefined,
              }))
              .filter((link: any) => link.target),
            agent_id: agentId,
            reason: `${reason} (graph links)`,
            source,
            importance: Number.isFinite(importance) ? importance : undefined,
          });
          if ((linkResult as any)?.kind === 'error') {
            writeJson(res, 400, { ok: false, error: (linkResult as any).message || 'Failed to save graph links' });
            return;
          }
          const opened = await agent.sendMempediaAction({
            action: 'open_node',
            node_id: nodeId,
            markdown: true,
            agent_id: agentId,
          });
          if ((opened as any)?.kind === 'error') {
            writeJson(res, 400, { ok: false, error: (opened as any).message || 'Saved but failed to reopen node' });
            return;
          }
          writeJson(res, 200, {
            ok: true,
            node_id: nodeId,
            result,
            linkResult,
            opened,
            snapshot: loadMemorySnapshot(),
          });
        } catch (error: any) {
          writeJson(res, 500, { ok: false, error: error?.message || String(error) });
        }
        return;
      }
      if (rawPath === '/api/cli/chat' && method === 'POST') {
        if (uiBusyRef.current) {
          writeJson(res, 409, { ok: false, error: 'CLI is busy.' });
          return;
        }
        try {
          const body = await readBody(req);
          const query = String(body?.query || '').trim();
          if (!query) {
            writeJson(res, 400, { ok: false, error: 'query is required' });
            return;
          }
          const skillName = String(body?.skill || '').trim();
          const selectedSkill = skillName
            ? skills.find((s) => s.name === skillName || s.name.endsWith(`/${skillName}`) || s.name.includes(skillName)) || null
            : null;
          const prompt = formatPromptWithSkill(query, selectedSkill);
          uiBusyRef.current = true;
          const traces: Array<{ type: string; content: string; metadata?: TraceEvent['metadata'] }> = [];
          webConversationRef.current.push({ role: 'user', content: query, timestamp: Date.now() });
          const answer = await agent.run(prompt, (event: TraceEvent) => {
            traces.push({ type: event.type, content: event.content, metadata: event.metadata });
            webConversationRef.current.push({
              role: 'trace',
              content: event.content,
              traceType: event.type,
              traceMeta: event.metadata,
              timestamp: Date.now(),
            });
          }, { conversationId: 'web-cli', sessionId: `web-cli-${Date.now()}` });
          webConversationRef.current.push({ role: 'assistant', content: answer, timestamp: Date.now() });
          if (webConversationRef.current.length > 400) {
            webConversationRef.current = webConversationRef.current.slice(-400);
          }
          writeJson(res, 200, {
            ok: true,
            answer,
            traces,
            conversation: webConversationRef.current,
          });
        } catch (error: any) {
          writeJson(res, 500, { ok: false, error: error?.message || String(error) });
        } finally {
          uiBusyRef.current = false;
        }
        return;
      }
      // ── Thread API ──────────────────────────────────────────────────────────

      // GET /api/threads – list all conversation threads
      if (rawPath === '/api/threads' && method === 'GET') {
        writeJson(res, 200, { ok: true, threads: threadLoadIndex() });
        return;
      }

      // POST /api/threads – create a new thread
      if (rawPath === '/api/threads' && method === 'POST') {
        const body = await readBody(req);
        const title = String(body?.title || '').trim() || 'New Conversation';
        const id = generateThreadId();
        const now = Date.now();
        const thread: ConversationThread = { id, title, created_at: now, last_updated: now, rounds: [] };
        threadSave(thread);
        const index = threadLoadIndex();
        index.unshift({ id, title, created_at: now, last_updated: now });
        threadSaveIndex(index);
        writeJson(res, 200, { ok: true, thread });
        return;
      }

      const threadIdMatch = rawPath.match(/^\/api\/threads\/([a-zA-Z0-9_-]{1,80})(\/[a-z]*)?\/?$/);
      if (threadIdMatch) {
        const tId = threadIdMatch[1];
        const subPath = threadIdMatch[2] || '';

        // GET /api/threads/:id – get thread detail
        if (!subPath && method === 'GET') {
          const thread = threadLoad(tId);
          if (!thread) { writeJson(res, 404, { ok: false, error: 'Thread not found' }); return; }
          writeJson(res, 200, { ok: true, thread });
          return;
        }

        // DELETE /api/threads/:id – delete thread
        if (!subPath && method === 'DELETE') {
          threadDelete(tId);
          const idx = threadLoadIndex().filter((t) => t.id !== tId);
          threadSaveIndex(idx);
          writeJson(res, 200, { ok: true });
          return;
        }

        // POST /api/threads/:id/title – rename thread
        if (subPath === '/title' && method === 'POST') {
          const body = await readBody(req);
          const newTitle = String(body?.title || '').trim();
          if (!newTitle) { writeJson(res, 400, { ok: false, error: 'title is required' }); return; }
          const thread = threadLoad(tId);
          if (!thread) { writeJson(res, 404, { ok: false, error: 'Thread not found' }); return; }
          thread.title = newTitle;
          threadSave(thread);
          const idx = threadLoadIndex();
          const pos = idx.findIndex((t) => t.id === tId);
          if (pos >= 0) { idx[pos].title = newTitle; threadSaveIndex(idx); }
          writeJson(res, 200, { ok: true, thread });
          return;
        }

        // POST /api/threads/:id/chat – send a message in a thread
        if (subPath === '/chat' && method === 'POST') {
          if (activeThreadRunsRef.current.has(tId)) {
            writeJson(res, 409, { ok: false, error: 'This thread is busy. Please wait for the current request to finish.' });
            return;
          }
          try {
            const body = await readBody(req);
            const query = String(body?.query || '').trim();
            if (!query) { writeJson(res, 400, { ok: false, error: 'query is required' }); return; }
            const thread = threadLoad(tId);
            if (!thread) { writeJson(res, 404, { ok: false, error: 'Thread not found' }); return; }

            const skillName = String(body?.skill || '').trim();
            const selectedSkill = skillName
              ? skills.find((s) => s.name === skillName || s.name.endsWith(`/${skillName}`) || s.name.includes(skillName)) || null
              : null;
            const prompt = formatPromptWithSkill(query, selectedSkill);

            activeThreadRunsRef.current.add(tId);
            const roundId = generateThreadId();
            const roundTimestamp = Date.now();
            const roundTraces: Array<{ type: string; content: string; metadata?: TraceEvent['metadata'] }> = [];
            const roundBranchSeen = new Set<string>();
            let roundBranchState: BranchLoopVisualState = {
              round: thread.rounds.length + 1,
              totalSteps: 0,
              totalBudget: branchTotalBudget,
              completed: 0,
              maxCompleted: branchMaxCompleted,
              activeBranchId: 'B0',
              activeBranchIds: ['B0'],
              queueCount: 0,
              nodes: { B0: { id: 'B0', parentId: null, label: 'root', depth: 0, step: 0, status: 'active' } },
            };

            const answer = await agent.run(prompt, (event: TraceEvent) => {
              roundTraces.push({ type: event.type, content: event.content, metadata: event.metadata });
              roundBranchState = applyBranchTraceEvent(roundBranchState, event, roundBranchSeen);
            }, { conversationId: `thread:${tId}`, sessionId: `thread-${tId}-${roundId}` });

            const round: ThreadRound = {
              id: roundId,
              timestamp: roundTimestamp,
              user_input: query,
              agent_response: answer,
              traces: roundTraces,
              branch_snapshot: roundBranchState,
            };

            thread.rounds.push(round);
            thread.last_updated = Date.now();
            // Auto-title from first message
            if (thread.rounds.length === 1 && thread.title === 'New Conversation') {
              thread.title = query.length > 50 ? `${query.slice(0, 50)}…` : query;
            }
            threadSave(thread);

            const idx = threadLoadIndex();
            const pos = idx.findIndex((t) => t.id === tId);
            if (pos >= 0) { idx[pos].last_updated = thread.last_updated; idx[pos].title = thread.title; }
            threadSaveIndex(idx);

            writeJson(res, 200, { ok: true, round, thread });
          } catch (error: any) {
            writeJson(res, 500, { ok: false, error: error?.message || String(error) });
          } finally {
            activeThreadRunsRef.current.delete(tId);
          }
          return;
        }

        // POST /api/threads/:id/stream – SSE streaming chat
        if (subPath === '/stream' && method === 'POST') {
          if (activeThreadRunsRef.current.has(tId)) {
            writeJson(res, 409, { ok: false, error: 'This thread is busy. Please wait for the current request to finish.' });
            return;
          }
          let body: any;
          try { body = await readBody(req); } catch { writeJson(res, 400, { ok: false, error: 'Invalid body' }); return; }
          const query = String(body?.query || '').trim();
          if (!query) { writeJson(res, 400, { ok: false, error: 'query is required' }); return; }
          const thread = threadLoad(tId);
          if (!thread) { writeJson(res, 404, { ok: false, error: 'Thread not found' }); return; }

          res.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
          });

          const sendSSE = (data: object) => {
            if (!res.writableEnded) {
              res.write(`data: ${JSON.stringify(data)}\n\n`);
            }
          };

          const skillName = String(body?.skill || '').trim();
          const selectedSkill = skillName
            ? skills.find((s) => s.name === skillName || s.name.endsWith(`/${skillName}`) || s.name.includes(skillName)) || null
            : null;
          const prompt = formatPromptWithSkill(query, selectedSkill);

          activeThreadRunsRef.current.add(tId);
          const roundId = generateThreadId();
          const roundTimestamp = Date.now();
          const roundTraces: Array<{ type: string; content: string; metadata?: TraceEvent['metadata'] }> = [];
          const roundBranchSeen = new Set<string>();
          let roundBranchState: BranchLoopVisualState = {
            round: thread.rounds.length + 1,
            totalSteps: 0,
            totalBudget: branchTotalBudget,
            completed: 0,
            maxCompleted: branchMaxCompleted,
            activeBranchId: 'B0',
            activeBranchIds: ['B0'],
            queueCount: 0,
            nodes: { B0: { id: 'B0', parentId: null, label: 'root', depth: 0, step: 0, status: 'active' } },
          };

          // Send initial tree state so the UI can render the root node immediately
          sendSSE({ kind: 'init', branchState: roundBranchState, query });

          try {
            const answer = await agent.run(prompt, (event: TraceEvent) => {
              roundTraces.push({ type: event.type, content: event.content, metadata: event.metadata });
              roundBranchState = applyBranchTraceEvent(roundBranchState, event, roundBranchSeen);
              sendSSE({ kind: 'trace', event, branchState: roundBranchState });
            }, { conversationId: `thread:${tId}`, sessionId: `thread-${tId}-${roundId}` });

            const round: ThreadRound = {
              id: roundId,
              timestamp: roundTimestamp,
              user_input: query,
              agent_response: answer,
              traces: roundTraces,
              branch_snapshot: roundBranchState,
            };

            thread.rounds.push(round);
            thread.last_updated = Date.now();
            if (thread.rounds.length === 1 && thread.title === 'New Conversation') {
              thread.title = query.length > 50 ? `${query.slice(0, 50)}…` : query;
            }
            threadSave(thread);

            const idx = threadLoadIndex();
            const pos = idx.findIndex((t) => t.id === tId);
            if (pos >= 0) { idx[pos].last_updated = thread.last_updated; idx[pos].title = thread.title; }
            threadSaveIndex(idx);

            sendSSE({ kind: 'done', round, thread });
          } catch (error: any) {
            sendSSE({ kind: 'error', error: error?.message || String(error) });
          } finally {
            activeThreadRunsRef.current.delete(tId);
            if (!res.writableEnded) res.end();
          }
          return;
        }
      }

      const requestPath = decodeURIComponent(rawPath === '/' ? '/index.html' : rawPath);
      const filePath = path.resolve(path.join(safeRoot, `.${requestPath}`));
      if (!(filePath === safeRoot || filePath.startsWith(safePrefix))) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Forbidden');
        return;
      }
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not Found');
        return;
      }
      res.writeHead(200, { 'Content-Type': mimeType(filePath) });
      res.end(fs.readFileSync(filePath));
    });
  };

  const startUiServer = async (preferredPort?: number) => {
    if (uiServerRef.current) {
      return uiUrl || 'http://localhost:7878/';
    }
    const uiRoot = path.join(projectRoot, 'mempedia-ui');
    if (!fs.existsSync(path.join(uiRoot, 'index.html'))) {
      throw new Error(`mempedia-ui not found: ${uiRoot}`);
    }
    const initialPort = preferredPort || Number(process.env.MEMPEDIA_UI_PORT || 7878);
    const tryListen = (port: number): Promise<{ server: http.Server; port: number }> => {
      return new Promise((resolve, reject) => {
        const server = createUiServer(uiRoot);
        const onError = (err: any) => {
          server.removeAllListeners();
          reject(err);
        };
        server.once('error', onError);
        server.listen(port, '127.0.0.1', () => {
          server.removeListener('error', onError);
          const addr = server.address();
          const resolvedPort = typeof addr === 'object' && addr ? addr.port : port;
          resolve({ server, port: resolvedPort });
        });
      });
    };
    let started: { server: http.Server; port: number } | null = null;
    try {
      started = await tryListen(initialPort);
    } catch (err: any) {
      if (err?.code !== 'EADDRINUSE') {
        throw err;
      }
      started = await tryListen(0);
    }
    uiServerRef.current = started.server;
    const nextUrl = `http://127.0.0.1:${started.port}/?source=cli`;
    setUiUrl(nextUrl);
    return nextUrl;
  };

  const stopUiServer = async () => {
    const current = uiServerRef.current;
    if (!current) {
      return false;
    }
    await new Promise<void>((resolve) => current.close(() => resolve()));
    uiServerRef.current = null;
    setUiUrl(null);
    return true;
  };

  const runAgent = async (query: string, oneShotSkill?: LocalSkill) => {
    const nextRound = runRound + 1;
    setRunRound(nextRound);
    branchStepSeenRef.current = new Set();
    setBranchLoop({
      round: nextRound,
      totalSteps: 0,
      totalBudget: branchTotalBudget,
      completed: 0,
      maxCompleted: branchMaxCompleted,
      activeBranchId: 'B0',
      activeBranchIds: ['B0'],
      queueCount: 0,
      nodes: {
        B0: {
          id: 'B0',
          parentId: null,
          label: 'root',
          depth: 0,
          step: 0,
          status: 'active'
        }
      }
    });

    const prompt = formatPromptWithSkill(query, oneShotSkill || null);
    const response = await agent.run(prompt, (event: TraceEvent) => {
      setBranchLoop((prev) => {
        if (!prev) return prev;
        return applyBranchTraceEvent(prev, event, branchStepSeenRef.current);
      });

      setHistory((prev: HistoryItem[]) => [...prev, {
        type: 'trace',
        content: event.content,
        traceType: event.type,
        traceMeta: event.metadata,
      }]);
    }, { conversationId: 'terminal-main', sessionId: `terminal-${Date.now()}` });
    setHistory((prev: HistoryItem[]) => [...prev, { type: 'agent', content: response }]);
  };

  const handleSubmit = async (query: string) => {
    if (!query.trim()) return;
    const trimmed = query.trim();

    if (trimmed === '/exit' || trimmed === '/quit') {
      setStatus('Flushing memory queue...');
      await agent.shutdown();
      exit();
      return;
    }

    if (trimmed === '/clear') {
      setHistory([]);
      setStatus('Ready');
      setInput('');
      return;
    }

    if (trimmed === '/help') {
      setHistory((prev: HistoryItem[]) => [...prev, {
        type: 'info',
        content: 'Commands: /help | /clear | /tracelog | /skills | /skills search <query> | /skills clear-remote | /skill <name> | /skill off | /skill <name> <task> | /ui start [port] | /ui stop | /ui status'
      }]);
      return;
    }

    if (trimmed === '/tracelog') {
      setTraceLogExpanded((prev) => !prev);
      setHistory((prev: HistoryItem[]) => [...prev, {
        type: 'info',
        content: `Trace log ${traceLogExpanded ? 'collapsed' : 'expanded'}.`
      }]);
      return;
    }

    if (trimmed.startsWith('/ui')) {
      const parts = trimmed.split(/\s+/);
      const action = parts[1] || 'status';
      if (action === 'start' || action === 'open') {
        const requestedPort = parts[2] ? Number(parts[2]) : undefined;
        if (parts[2] && Number.isNaN(requestedPort)) {
          setHistory((prev: HistoryItem[]) => [...prev, { type: 'info', content: `Invalid port: ${parts[2]}` }]);
          return;
        }
        try {
          const url = await startUiServer(requestedPort);
          setHistory((prev: HistoryItem[]) => [...prev, { type: 'info', content: `Mempedia UI started: ${url}` }]);
        } catch (error: any) {
          setHistory((prev: HistoryItem[]) => [...prev, { type: 'info', content: `Failed to start UI: ${error.message}` }]);
        }
        return;
      }
      if (action === 'stop') {
        const stopped = await stopUiServer();
        setHistory((prev: HistoryItem[]) => [...prev, { type: 'info', content: stopped ? 'Mempedia UI stopped.' : 'Mempedia UI is not running.' }]);
        return;
      }
      if (action === 'status') {
        setHistory((prev: HistoryItem[]) => [...prev, { type: 'info', content: uiServerRef.current ? `Mempedia UI running at ${uiUrl}` : 'Mempedia UI is not running.' }]);
        return;
      }
      setHistory((prev: HistoryItem[]) => [...prev, { type: 'info', content: 'Usage: /ui start [port] | /ui stop | /ui status' }]);
      return;
    }

    if (trimmed.startsWith('/skills')) {
      const parts = trimmed.split(/\s+/).slice(1);
      if (parts.length === 0) {
        const listedSkills = availableSkills();
        const lines = listedSkills.length > 0
          ? listedSkills.map((s) => `${activeSkill?.name === s.name ? '* ' : '- '}${formatSkillLabel(s)}: ${s.description}`).join('\n')
          : 'No local skills found under ./skills. Use /skills search <query> to search GitHub.';
        setHistory((prev: HistoryItem[]) => [...prev, {
          type: 'info',
          content: `Available skills:\n${lines}`
        }]);
        return;
      }
      const action = parts[0];
      if (action === 'search') {
        const searchQuery = parts.slice(1).join(' ').trim();
        if (!searchQuery) {
          setHistory((prev: HistoryItem[]) => [...prev, {
            type: 'info',
            content: 'Usage: /skills search <query>'
          }]);
          return;
        }
        setStatus(`Searching online skills for ${searchQuery}...`);
        try {
          const found = await searchOnlineSkills(searchQuery);
          setRemoteSkills((prev) => mergeSkills(prev, found));
          const lines = found.length > 0
            ? found.map((skill) => `- ${formatSkillLabel(skill)}: ${skill.description}`).join('\n')
            : 'No remote skills matched this query.';
          setHistory((prev: HistoryItem[]) => [...prev, {
            type: 'info',
            content: `Remote skill search for "${searchQuery}":\n${lines}`
          }]);
          setStatus('Ready');
        } catch (error: any) {
          setHistory((prev: HistoryItem[]) => [...prev, {
            type: 'info',
            content: `Remote skill search failed: ${error.message}`
          }]);
          setStatus('Error');
        }
        return;
      }
      if (action === 'clear-remote') {
        if (activeSkill?.source === 'remote') {
          setActiveSkill(null);
        }
        setRemoteSkills([]);
        setHistory((prev: HistoryItem[]) => [...prev, {
          type: 'info',
          content: 'Remote skill cache cleared.'
        }]);
        return;
      }
      setHistory((prev: HistoryItem[]) => [...prev, {
        type: 'info',
        content: 'Usage: /skills | /skills search <query> | /skills clear-remote'
      }]);
      return;
    }

    if (trimmed.startsWith('/skill')) {
      const parts = trimmed.split(/\s+/).slice(1);
      if (parts.length === 0) {
        setHistory((prev: HistoryItem[]) => [...prev, {
          type: 'info',
          content: 'Usage: /skill <name> | /skill off | /skill <name> <task>'
        }]);
        return;
      }
      const targetName = parts[0];
      if (targetName === 'off' || targetName === 'none') {
        setActiveSkill(null);
        setHistory((prev: HistoryItem[]) => [...prev, {
          type: 'info',
          content: 'Skill deactivated.'
        }]);
        return;
      }
      const selected = findSkill(targetName);
      if (!selected) {
        setHistory((prev: HistoryItem[]) => [...prev, {
          type: 'info',
          content: `Skill not found: ${targetName}. Use /skills or /skills search <query>.`
        }]);
        return;
      }
      const task = parts.slice(1).join(' ').trim();
      if (!task) {
        setActiveSkill(selected);
        setHistory((prev: HistoryItem[]) => [...prev, {
          type: 'info',
          content: `Skill activated: ${formatSkillLabel(selected)}`
        }]);
        return;
      }
      setIsProcessing(true);
      setHistory((prev: HistoryItem[]) => [...prev, { type: 'user', content: task }]);
      setInput('');
      setStatus(`Running with skill ${selected.name}...`);
      try {
        await runAgent(task, selected);
        setStatus('Ready');
      } catch (error: any) {
        setHistory((prev: HistoryItem[]) => [...prev, { type: 'info', content: `Error: ${error.message}` }]);
        setStatus('Error');
      } finally {
        setIsProcessing(false);
      }
      return;
    }
    
    setIsProcessing(true);
    setHistory((prev: HistoryItem[]) => [...prev, { type: 'user', content: query }]);
    setInput('');
    setStatus('Initializing...');

    try {
      await runAgent(query);
      setStatus('Ready');
    } catch (error: any) {
      setHistory((prev: HistoryItem[]) => [...prev, { type: 'info', content: `Error: ${error.message}` }]);
      setStatus('Error');
    } finally {
      setIsProcessing(false);
    }
  };

  const getTraceColor = (type?: string) => {
    switch (type) {
      case 'thought': return 'gray';
      case 'action': return 'yellow';
      case 'observation': return 'dim';
      case 'error': return 'red';
      default: return 'white';
    }
  };

  const getTracePrefix = (type?: string) => {
    switch (type) {
      case 'thought': return '🤔 ';
      case 'action': return '⚡ ';
      case 'observation': return '👁️ ';
      case 'error': return '❌ ';
      default: return '';
    }
  };

  const formatTraceBranch = (meta?: TraceEvent['metadata']) => {
    if (!meta?.branchId) {
      return '';
    }
    const label = meta.branchLabel ? ` ${meta.branchLabel}` : '';
    const depth = typeof meta.depth === 'number' ? ` d${meta.depth}` : '';
    return `[${meta.branchId}${depth}${label}] `;
  };

  const sortBranchIds = (left: string, right: string) => {
    const l = left.replace(/^B/, '').split('.').map((part) => Number(part) || 0);
    const r = right.replace(/^B/, '').split('.').map((part) => Number(part) || 0);
    const max = Math.max(l.length, r.length);
    for (let i = 0; i < max; i += 1) {
      const lv = l[i] ?? -1;
      const rv = r[i] ?? -1;
      if (lv !== rv) {
        return lv - rv;
      }
    }
    return left.localeCompare(right);
  };

  const getBranchStatusColor = (status: BranchVisualStatus) => {
    switch (status) {
      case 'completed': return 'green';
      case 'active': return 'cyan';
      case 'queued': return 'gray';
      case 'finalizing': return 'yellow';
      case 'error': return 'red';
      default: return 'white';
    }
  };

  const getBranchStatusGlyph = (status: BranchVisualStatus) => {
    switch (status) {
      case 'completed': return '●';
      case 'active': return '◆';
      case 'queued': return '○';
      case 'finalizing': return '◐';
      case 'error': return '✖';
      default: return '•';
    }
  };

  const buildProgressBar = (value: number, total: number, width = 22) => {
    const safeTotal = Math.max(1, total);
    const clamped = Math.max(0, Math.min(value, safeTotal));
    const filled = Math.round((clamped / safeTotal) * width);
    return `${'█'.repeat(filled)}${'░'.repeat(Math.max(0, width - filled))}`;
  };

  const buildBranchTreeRows = (state: BranchLoopVisualState): BranchTreeRow[] => {
    const children = new Map<string | null, BranchVisualNode[]>();
    for (const node of Object.values(state.nodes)) {
      const key = node.parentId ?? null;
      const bucket = children.get(key) || [];
      bucket.push(node);
      children.set(key, bucket);
    }
    for (const bucket of children.values()) {
      bucket.sort((a, b) => sortBranchIds(a.id, b.id));
    }

    const rows: BranchTreeRow[] = [];
    const walk = (parentId: string | null, ancestorHasNext: boolean[]) => {
      const bucket = children.get(parentId) || [];
      bucket.forEach((node, index) => {
        const isLast = index === bucket.length - 1;
        rows.push({ node, isLast, ancestorHasNext });
        walk(node.id, [...ancestorHasNext, !isLast]);
      });
    };

    walk(null, []);
    return rows;
  };

  const renderBranchTree = (state: BranchLoopVisualState) => {
    return buildBranchTreeRows(state).slice(0, 24).map((row) => {
      const statusColor = getBranchStatusColor(row.node.status);
      const isActive = state.activeBranchId === row.node.id;
      const label = row.node.label && row.node.label !== row.node.id ? row.node.label : 'branch';
      return (
        <Box key={row.node.id} flexDirection="row">
          {row.ancestorHasNext.map((hasNext, index) => (
            <Text key={`${row.node.id}-ancestor-${index}`} color="gray">{hasNext ? '│  ' : '   '}</Text>
          ))}
          <Text color="gray">{row.node.depth === 0 ? '● ' : row.isLast ? '└─ ' : '├─ '}</Text>
          <Text color={statusColor}>{getBranchStatusGlyph(row.node.status)}</Text>
          <Text> </Text>
          <Text bold color={isActive ? 'cyanBright' : 'white'}>{row.node.id}</Text>
          <Text color="dim"> · s{row.node.step} · d{row.node.depth}</Text>
          <Text> </Text>
          <Text color={statusColor}>{label}</Text>
        </Box>
      );
    });
  };

  const visibleHistory = traceLogExpanded ? history : history.slice(-5);

  return (
    <Box flexDirection="column" padding={1}>
      <Text color="green" bold>Mempedia CodeCLI (Branching ReAct Agent)</Text>
      <Text color="dim">Skill: {activeSkill ? formatSkillLabel(activeSkill) : 'none'} | Use /skills or /skills search</Text>
      <Text color="dim">UI: {uiUrl || 'stopped'} | /ui start to launch mempedia-ui</Text>
      <Text color="dim">Trace log: {traceLogExpanded ? 'expanded' : 'collapsed'} | /tracelog to toggle</Text>
      {branchLoop && (
        <Box flexDirection="column" marginTop={1} borderStyle="round" borderColor="cyan" paddingX={1} paddingY={0}>
          <Text color="cyan" bold>Branch Tree</Text>
          <Box flexDirection="row">
            <Text color="dim">Round {branchLoop.round}</Text>
            <Text color="dim">  Active: {branchLoop.activeBranchId || 'synthesizing'}</Text>
            <Text color="dim">  Queue: {branchLoop.queueCount}</Text>
          </Box>
          <Box flexDirection="row">
            <Text color="white">Steps </Text>
            <Text color="cyan">{buildProgressBar(branchLoop.totalSteps, branchLoop.totalBudget)}</Text>
            <Text color="dim"> {branchLoop.totalSteps}/{branchLoop.totalBudget}</Text>
          </Box>
          <Box flexDirection="row">
            <Text color="white">Done  </Text>
            <Text color="green">{buildProgressBar(branchLoop.completed, branchLoop.maxCompleted)}</Text>
            <Text color="dim"> {branchLoop.completed}/{branchLoop.maxCompleted}</Text>
          </Box>
          <Box flexDirection="row" marginBottom={0}>
            <Text color="cyan">◆ active</Text>
            <Text color="dim">  </Text>
            <Text color="green">● done</Text>
            <Text color="dim">  </Text>
            <Text color="yellow">◐ finalizing</Text>
            <Text color="dim">  </Text>
            <Text color="gray">○ queued</Text>
            <Text color="dim">  </Text>
            <Text color="red">✖ error</Text>
          </Box>
          <Box flexDirection="column">
            {renderBranchTree(branchLoop)}
          </Box>
        </Box>
      )}
      <Box flexDirection="column" marginY={1} minHeight={5}>
        {visibleHistory.map((item, index) => (
          <Box key={index} flexDirection="column" marginY={0} marginLeft={item.type === 'trace' ? 2 : 0}>
            {item.type === 'trace' ? (
              <Text color={getTraceColor(item.traceType)}>
                {getTracePrefix(item.traceType)} {formatTraceBranch(item.traceMeta)}{item.content}
              </Text>
            ) : (
              <Text color={item.type === 'user' ? 'blue' : item.type === 'agent' ? 'green' : 'yellow'}>
                {item.type === 'user' ? '> ' : item.type === 'agent' ? '🤖 ' : 'ℹ️ '}
                {item.content}
              </Text>
            )}
          </Box>
        ))}
        {!traceLogExpanded && history.length > 5 && (
          <Text color="dim">... {history.length - 5} earlier log entries hidden</Text>
        )}
      </Box>

      {isProcessing ? (
        <Text color="cyan">⚙️ {status}</Text>
      ) : (
        <Box>
          <Text color="blue">{'> '}</Text>
          <TextInput
            value={input}
            onChange={setInput}
            onSubmit={handleSubmit}
            placeholder="Type your instruction..."
          />
        </Box>
      )}
      
      {backgroundTasks.length > 0 && (
        <Box marginTop={1}>
            <Text color="dim">⏳ Background tasks: {backgroundTasks.join(', ')}</Text>
        </Box>
      )}
    </Box>
  );
};
