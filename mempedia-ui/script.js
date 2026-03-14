const state = {
  nodes: [],
  filtered: [],
  selectedId: null,
  graphScope: 'selected',
  canonicalGraph: { nodes: [], edges: [] },
  libraryView: 'knowledge',
  memoryStream: {
    habits: [],
    behaviorPatterns: [],
    nodeConversations: [],
    conversations: [],
    agentActions: [],
    accessLogs: [],
  },
  query: '',
  sourceFilter: 'all',
  originFilter: 'all',
  mempediaHandle: null,
  connected: false,
  memoryRoot: null,
  autoSave: true,
  saveTimer: null,
  loadingNode: false,
  recentOpened: [],
  cliConversation: [],
  cliRuns: [],
  selectedCliRunId: null,
  editor: null,
};

const elements = {
  nodeList: document.getElementById('node-list'),
  nodeDetail: document.getElementById('node-detail'),
  heroPreview: document.getElementById('hero-preview'),
  searchInput: document.getElementById('search-input'),
  filterSource: document.getElementById('filter-source'),
  filterOrigin: document.getElementById('filter-origin'),
  status: document.getElementById('status'),
  editorStatus: document.getElementById('editor-status'),
  workspaceGlance: document.getElementById('workspace-glance'),
  pageTree: document.getElementById('page-tree'),
  recentList: document.getElementById('recent-list'),
  branchRuns: document.getElementById('branch-runs'),
  branchGraph: document.getElementById('branch-graph'),
  tagsList: document.getElementById('tags-list'),
  outlineList: document.getElementById('outline-list'),
  workspaceStatus: document.getElementById('workspace-status'),
  refreshWorkspace: document.getElementById('refresh-workspace'),
  loadFolder: document.getElementById('load-folder'),
  loadDemo: document.getElementById('load-demo'),
  clearAll: document.getElementById('clear-all'),
  exportJson: document.getElementById('export-json'),
  newNode: document.getElementById('new-node'),
  saveNode: document.getElementById('save-node'),
  reloadNode: document.getElementById('reload-node'),
  autoSaveToggle: document.getElementById('auto-save-toggle'),
  fileInput: document.getElementById('file-input'),
  graphScope: document.getElementById('graph-scope'),
  graphSummary: document.getElementById('graph-summary'),
  graphView: document.getElementById('graph-view'),
  memoryList: document.getElementById('memory-list'),
  activityList: document.getElementById('activity-list'),
  contextMemory: document.getElementById('context-memory'),
  noteBreadcrumb: document.getElementById('note-breadcrumb'),
  noteShellSummary: document.getElementById('note-shell-summary'),
  noteShellMeta: document.getElementById('note-shell-meta'),
  viewButtons: {
    knowledge: document.getElementById('view-knowledge'),
    memory: document.getElementById('view-memory'),
    activity: document.getElementById('view-activity'),
  },
  editorMarkdown: document.getElementById('editor-markdown'),
  graphLinks: document.getElementById('editor-graph-links'),
  fields: {
    nodeId: document.getElementById('editor-node-id'),
    title: document.getElementById('editor-title'),
    summary: document.getElementById('editor-summary'),
    source: document.getElementById('editor-source'),
    origin: document.getElementById('editor-origin'),
    confidence: document.getElementById('editor-confidence'),
    importance: document.getElementById('editor-importance'),
    body: document.getElementById('editor-body'),
    factsText: document.getElementById('editor-facts'),
    relationsText: document.getElementById('editor-relations'),
    evidenceText: document.getElementById('editor-evidence'),
  },
};

const demoNodes = [
  {
    id: 'fatigue_model',
    title: 'Fatigue Model',
    summary: 'Baseline recovery assumptions and linked signals used across the project.',
    body: 'Recovery baseline depends on sleep quality, stress recovery, and weekly decay signals.',
    source: 'design-notes',
    origin: 'human',
    facts: ['recovery_baseline: sleep_quality', 'decay: exponential'],
    relations: ['SleepSignals | depends_on | 0.9', 'CircadianRhythm | related | 0.6'],
    evidence: ['meeting-notes-2024-03-01'],
    highlights: [],
    confidence: 0.9,
    importance: 1.1,
  },
  {
    id: 'context_pipeline',
    title: 'Context Pipeline',
    summary: 'Orchestration steps for ingesting, normalizing, and serving memory nodes.',
    body: 'Pipeline stages:\n\n1. Ingest\n2. Normalize\n3. Index\n4. Retrieve',
    source: 'ops-doc',
    origin: 'agent',
    facts: ['stages: ingest, normalize, index, retrieve'],
    relations: ['SearchHybrid | feeds | 0.8', 'SyncMarkdown | feeds | 0.7'],
    evidence: ['runbook-v2'],
    highlights: [],
    confidence: 0.88,
    importance: 1.0,
  },
];

function createEmptyEditor(overrides = {}) {
  return {
    nodeId: '',
    title: '',
    summary: '',
    source: '',
    origin: 'human',
    confidence: '0.90',
    importance: '1.00',
    body: '',
    factsText: '',
    relationsText: '',
    evidenceText: '',
    graphLinksText: '',
    markdown: '',
    version: '',
    path: '',
    dirty: false,
    saving: false,
    lastError: '',
    lastSavedAt: '',
    ...overrides,
  };
}

function createEmptyGraph() {
  return { nodes: [], edges: [] };
}

function createEmptyMemoryStream() {
  return {
    habits: [],
    behaviorPatterns: [],
    nodeConversations: [],
    conversations: [],
    agentActions: [],
    accessLogs: [],
  };
}

state.editor = createEmptyEditor();

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function yamlEscape(value) {
  return `"${String(value || '').replaceAll('"', '\\"')}"`;
}

function shortHash(value) {
  return String(value || '').slice(0, 8);
}

function truncateText(value, length = 140) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

function formatTimestamp(value) {
  if (!value) return 'unknown time';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

function extractOutline(body = '', fallbackTitle = 'Untitled') {
  const items = [];
  const lines = String(body || '').split(/\r?\n/);
  for (const line of lines) {
    const heading = line.trim().match(/^(#{1,3})\s+(.+)$/);
    if (!heading) continue;
    items.push({ level: heading[1].length, title: heading[2].trim() });
  }
  if (!items.length) {
    items.push({ level: 1, title: fallbackTitle });
  }
  return items.slice(0, 12);
}

function formatNumber(value, digits = 2) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(digits) : '';
}

function updateSelect(select, options, value) {
  select.innerHTML = '';
  for (const option of options) {
    const element = document.createElement('option');
    element.value = option;
    element.textContent = option === 'all' ? 'All' : option;
    select.appendChild(element);
  }
  select.value = value;
}

function parseFrontmatter(markdown) {
  const match = markdown.match(/^---\s*[\r\n]+([\s\S]*?)\s*[\r\n]+---\s*[\r\n]*/);
  if (!match) return { meta: {}, body: markdown };
  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    const [key, ...rest] = line.split(':');
    if (!key || rest.length === 0) continue;
    meta[key.trim()] = rest.join(':').trim().replace(/^"|"$/g, '');
  }
  return { meta, body: markdown.slice(match[0].length) };
}

function normalizeSectionName(name) {
  const lower = String(name || '').trim().toLowerCase();
  if (['facts', 'fact', 'claims', 'claim'].includes(lower)) return 'facts';
  if (['relations', 'relation', 'links', 'link', 'related', 'related nodes', 'connections'].includes(lower)) return 'relations';
  if (['evidence', 'sources', 'source'].includes(lower)) return 'evidence';
  return null;
}

function parseSections(body) {
  const sections = { facts: [], relations: [], evidence: [] };
  let current = null;
  for (const line of String(body || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    const heading = trimmed.match(/^#{2,3}\s+(.+)$/);
    if (heading) {
      current = normalizeSectionName(heading[1]);
      continue;
    }
    if (!current) continue;
    if (/^[-*+]\s+/.test(trimmed)) {
      sections[current].push(trimmed.replace(/^[-*+]\s+/, ''));
    }
  }
  return sections;
}

function deriveTitle(body, meta) {
  if (meta.title) return meta.title;
  const match = String(body || '').match(/^#\s+(.+)/m);
  if (match) return match[1].trim();
  return 'Untitled';
}

function deriveSummary(body, meta) {
  if (meta.summary) return meta.summary;
  const lines = String(body || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    if (!line.startsWith('#') && line.length > 10) {
      return line.slice(0, 140);
    }
  }
  return 'Summary unavailable.';
}

function extractNarrativeBody(body, title) {
  const kept = [];
  let currentStructured = null;
  for (const rawLine of String(body || '').split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    const heading = trimmed.match(/^#{2,3}\s+(.+)$/);
    if (heading) {
      const structured = normalizeSectionName(heading[1]);
      if (structured) {
        currentStructured = structured;
        continue;
      }
      currentStructured = null;
      kept.push(rawLine);
      continue;
    }
    if (currentStructured) {
      if (!trimmed) continue;
      if (/^[-*+]\s+/.test(trimmed)) continue;
      continue;
    }
    kept.push(rawLine);
  }
  let narrative = kept.join('\n').trim();
  const titleHeading = `# ${title}`;
  if (narrative.startsWith(titleHeading)) {
    narrative = narrative.slice(titleHeading.length).trimStart();
  }
  return narrative.trim();
}

function normalizeListText(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[-*+]\s+/, '').trim());
}

function parseRelationEntry(line) {
  const raw = String(line || '').trim().replace(/^[-*+]\s+/, '');
  if (!raw) return null;

  const normalizeTarget = (value) => {
    const trimmed = String(value || '').trim();
    const wiki = trimmed.match(/\[\[([^\]]+)\]\]/);
    return (wiki ? wiki[1] : trimmed).trim();
  };

  if (raw.includes('|')) {
    const parts = raw.split('|').map((part) => part.trim());
    const target = normalizeTarget(parts[0]);
    if (!target) return null;
    const label = parts[1] || 'related';
    const weight = Number(parts[2]);
    return {
      target,
      label,
      weight: Number.isFinite(weight) ? weight : null,
      raw,
    };
  }

  const fnStyle = raw.match(/^(.*?)\((.*)\)$/);
  if (fnStyle) {
    const target = normalizeTarget(fnStyle[1]);
    if (!target) return null;
    let label = 'related';
    let weight = null;
    for (const part of fnStyle[2].split(',')) {
      const [key, value] = part.split('=').map((token) => token?.trim());
      if (!key || !value) continue;
      if (key === 'label') label = value;
      if (key === 'weight') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) weight = parsed;
      }
    }
    return { target, label, weight, raw };
  }

  const target = normalizeTarget(raw);
  if (!target) return null;
  return { target, label: 'related', weight: null, raw };
}

