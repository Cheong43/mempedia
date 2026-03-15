const state = {
  nodes: [],
  filtered: [],
  selectedId: null,
  selectedBranchId: null,
  query: '',
  sourceFilter: 'all',
  originFilter: 'all',
  graphScope: 'selected',
  canonicalGraph: createEmptyGraph(),
  mempediaHandle: null,
  connected: false,
  memoryRoot: null,
  memoryStream: createEmptyMemoryStream(),
  workspaceLabel: 'Standalone viewer',
  lastLoadedAt: null,
};

const elements = {
  workspaceStatus: document.getElementById('workspace-status'),
  status: document.getElementById('status'),
  editorStatus: document.getElementById('editor-status'),
  metricsGrid: document.getElementById('metrics-grid'),
  searchInput: document.getElementById('search-input'),
  filterSource: document.getElementById('filter-source'),
  filterOrigin: document.getElementById('filter-origin'),
  graphScope: document.getElementById('graph-scope'),
  nodeList: document.getElementById('node-list'),
  legend: document.getElementById('legend'),
  graphSummary: document.getElementById('graph-summary'),
  graphView: document.getElementById('graph-view'),
  graphInsights: document.getElementById('graph-insights'),
  heroPreview: document.getElementById('hero-preview'),
  nodeDetail: document.getElementById('node-detail'),
  markdownPreview: document.getElementById('markdown-preview'),
  strategyLoop: document.getElementById('strategy-loop'),
  toolOrder: document.getElementById('tool-order'),
  branchRuns: document.getElementById('branch-runs'),
  branchGraph: document.getElementById('branch-graph'),
  activityList: document.getElementById('activity-list'),
  memoryList: document.getElementById('memory-list'),
  workspaceGlance: document.getElementById('workspace-glance'),
  pageTree: document.getElementById('page-tree'),
  tagsList: document.getElementById('tags-list'),
  outlineList: document.getElementById('outline-list'),
  contextMemory: document.getElementById('context-memory'),
  loadFolder: document.getElementById('load-folder'),
  refreshWorkspace: document.getElementById('refresh-workspace'),
  loadDemo: document.getElementById('load-demo'),
  fileInput: document.getElementById('file-input'),
  clearAll: document.getElementById('clear-all'),
  exportJson: document.getElementById('export-json'),
};

const strategyGuide = {
  loopModes: [
    {
      id: 'tool',
      title: 'Thought → Tool',
      accent: 'primary',
      summary: 'Pick one highest-yield tool call and continue inside the same branch.',
      detail: 'Best for linear progress after the branch has already committed to one hypothesis or retrieval path.',
    },
    {
      id: 'branch',
      title: 'Thought → Branch',
      accent: 'accent',
      summary: 'Fork only when there are materially different strategies worth exploring.',
      detail: 'Examples: lexical search vs graph traversal, top-hit read vs version-history verification.',
    },
    {
      id: 'final',
      title: 'Thought → Final',
      accent: 'success',
      summary: 'Close the branch when it has enough evidence to answer its local goal.',
      detail: 'Completed branches are later synthesized into one user-facing answer.',
    },
    {
      id: 'save',
      title: 'Thought → Async Save',
      accent: 'warning',
      summary: 'Persist only durable, reusable knowledge discovered by a branch.',
      detail: 'Save discipline is explicit: no noisy session dumps, only reusable atomic facts or patterns.',
    },
  ],
  toolOrder: [
    {
      name: 'mempedia_search_hybrid',
      order: 1,
      purpose: 'High-recall retrieval before narrowing the hypothesis.',
      usage: 'Start broad with limit=8–12.',
    },
    {
      name: 'mempedia_read',
      order: 2,
      purpose: 'Confirm the top 1–3 nodes and remove false positives.',
      usage: 'Read nodes returned by hybrid search or graph traversal.',
    },
    {
      name: 'mempedia_traverse',
      order: 3,
      purpose: 'Expand dependencies, neighbors, or structural context.',
      usage: 'Useful when the selected node is a hub or relation bridge.',
    },
    {
      name: 'mempedia_history',
      order: 4,
      purpose: 'Validate how a fact evolved over time.',
      usage: 'Use when confidence is low or evidence implies drift.',
    },
    {
      name: 'mempedia_save',
      order: 5,
      purpose: 'Persist reusable memory after the branch has real value.',
      usage: 'Never use for transient chatter or speculative state.',
    },
  ],
  budgets: {
    depth: 2,
    width: 3,
    steps: 8,
    completed: 4,
  },
};

const demoNodes = [
  {
    id: 'branching_react_loop',
    title: 'Branching ReAct Loop',
    summary: 'Treat ReAct as a functional loop where one thought step can continue, fork, finish, or queue an async memory save.',
    body: 'The root loop begins with one user objective. Each thought chooses either a single tool, a set of materially distinct child branches, a final answer, or a durable memory save. Completed branches are synthesized into one user-facing answer.',
    source: 'react_strategy.md',
    origin: 'codecli',
    facts: [
      'branch.max_depth: 2',
      'branch.max_width: 3',
      'branch.max_steps: 8',
      'branch.max_completed: 4',
    ],
    relations: [
      'tool_priority | defines | 0.93',
      'branch_synthesizer | feeds | 0.91',
      'async_memory_save | enables | 0.86',
      'mempedia_search_hybrid | prioritizes | 0.78',
    ],
    evidence: ['mempedia-codecli/react_strategy.md', 'mempedia-codecli/README.md'],
    confidence: 0.96,
    importance: 1.3,
    version: 'demo-v1',
  },
  {
    id: 'tool_priority',
    title: 'Tool Priority Ladder',
    summary: 'Hybrid retrieval comes first, then targeted read, graph traversal, temporal verification, and durable save.',
    body: 'The CLI prefers high recall before local confirmation. Search broad, read top hits, traverse graph context, check version history, and save only after extracting durable value.',
    source: 'README.md',
    origin: 'codecli',
    facts: [
      'tool.1: mempedia_search_hybrid',
      'tool.2: mempedia_read',
      'tool.3: mempedia_traverse',
      'tool.4: mempedia_history',
      'tool.5: mempedia_save',
    ],
    relations: [
      'mempedia_search_hybrid | ranks_before | 0.95',
      'mempedia_read | follows | 0.9',
      'mempedia_history | verifies | 0.78',
      'async_memory_save | guards | 0.73',
    ],
    evidence: ['mempedia-codecli/README.md'],
    confidence: 0.92,
    importance: 1.12,
    version: 'demo-v1',
  },
  {
    id: 'markdown_projection',
    title: 'Markdown Projection',
    summary: 'Each head version projects into markdown with frontmatter plus optional Facts, Relations, and Evidence sections.',
    body: 'Humans edit markdown; runtime projects it back into structured data and graph links. Frontmatter stores node identity, version, timestamp, confidence, importance, source, and origin.',
    source: 'KB_SCHEMA.md',
    origin: 'mempedia',
    facts: [
      'frontmatter.node_id: stable identifier',
      'section.facts: fact.<key>',
      'section.relations: graph links',
      'section.evidence: evidence.01+',
    ],
    relations: [
      'kb_schema | documents | 0.95',
      'version_graph | projects_to | 0.84',
      'knowledge_graph_stage | visualizes | 0.76',
    ],
    evidence: ['policies/KB_SCHEMA.md'],
    confidence: 0.95,
    importance: 1.08,
    version: 'demo-v1',
  },
  {
    id: 'version_graph',
    title: 'Version Graph',
    summary: 'Heads, version objects, and markdown projections combine into the canonical graph used for browsing and validation.',
    body: 'The UI can load index state, read version objects, and reconstruct current node heads. History validation is a first-class reasoning path when the model needs drift checks.',
    source: 'mempedia-ui',
    origin: 'ui',
    facts: [
      'load.index_state: heads map',
      'load.objects: version json',
      'load.knowledge_nodes: markdown projection',
    ],
    relations: [
      'mempedia_history | validates | 0.91',
      'branching_react_loop | supports | 0.67',
      'markdown_projection | reconstructs | 0.88',
    ],
    evidence: ['mempedia-ui/script.js'],
    confidence: 0.88,
    importance: 1.0,
    version: 'demo-v1',
  },
  {
    id: 'async_memory_save',
    title: 'Async Memory Save',
    summary: 'Branches may preserve durable value without blocking the main reasoning loop.',
    body: 'Async save is optional and selective. The branch should queue a save only when it has discovered reusable project facts, confirmed stable workflows, or valuable branch results.',
    source: 'react_strategy.md',
    origin: 'codecli',
    facts: [
      'save.when: reusable project fact',
      'save.when: confirmed stable workflow',
      'save.when: valuable branch result',
      'save.avoid: transient chatter',
    ],
    relations: [
      'branching_react_loop | extends | 0.86',
      'branch_synthesizer | complements | 0.68',
      'tool_priority | constrains | 0.6',
    ],
    evidence: ['mempedia-codecli/react_strategy.md'],
    confidence: 0.89,
    importance: 1.04,
    version: 'demo-v1',
  },
  {
    id: 'branch_synthesizer',
    title: 'Branch Synthesizer',
    summary: 'Completed child branches are collapsed into one answer after local goals finish.',
    body: 'The synthesis layer prevents the user from seeing three separate competing transcripts. Instead, the system merges finished branch findings into a single concise answer.',
    source: 'README.md',
    origin: 'codecli',
    facts: [
      'synthesis.input: completed branches',
      'synthesis.output: single user answer',
      'synthesis.bias: prefer best validated branch',
    ],
    relations: [
      'branching_react_loop | completes_with | 0.94',
      'async_memory_save | may_follow | 0.58',
      'knowledge_graph_stage | explains | 0.42',
    ],
    evidence: ['mempedia-codecli/README.md'],
    confidence: 0.9,
    importance: 1.1,
    version: 'demo-v1',
  },
  {
    id: 'knowledge_graph_stage',
    title: 'Knowledge Graph Stage',
    summary: 'The redesigned UI centers on nodes, edge labels, graph density, and selected-neighborhood reasoning context.',
    body: 'A graph-first UI reduces the need to open raw editors. Operators can filter sources, inspect hub nodes, map evidence, and understand why a branch prefers one retrieval strategy over another.',
    source: 'mempedia-ui',
    origin: 'ui',
    facts: [
      'ui.focus: graph-first',
      'ui.focus: strategy-theatre',
      'ui.focus: schema-coverage',
    ],
    relations: [
      'markdown_projection | reveals | 0.83',
      'branching_react_loop | narrates | 0.77',
      'version_graph | renders | 0.71',
    ],
    evidence: ['mempedia-ui/index.html', 'mempedia-ui/styles.css'],
    confidence: 0.87,
    importance: 1.16,
    version: 'demo-v1',
  },
];

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

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function truncateText(value, length = 140) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  return normalized.length > length ? `${normalized.slice(0, length - 1)}…` : normalized;
}

