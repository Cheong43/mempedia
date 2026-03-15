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
  const [uiUrl, setUiUrl] = useState<string | null>(null);
  const uiServerRef = useRef<http.Server | null>(null);
  const uiBusyRef = useRef(false);
  const webConversationRef = useRef<WebConversationItem[]>([]);

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
    const habits = readJsonLines(path.join(indexDir, 'user_habits.jsonl'), (row) => row && typeof row.topic === 'string');
    const behaviorPatterns = readJsonLines(path.join(indexDir, 'behavior_patterns.jsonl'), (row) => row && typeof row.pattern_key === 'string');
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
      habits,
      behaviorPatterns,
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
          const confidence = Number(body?.confidence);
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
            confidence: Number.isFinite(confidence) ? confidence : undefined,
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
            confidence: Number.isFinite(confidence) ? confidence : undefined,
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
          });
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
    const prompt = formatPromptWithSkill(query, oneShotSkill || null);
    const response = await agent.run(prompt, (event: TraceEvent) => {
      setHistory((prev: HistoryItem[]) => [...prev, {
        type: 'trace',
        content: event.content,
        traceType: event.type,
        traceMeta: event.metadata,
      }]);
      setStatus(event.type === 'thought' ? 'Thinking...' : event.type === 'action' ? 'Acting...' : 'Observing...');
    });
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
        content: 'Commands: /help | /clear | /skills | /skills search <query> | /skills clear-remote | /skill <name> | /skill off | /skill <name> <task> | /ui start [port] | /ui stop | /ui status'
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

  return (
    <Box flexDirection="column" padding={1}>
      <Text color="green" bold>Mempedia CodeCLI (Branching ReAct Agent)</Text>
      <Text color="dim">Skill: {activeSkill ? formatSkillLabel(activeSkill) : 'none'} | Use /skills or /skills search</Text>
      <Text color="dim">UI: {uiUrl || 'stopped'} | /ui start to launch mempedia-ui</Text>
      <Box flexDirection="column" marginY={1}>
        {history.map((item, index) => (
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