function formatGraphLink(edge) {
  const label = String(edge?.label || 'related').trim() || 'related';
  const weight = Number(edge?.weight);
  return Number.isFinite(weight)
    ? `${edge.target} | ${label} | ${weight}`
    : `${edge.target} | ${label}`;
}

function getOutgoingGraphLinksText(nodeId) {
  return (state.canonicalGraph?.edges || [])
    .filter((edge) => edge.source === nodeId)
    .map((edge) => formatGraphLink(edge))
    .join('\n');
}

function parseGraphLinksText(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => parseRelationEntry(line))
    .filter(Boolean)
    .map((relation) => ({
      target: relation.target,
      label: relation.label || 'related',
      weight: relation.weight,
    }));
}

function parseMarkdownFile(markdown, fileName = '') {
  const { meta, body } = parseFrontmatter(markdown);
  const title = deriveTitle(body, meta);
  const sections = parseSections(body);
  return {
    id: meta.node_id || fileName.replace(/\.md$/, '') || 'untitled',
    title,
    summary: deriveSummary(body, meta),
    body: extractNarrativeBody(body, title),
    source: meta.source || 'manual-import',
    origin: meta.origin || 'human',
    facts: sections.facts,
    relations: sections.relations,
    evidence: sections.evidence,
    highlights: [],
    markdown,
    version: meta.version || '',
    path: fileName,
    confidence: meta.confidence || '0.9',
    importance: meta.importance || '1.0',
  };
}

function createEditorFromNode(node) {
  const editor = createEmptyEditor({
    nodeId: node?.id || '',
    title: node?.title || '',
    summary: node?.summary || '',
    source: node?.source || '',
    origin: node?.origin || 'human',
    confidence: formatNumber(node?.confidence ?? 0.9, 2),
    importance: formatNumber(node?.importance ?? 1.0, 2),
    body: node?.body || '',
    factsText: (node?.facts || []).join('\n'),
    relationsText: (node?.relations || []).join('\n'),
    evidenceText: (node?.evidence || []).join('\n'),
    graphLinksText: getOutgoingGraphLinksText(node?.id || ''),
    version: node?.version || '',
    path: node?.path || '',
  });
  editor.markdown = node?.markdown || buildMarkdownFromEditor(editor);
  return editor;
}

function editorToNode(editor) {
  return {
    id: editor.nodeId.trim(),
    title: editor.title.trim() || editor.nodeId.trim() || 'Untitled',
    summary: editor.summary.trim() || 'Summary unavailable.',
    body: editor.body.trim(),
    source: editor.source.trim() || 'manual-edit',
    origin: editor.origin.trim() || 'human',
    facts: normalizeListText(editor.factsText),
    relations: normalizeListText(editor.relationsText),
    evidence: normalizeListText(editor.evidenceText),
    highlights: [],
    markdown: buildMarkdownFromEditor(editor),
    version: editor.version || '',
    path: editor.path || '',
    confidence: editor.confidence || '0.9',
    importance: editor.importance || '1.0',
  };
}

function buildMarkdownFromEditor(editor) {
  const nodeId = editor.nodeId.trim();
  const title = editor.title.trim() || nodeId || 'Untitled';
  const summary = editor.summary.trim();
  const source = editor.source.trim();
  const origin = editor.origin.trim();
  const confidence = Number(editor.confidence);
  const importance = Number(editor.importance);
  const facts = normalizeListText(editor.factsText);
  const relations = normalizeListText(editor.relationsText);
  const evidence = normalizeListText(editor.evidenceText);
  const bodyParts = [`# ${title}`];
  if (editor.body.trim()) bodyParts.push(editor.body.trim());
  if (facts.length) bodyParts.push('## Facts', ...facts.map((item) => `- ${item}`));
  if (relations.length) bodyParts.push('## Relations', ...relations.map((item) => `- ${item}`));
  if (evidence.length) bodyParts.push('## Evidence', ...evidence.map((item) => `- ${item}`));
  const frontmatter = [
    '---',
    `node_id: ${yamlEscape(nodeId)}`,
    `title: ${yamlEscape(title)}`,
    summary ? `summary: ${yamlEscape(summary)}` : null,
    source ? `source: ${yamlEscape(source)}` : null,
    origin ? `origin: ${yamlEscape(origin)}` : null,
    Number.isFinite(confidence) ? `confidence: ${confidence}` : null,
    Number.isFinite(importance) ? `importance: ${importance}` : null,
    '---',
    '',
  ].filter(Boolean);
  return `${frontmatter.join('\n')}${bodyParts.join('\n\n').trim()}\n`;
}

function setMemoryStream(payload = {}) {
  state.memoryStream = {
    habits: Array.isArray(payload.habits) ? payload.habits : [],
    behaviorPatterns: Array.isArray(payload.behaviorPatterns) ? payload.behaviorPatterns : [],
    nodeConversations: Array.isArray(payload.nodeConversations) ? payload.nodeConversations : [],
    conversations: Array.isArray(payload.conversations) ? payload.conversations : [],
    agentActions: Array.isArray(payload.agentActions) ? payload.agentActions : [],
    accessLogs: Array.isArray(payload.accessLogs) ? payload.accessLogs : [],
  };
}

function setNodes(nodes, options = {}) {
  state.nodes = nodes;
  state.recentOpened = state.recentOpened.filter((nodeId) => nodes.some((node) => node.id === nodeId));
  if (options.selectedId !== undefined) {
    state.selectedId = options.selectedId;
    rememberRecentNode(options.selectedId);
  }
  applyFilters();
}

function rememberRecentNode(nodeId) {
  const normalized = String(nodeId || '').trim();
  if (!normalized) return;
  state.recentOpened = [normalized, ...state.recentOpened.filter((item) => item !== normalized)].slice(0, 8);
}

function buildCliRuns(conversation = []) {
  const sorted = Array.isArray(conversation)
    ? conversation.slice().sort((a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0))
    : [];
  const runs = [];
  let current = null;

  const flush = () => {
    if (!current) return;
    current.traceCount = current.traces.length;
    current.branchCount = new Set(
      current.traces
        .map((item) => item?.traceMeta?.branchId)
        .filter(Boolean)
        .map((id) => String(id))
    ).size;
    runs.push(current);
    current = null;
  };

  for (const item of sorted) {
    const role = String(item?.role || 'trace');
    const timestamp = Number(item?.timestamp || Date.now());
    if (role === 'user') {
      flush();
      current = {
        id: `run-${timestamp}-${runs.length + 1}`,
        prompt: String(item?.content || ''),
        answer: '',
        startTs: timestamp,
        endTs: timestamp,
        items: [item],
        traces: [],
      };
      continue;
    }
    if (!current) {
      current = {
        id: `run-${timestamp}-${runs.length + 1}`,
        prompt: '',
        answer: '',
        startTs: timestamp,
        endTs: timestamp,
        items: [],
        traces: [],
      };
    }
    current.items.push(item);
    current.endTs = timestamp;
    if (role === 'trace') current.traces.push(item);
    if (role === 'assistant') current.answer = String(item?.content || current.answer || '');
  }

  flush();
  return runs;
}

function setCliConversation(items = []) {
  state.cliConversation = Array.isArray(items) ? items : [];
  state.cliRuns = buildCliRuns(state.cliConversation);
  const hasSelection = state.cliRuns.some((run) => run.id === state.selectedCliRunId);
  state.selectedCliRunId = hasSelection
    ? state.selectedCliRunId
    : (state.cliRuns[state.cliRuns.length - 1]?.id || null);
}

function getSelectedCliRun() {
  if (!state.cliRuns.length) return null;
  return state.cliRuns.find((run) => run.id === state.selectedCliRunId) || state.cliRuns[state.cliRuns.length - 1] || null;
}