function formatNumber(value, digits = 2) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(digits) : '0.00';
}

function formatTimestamp(value) {
  if (!value) return 'not available';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function updateStatus(text, mutedText = '') {
  elements.status.textContent = text;
  if (mutedText) elements.editorStatus.textContent = mutedText;
}

function setWorkspaceMode(mode, detail) {
  elements.workspaceStatus.textContent = mode;
  if (detail) elements.editorStatus.textContent = detail;
}

function parseFrontmatter(markdown) {
  const match = String(markdown || '').match(/^---\s*[\r\n]+([\s\S]*?)\s*[\r\n]+---\s*[\r\n]*/);
  if (!match) return { meta: {}, body: String(markdown || '') };
  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    const [key, ...rest] = line.split(':');
    if (!key || !rest.length) continue;
    meta[key.trim()] = rest.join(':').trim().replace(/^"|"$/g, '');
  }
  return { meta, body: String(markdown).slice(match[0].length) };
}

function normalizeSectionName(name) {
  const value = String(name || '').trim().toLowerCase();
  if (['facts', 'fact', 'claims', 'claim'].includes(value)) return 'facts';
  if (['relations', 'relation', 'links', 'link', 'related', 'related nodes', 'connections'].includes(value)) return 'relations';
  if (['evidence', 'sources', 'source'].includes(value)) return 'evidence';
  return null;
}