function buildBranchGraph(run) {
  const branchMap = new Map();
  const globalEvents = [];

  const ensureBranch = (branchId, meta = {}) => {
    const normalizedId = String(branchId || 'B0');
    if (!branchMap.has(normalizedId)) {
      branchMap.set(normalizedId, {
        id: normalizedId,
        parentId: meta.parentId == null || meta.parentId === '' ? null : String(meta.parentId),
        label: String(meta.label || normalizedId),
        depth: Number.isFinite(Number(meta.depth)) ? Number(meta.depth) : 0,
        events: [],
        children: [],
      });
    }
    const branch = branchMap.get(normalizedId);
    if (meta.parentId !== undefined && meta.parentId !== null && meta.parentId !== '') {
      branch.parentId = String(meta.parentId);
    }
    if (meta.label) branch.label = String(meta.label);
    if (meta.depth !== undefined && Number.isFinite(Number(meta.depth))) {
      branch.depth = Number(meta.depth);
    }
    return branch;
  };

  for (const trace of run?.traces || []) {
    const meta = trace?.traceMeta || {};
    const branchId = meta?.branchId ? String(meta.branchId) : '';
    const event = {
      type: String(trace?.traceType || 'observation'),
      content: String(trace?.content || ''),
      step: Number.isFinite(Number(meta?.step)) ? Number(meta.step) : null,
      toolName: meta?.toolName ? String(meta.toolName) : '',
      timestamp: Number(trace?.timestamp || 0),
    };
    if (!branchId) {
      globalEvents.push(event);
      continue;
    }
    const branch = ensureBranch(branchId, {
      parentId: meta?.parentBranchId,
      label: meta?.branchLabel,
      depth: meta?.depth,
    });
    branch.events.push(event);
  }

  if (!branchMap.size && globalEvents.length) {
    const fallback = ensureBranch('B0', { label: 'root', depth: 0 });
    fallback.events.push(...globalEvents);
    globalEvents.length = 0;
  }

  for (const branch of branchMap.values()) {
    branch.events.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
    branch.toolCount = branch.events.filter((event) => event.type === 'action').length;
    branch.status = branch.events.some((event) => event.type === 'error')
      ? 'error'
      : branch.events.some((event) => /branch completed/i.test(event.content))
        ? 'completed'
        : 'active';
  }

  const roots = [];
  for (const branch of branchMap.values()) {
    if (branch.parentId) {
      const parent = ensureBranch(branch.parentId, { label: branch.parentId });
      parent.children.push(branch);
    } else {
      roots.push(branch);
    }
  }

  const sortTree = (branch) => {
    branch.children.sort((a, b) => a.depth - b.depth || a.id.localeCompare(b.id));
    branch.children.forEach(sortTree);
  };
  roots.sort((a, b) => a.depth - b.depth || a.id.localeCompare(b.id));
  roots.forEach(sortTree);

  return {
    roots,
    totalBranches: branchMap.size,
    globalEvents,
  };
}

function countBranchTree(branch) {
  return 1 + branch.children.reduce((sum, child) => sum + countBranchTree(child), 0);
}

function renderBranchNode(branch) {
  const detailsOpen = branch.depth <= 1 ? 'open' : '';
  const eventHtml = branch.events.length
    ? branch.events.map((event) => `
        <div class="branch-event branch-event--${escapeHtml(event.type)}">
          <div class="branch-event__meta">
            <span class="branch-event__type">${escapeHtml(event.type)}</span>
            ${event.toolName ? `<span class="tag">${escapeHtml(event.toolName)}</span>` : ''}
            ${event.step != null ? `<span class="tag">step ${escapeHtml(event.step)}</span>` : ''}
          </div>
          <p>${escapeHtml(event.content)}</p>
        </div>
      `).join('')
    : '<p class="mini-list__empty">No branch events recorded.</p>';

  return `
    <div class="branch-node branch-node--${escapeHtml(branch.status)}" style="--branch-depth:${Number(branch.depth) || 0}">
      <div class="branch-node__header">
        <div class="branch-node__heading">
          <span class="branch-node__id">${escapeHtml(branch.id)}</span>
          <strong>${escapeHtml(branch.label || branch.id)}</strong>
        </div>
        <div class="branch-node__stats">
          <span class="tag">d${escapeHtml(branch.depth)}</span>
          <span class="tag">${branch.events.length} event${branch.events.length === 1 ? '' : 's'}</span>
          <span class="tag">${branch.toolCount} tool${branch.toolCount === 1 ? '' : 's'}</span>
        </div>
      </div>
      <details class="branch-node__details" ${detailsOpen}>
        <summary>${branch.children.length} child branch${branch.children.length === 1 ? '' : 'es'} · ${branch.status}</summary>
        <div class="branch-node__events">${eventHtml}</div>
      </details>
      ${branch.children.length ? `<div class="branch-node__children">${branch.children.map((child) => renderBranchNode(child)).join('')}</div>` : ''}
    </div>
  `;
}

function renderBranchGraph() {
  const run = getSelectedCliRun();
  elements.branchRuns.innerHTML = state.cliRuns.length
    ? state.cliRuns.slice().reverse().slice(0, 6).map((item) => `
      <button type="button" class="mini-list__item${item.id === state.selectedCliRunId ? ' is-active' : ''}" data-cli-run-id="${escapeHtml(item.id)}">
        <span class="mini-list__title">${escapeHtml(truncateText(item.prompt || 'Untitled run', 42))}</span>
        <span class="mini-list__meta">${escapeHtml(formatTimestamp(item.endTs))} · ${item.branchCount} branch${item.branchCount === 1 ? '' : 'es'} · ${item.traceCount} trace${item.traceCount === 1 ? '' : 's'}</span>
      </button>
    `).join('')
    : '<p class="mini-list__empty">No connected CLI traces yet.</p>';

  if (!run) {
    elements.branchGraph.innerHTML = '<p class="mini-list__empty">Start the integrated CLI and submit a request to see the branch tree.</p>';
  } else {
    const graph = buildBranchGraph(run);
    const rootCount = graph.roots.length;
    const maxBranches = graph.roots.reduce((sum, branch) => sum + countBranchTree(branch), 0);
    elements.branchGraph.innerHTML = `
      <div class="branch-graph__summary">
        <div class="branch-graph__prompt">${escapeHtml(truncateText(run.prompt || 'Untitled run', 180))}</div>
        ${run.answer ? `<div class="branch-graph__answer">${escapeHtml(truncateText(run.answer, 180))}</div>` : ''}
        <div class="node-meta">
          <span class="tag">${graph.totalBranches} branch node${graph.totalBranches === 1 ? '' : 's'}</span>
          <span class="tag">${rootCount} root${rootCount === 1 ? '' : 's'}</span>
          <span class="tag">${run.traceCount} trace event${run.traceCount === 1 ? '' : 's'}</span>
          <span class="tag">${maxBranches} total tree node${maxBranches === 1 ? '' : 's'}</span>
        </div>
      </div>
      ${graph.globalEvents.length ? `
        <details class="branch-global" open>
          <summary>Global synthesis events</summary>
          <div class="branch-node__events">
            ${graph.globalEvents.map((event) => `
              <div class="branch-event branch-event--${escapeHtml(event.type)}">
                <div class="branch-event__meta"><span class="branch-event__type">${escapeHtml(event.type)}</span></div>
                <p>${escapeHtml(event.content)}</p>
              </div>
            `).join('')}
          </div>
        </details>
      ` : ''}
      <div class="branch-tree">
        ${graph.roots.length ? graph.roots.map((branch) => renderBranchNode(branch)).join('') : '<p class="mini-list__empty">This run did not emit branch metadata.</p>'}
      </div>
    `;
  }

  for (const button of elements.branchRuns.querySelectorAll('[data-cli-run-id]')) {
    button.addEventListener('click', () => {
      const runId = button.getAttribute('data-cli-run-id');
      if (!runId) return;
      state.selectedCliRunId = runId;
      renderBranchGraph();
    });
  }
}

async function refreshCliConversation() {
  if (!state.connected) {
    setCliConversation([]);
    return;
  }
  const response = await fetch('/api/cli/conversation');
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || 'Failed to load CLI conversation');
  }
  setCliConversation(Array.isArray(payload.conversation) ? payload.conversation : []);
}

function applyFilters() {
  const query = state.query.trim().toLowerCase();
  state.filtered = state.nodes.filter((node) => {
    const haystack = [
      node.title,
      node.summary,
      node.body,
      node.markdown || '',
      (node.facts || []).join(' '),
      (node.relations || []).join(' '),
      (node.evidence || []).join(' '),
    ].join(' ').toLowerCase();
    const matchesQuery = !query || haystack.includes(query);
    const matchesSource = state.sourceFilter === 'all' || node.source === state.sourceFilter;
    const matchesOrigin = state.originFilter === 'all' || node.origin === state.originFilter;
    return matchesQuery && matchesSource && matchesOrigin;
  });
  if (state.filtered.length > 0 && !state.filtered.find((node) => node.id === state.selectedId)) {
    state.selectedId = state.filtered[0].id;
  }
  render();
}

function renderFilters() {
  updateSelect(elements.filterSource, ['all', ...new Set(state.nodes.map((node) => node.source).filter(Boolean))], state.sourceFilter);
  updateSelect(elements.filterOrigin, ['all', ...new Set(state.nodes.map((node) => node.origin).filter(Boolean))], state.originFilter);
}

function renderList() {
  elements.nodeList.innerHTML = '';
  if (state.filtered.length === 0) {
    elements.nodeList.innerHTML = '<p class="detail__empty">No nodes match your filters.</p>';
    elements.heroPreview.textContent = 'No nodes loaded yet.';
    return;
  }
  for (const node of state.filtered) {
    const graphLinks = (state.canonicalGraph?.edges || []).filter((edge) => edge.source === node.id || edge.target === node.id).length;
    const card = document.createElement('button');
    card.type = 'button';
    card.className = `node-card${node.id === state.selectedId ? ' active' : ''}`;
    card.innerHTML = `
      <h3>${escapeHtml(node.title)}</h3>
      <p>${escapeHtml(node.summary)}</p>
      <div class="node-meta">
        <span class="tag">${escapeHtml(node.source || 'unknown source')}</span>
        <span class="tag">${escapeHtml(node.origin || 'unknown origin')}</span>
        <span class="tag">${graphLinks} graph links</span>
        ${node.version ? `<span class="tag">v ${escapeHtml(shortHash(node.version))}</span>` : ''}
      </div>
    `;
    card.addEventListener('click', () => void selectNode(node.id));
    elements.nodeList.appendChild(card);
  }
}

function renderWorkspaceGlance() {
  const { habits, behaviorPatterns, nodeConversations, conversations } = state.memoryStream;
  elements.workspaceGlance.innerHTML = `
    <div class="glance-card">
      <strong>${state.nodes.length}</strong>
      <span>knowledge notes</span>
    </div>
    <div class="glance-card">
      <strong>${habits.length}</strong>
      <span>preferences & habits</span>
    </div>
    <div class="glance-card">
      <strong>${behaviorPatterns.length}</strong>
      <span>behavior patterns</span>
    </div>
    <div class="glance-card">
      <strong>${Math.max(nodeConversations.length, conversations.length)}</strong>
      <span>episodic traces</span>
    </div>
  `;
}

function groupNodesForPageTree(nodes) {
  const groups = new Map();
  for (const node of nodes) {
    const source = String(node.source || 'uncategorized').trim() || 'uncategorized';
    const origin = String(node.origin || 'notes').trim() || 'notes';
    if (!groups.has(source)) groups.set(source, new Map());
    const branchMap = groups.get(source);
    if (!branchMap.has(origin)) branchMap.set(origin, []);
    branchMap.get(origin).push(node);
  }
  return Array.from(groups.entries())
    .map(([source, branchMap]) => ({
      source,
      branches: Array.from(branchMap.entries())
        .map(([origin, items]) => ({
          origin,
          items: items.slice().sort((a, b) => String(a.title || a.id).localeCompare(String(b.title || b.id))),
        }))
        .sort((a, b) => b.items.length - a.items.length || a.origin.localeCompare(b.origin)),
    }))
    .sort((a, b) => {
      if (a.source === state.sourceFilter) return -1;
      if (b.source === state.sourceFilter) return 1;
      const aCount = a.branches.reduce((sum, branch) => sum + branch.items.length, 0);
      const bCount = b.branches.reduce((sum, branch) => sum + branch.items.length, 0);
      return bCount - aCount || a.source.localeCompare(b.source);
    });
}

function renderPageTree() {
  const groups = groupNodesForPageTree(state.nodes);
  elements.pageTree.innerHTML = groups.length ? groups.map((group) => {
    const isCurrentSource = state.sourceFilter === group.source;
    const totalCount = group.branches.reduce((sum, branch) => sum + branch.items.length, 0);
    return `
      <details class="page-tree__group" ${isCurrentSource || state.sourceFilter === 'all' ? 'open' : ''}>
        <summary class="page-tree__summary">
          <span class="page-tree__folder">${escapeHtml(group.source)}</span>
          <span class="page-tree__count">${totalCount}</span>
        </summary>
        <div class="page-tree__items">
          ${group.branches.map((branch) => `
            <div class="page-tree__branch">
              <div class="page-tree__branch-title">${escapeHtml(branch.origin)}</div>
              ${branch.items.map((node) => `
                <button type="button" class="page-tree__item${node.id === state.selectedId ? ' is-active' : ''}" data-page-node-id="${escapeHtml(node.id)}">
                  <span class="page-tree__item-title">${escapeHtml(node.title || node.id)}</span>
                  <span class="page-tree__item-meta">${escapeHtml(shortHash(node.version || node.id))}</span>
                </button>
              `).join('')}
            </div>
          `).join('')}
        </div>
      </details>
    `;
  }).join('') : '<p class="mini-list__empty">No pages yet.</p>';

  for (const button of elements.pageTree.querySelectorAll('[data-page-node-id]')) {
    button.addEventListener('click', () => {
      const nodeId = button.getAttribute('data-page-node-id');
      if (nodeId) void selectNode(nodeId);
    });
  }
}

function collectTagEntries() {
  const tagMap = new Map();
  const addTag = (kind, value, nodeId) => {
    const normalized = String(value || '').trim();
    if (!normalized) return;
    const key = `${kind}:${normalized}`;
    if (!tagMap.has(key)) {
      tagMap.set(key, { kind, value: normalized, count: 0, nodes: new Set() });
    }
    const entry = tagMap.get(key);
    entry.nodes.add(nodeId);
    entry.count = entry.nodes.size;
  };

  for (const node of state.nodes) {
    addTag('source', node.source, node.id);
    addTag('origin', node.origin, node.id);
    for (const fact of node.facts || []) {
      const tag = String(fact).split(':')[0].trim();
      if (tag) addTag('fact', tag, node.id);
    }
    for (const evidence of node.evidence || []) {
      const tag = String(evidence).split(/[/.]/)[0].trim();
      if (tag) addTag('evidence', tag, node.id);
    }
  }

  return Array.from(tagMap.values())
    .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind) || a.value.localeCompare(b.value))
    .slice(0, 18);
}

function applyTagFilter(kind, value) {
  if (kind === 'source') {
    state.sourceFilter = value;
    elements.filterSource.value = value;
  } else if (kind === 'origin') {
    state.originFilter = value;
    elements.filterOrigin.value = value;
  } else {
    state.query = value;
    elements.searchInput.value = value;
  }
  applyFilters();
}

function renderSidebarPanels() {
  renderPageTree();
  const recentNodes = state.recentOpened
    .map((nodeId) => state.nodes.find((node) => node.id === nodeId))
    .filter(Boolean)
    .slice(0, 6);
  elements.recentList.innerHTML = recentNodes.length
    ? recentNodes.map((node) => `
      <button type="button" class="mini-list__item" data-node-id="${escapeHtml(node.id)}">
        <span class="mini-list__title">${escapeHtml(node.title || node.id)}</span>
        <span class="mini-list__meta">${escapeHtml(node.source || 'workspace')} · ${escapeHtml(node.origin || 'note')}</span>
      </button>
    `).join('')
    : '<p class="mini-list__empty">Open notes to build a working set.</p>';

  const tags = collectTagEntries();
  elements.tagsList.innerHTML = tags.length
    ? tags.map((tag) => `
      <button type="button" class="tag-chip tag-chip--${escapeHtml(tag.kind)}" data-tag-kind="${escapeHtml(tag.kind)}" data-tag-value="${escapeHtml(tag.value)}">
        <span>${escapeHtml(tag.value)}</span>
        <strong>${tag.count}</strong>
      </button>
    `).join('')
    : '<p class="mini-list__empty">No tags yet.</p>';

  const outline = extractOutline(state.editor.body || state.editor.markdown || '', state.editor.title || 'Untitled');
  elements.outlineList.innerHTML = outline.length
    ? outline.map((item) => `
      <div class="mini-list__item" style="padding-left: ${0.75 + (item.level - 1) * 0.75}rem; cursor: default;">
        <span class="mini-list__title">${escapeHtml(item.title)}</span>
        <span class="mini-list__meta">H${item.level}</span>
      </div>
    `).join('')
    : '<p class="mini-list__empty">No headings yet.</p>';

  renderBranchGraph();

  for (const button of elements.recentList.querySelectorAll('[data-node-id]')) {
    button.addEventListener('click', () => {
      const nodeId = button.getAttribute('data-node-id');
      if (nodeId) void selectNode(nodeId);
    });
  }
  for (const button of elements.tagsList.querySelectorAll('[data-tag-kind][data-tag-value]')) {
    button.addEventListener('click', () => {
      const kind = button.getAttribute('data-tag-kind') || 'fact';
      const value = button.getAttribute('data-tag-value') || '';
      applyTagFilter(kind, value);
    });
  }
}

function renderNoteShell() {
  const node = editorToNode(state.editor);
  const source = node.source || 'workspace';
  const breadcrumb = `${source} / ${node.title || 'Untitled'}`;
  elements.noteBreadcrumb.textContent = breadcrumb;
  elements.noteShellSummary.textContent = node.summary || 'Human-readable note with structured AI-updatable metadata.';
  const linkedConversationCount = (state.memoryStream.nodeConversations || []).filter((item) => item.node_id === node.id).length;
  const graphCount = (state.canonicalGraph.edges || []).filter((edge) => edge.source === node.id || edge.target === node.id).length;
  elements.noteShellMeta.innerHTML = `
    <span class="tag">${escapeHtml(node.id || 'unsaved note')}</span>
    <span class="tag">${escapeHtml(node.origin || 'human')}</span>
    <span class="tag">${graphCount} graph link${graphCount === 1 ? '' : 's'}</span>
    <span class="tag">${linkedConversationCount} memory trace${linkedConversationCount === 1 ? '' : 's'}</span>
    ${node.version ? `<span class="tag">v ${escapeHtml(shortHash(node.version))}</span>` : ''}
  `;
}

function renderLibraryView() {
  const isKnowledge = state.libraryView === 'knowledge';
  const isMemory = state.libraryView === 'memory';
  const isActivity = state.libraryView === 'activity';
  elements.nodeList.classList.toggle('is-hidden', !isKnowledge);
  elements.memoryList.classList.toggle('is-hidden', !isMemory);
  elements.activityList.classList.toggle('is-hidden', !isActivity);
  for (const [key, button] of Object.entries(elements.viewButtons)) {
    const active = key === state.libraryView;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-selected', String(active));
  }
}