function parseSections(body) {
  const sections = { facts: [], relations: [], evidence: [] };
  let current = null;
  for (const line of String(body || '').split(/\r?\n/)) {
    const heading = line.trim().match(/^#{2,3}\s+(.+)$/);
    if (heading) {
      current = normalizeSectionName(heading[1]);
      continue;
    }
    if (!current) continue;
    if (/^[-*+]\s+/.test(line.trim())) {
      sections[current].push(line.trim().replace(/^[-*+]\s+/, ''));
    }
  }
  return sections;
}

function deriveTitle(body, meta) {
  if (meta.title) return meta.title;
  const heading = String(body || '').match(/^#\s+(.+)/m);
  return heading ? heading[1].trim() : 'Untitled';
}

function deriveSummary(body, meta) {
  if (meta.summary) return meta.summary;
  const lines = String(body || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (const line of lines) {
    if (!line.startsWith('#') && line.length > 10) return truncateText(line, 160);
  }
  return 'Summary unavailable.';
}

function extractNarrativeBody(body, title) {
  const kept = [];
  let structured = null;
  for (const rawLine of String(body || '').split(/\r?\n/)) {
    const heading = rawLine.trim().match(/^#{2,3}\s+(.+)$/);
    if (heading) {
      const next = normalizeSectionName(heading[1]);
      if (next) {
        structured = next;
        continue;
      }
      structured = null;
      kept.push(rawLine);
      continue;
    }
    if (structured) continue;
    kept.push(rawLine);
  }
  let narrative = kept.join('\n').trim();
  const heading = `# ${title}`;
  if (narrative.startsWith(heading)) narrative = narrative.slice(heading.length).trimStart();
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

  if (raw.includes('|')) {
    const parts = raw.split('|').map((part) => part.trim());
    const target = parts[0];
    if (!target) return null;
    const label = parts[1] || 'related';
    const weight = Number(parts[2]);
    return { target, label, weight: Number.isFinite(weight) ? weight : null };
  }

  const fnStyle = raw.match(/^(.*?)\((.*)\)$/);
  if (fnStyle) {
    const target = fnStyle[1].trim();
    let label = 'related';
    let weight = null;
    for (const part of fnStyle[2].split(',')) {
      const [key, value] = part.split('=').map((item) => item?.trim());
      if (!key || !value) continue;
      if (key === 'label') label = value;
      if (key === 'weight') {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) weight = parsed;
      }
    }
    return target ? { target, label, weight } : null;
  }

  return { target: raw, label: 'related', weight: null };
}

function parseMarkdownFile(markdown, fileName = '') {
  const { meta, body } = parseFrontmatter(markdown);
  const title = deriveTitle(body, meta);
  const sections = parseSections(body);
  return normalizeNode({
    id: meta.node_id || fileName.replace(/\.md$/i, '').replace(/-.+$/, '') || title.toLowerCase().replace(/\s+/g, '_'),
    title,
    summary: deriveSummary(body, meta),
    body: extractNarrativeBody(body, title),
    source: meta.source || 'manual-import',
    origin: meta.origin || 'human',
    facts: sections.facts,
    relations: sections.relations,
    evidence: sections.evidence,
    confidence: Number(meta.confidence || 0.9),
    importance: Number(meta.importance || 1),
    version: meta.version || '',
    markdown,
    path: fileName,
  });
}

function normalizeNode(node) {
  return {
    id: String(node.id || 'untitled').trim(),
    title: String(node.title || node.id || 'Untitled').trim(),
    summary: String(node.summary || 'Summary unavailable.').trim(),
    body: String(node.body || '').trim(),
    source: String(node.source || 'unknown').trim(),
    origin: String(node.origin || 'unknown').trim(),
    facts: Array.isArray(node.facts) ? node.facts.filter(Boolean) : normalizeListText(node.facts),
    relations: Array.isArray(node.relations) ? node.relations.filter(Boolean) : normalizeListText(node.relations),
    evidence: Array.isArray(node.evidence) ? node.evidence.filter(Boolean) : normalizeListText(node.evidence),
    confidence: Number(node.confidence || 0.9),
    importance: Number(node.importance || 1),
    version: node.version || '',
    markdown: node.markdown || '',
    path: node.path || '',
  };
}

function buildNodeFromVersion(nodeId, versionObj, markdown, path = '') {
  if (!versionObj && !markdown) return null;
  if (markdown) {
    const parsed = parseMarkdownFile(markdown, path || `${nodeId}.md`);
    return normalizeNode({
      ...parsed,
      id: nodeId,
      confidence: versionObj?.confidence || parsed.confidence,
      importance: versionObj?.importance || parsed.importance,
      version: versionObj?.version || parsed.version,
    });
  }
  return normalizeNode({
    id: nodeId,
    title: versionObj?.content?.title || nodeId,
    summary: versionObj?.content?.summary || 'Summary unavailable.',
    body: versionObj?.content?.body || '',
    source: versionObj?.content?.structured_data?.['meta.source'] || 'mempedia',
    origin: versionObj?.content?.structured_data?.['meta.origin'] || 'agent',
    confidence: versionObj?.confidence || 0.9,
    importance: versionObj?.importance || 1,
    version: versionObj?.version || '',
    path,
  });
}

function buildNodesFromMempedia(stateJson, versionMap, markdownMap) {
  const nodes = [];
  const heads = stateJson?.heads || {};
  for (const [nodeId, versionHash] of Object.entries(heads)) {
    const markdownName = Object.keys(markdownMap).find((name) => name.startsWith(`${nodeId}-`) || name === `${nodeId}.md`);
    const node = buildNodeFromVersion(nodeId, versionMap[versionHash], markdownMap[markdownName], markdownName || `${nodeId}.md`);
    if (node) nodes.push(node);
  }

  for (const [fileName, markdown] of Object.entries(markdownMap)) {
    const nodeId = fileName.replace(/-.+\.md$/, '').replace(/\.md$/, '');
    if (!nodes.some((node) => node.id === nodeId)) nodes.push(parseMarkdownFile(markdown, fileName));
  }

  return nodes;
}

function buildNodesFromSnapshot(payload) {
  const versionMap = Object.fromEntries(payload.versions || []);
  const markdownByNode = Object.fromEntries(payload.markdownByNode || []);
  const nodes = [];
  const heads = payload.snapshot?.heads || {};

  for (const [nodeId, versionHash] of Object.entries(heads)) {
    const entry = markdownByNode[nodeId];
    const node = buildNodeFromVersion(nodeId, versionMap[versionHash], entry?.markdown, entry?.path || `${nodeId}.md`);
    if (node) nodes.push(node);
  }

  for (const [nodeId, entry] of Object.entries(markdownByNode)) {
    if (!nodes.some((node) => node.id === nodeId)) nodes.push(parseMarkdownFile(entry.markdown, entry.path || `${nodeId}.md`));
  }

  return nodes;
}

function buildCanonicalGraph(heads = {}, versionMap = {}, knownNodes = []) {
  const nodeMap = new Map();
  const edgeMap = new Map();
  const knownMap = new Map(knownNodes.map((node) => [node.id, node]));

  const ensureNode = (nodeId, seed = {}, external = false) => {
    if (!nodeId) return null;
    const existing = nodeMap.get(nodeId);
    if (existing) {
      existing.external = existing.external && external;
      return existing;
    }
    const created = {
      id: nodeId,
      title: seed.title || nodeId,
      summary: seed.summary || '',
      source: seed.source || '',
      origin: seed.origin || '',
      external,
    };
    nodeMap.set(nodeId, created);
    return created;
  };

  for (const node of knownNodes) ensureNode(node.id, node, false);

  for (const [nodeId, versionHash] of Object.entries(heads)) {
    const versionObj = versionMap[versionHash];
    const base = knownMap.get(nodeId) || {
      title: versionObj?.content?.title || nodeId,
      summary: versionObj?.content?.summary || '',
      source: versionObj?.content?.structured_data?.['meta.source'] || '',
      origin: versionObj?.content?.structured_data?.['meta.origin'] || '',
    };
    ensureNode(nodeId, base, false);
    for (const link of Array.isArray(versionObj?.content?.links) ? versionObj.content.links : []) {
      const target = String(link?.target || '').trim();
      if (!target) continue;
      ensureNode(target, knownMap.get(target) || { title: target }, !heads[target]);
      const label = String(link?.label || 'related').trim() || 'related';
      const weight = Number(link?.weight);
      const key = `${nodeId}__${target}__${label}`;
      if (!edgeMap.has(key)) {
        edgeMap.set(key, {
          id: key,
          source: nodeId,
          target,
          label,
          weight: Number.isFinite(weight) ? weight : null,
        });
      }
    }
  }

  const markdownGraph = buildGraphFromNodes(knownNodes);
  for (const node of markdownGraph.nodes) ensureNode(node.id, node, node.external);
  for (const edge of markdownGraph.edges) {
    const key = `${edge.source}__${edge.target}__${edge.label}`;
    if (!edgeMap.has(key)) edgeMap.set(key, edge);
  }

  return { nodes: Array.from(nodeMap.values()), edges: Array.from(edgeMap.values()) };
}

function buildGraphFromNodes(nodes) {
  const nodeMap = new Map();
  const edgeMap = new Map();

  const ensureNode = (id, seed = {}, external = false) => {
    if (!id) return;
    if (nodeMap.has(id)) {
      const current = nodeMap.get(id);
      current.external = current.external && external;
      return;
    }
    nodeMap.set(id, {
      id,
      title: seed.title || id,
      summary: seed.summary || '',
      source: seed.source || '',
      origin: seed.origin || '',
      external,
    });
  };

  for (const node of nodes) ensureNode(node.id, node, false);

  for (const node of nodes) {
    for (const relationLine of node.relations || []) {
      const relation = parseRelationEntry(relationLine);
      if (!relation) continue;
      ensureNode(relation.target, { title: relation.target }, !nodes.some((item) => item.id === relation.target));
      const key = `${node.id}__${relation.target}__${relation.label}`;
      if (!edgeMap.has(key)) {
        edgeMap.set(key, {
          id: key,
          source: node.id,
          target: relation.target,
          label: relation.label,
          weight: relation.weight,
        });
      }
    }
  }

  return { nodes: Array.from(nodeMap.values()), edges: Array.from(edgeMap.values()) };
}

function extractOutline(body = '', fallbackTitle = 'Untitled') {
  const items = [];
  for (const line of String(body || '').split(/\r?\n/)) {
    const heading = line.trim().match(/^(#{1,3})\s+(.+)$/);
    if (heading) items.push({ level: heading[1].length, title: heading[2].trim() });
  }
  return items.length ? items : [{ level: 1, title: fallbackTitle }];
}

function generateMarkdown(node) {
  const facts = node.facts.length ? `\n## Facts\n${node.facts.map((item) => `- ${item}`).join('\n')}\n` : '';
  const relations = node.relations.length ? `\n## Relations\n${node.relations.map((item) => `- ${item}`).join('\n')}\n` : '';
  const evidence = node.evidence.length ? `\n## Evidence\n${node.evidence.map((item) => `- ${item}`).join('\n')}\n` : '';
  return [
    '---',
    `node_id: "${node.id}"`,
    node.version ? `version: "${node.version}"` : null,
    `confidence: ${formatNumber(node.confidence, 2)}`,
    `importance: ${formatNumber(node.importance, 2)}`,
    `title: "${String(node.title).replaceAll('"', '\\"')}"`,
    `source: "${String(node.source).replaceAll('"', '\\"')}"`,
    `origin: "${String(node.origin).replaceAll('"', '\\"')}"`,
    '---',
    `# ${node.title}`,
    '',
    node.body || node.summary,
    facts,
    relations,
    evidence,
  ].filter(Boolean).join('\n');
}

function getSelectedNode() {
  return state.nodes.find((node) => node.id === state.selectedId) || null;
}

function getBaseGraph() {
  if (state.canonicalGraph.nodes.length || state.canonicalGraph.edges.length) return state.canonicalGraph;
  return buildGraphFromNodes(state.nodes);
}

function getGraphDegreeMap(graph) {
  const map = new Map(graph.nodes.map((node) => [node.id, 0]));
  for (const edge of graph.edges) {
    map.set(edge.source, (map.get(edge.source) || 0) + 1);
    map.set(edge.target, (map.get(edge.target) || 0) + 1);
  }
  return map;
}

function getVisibleGraph() {
  const base = getBaseGraph();
  if (!base.nodes.length) return createEmptyGraph();

  const selectedNode = getSelectedNode();
  const filteredIds = new Set(state.filtered.map((node) => node.id));
  const focusIds = new Set();

  if (state.graphScope === 'selected' && selectedNode) {
    focusIds.add(selectedNode.id);
    for (const edge of base.edges) {
      if (edge.source === selectedNode.id || edge.target === selectedNode.id) {
        focusIds.add(edge.source);
        focusIds.add(edge.target);
      }
    }
  } else {
    for (const id of filteredIds) focusIds.add(id);
    if (!focusIds.size) {
      const degreeMap = getGraphDegreeMap(base);
      for (const node of [...base.nodes].sort((a, b) => (degreeMap.get(b.id) || 0) - (degreeMap.get(a.id) || 0)).slice(0, 10)) {
        focusIds.add(node.id);
      }
    }
    for (const edge of base.edges) {
      if (focusIds.has(edge.source) || focusIds.has(edge.target)) {
        focusIds.add(edge.source);
        focusIds.add(edge.target);
      }
    }
  }

  const nodes = base.nodes.filter((node) => focusIds.has(node.id)).slice(0, 18);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = base.edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));
  return { nodes, edges };
}

function computeGraphLayout(graph) {
  const width = 960;
  const height = 620;
  const centerX = width / 2;
  const centerY = height / 2;
  const positions = new Map();
  const degreeMap = getGraphDegreeMap(graph);
  const selectedNode = getSelectedNode();

  if (!graph.nodes.length) return positions;

  if (state.graphScope === 'selected' && selectedNode && graph.nodes.some((node) => node.id === selectedNode.id)) {
    positions.set(selectedNode.id, { x: centerX, y: centerY });
    const neighbors = graph.nodes.filter((node) => node.id !== selectedNode.id);
    neighbors.forEach((node, index) => {
      const angle = (-Math.PI / 2) + ((Math.PI * 2) / Math.max(neighbors.length, 1)) * index;
      const radius = 200 + (index % 2) * 40;
      positions.set(node.id, {
        x: centerX + Math.cos(angle) * radius,
        y: centerY + Math.sin(angle) * radius,
      });
    });
    return positions;
  }

  const ordered = [...graph.nodes].sort((a, b) => (degreeMap.get(b.id) || 0) - (degreeMap.get(a.id) || 0));
  const center = ordered.shift();
  if (center) positions.set(center.id, { x: centerX, y: centerY });

  ordered.forEach((node, index) => {
    const ring = index < 6 ? 0 : 1;
    const ringItems = ring === 0 ? ordered.slice(0, Math.min(6, ordered.length)) : ordered.slice(6);
    const localIndex = ring === 0 ? index : index - 6;
    const angle = (-Math.PI / 2) + ((Math.PI * 2) / Math.max(ringItems.length, 1)) * localIndex;
    const radius = ring === 0 ? 180 : 280;
    positions.set(node.id, {
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius,
    });
  });

  return positions;
}

function collectTags(node) {
  if (!node) return [];
  const tags = new Set([node.source, node.origin]);
  for (const fact of node.facts) {
    const key = String(fact).split(/[:=]/)[0]?.trim();
    if (key) tags.add(key);
  }
  for (const relation of node.relations) {
    const parsed = parseRelationEntry(relation);
    if (parsed?.label) tags.add(parsed.label);
  }
  return [...tags].filter(Boolean).slice(0, 16);
}

function degreeForNode(nodeId) {
  const base = getBaseGraph();
  let count = 0;
  for (const edge of base.edges) {
    if (edge.source === nodeId || edge.target === nodeId) count += 1;
  }
  return count;
}

function applyFilters(renderNow = true) {
  const query = state.query.trim().toLowerCase();
  state.filtered = state.nodes.filter((node) => {
    const matchesSource = state.sourceFilter === 'all' || node.source === state.sourceFilter;
    const matchesOrigin = state.originFilter === 'all' || node.origin === state.originFilter;
    if (!matchesSource || !matchesOrigin) return false;
    if (!query) return true;
    const haystack = [node.id, node.title, node.summary, node.body, ...node.facts, ...node.relations, ...node.evidence].join(' ').toLowerCase();
    return haystack.includes(query);
  });

  if (!state.filtered.some((node) => node.id === state.selectedId)) {
    state.selectedId = state.filtered[0]?.id || state.nodes[0]?.id || null;
  }

  if (renderNow) render();
}

function setNodes(nodes, options = {}) {
  state.nodes = nodes.map(normalizeNode).sort((a, b) => (b.importance - a.importance) || a.title.localeCompare(b.title));
  state.selectedId = options.selectedId || state.selectedId || state.nodes[0]?.id || null;
  state.selectedBranchId = null;
  state.lastLoadedAt = Date.now();
  applyFilters(false);
  render();
}

function createMemorySaveCards(run) {
  const cards = [];
  if (run.bestBranch?.saveRecommended) {
    cards.push({
      title: 'Async save recommended',
      copy: `Branch ${run.bestBranch.id} found reusable structure around “${run.node.title}”. Queue a save for the synthesis summary and linked graph context.`,
      chips: ['durable insight', 'non-blocking', 'branch-owned'],
    });
  }

  cards.push({
    title: 'Branch synthesis output',
    copy: run.synthesis,
    chips: ['completed branches', `${run.branches.length} child paths`, `best: ${run.bestBranch?.label || 'n/a'}`],
  });

  if (state.memoryStream.behaviorPatterns.length) {
    const pattern = state.memoryStream.behaviorPatterns[0];
    cards.push({
      title: 'Loaded memory pattern',
      copy: pattern.summary || pattern.details || 'Behavior pattern loaded from the memory index.',
      chips: ['memory index', 'behavior pattern'],
    });
  }

  return cards;
}

function buildStrategyRun(node) {
  if (!node) {
    return {
      node: null,
      root: null,
      branches: [],
      bestBranch: null,
      synthesis: 'Select a node to see how the Branching ReAct planner would fan out the reasoning paths.',
    };
  }

  const relations = node.relations.map(parseRelationEntry).filter(Boolean);
  const evidenceCount = node.evidence.length;
  const factCount = node.facts.length;
  const searchConfidence = Math.min(0.97, 0.62 + factCount * 0.04 + (state.query ? 0.08 : 0.04));
  const traverseConfidence = Math.min(0.96, 0.56 + relations.length * 0.09 + (degreeForNode(node.id) > 2 ? 0.07 : 0));
  const historyConfidence = Math.min(0.95, 0.52 + evidenceCount * 0.1 + (node.version ? 0.07 : 0));

  const root = {
    id: 'B0',
    label: 'Root loop',
    goal: `Resolve the user request around ${node.title}`,
    steps: [
      { kind: 'thought', title: 'Establish objective', detail: `The active focus is ${node.title}. Preserve graph structure and choose the next highest-yield action.` },
      { kind: 'branch', title: 'Fork into material strategies', detail: 'Search-first, graph-traversal, and history-verification are distinct enough to deserve separate child loops.' },
    ],
  };

  const branches = [
    {
      id: 'B0.1',
      parentId: 'B0',
      label: 'Search-first',
      confidence: searchConfidence,
      verdict: searchConfidence >= 0.82 ? 'Strong entry path' : 'Good broad recall',
      saveRecommended: factCount + evidenceCount >= 5,
      steps: [
        { kind: 'thought', title: 'Start with recall', detail: 'Query ambiguity is best handled by broad retrieval before committing to one interpretation.' },
        { kind: 'action', title: 'Call mempedia_search_hybrid', detail: `query="${truncateText(`${node.title} ${node.summary}`, 80)}", limit=10` },
        { kind: 'observation', title: 'Inspect top hits', detail: `${Math.max(4, factCount + relations.length + 2)} likely matches cluster around ${node.title}.` },
        { kind: 'action', title: 'Call mempedia_read', detail: `Open ${node.id} and the highest-ranked companion node.` },
        { kind: 'final', title: 'Finish branch', detail: 'Use when the question needs broad recall and then quick confirmation.' },
      ],
    },
    {
      id: 'B0.2',
      parentId: 'B0',
      label: 'Graph-traverse',
      confidence: traverseConfidence,
      verdict: traverseConfidence >= 0.82 ? 'Best structural path' : 'Useful for neighbors',
      saveRecommended: relations.length >= 3,
      steps: [
        { kind: 'thought', title: 'Exploit topology', detail: 'The selected node already exposes labeled relations, so graph adjacency can reduce search noise.' },
        { kind: 'action', title: 'Call mempedia_traverse', detail: `start_node="${node.id}", mode="bfs", depth_limit=1` },
        { kind: 'observation', title: 'Collect neighbor evidence', detail: `${Math.max(1, relations.length)} first-hop links expose tool order, schema coverage, or branch synthesis context.` },
        { kind: 'action', title: 'Call mempedia_read', detail: 'Open the most informative neighbor and compare relation labels.' },
        { kind: 'final', title: 'Finish branch', detail: 'Use when the answer depends on dependencies, cluster shape, or edge labels.' },
      ],
    },
    {
      id: 'B0.3',
      parentId: 'B0',
      label: 'History-verify',
      confidence: historyConfidence,
      verdict: historyConfidence >= 0.82 ? 'Best for drift checks' : 'Good validation path',
      saveRecommended: evidenceCount >= 2,
      steps: [
        { kind: 'thought', title: 'Check temporal confidence', detail: 'Evidence and version identifiers imply the user may care about whether the fact is still current.' },
        { kind: 'action', title: 'Call mempedia_history', detail: `node_id="${node.id}", limit=5` },
        { kind: 'observation', title: 'Measure evolution', detail: `${Math.max(2, evidenceCount + 1)} change points suggest where the explanation stabilized or drifted.` },
        { kind: 'final', title: 'Finish branch', detail: 'Use when version drift matters more than raw recall.' },
      ],
    },
  ];

  const bestBranch = [...branches].sort((a, b) => b.confidence - a.confidence)[0];
  const synthesis = `Prefer ${bestBranch.label.toLowerCase()} for “${node.title}” because its confidence is ${formatNumber(bestBranch.confidence, 2)}. Keep ${branches
    .filter((branch) => branch.id !== bestBranch.id)
    .map((branch) => branch.label.toLowerCase())
    .join(' and ')} as validation or fallback lanes, then synthesize the confirmed findings into one answer.`;

  return { node, root, branches, bestBranch, synthesis };
}

function renderMetrics(run) {
  const base = getBaseGraph();
  const externalCount = base.nodes.filter((node) => node.external).length;
  const relationLabels = new Set(base.edges.map((edge) => edge.label));
  const evidenceCount = state.filtered.reduce((sum, node) => sum + node.evidence.length, 0);
  const averageDegree = base.nodes.length ? ((base.edges.length * 2) / base.nodes.length) : 0;
  const cards = [
    { label: 'Visible nodes', value: state.filtered.length, detail: `${state.nodes.length} total loaded in workspace scope.` },
    { label: 'Graph edges', value: base.edges.length, detail: `${relationLabels.size} relation labels mapped into the knowledge graph.` },
    { label: 'Average degree', value: formatNumber(averageDegree, 1), detail: `${externalCount} external references extend beyond the local node set.` },
    { label: 'Evidence lines', value: evidenceCount, detail: 'Structured evidence remains visible without opening raw markdown.' },
    { label: 'Branch width', value: strategyGuide.budgets.width, detail: `Documented maximum child strategies per fork; depth cap ${strategyGuide.budgets.depth}.` },
    { label: 'Best lane', value: run.bestBranch ? run.bestBranch.label : 'None', detail: run.bestBranch ? `${formatNumber(run.bestBranch.confidence, 2)} confidence for the selected node.` : 'Select a node to rank branch options.' },
  ];

  elements.metricsGrid.innerHTML = cards.map((card) => `
    <article class="metric-card">
      <div class="metric-card__label">${escapeHtml(card.label)}</div>
      <div class="metric-card__value">${escapeHtml(card.value)}</div>
      <div class="metric-card__detail">${escapeHtml(card.detail)}</div>
    </article>
  `).join('');
}

function renderLegend() {
  const cards = [
    { title: 'Selected node', copy: 'Bright cyan nodes are the current inspection anchor. The surrounding slice is centered on its relation neighborhood.' },
    { title: 'External reference', copy: 'Muted nodes come from relation targets not fully loaded into the current memory set.' },
    { title: 'Branch heuristics', copy: 'The strategy theatre ranks search-first, graph-traverse, and history-verify based on facts, relations, evidence, and graph degree.' },
  ];

  elements.legend.innerHTML = cards.map((card) => `
    <article class="legend-card">
      <div class="legend-card__title">${escapeHtml(card.title)}</div>
      <div class="legend-card__copy">${escapeHtml(card.copy)}</div>
    </article>
  `).join('');
}

function renderFilters() {
  const sources = ['all', ...new Set(state.nodes.map((node) => node.source).filter(Boolean))];
  const origins = ['all', ...new Set(state.nodes.map((node) => node.origin).filter(Boolean))];

  elements.filterSource.innerHTML = sources.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value === 'all' ? 'All' : value)}</option>`).join('');
  elements.filterSource.value = state.sourceFilter;
  elements.filterOrigin.innerHTML = origins.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value === 'all' ? 'All' : value)}</option>`).join('');
  elements.filterOrigin.value = state.originFilter;
  elements.searchInput.value = state.query;
  elements.graphScope.value = state.graphScope;
}