function renderMemoryList() {
  const { habits, behaviorPatterns, nodeConversations, conversations } = state.memoryStream;
  const conversationMap = new Map((conversations || []).map((item) => [item.id, item]));
  const recentConversations = (nodeConversations || []).slice().reverse().slice(0, 8);
  elements.memoryList.innerHTML = `
    <section class="library-section">
      <h3>Preferences & habits</h3>
      ${habits.length ? habits.slice().reverse().slice(0, 6).map((item) => `
        <article class="memory-card">
          <div class="memory-card__title">${escapeHtml(item.topic)}</div>
          <p>${escapeHtml(truncateText(item.summary || item.details, 110))}</p>
          <div class="node-meta"><span class="tag">${escapeHtml(item.source || 'habit')}</span><span class="tag">${escapeHtml(formatTimestamp(item.timestamp))}</span></div>
        </article>
      `).join('') : '<p class="detail__empty">No preference memory yet.</p>'}
    </section>
    <section class="library-section">
      <h3>Behavior patterns</h3>
      ${behaviorPatterns.length ? behaviorPatterns.slice().reverse().slice(0, 6).map((item) => `
        <article class="memory-card">
          <div class="memory-card__title">${escapeHtml(item.pattern_key)}</div>
          <p>${escapeHtml(truncateText(item.summary || item.details, 110))}</p>
          <div class="node-meta"><span class="tag">${escapeHtml(item.source || 'pattern')}</span><span class="tag">${escapeHtml(formatTimestamp(item.timestamp))}</span></div>
        </article>
      `).join('') : '<p class="detail__empty">No behavior patterns yet.</p>'}
    </section>
    <section class="library-section">
      <h3>Recent situational memory</h3>
      ${recentConversations.length ? recentConversations.map((item) => {
        const conversation = conversationMap.get(item.conversation_id) || {};
        return `
          <article class="memory-card memory-card--linked" data-node-jump="${escapeHtml(item.node_id)}">
            <div class="memory-card__title">${escapeHtml(item.node_id)}</div>
            <p>${escapeHtml(truncateText(conversation.input || conversation.answer || item.reason || '', 120))}</p>
            <div class="node-meta"><span class="tag">${escapeHtml(item.reason || 'conversation')}</span><span class="tag">${escapeHtml(formatTimestamp(item.ts || conversation.timestamp))}</span></div>
          </article>
        `;
      }).join('') : '<p class="detail__empty">No conversation-linked memory yet.</p>'}
    </section>
  `;
  for (const card of elements.memoryList.querySelectorAll('[data-node-jump]')) {
    card.addEventListener('click', () => {
      const nodeId = card.getAttribute('data-node-jump');
      if (nodeId) void selectNode(nodeId);
    });
  }
}

function renderActivityList() {
  const rows = [
    ...(state.memoryStream.agentActions || []).map((item) => ({
      kind: 'action',
      ts: item.timestamp,
      title: item.action,
      detail: item.node_id,
      meta: item.reason || item.source || '',
    })),
    ...(state.memoryStream.accessLogs || []).map((item) => ({
      kind: 'access',
      ts: item.timestamp,
      title: 'node_access',
      detail: item.node_id,
      meta: item.agent_id || '',
    })),
  ].sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0));

  elements.activityList.innerHTML = rows.length ? rows.slice(0, 20).map((item) => `
    <article class="memory-card">
      <div class="memory-card__title">${escapeHtml(item.title)}</div>
      <p>${escapeHtml(item.detail)}</p>
      <div class="node-meta"><span class="tag">${escapeHtml(item.kind)}</span><span class="tag">${escapeHtml(formatTimestamp(item.ts ? new Date(Number(item.ts) * 1000).toISOString() : ''))}</span></div>
      ${item.meta ? `<div class="memory-card__meta">${escapeHtml(truncateText(item.meta, 120))}</div>` : ''}
    </article>
  `).join('') : '<p class="detail__empty">No agent activity yet.</p>';
}

function renderContextMemory() {
  if (!state.selectedId) {
    elements.contextMemory.innerHTML = '<p class="detail__empty">Select a note to inspect linked episodic memory.</p>';
    return;
  }
  const links = (state.memoryStream.nodeConversations || []).filter((item) => item.node_id === state.selectedId);
  const conversationMap = new Map((state.memoryStream.conversations || []).map((item) => [item.id, item]));
  const habitMatches = (state.memoryStream.habits || []).filter((item) => {
    const haystack = `${item.topic || ''} ${item.summary || ''} ${item.details || ''}`.toLowerCase();
    return haystack.includes(String(state.selectedId).toLowerCase()) || haystack.includes(String(state.editor.title || '').toLowerCase());
  }).slice(0, 4);
  const patternMatches = (state.memoryStream.behaviorPatterns || []).filter((item) => {
    const haystack = `${item.pattern_key || ''} ${item.summary || ''} ${item.details || ''}`.toLowerCase();
    return haystack.includes(String(state.editor.title || '').toLowerCase());
  }).slice(0, 4);

  elements.contextMemory.innerHTML = `
    <section class="library-section">
      <h4>Linked conversations</h4>
      ${links.length ? links.slice().reverse().map((item) => {
        const conversation = conversationMap.get(item.conversation_id) || {};
        return `
          <article class="memory-card">
            <div class="memory-card__title">${escapeHtml(item.conversation_id)}</div>
            <p>${escapeHtml(truncateText(conversation.input || conversation.answer || item.reason || '', 160))}</p>
            <div class="node-meta"><span class="tag">${escapeHtml(item.reason || 'conversation')}</span><span class="tag">${escapeHtml(formatTimestamp(item.ts || conversation.timestamp))}</span></div>
          </article>
        `;
      }).join('') : '<p class="detail__empty">No linked conversations for this note.</p>'}
    </section>
    <section class="library-section library-section--split">
      <div>
        <h4>Preference cues</h4>
        ${habitMatches.length ? habitMatches.map((item) => `<article class="memory-card"><div class="memory-card__title">${escapeHtml(item.topic)}</div><p>${escapeHtml(truncateText(item.summary || item.details, 120))}</p></article>`).join('') : '<p class="detail__empty">No related preference memory.</p>'}
      </div>
      <div>
        <h4>Behavior cues</h4>
        ${patternMatches.length ? patternMatches.map((item) => `<article class="memory-card"><div class="memory-card__title">${escapeHtml(item.pattern_key)}</div><p>${escapeHtml(truncateText(item.summary || item.details, 120))}</p></article>`).join('') : '<p class="detail__empty">No related behavior memory.</p>'}
      </div>
    </section>
  `;
}