function renderNodeList() {
  if (!state.filtered.length) {
    elements.nodeList.innerHTML = '<div class="empty-state">No nodes match the current filters. Clear the query or load a different dataset.</div>';
    return;
  }

  elements.nodeList.innerHTML = state.filtered.map((node) => `
    <article class="node-card ${node.id === state.selectedId ? 'is-active' : ''}" data-node-id="${escapeHtml(node.id)}">
      <div class="node-card__head">
        <div class="node-card__title">${escapeHtml(node.title)}</div>
        <div class="node-card__score">${formatNumber(node.importance, 2)}</div>
      </div>
      <div class="node-card__summary">${escapeHtml(truncateText(node.summary, 140))}</div>
      <div class="node-card__meta">
        <span class="chip chip--primary">${escapeHtml(node.source)}</span>
        <span class="chip chip--accent">${escapeHtml(node.origin)}</span>
        <span class="chip chip--success">degree ${degreeForNode(node.id)}</span>
      </div>
    </article>
  `).join('');

  for (const card of elements.nodeList.querySelectorAll('[data-node-id]')) {
    card.addEventListener('click', () => {
      state.selectedId = card.getAttribute('data-node-id');
      state.selectedBranchId = null;
      render();
    });
  }
}

function renderGraph() {
  const graph = getVisibleGraph();
  const selectedNode = getSelectedNode();
  const degreeMap = getGraphDegreeMap(graph);
  const positions = computeGraphLayout(graph);
  const selectedId = selectedNode?.id;

  const summary = selectedNode
    ? `Focused on ${selectedNode.title}. ${graph.nodes.length} nodes and ${graph.edges.length} edges are visible in the current ${state.graphScope === 'selected' ? 'neighborhood' : 'filtered slice'}.`
    : `Showing ${graph.nodes.length} nodes and ${graph.edges.length} edges from the current dataset.`;
  elements.graphSummary.textContent = summary;

  if (!graph.nodes.length) {
    elements.graphView.innerHTML = '';
    elements.graphInsights.innerHTML = '<div class="empty-state">Load a dataset to render the graph stage.</div>';
    return;
  }

  const svgEdges = graph.edges.map((edge) => {
    const source = positions.get(edge.source);
    const target = positions.get(edge.target);
    if (!source || !target) return '';
    const midX = (source.x + target.x) / 2;
    const midY = (source.y + target.y) / 2;
    const weight = Number(edge.weight);
    return `
      <line class="graph-edge ${Number.isFinite(weight) && weight >= 0.8 ? 'graph-edge--strong' : ''}" x1="${source.x}" y1="${source.y}" x2="${target.x}" y2="${target.y}"></line>
      <text class="graph-edge-label" x="${midX}" y="${midY - 6}" text-anchor="middle">${escapeHtml(edge.label)}</text>
    `;
  }).join('');

  const svgNodes = graph.nodes.map((node) => {
    const position = positions.get(node.id);
    if (!position) return '';
    const degree = degreeMap.get(node.id) || 0;
    const radius = node.id === selectedId ? 28 : Math.max(16, Math.min(24, 14 + degree * 2));
    const fill = node.id === selectedId
      ? 'url(#selectedGradient)'
      : node.external
        ? 'rgba(146, 179, 215, 0.22)'
        : 'rgba(90, 209, 255, 0.18)';
    const stroke = node.id === selectedId
      ? '#9be7ff'
      : node.external
        ? 'rgba(146, 179, 215, 0.45)'
        : 'rgba(90, 209, 255, 0.6)';
    return `
      <g class="graph-node ${node.id === selectedId ? 'is-active' : ''}" data-node-id="${escapeHtml(node.id)}" transform="translate(${position.x}, ${position.y})">
        <circle r="${radius}" fill="${fill}" stroke="${stroke}"></circle>
        <text text-anchor="middle" y="4">${escapeHtml(truncateText(node.title, 16))}</text>
      </g>
    `;
  }).join('');

  elements.graphView.innerHTML = `
    <defs>
      <linearGradient id="selectedGradient" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#9be7ff"></stop>
        <stop offset="100%" stop-color="#6c8dff"></stop>
      </linearGradient>
    </defs>
    ${svgEdges}
    ${svgNodes}
  `;

  for (const node of elements.graphView.querySelectorAll('[data-node-id]')) {
    node.addEventListener('click', () => {
      state.selectedId = node.getAttribute('data-node-id');
      state.selectedBranchId = null;
      render();
    });
  }

  const hubNode = [...graph.nodes].sort((a, b) => (degreeMap.get(b.id) || 0) - (degreeMap.get(a.id) || 0))[0];
  const relationCounts = {};
  for (const edge of graph.edges) relationCounts[edge.label] = (relationCounts[edge.label] || 0) + 1;
  const topRelation = Object.entries(relationCounts).sort((a, b) => b[1] - a[1])[0];

  elements.graphInsights.innerHTML = [
    {
      title: 'Hub node',
      copy: hubNode ? `${hubNode.title} carries ${degreeMap.get(hubNode.id) || 0} visible connections in the current slice.` : 'No hub identified.',
    },
    {
      title: 'Top relation label',
      copy: topRelation ? `${topRelation[0]} appears ${topRelation[1]} times in the active slice.` : 'No relation labels found.',
    },
    {
      title: 'Graph scope',
      copy: state.graphScope === 'selected' ? 'Selected node scope highlights immediate reasoning context.' : 'Filtered graph scope surfaces cluster-level structure.',
    },
    {
      title: 'Structural takeaway',
      copy: selectedNode ? `Use the graph-traverse branch when ${selectedNode.title} behaves like a hub or bridge node.` : 'Select a node to derive branch guidance from topology.',
    },
  ].map((item) => `
    <article class="insight-card">
      <div class="card-title">${escapeHtml(item.title)}</div>
      <div class="insight-card__copy">${escapeHtml(item.copy)}</div>
    </article>
  `).join('');
}

function renderInspector(run) {
  const node = getSelectedNode();
  if (!node) {
    elements.heroPreview.innerHTML = '<div class="empty-state">Select a node to inspect its summary, graph context, and markdown projection.</div>';
    elements.nodeDetail.innerHTML = '';
    elements.markdownPreview.textContent = '';
    return;
  }

  elements.heroPreview.innerHTML = `
    <div class="hero-preview__title">${escapeHtml(node.title)}</div>
    <div class="hero-preview__copy">${escapeHtml(node.summary)}</div>
    <div class="chip-row">
      <span class="chip chip--primary">${escapeHtml(node.source)}</span>
      <span class="chip chip--accent">${escapeHtml(node.origin)}</span>
      <span class="chip chip--success">confidence ${formatNumber(node.confidence, 2)}</span>
      <span class="chip chip--warning">importance ${formatNumber(node.importance, 2)}</span>
    </div>
  `;

  const sections = [
    {
      title: 'Graph role',
      body: `${node.title} has ${degreeForNode(node.id)} visible graph connections. ${run.bestBranch ? `${run.bestBranch.label} is currently the highest-confidence reasoning path.` : ''}`,
      list: node.relations.slice(0, 6),
    },
    {
      title: 'Facts',
      body: 'Structured facts are already normalized for retrieval and inspection.',
      list: node.facts,
    },
    {
      title: 'Evidence',
      body: 'Evidence lines are the best trigger for a history-verification branch.',
      list: node.evidence,
    },
  ];

  elements.nodeDetail.innerHTML = sections.map((section) => `
    <article class="detail-card">
      <div class="detail-card__title">${escapeHtml(section.title)}</div>
      <div class="detail-card__copy">${escapeHtml(section.body)}</div>
      ${section.list.length ? `<ul class="detail-card__list">${section.list.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : '<div class="detail-card__copy">No items available.</div>'}
    </article>
  `).join('');

  elements.markdownPreview.textContent = generateMarkdown(node);
}

function renderStrategyGuide(run) {
  elements.strategyLoop.innerHTML = strategyGuide.loopModes.map((item) => `
    <article class="loop-card">
      <div class="chip chip--${escapeHtml(item.accent)}">${escapeHtml(item.title)}</div>
      <div class="detail-card__copy">${escapeHtml(item.summary)}</div>
      <div class="detail-card__copy">${escapeHtml(item.detail)}</div>
    </article>
  `).join('');

  elements.toolOrder.innerHTML = strategyGuide.toolOrder.map((tool) => `
    <article class="tool-card">
      <div class="node-card__head">
        <span class="tool-card__order">${tool.order}</span>
        <div class="tool-card__title">${escapeHtml(tool.name)}</div>
      </div>
      <div class="tool-card__copy">${escapeHtml(tool.purpose)}</div>
      <div class="tool-card__copy">${escapeHtml(tool.usage)}</div>
    </article>
  `).join('');

  if (!run.node) {
    elements.branchRuns.innerHTML = '<div class="empty-state">Select a node to project branch alternatives.</div>';
    elements.branchGraph.innerHTML = '';
    elements.activityList.innerHTML = '';
    elements.memoryList.innerHTML = '';
    return;
  }

  const activeBranchId = state.selectedBranchId || run.bestBranch?.id || run.branches[0]?.id;
  state.selectedBranchId = activeBranchId;
  const activeBranch = run.branches.find((branch) => branch.id === activeBranchId) || run.bestBranch;

  elements.branchRuns.innerHTML = run.branches.map((branch) => `
    <article class="branch-summary ${branch.id === activeBranchId ? 'is-active' : ''}" data-branch-id="${escapeHtml(branch.id)}">
      <div class="branch-summary__title">${escapeHtml(branch.label)}</div>
      <div class="branch-summary__copy">${escapeHtml(branch.verdict)}</div>
      <div class="branch-summary__meta">
        <span class="chip chip--accent">${escapeHtml(branch.id)}</span>
        <span class="chip chip--primary">${formatNumber(branch.confidence, 2)} confidence</span>
        <span class="chip chip--${branch.saveRecommended ? 'success' : 'warning'}">${branch.saveRecommended ? 'save-worthy' : 'validation only'}</span>
      </div>
    </article>
  `).join('');

  for (const card of elements.branchRuns.querySelectorAll('[data-branch-id]')) {
    card.addEventListener('click', () => {
      state.selectedBranchId = card.getAttribute('data-branch-id');
      render();
    });
  }

  elements.branchGraph.innerHTML = `
    <div class="branch-tree">
      <article class="branch-node">
        <div class="branch-node__title">${escapeHtml(run.root.label)} · ${escapeHtml(run.root.id)}</div>
        <div class="branch-node__copy">${escapeHtml(run.root.goal)}</div>
        <div class="branch-children">
          ${run.branches.map((branch) => `
            <article class="branch-node">
              <div class="branch-node__title">${escapeHtml(branch.label)} · ${escapeHtml(branch.id)}</div>
              <div class="branch-node__copy">${escapeHtml(branch.steps[0].detail)}</div>
              <div class="branch-node__meta">
                <span class="chip chip--primary">${formatNumber(branch.confidence, 2)}</span>
                <span class="chip chip--accent">${escapeHtml(branch.verdict)}</span>
              </div>
            </article>
          `).join('')}
        </div>
      </article>
    </div>
  `;

  elements.activityList.innerHTML = activeBranch.steps.map((step) => `
    <article class="timeline-step timeline-step--${escapeHtml(step.kind)}">
      <div class="branch-node__title">${escapeHtml(step.title)}</div>
      <div class="timeline-step__copy">${escapeHtml(step.detail)}</div>
      <div class="timeline-step__meta">
        <span class="chip chip--${step.kind === 'final' ? 'success' : step.kind === 'action' ? 'warning' : step.kind === 'save' ? 'accent' : 'primary'}">${escapeHtml(step.kind)}</span>
        <span class="chip chip--accent">${escapeHtml(activeBranch.id)}</span>
      </div>
    </article>
  `).join('');

  elements.memoryList.innerHTML = createMemorySaveCards(run).map((card) => `
    <article class="memory-card">
      <div class="memory-card__title">${escapeHtml(card.title)}</div>
      <div class="memory-card__copy">${escapeHtml(card.copy)}</div>
      <div class="memory-card__meta">
        ${card.chips.map((chip) => `<span class="chip chip--accent">${escapeHtml(chip)}</span>`).join('')}
      </div>
    </article>
  `).join('');
}

function renderSchema(node, run) {
  const base = getBaseGraph();
  const sources = {};
  const origins = {};
  for (const item of state.nodes) {
    sources[item.source] = (sources[item.source] || 0) + 1;
    origins[item.origin] = (origins[item.origin] || 0) + 1;
  }
  const topSource = Object.entries(sources).sort((a, b) => b[1] - a[1])[0];
  const topOrigin = Object.entries(origins).sort((a, b) => b[1] - a[1])[0];

  elements.workspaceGlance.innerHTML = [
    {
      title: 'Frontmatter coverage',
      copy: `${state.nodes.length} nodes expose stable identifiers, source attribution, and confidence metadata in markdown projection form.`,
      meta: ['node_id', 'confidence', 'importance', 'source', 'origin'],
    },
    {
      title: 'Dominant source',
      copy: topSource ? `${topSource[0]} contributes ${topSource[1]} visible nodes.` : 'No source metadata loaded.',
      meta: topOrigin ? [`top origin: ${topOrigin[0]}`] : [],
    },
    {
      title: 'Graph shape',
      copy: `${base.nodes.length} graph nodes and ${base.edges.length} edges are available for traversal and synthesis.`,
      meta: [`branch depth ${strategyGuide.budgets.depth}`, `branch width ${strategyGuide.budgets.width}`],
    },
    {
      title: 'Selection fit',
      copy: node ? `${node.title} maps cleanly to facts, relations, evidence, and markdown body.` : 'Select a node to inspect schema fit.',
      meta: run.bestBranch ? [run.bestBranch.label, `${formatNumber(run.bestBranch.confidence, 2)} confidence`] : [],
    },
  ].map((card) => `
    <article class="schema-card">
      <div class="schema-card__title">${escapeHtml(card.title)}</div>
      <div class="schema-card__copy">${escapeHtml(card.copy)}</div>
      <div class="schema-card__meta">
        ${card.meta.map((value) => `<span class="chip chip--primary">${escapeHtml(value)}</span>`).join('')}
      </div>
    </article>
  `).join('');

  elements.pageTree.innerHTML = [
    { title: '1. Markdown note', copy: 'Human-readable note with body text remains the editing surface.' },
    { title: '2. Frontmatter', copy: 'Stable node identity, version, confidence, importance, source, and origin.' },
    { title: '3. Facts section', copy: 'Bullet facts are normalized into structured keys for search and inspection.' },
    { title: '4. Relations section', copy: 'Relation bullets become graph links with target, label, and optional weight.' },
    { title: '5. Evidence section', copy: 'Evidence bullets remain visible for operators and trigger history-aware reasoning.' },
    { title: '6. Graph + CLI', copy: 'The UI renders structure while CodeCLI uses the same graph for branching decisions.' },
  ].map((item) => `
    <article class="pipeline-card">
      <div class="pipeline-card__title">${escapeHtml(item.title)}</div>
      <div class="pipeline-card__copy">${escapeHtml(item.copy)}</div>
    </article>
  `).join('');

  const tags = collectTags(node);
  elements.tagsList.innerHTML = tags.length
    ? tags.map((tag) => `<span class="tag-chip">${escapeHtml(tag)}</span>`).join('')
    : '<div class="empty-state">Tags appear here from source, origin, fact keys, and relation labels.</div>';

  const outline = node ? extractOutline(node.body || node.summary, node.title) : [];
  elements.outlineList.innerHTML = node ? `
    <article class="outline-card">
      <div class="outline-card__title">Outline</div>
      <div class="outline-card__copy">This shows how the selected node reads as a human document.</div>
      <ol class="outline-list">
        ${outline.map((item) => `<li>${escapeHtml(item.title)}</li>`).join('')}
      </ol>
    </article>
  ` : '<div class="empty-state">Select a node to inspect its document outline.</div>';

  const contextCards = [];
  if (node) {
    contextCards.push({
      title: 'Branch synthesis',
      copy: run.synthesis,
      meta: [run.bestBranch?.label || 'no branch', `degree ${degreeForNode(node.id)}`],
    });
  }

  if (state.memoryStream.habits.length) {
    const habit = state.memoryStream.habits[0];
    contextCards.push({
      title: 'Loaded habit',
      copy: habit.summary || habit.details || 'User habit loaded from memory stream.',
      meta: ['memory stream', 'habit'],
    });
  }

  if (!contextCards.length) {
    contextCards.push({
      title: 'No external memory stream',
      copy: 'When a connected workspace or local memory folder is available, habit and behavior pattern summaries will appear here.',
      meta: ['standalone mode'],
    });
  }

  elements.contextMemory.innerHTML = contextCards.map((card) => `
    <article class="context-card">
      <div class="context-card__title">${escapeHtml(card.title)}</div>
      <div class="context-card__copy">${escapeHtml(card.copy)}</div>
      <div class="context-card__meta">
        ${card.meta.map((value) => `<span class="chip chip--accent">${escapeHtml(value)}</span>`).join('')}
      </div>
    </article>
  `).join('');
}

function render() {
  const node = getSelectedNode();
  const run = buildStrategyRun(node);
  renderFilters();
  renderLegend();
  renderMetrics(run);
  renderNodeList();
  renderGraph();
  renderInspector(run);
  renderStrategyGuide(run);
  renderSchema(node, run);

  updateStatus(
    `${state.filtered.length} visible nodes · ${getBaseGraph().edges.length} graph edges`,
    `${state.workspaceLabel}${state.lastLoadedAt ? ` · updated ${formatTimestamp(state.lastLoadedAt)}` : ''}`,
  );
}

async function readJsonlOptional(handle, name) {
  try {
    const fileHandle = await handle.getFileHandle(name);
    const text = await fileHandle.getFile().then((file) => file.text());
    return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

async function getOptionalDirectory(handle, name) {
  try {
    return await handle.getDirectoryHandle(name);
  } catch {
    return null;
  }
}

async function resolveMemoryRoot(dirHandle) {
  const candidates = [];
  candidates.push(dirHandle);
  const memory = await getOptionalDirectory(dirHandle, 'memory');
  if (memory) candidates.push(memory);
  const dotMempedia = await getOptionalDirectory(dirHandle, '.mempedia');
  if (dotMempedia) {
    candidates.push(dotMempedia);
    const nestedMemory = await getOptionalDirectory(dotMempedia, 'memory');
    if (nestedMemory) candidates.push(nestedMemory);
  }

  for (const candidate of candidates) {
    const hasIndex = await getOptionalDirectory(candidate, 'index');
    const hasObjects = await getOptionalDirectory(candidate, 'objects');
    if (hasIndex || hasObjects) return candidate;
  }
  return dirHandle;
}

async function scanMarkdownFiles(dirHandle, prefix = '') {
  const map = {};
  for await (const [name, handle] of dirHandle.entries()) {
    if (handle.kind === 'file' && /\.(md|markdown)$/i.test(name)) {
      map[prefix ? `${prefix}/${name}` : name] = await handle.getFile().then((file) => file.text());
      continue;
    }
    if (handle.kind === 'directory') {
      const nested = await scanMarkdownFiles(handle, prefix ? `${prefix}/${name}` : name);
      Object.assign(map, nested);
    }
  }
  return map;
}

async function loadFiles(fileList) {
  const nodes = await Promise.all(Array.from(fileList).map((file) => file.text().then((text) => parseMarkdownFile(text, file.name))));
  state.connected = false;
  state.canonicalGraph = buildGraphFromNodes(nodes);
  state.memoryStream = createEmptyMemoryStream();
  state.workspaceLabel = 'Markdown import';
  setWorkspaceMode('Imported markdown', 'Static markdown import loaded without live backend sync.');
  setNodes(nodes, { selectedId: nodes[0]?.id || null });
}

async function loadMempediaFolder(dirHandle) {
  try {
    const memoryRoot = await resolveMemoryRoot(dirHandle);
    state.mempediaHandle = memoryRoot;
    state.connected = false;
    setWorkspaceMode('Local folder', 'Browsing local memory files through the File System Access API.');
    updateStatus('Loading local Mempedia folder...');

    let stateJson = null;
    const versionMap = {};
    const memoryStream = createEmptyMemoryStream();
    const indexHandle = await getOptionalDirectory(memoryRoot, 'index');
    if (indexHandle) {
      try {
        const stateFile = await indexHandle.getFileHandle('state.json');
        stateJson = JSON.parse(await stateFile.getFile().then((file) => file.text()));
      } catch {}
      memoryStream.habits = await readJsonlOptional(indexHandle, 'user_habits.jsonl');
      memoryStream.behaviorPatterns = await readJsonlOptional(indexHandle, 'behavior_patterns.jsonl');
      memoryStream.nodeConversations = await readJsonlOptional(indexHandle, 'node_conversations.jsonl');
      memoryStream.agentActions = await readJsonlOptional(indexHandle, 'agent_actions.log');
      memoryStream.accessLogs = await readJsonlOptional(indexHandle, 'access.log');
    }

    const objectsHandle = await getOptionalDirectory(memoryRoot, 'objects');
    if (objectsHandle) {
      for await (const [, bucket] of objectsHandle.entries()) {
        if (bucket.kind !== 'directory') continue;
        for await (const [fileName, fileHandle] of bucket.entries()) {
          if (!fileName.endsWith('.json')) continue;
          versionMap[fileName.replace('.json', '')] = JSON.parse(await fileHandle.getFile().then((file) => file.text()));
        }
      }
    }

    const knowledgeRoot = (await getOptionalDirectory(memoryRoot, 'knowledge')) || memoryRoot;
    const nodesHandle = knowledgeRoot === memoryRoot ? knowledgeRoot : (await getOptionalDirectory(knowledgeRoot, 'nodes')) || knowledgeRoot;
    const markdownMap = await scanMarkdownFiles(nodesHandle);
    const nodes = stateJson ? buildNodesFromMempedia(stateJson, versionMap, markdownMap) : Object.entries(markdownMap).map(([name, markdown]) => parseMarkdownFile(markdown, name));

    state.memoryStream = memoryStream;
    state.workspaceLabel = 'Local Mempedia folder';
    state.canonicalGraph = stateJson ? buildCanonicalGraph(stateJson?.heads || {}, versionMap, nodes) : buildGraphFromNodes(nodes);
    setNodes(nodes, { selectedId: nodes[0]?.id || null });
  } catch (error) {
    console.error(error);
    updateStatus('Failed to load local Mempedia folder.', 'Check browser console or try selecting the memory root again.');
  }
}

async function refreshWorkspace() {
  const response = await fetch('/api/memory/snapshot');
  const payload = await response.json();
  if (!response.ok || !payload.ok) throw new Error(payload.error || 'Failed to refresh connected workspace');

  const versionMap = Object.fromEntries(payload.versions || []);
  const nodes = buildNodesFromSnapshot(payload);
  state.connected = true;
  state.memoryRoot = payload.memoryRoot || null;
  state.memoryStream = {
    habits: payload.habits || [],
    behaviorPatterns: payload.behaviorPatterns || [],
    nodeConversations: payload.nodeConversations || [],
    conversations: payload.conversations || [],
    agentActions: payload.agentActions || [],
    accessLogs: payload.accessLogs || [],
  };
  state.workspaceLabel = payload.memoryRoot ? `Connected workspace · ${payload.memoryRoot}` : 'Connected workspace';
  state.canonicalGraph = buildCanonicalGraph(payload.snapshot?.heads || {}, versionMap, nodes);
  setWorkspaceMode('Connected workspace', 'Live snapshot loaded from the integrated UI bridge.');
  setNodes(nodes, { selectedId: state.selectedId || nodes[0]?.id || null });
}

async function bootstrapConnectedWorkspace() {
  try {
    const response = await fetch('/api/cli/status');
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.error || 'Not connected');
    state.connected = true;
    state.memoryRoot = payload.memoryRoot || null;
    setWorkspaceMode('Connected workspace', 'Live Mempedia snapshot and CodeCLI bridge are available.');
    await refreshWorkspace();
  } catch {
    state.connected = false;
    setWorkspaceMode('Standalone mode', 'Load a local folder or use the demo graph.');
    loadDemo();
  }
}

function loadDemo() {
  state.connected = false;
  state.memoryRoot = null;
  state.memoryStream = {
    habits: [{ summary: 'Operator repeatedly inspects graph structure before editing markdown bodies.' }],
    behaviorPatterns: [{ summary: 'Branching explanations are easier to validate when relation labels stay visible next to the graph.' }],
    nodeConversations: [],
    conversations: [],
    agentActions: [],
    accessLogs: [],
  };
  state.workspaceLabel = 'Bundled focus demo';
  state.canonicalGraph = buildGraphFromNodes(demoNodes);
  setWorkspaceMode('Demo mode', 'A curated graph highlighting Mempedia structure and CodeCLI branching strategy is loaded.');
  setNodes(demoNodes, { selectedId: demoNodes[0].id });
}

function clearAll() {
  state.nodes = [];
  state.filtered = [];
  state.selectedId = null;
  state.selectedBranchId = null;
  state.query = '';
  state.sourceFilter = 'all';
  state.originFilter = 'all';
  state.graphScope = 'selected';
  state.canonicalGraph = createEmptyGraph();
  state.memoryStream = createEmptyMemoryStream();
  state.workspaceLabel = 'Standalone viewer';
  state.lastLoadedAt = null;
  render();
}

function exportJson() {
  const payload = {
    exportedAt: new Date().toISOString(),
    workspaceLabel: state.workspaceLabel,
    nodes: state.filtered,
    graph: getVisibleGraph(),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'mempedia-graph-view.json';
  link.click();
  URL.revokeObjectURL(url);
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

elements.loadDemo.addEventListener('click', () => {
  loadDemo();
});

elements.loadFolder.addEventListener('click', async () => {
  try {
    const dirHandle = await window.showDirectoryPicker();
    await loadMempediaFolder(dirHandle);
  } catch (error) {
    if (error?.name !== 'AbortError') {
      console.error(error);
      updateStatus('Opening local folder failed.', 'Check browser permissions or retry selecting the memory root.');
    }
  }
});

elements.refreshWorkspace.addEventListener('click', async () => {
  if (!state.connected) {
    updateStatus('No connected workspace is available.', 'Start the integrated UI bridge or open a local folder instead.');
    return;
  }
  try {
    await refreshWorkspace();
  } catch (error) {
    console.error(error);
    updateStatus('Refresh failed.', error.message || 'Unable to refresh the connected workspace.');
  }
});

elements.fileInput.addEventListener('change', (event) => {
  if (!event.target.files?.length) return;
  void loadFiles(event.target.files);
});

elements.clearAll.addEventListener('click', () => {
  clearAll();
});

elements.exportJson.addEventListener('click', () => {
  exportJson();
});

render();
void bootstrapConnectedWorkspace();