function renderStructuredSection(title, items, emptyText) {
  return `
    <div class="detail__section">
      <h4>${title}</h4>
      <div class="detail__content">${items.length ? `<ul class="detail__list">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : escapeHtml(emptyText)}</div>
    </div>
  `;
}

function buildGraphDataset() {
  const graph = state.canonicalGraph || createEmptyGraph();
  const includeSelectedNeighborhood = state.graphScope === 'selected' && state.selectedId;
  const included = new Set();
  if (includeSelectedNeighborhood) {
    included.add(state.selectedId);
  } else {
    for (const node of state.filtered) included.add(node.id);
  }

  if (includeSelectedNeighborhood) {
    for (const edge of graph.edges || []) {
      if (edge.source === state.selectedId || edge.target === state.selectedId) {
        included.add(edge.source);
        included.add(edge.target);
      }
    }
  }

  let nodes = (graph.nodes || []).filter((node) => included.has(node.id));
  let edges = (graph.edges || []).filter((edge) => included.has(edge.source) && included.has(edge.target));

  if (!includeSelectedNeighborhood) {
    const connectedIds = new Set(nodes.map((node) => node.id));
    for (const edge of graph.edges || []) {
      if (connectedIds.has(edge.source) || connectedIds.has(edge.target)) {
        connectedIds.add(edge.source);
        connectedIds.add(edge.target);
      }
    }
    nodes = (graph.nodes || []).filter((node) => connectedIds.has(node.id));
    edges = (graph.edges || []).filter((edge) => connectedIds.has(edge.source) && connectedIds.has(edge.target));
  }

  if (state.graphScope === 'filtered' && nodes.length > 24) {
    const allowed = new Set(nodes.slice(0, 24).map((node) => node.id));
    nodes = nodes.filter((node) => allowed.has(node.id));
    edges = edges.filter((edge) => allowed.has(edge.source) && allowed.has(edge.target));
  }

  const uiNodeMap = new Map(state.nodes.map((node) => [node.id, node]));
  nodes = nodes.map((node) => {
    const uiNode = uiNodeMap.get(node.id);
    return uiNode ? { ...node, ...uiNode, external: node.external } : node;
  });

  return { nodes, edges };
}

function layoutGraph(nodes, edges) {
  const width = 960;
  const height = 420;
  const positions = new Map();
  if (!nodes.length) return { width, height, positions };

  const selectedId = state.selectedId;
  const selectedNode = nodes.find((node) => node.id === selectedId) || nodes[0];
  const neighbors = new Set();
  for (const edge of edges) {
    if (edge.source === selectedNode.id) neighbors.add(edge.target);
    if (edge.target === selectedNode.id) neighbors.add(edge.source);
  }

  const primary = nodes.filter((node) => node.id === selectedNode.id || neighbors.has(node.id));
  const secondary = nodes.filter((node) => !primary.some((item) => item.id === node.id));

  positions.set(selectedNode.id, { x: width / 2, y: height / 2 });

  const primaryOthers = primary.filter((node) => node.id !== selectedNode.id);
  const primaryRadius = Math.min(145, 80 + primaryOthers.length * 12);
  primaryOthers.forEach((node, index) => {
    const angle = (-Math.PI / 2) + (index / Math.max(primaryOthers.length, 1)) * Math.PI * 2;
    positions.set(node.id, {
      x: width / 2 + Math.cos(angle) * primaryRadius,
      y: height / 2 + Math.sin(angle) * primaryRadius,
    });
  });

  const secondaryRadius = Math.min(205, primaryRadius + 80);
  secondary.forEach((node, index) => {
    const angle = (-Math.PI / 2) + (index / Math.max(secondary.length, 1)) * Math.PI * 2;
    const wobble = index % 2 === 0 ? 18 : -18;
    positions.set(node.id, {
      x: width / 2 + Math.cos(angle) * secondaryRadius,
      y: height / 2 + Math.sin(angle) * (secondaryRadius - 22) + wobble,
    });
  });

  return { width, height, positions };
}

function renderGraph() {
  const { nodes, edges } = buildGraphDataset();
  if (!nodes.length) {
    elements.graphSummary.textContent = 'No graph data yet.';
    elements.graphView.innerHTML = `
      <rect x="0" y="0" width="960" height="420" rx="18" class="graph-bg"></rect>
      <text x="480" y="210" text-anchor="middle" class="graph-empty">Load or create nodes to visualize relationships.</text>
    `;
    return;
  }

  const { positions } = layoutGraph(nodes, edges);
  const selectedId = state.selectedId;
  const neighborIds = new Set();
  for (const edge of edges) {
    if (edge.source === selectedId) neighborIds.add(edge.target);
    if (edge.target === selectedId) neighborIds.add(edge.source);
  }

  elements.graphSummary.textContent = `${nodes.length} nodes · ${edges.length} relations · scope: ${state.graphScope === 'selected' ? 'selected node' : 'filtered result set'}`;

  const edgeMarkup = edges.map((edge) => {
    const source = positions.get(edge.source);
    const target = positions.get(edge.target);
    if (!source || !target) return '';
    const midX = (source.x + target.x) / 2;
    const midY = (source.y + target.y) / 2;
    const active = edge.source === selectedId || edge.target === selectedId;
    return `
      <g class="graph-edge${active ? ' is-active' : ''}">
        <line x1="${source.x}" y1="${source.y}" x2="${target.x}" y2="${target.y}"></line>
        <text x="${midX}" y="${midY - 6}" text-anchor="middle">${escapeHtml(edge.label)}</text>
      </g>
    `;
  }).join('');

  const nodeMarkup = nodes.map((node) => {
    const position = positions.get(node.id);
    if (!position) return '';
    const isSelected = node.id === selectedId;
    const isNeighbor = neighborIds.has(node.id);
    const classes = [
      'graph-node',
      isSelected ? 'is-selected' : '',
      isNeighbor ? 'is-neighbor' : '',
      node.external ? 'is-external' : '',
    ].filter(Boolean).join(' ');
    return `
      <g class="${classes}" data-node-id="${escapeHtml(node.id)}" transform="translate(${position.x}, ${position.y})">
        <circle r="${isSelected ? 26 : isNeighbor ? 21 : 18}"></circle>
        <text class="graph-node__title" text-anchor="middle" y="4">${escapeHtml(node.title.slice(0, 20))}</text>
        <text class="graph-node__meta" text-anchor="middle" y="36">${escapeHtml(node.id.slice(0, 24))}</text>
      </g>
    `;
  }).join('');

  elements.graphView.innerHTML = `
    <rect x="0" y="0" width="960" height="420" rx="18" class="graph-bg"></rect>
    ${edgeMarkup}
    ${nodeMarkup}
  `;

  for (const element of elements.graphView.querySelectorAll('[data-node-id]')) {
    element.addEventListener('click', () => {
      const nodeId = element.getAttribute('data-node-id');
      if (nodeId) void selectNode(nodeId);
    });
  }
}

function renderRichText(text) {
  const lines = String(text || '').split(/\r?\n/);
  const blocks = [];
  let listItems = [];
  const flushList = () => {
    if (!listItems.length) return;
    blocks.push(`<ul class="detail__list">${listItems.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`);
    listItems = [];
  };
  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      flushList();
      continue;
    }
    if (/^[-*+]\s+/.test(trimmed)) {
      listItems.push(trimmed.replace(/^[-*+]\s+/, ''));
      continue;
    }
    flushList();
    if (trimmed.startsWith('### ')) blocks.push(`<h5>${escapeHtml(trimmed.slice(4))}</h5>`);
    else if (trimmed.startsWith('## ')) blocks.push(`<h4>${escapeHtml(trimmed.slice(3))}</h4>`);
    else if (trimmed.startsWith('# ')) blocks.push(`<h3>${escapeHtml(trimmed.slice(2))}</h3>`);
    else blocks.push(`<p>${escapeHtml(trimmed)}</p>`);
  }
  flushList();
  return blocks.join('') || '<p>No narrative yet.</p>';
}

function renderDetail() {
  const node = editorToNode(state.editor);
  if (!node.id) {
    elements.nodeDetail.innerHTML = '<p class="detail__empty">Select a node to inspect its metadata and content.</p>';
    elements.heroPreview.textContent = 'Import or search to see details here.';
    return;
  }
  const graphRelations = (state.canonicalGraph?.edges || [])
    .filter((edge) => edge.source === node.id || edge.target === node.id)
    .map((edge) => {
      if (edge.source === node.id) {
        return `→ ${edge.target} (${edge.label})`;
      }
      return `← ${edge.source} (${edge.label})`;
    });
  elements.heroPreview.textContent = node.summary;
  elements.nodeDetail.innerHTML = `
    <div class="detail__header">
      <h3 class="detail__title">${escapeHtml(node.title)}</h3>
      <p class="detail__summary">${escapeHtml(node.summary)}</p>
      <div class="node-meta">
        <span class="tag">source: ${escapeHtml(node.source || 'unknown')}</span>
        <span class="tag">origin: ${escapeHtml(node.origin || 'unknown')}</span>
        <span class="tag">confidence: ${escapeHtml(String(node.confidence || '0.9'))}</span>
        <span class="tag">importance: ${escapeHtml(String(node.importance || '1.0'))}</span>
        ${state.editor.path ? `<span class="tag">${escapeHtml(state.editor.path)}</span>` : ''}
      </div>
    </div>
    <div class="detail__section">
      <h4>Narrative</h4>
      <div class="detail__content detail__content--rich">${renderRichText(node.body || `# ${node.title}`)}</div>
    </div>
    ${renderStructuredSection('Graph Links (index)', graphRelations, 'No canonical graph links found.')}
    ${renderStructuredSection('Facts', node.facts, 'No facts extracted.')}
    ${renderStructuredSection('Markdown Relations', node.relations, 'No markdown relation notes found.')}
    ${renderStructuredSection('Evidence', node.evidence, 'No evidence attached.')}
  `;
}

function renderWorkspaceMeta() {
  elements.workspaceStatus.textContent = state.connected
    ? `Mode: connected workspace${state.memoryRoot ? ` · ${state.memoryRoot}` : ''}`
    : 'Mode: standalone viewer';
}

function renderEditorChrome() {
  const editor = state.editor;
  elements.autoSaveToggle.checked = state.autoSave;
  elements.saveNode.disabled = editor.saving || !editor.nodeId.trim();
  elements.reloadNode.disabled = state.loadingNode || !editor.nodeId.trim();
  if (editor.lastError) {
    elements.editorStatus.textContent = editor.lastError;
    elements.editorStatus.dataset.state = 'error';
    return;
  }
  if (editor.saving) {
    elements.editorStatus.textContent = 'Saving markdown into the graph...';
    elements.editorStatus.dataset.state = 'saving';
    return;
  }
  if (!state.connected) {
    elements.editorStatus.textContent = 'Open the integrated UI from codecli to enable graph sync editing.';
    elements.editorStatus.dataset.state = 'idle';
    return;
  }
  if (editor.dirty) {
    elements.editorStatus.textContent = 'Unsaved changes.';
    elements.editorStatus.dataset.state = 'dirty';
    return;
  }
  if (editor.lastSavedAt) {
    elements.editorStatus.textContent = `Saved ${editor.lastSavedAt}${editor.version ? ` · version ${shortHash(editor.version)}` : ''}`;
    elements.editorStatus.dataset.state = 'saved';
    return;
  }
  elements.editorStatus.textContent = 'Connected. Select a node or create a new one.';
  elements.editorStatus.dataset.state = 'idle';
}

function syncEditorToDom() {
  const editor = state.editor;
  elements.fields.nodeId.value = editor.nodeId;
  elements.fields.title.value = editor.title;
  elements.fields.summary.value = editor.summary;
  elements.fields.source.value = editor.source;
  elements.fields.origin.value = editor.origin;
  elements.fields.confidence.value = editor.confidence;
  elements.fields.importance.value = editor.importance;
  elements.fields.body.value = editor.body;
  elements.fields.factsText.value = editor.factsText;
  elements.fields.relationsText.value = editor.relationsText;
  elements.fields.evidenceText.value = editor.evidenceText;
  elements.graphLinks.value = editor.graphLinksText;
  elements.editorMarkdown.value = editor.markdown || buildMarkdownFromEditor(editor);
}

function syncDraftNode() {
  const node = editorToNode(state.editor);
  if (!node.id) return;
  const index = state.nodes.findIndex((item) => item.id === node.id);
  if (index >= 0) state.nodes[index] = { ...state.nodes[index], ...node };
  else state.nodes.unshift(node);
  state.selectedId = node.id;
}

function updateEditorField(field, value) {
  state.editor[field] = value;
  state.editor.markdown = buildMarkdownFromEditor(state.editor);
  state.editor.dirty = true;
  state.editor.lastError = '';
  elements.editorMarkdown.value = state.editor.markdown;
  syncDraftNode();
  applyFilters();
  scheduleAutoSave();
}

function updateGraphLinksField(value) {
  state.editor.graphLinksText = value;
  state.editor.dirty = true;
  state.editor.lastError = '';
  render();
  scheduleAutoSave();
}

function loadEditorFromNode(node) {
  state.editor = createEditorFromNode(node);
  state.editor.markdown = buildMarkdownFromEditor(state.editor);
  syncEditorToDom();
  render();
}

function buildNodesFromMempedia(stateJson, versionMap, markdownMap) {
  const nodes = [];
  const heads = stateJson?.heads || {};
  for (const [nodeId, versionHash] of Object.entries(heads)) {
    const markdownFile = Object.keys(markdownMap).find((name) => name.startsWith(`${nodeId}-`));
    const node = buildNodeFromVersion(nodeId, versionMap[versionHash], markdownMap[markdownFile], markdownFile || '');
    if (node) nodes.push(node);
  }
  for (const [fileName, markdown] of Object.entries(markdownMap)) {
    const nodeId = fileName.replace(/-.+\.md$/, '').replace(/\.md$/, '');
    if (!nodes.find((node) => node.id === nodeId)) {
      nodes.push(parseMarkdownFile(markdown, fileName));
    }
  }
  return nodes;
}

function buildNodeFromVersion(nodeId, versionObj, markdown, path = '') {
  if (!versionObj) return null;
  if (markdown) {
    const parsed = parseMarkdownFile(markdown, path || `${nodeId}.md`);
    return {
      ...parsed,
      id: nodeId,
      version: versionObj.version || parsed.version || '',
      confidence: versionObj.confidence || parsed.confidence || '0.9',
      importance: versionObj.importance || parsed.importance || '1.0',
    };
  }
  return {
    id: nodeId,
    title: versionObj.content?.title || nodeId,
    summary: versionObj.content?.summary || 'Summary unavailable.',
    body: versionObj.content?.body || '',
    source: versionObj.content?.structured_data?.['meta.source'] || 'mempedia',
    origin: versionObj.content?.structured_data?.['meta.origin'] || 'agent',
    facts: [],
    relations: [],
    evidence: [],
    highlights: [],
    markdown: '',
    version: versionObj.version || '',
    path,
    confidence: versionObj.confidence || '0.9',
    importance: versionObj.importance || '1.0',
  };
}

function buildCanonicalGraph(heads = {}, versionMap = {}, knownNodes = []) {
  const knownNodeMap = new Map(knownNodes.map((node) => [node.id, node]));
  const nodeMap = new Map();
  const edgeMap = new Map();

  const ensureNode = (nodeId, seed = null, external = false) => {
    if (!nodeId) return null;
    const existing = nodeMap.get(nodeId);
    if (existing) {
      if (seed) {
        existing.title = seed.title || existing.title;
        existing.summary = seed.summary || existing.summary;
        existing.source = seed.source || existing.source;
        existing.origin = seed.origin || existing.origin;
      }
      if (!external) existing.external = false;
      return existing;
    }
    const created = {
      id: nodeId,
      title: seed?.title || nodeId,
      summary: seed?.summary || '',
      source: seed?.source || '',
      origin: seed?.origin || '',
      external,
    };
    nodeMap.set(nodeId, created);
    return created;
  };

  for (const node of knownNodes) {
    ensureNode(node.id, node, false);
  }

  for (const [nodeId, versionHash] of Object.entries(heads || {})) {
    const versionObj = versionMap[versionHash];
    const knownNode = knownNodeMap.get(nodeId);
    ensureNode(nodeId, knownNode || {
      title: versionObj?.content?.title || nodeId,
      summary: versionObj?.content?.summary || '',
      source: versionObj?.content?.structured_data?.['meta.source'] || '',
      origin: versionObj?.content?.structured_data?.['meta.origin'] || '',
    }, false);

    const links = Array.isArray(versionObj?.content?.links) ? versionObj.content.links : [];
    for (const link of links) {
      const target = String(link?.target || '').trim();
      if (!target) continue;
      const knownTarget = knownNodeMap.get(target);
      ensureNode(target, knownTarget || {
        title: knownTarget?.title || target,
        summary: knownTarget?.summary || '',
        source: knownTarget?.source || '',
        origin: knownTarget?.origin || '',
      }, !Object.prototype.hasOwnProperty.call(heads || {}, target));

      const label = String(link?.label || 'related').trim() || 'related';
      const weight = Number(link?.weight);
      const edgeKey = `${nodeId}__${target}__${label}`;
      if (!edgeMap.has(edgeKey)) {
        edgeMap.set(edgeKey, {
          id: edgeKey,
          source: nodeId,
          target,
          label,
          weight: Number.isFinite(weight) ? weight : null,
        });
      }
    }
  }

  return {
    nodes: Array.from(nodeMap.values()),
    edges: Array.from(edgeMap.values()),
  };
}

function buildNodesFromSnapshot(payload) {
  const versionMap = Object.fromEntries(payload.versions || []);
  const markdownByNode = Object.fromEntries(payload.markdownByNode || []);
  const nodes = [];
  const heads = payload.snapshot?.heads || {};
  for (const [nodeId, versionHash] of Object.entries(heads)) {
    const markdownEntry = markdownByNode[nodeId];
    const node = buildNodeFromVersion(nodeId, versionMap[versionHash], markdownEntry?.markdown, markdownEntry?.path || `${nodeId}.md`);
    if (node) nodes.push(node);
  }
  for (const [nodeId, entry] of Object.entries(markdownByNode)) {
    if (!nodes.find((node) => node.id === nodeId)) {
      nodes.push(parseMarkdownFile(entry.markdown, entry.path || `${nodeId}.md`));
    }
  }
  return nodes;
}

async function loadFiles(files) {
  const nodes = await Promise.all(Array.from(files).map((file) => file.text().then((text) => parseMarkdownFile(text, file.name))));
  state.canonicalGraph = createEmptyGraph();
  setMemoryStream(createEmptyMemoryStream());
  setCliConversation([]);
  setNodes(nodes, { selectedId: nodes[0]?.id || null });
  if (nodes[0]) loadEditorFromNode(nodes[0]);
}

async function loadMempediaFolder(dirHandle) {
  try {
    state.mempediaHandle = dirHandle;
    elements.status.textContent = 'Loading .mempedia folder...';
    let stateJson = null;
    let indexHandle = null;
    const localMemoryStream = createEmptyMemoryStream();
    try {
      indexHandle = await dirHandle.getDirectoryHandle('index');
      const stateFile = await indexHandle.getFileHandle('state.json');
      stateJson = JSON.parse(await stateFile.getFile().then((file) => file.text()));

      const readJsonlOptional = async (name) => {
        try {
          const handle = await indexHandle.getFileHandle(name);
          const text = await handle.getFile().then((file) => file.text());
          return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line));
        } catch {
          return [];
        }
      };

      localMemoryStream.habits = await readJsonlOptional('user_habits.jsonl');
      localMemoryStream.behaviorPatterns = await readJsonlOptional('behavior_patterns.jsonl');
      localMemoryStream.nodeConversations = await readJsonlOptional('node_conversations.jsonl');
      try {
        const conversationsHandle = await indexHandle.getDirectoryHandle('conversations');
        for await (const [name, fileHandle] of conversationsHandle.entries()) {
          if (!name.endsWith('.json')) continue;
          try {
            const parsed = JSON.parse(await fileHandle.getFile().then((file) => file.text()));
            if (parsed?.id) {
              localMemoryStream.conversations.push({
                id: parsed.id,
                timestamp: parsed.timestamp,
                input: parsed.input,
                answer: parsed.answer,
              });
            }
          } catch {}
        }
      } catch {}
    } catch (error) {
      console.warn('Could not read index/state.json', error);
    }
    const versionMap = {};
    try {
      const objectsHandle = await dirHandle.getDirectoryHandle('objects');
      for await (const [, bucketHandle] of objectsHandle.entries()) {
        if (bucketHandle.kind !== 'directory') continue;
        for await (const [fileName, fileHandle] of bucketHandle.entries()) {
          if (!fileName.endsWith('.json')) continue;
          versionMap[fileName.replace('.json', '')] = JSON.parse(await fileHandle.getFile().then((file) => file.text()));
        }
      }
    } catch (error) {
      console.warn('Could not read objects/', error);
    }
    const markdownMap = {};
    try {
      const knowledgeHandle = await dirHandle.getDirectoryHandle('knowledge');
      const nodesHandle = await knowledgeHandle.getDirectoryHandle('nodes');
      for await (const [name, fileHandle] of nodesHandle.entries()) {
        if (!name.endsWith('.md')) continue;
        markdownMap[name] = await fileHandle.getFile().then((file) => file.text());
      }
    } catch (error) {
      console.warn('Could not read knowledge/nodes/', error);
    }
    const nodes = buildNodesFromMempedia(stateJson, versionMap, markdownMap);
    state.canonicalGraph = buildCanonicalGraph(stateJson?.heads || {}, versionMap, nodes);
    setMemoryStream(localMemoryStream);
    setCliConversation([]);
    setNodes(nodes, { selectedId: nodes[0]?.id || null });
    if (nodes[0]) loadEditorFromNode(nodes[0]);
    elements.status.textContent = `${nodes.length} nodes loaded from .mempedia`;
  } catch (error) {
    console.error(error);
    elements.status.textContent = 'Error loading folder. Check browser console.';
  }
}

async function refreshWorkspace() {
  const [memoryResponse] = await Promise.all([
    fetch('/api/memory/snapshot'),
    refreshCliConversation().catch((error) => {
      console.warn('Failed to refresh CLI conversation', error);
      setCliConversation([]);
    }),
  ]);
  const payload = await memoryResponse.json();
  if (!memoryResponse.ok || !payload.ok) {
    throw new Error(payload.error || 'Failed to load workspace snapshot');
  }
  state.memoryRoot = payload.memoryRoot || null;
  const versionMap = Object.fromEntries(payload.versions || []);
  const nodes = buildNodesFromSnapshot(payload);
  state.canonicalGraph = buildCanonicalGraph(payload.snapshot?.heads || {}, versionMap, nodes);
  setMemoryStream(payload);
  setNodes(nodes, { selectedId: state.selectedId || nodes[0]?.id || null });
  const selected = nodes.find((node) => node.id === state.selectedId) || nodes[0];
  if (selected) loadEditorFromNode(selected);
}

async function bootstrapConnectedWorkspace() {
  try {
    const response = await fetch('/api/cli/status');
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.error || 'No connected workspace');
    state.connected = true;
    state.memoryRoot = payload.memoryRoot || null;
    await refreshWorkspace();
  } catch {
    state.connected = false;
    render();
  }
}

async function selectNode(nodeId, options = {}) {
  state.selectedId = nodeId;
  rememberRecentNode(nodeId);
  const localNode = state.nodes.find((node) => node.id === nodeId);
  if (localNode) loadEditorFromNode(localNode);
  else render();
  if (options.fetchRemote === false || !state.connected) return;
  state.loadingNode = true;
  renderEditorChrome();
  try {
    const response = await fetch(`/api/memory/node?node_id=${encodeURIComponent(nodeId)}`);
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.error || 'Failed to open node');
    if (!payload.markdown) return;
    const freshNode = parseMarkdownFile(payload.markdown, payload.path || `${nodeId}.md`);
    freshNode.version = payload.version || freshNode.version;
    freshNode.path = payload.path || freshNode.path;
    const index = state.nodes.findIndex((node) => node.id === nodeId);
    if (index >= 0) state.nodes[index] = { ...state.nodes[index], ...freshNode };
    else state.nodes.unshift(freshNode);
    if (state.selectedId === nodeId) loadEditorFromNode(freshNode);
    applyFilters();
  } catch (error) {
    state.editor.lastError = error.message || String(error);
    render();
  } finally {
    state.loadingNode = false;
  }
}

function scheduleAutoSave() {
  if (!state.connected || !state.autoSave || !state.editor.nodeId.trim()) return;
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => {
    void saveCurrentNode(false).catch((error) => {
      state.editor.lastError = error.message || String(error);
      state.editor.saving = false;
      render();
    });
  }, 1200);
}

async function saveCurrentNode(manual = true) {
  if (!state.connected) {
    state.editor.lastError = 'Graph sync is only available in the integrated UI.';
    render();
    return;
  }
  const nodeId = state.editor.nodeId.trim();
  if (!nodeId) {
    state.editor.lastError = 'Node ID is required before saving.';
    render();
    return;
  }
  clearTimeout(state.saveTimer);
  state.editor.saving = true;
  state.editor.lastError = '';
  state.editor.markdown = buildMarkdownFromEditor(state.editor);
  render();
  const response = await fetch('/api/memory/node/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      node_id: nodeId,
      markdown: state.editor.markdown,
      agent_id: 'ui-editor',
      reason: manual ? 'manual ui editor save' : 'ui autosave sync',
      source: 'mempedia-ui',
      confidence: Number(state.editor.confidence),
      importance: Number(state.editor.importance),
      graph_links: parseGraphLinksText(state.editor.graphLinksText),
    }),
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    throw new Error(payload.error || 'Failed to save node');
  }
  if (payload.snapshot) {
    const versionMap = Object.fromEntries(payload.snapshot.versions || []);
    const nodes = buildNodesFromSnapshot(payload.snapshot);
    state.memoryRoot = payload.snapshot.memoryRoot || state.memoryRoot;
    state.canonicalGraph = buildCanonicalGraph(payload.snapshot.snapshot?.heads || {}, versionMap, nodes);
    setMemoryStream(payload.snapshot);
    setNodes(nodes, { selectedId: nodeId });
  }
  const opened = payload.opened || {};
  if (opened.markdown) {
    const freshNode = parseMarkdownFile(opened.markdown, opened.path || `${nodeId}.md`);
    freshNode.version = opened.version || freshNode.version;
    freshNode.path = opened.path || freshNode.path;
    state.selectedId = freshNode.id;
    loadEditorFromNode(freshNode);
  }
  state.editor.dirty = false;
  state.editor.saving = false;
  state.editor.lastSavedAt = new Date().toLocaleTimeString();
  state.editor.version = opened.version || state.editor.version;
  state.editor.path = opened.path || state.editor.path;
  render();
}

function render() {
  renderFilters();
  renderWorkspaceMeta();
  renderWorkspaceGlance();
  renderSidebarPanels();
  renderLibraryView();
  renderList();
  renderMemoryList();
  renderActivityList();
  renderGraph();
  renderEditorChrome();
  renderNoteShell();
  renderDetail();
  renderContextMemory();
  elements.status.textContent = `${state.filtered.length} nodes loaded`;
}

elements.searchInput.addEventListener('input', (event) => {
  state.query = event.target.value;
  applyFilters();
});

elements.filterSource.addEventListener('change', (event) => {
  state.sourceFilter = event.target.value;
  applyFilters();
});

elements.filterOrigin.addEventListener('change', (event) => {
  state.originFilter = event.target.value;
  applyFilters();
});

elements.graphScope.addEventListener('change', (event) => {
  state.graphScope = event.target.value;
  render();
});

for (const [view, button] of Object.entries(elements.viewButtons)) {
  button.addEventListener('click', () => {
    state.libraryView = view;
    render();
  });
}

elements.loadFolder.addEventListener('click', async () => {
  try {
    const dirHandle = await window.showDirectoryPicker();
    await loadMempediaFolder(dirHandle);
  } catch (error) {
    if (error.name !== 'AbortError') {
      console.error(error);
      elements.status.textContent = 'Failed to open folder. Check browser console.';
    }
  }
});

elements.refreshWorkspace.addEventListener('click', async () => {
  if (!state.connected) {
    elements.editorStatus.textContent = 'Not connected. Use Open .mempedia Folder for local browsing or start the integrated UI.';
    return;
  }
  try {
    await refreshWorkspace();
  } catch (error) {
    state.editor.lastError = error.message || String(error);
    render();
  }
});

elements.loadDemo.addEventListener('click', () => {
  state.canonicalGraph = createEmptyGraph();
  setMemoryStream({
    habits: [{ topic: 'likes_cat_topics', summary: 'The user enjoys cat-related knowledge and examples.', details: 'Observed from repeated cat prompts.', source: 'demo', timestamp: Date.now() }],
    behaviorPatterns: [{ pattern_key: 'asks_followup_examples', summary: 'Prefers concrete follow-up examples after a high-level explanation.', details: 'Often asks for UI behavior after architecture discussion.', source: 'demo', timestamp: Date.now() }],
    nodeConversations: [],
    conversations: [],
    agentActions: [],
    accessLogs: [],
  });
  setCliConversation([]);
  setNodes(demoNodes, { selectedId: demoNodes[0]?.id || null });
  if (demoNodes[0]) loadEditorFromNode(demoNodes[0]);
});

elements.clearAll.addEventListener('click', () => {
  state.canonicalGraph = createEmptyGraph();
  setMemoryStream(createEmptyMemoryStream());
  setCliConversation([]);
  state.recentOpened = [];
  setNodes([], { selectedId: null });
  state.query = '';
  elements.searchInput.value = '';
  state.editor = createEmptyEditor();
  syncEditorToDom();
  render();
});

elements.exportJson.addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(state.filtered, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'mempedia_nodes.json';
  link.click();
  URL.revokeObjectURL(url);
});

elements.newNode.addEventListener('click', () => {
  const draftId = `new_node_${Date.now()}`;
  state.selectedId = draftId;
  rememberRecentNode(draftId);
  state.editor = createEmptyEditor({
    nodeId: draftId,
    title: 'New Node',
    origin: state.connected ? 'ui-editor' : 'human',
  });
  state.editor.markdown = buildMarkdownFromEditor(state.editor);
  syncEditorToDom();
  render();
});

elements.saveNode.addEventListener('click', async () => {
  try {
    await saveCurrentNode(true);
  } catch (error) {
    state.editor.lastError = error.message || String(error);
    state.editor.saving = false;
    render();
  }
});

elements.reloadNode.addEventListener('click', async () => {
  if (!state.editor.nodeId.trim()) return;
  await selectNode(state.editor.nodeId.trim(), { fetchRemote: state.connected });
});

elements.autoSaveToggle.addEventListener('change', (event) => {
  state.autoSave = event.target.checked;
  renderEditorChrome();
});

elements.fileInput.addEventListener('change', (event) => {
  if (!event.target.files) return;
  void loadFiles(event.target.files);
});

elements.graphLinks.addEventListener('input', (event) => updateGraphLinksField(event.target.value));

for (const [field, element] of Object.entries(elements.fields)) {
  element.addEventListener('input', (event) => updateEditorField(field, event.target.value));
}

setNodes([]);
syncEditorToDom();
render();
void bootstrapConnectedWorkspace();
