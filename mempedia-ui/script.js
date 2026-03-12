const SVG_NS = "http://www.w3.org/2000/svg";

const elements = {
  folderInput: document.getElementById('folder-input'),
  rootSelect: document.getElementById('root-select'),
  loadBtn: document.getElementById('load-btn'),
  status: document.getElementById('status'),
  metricNodes: document.getElementById('metric-nodes'),
  metricEdges: document.getElementById('metric-edges'),
  metricVersions: document.getElementById('metric-versions'),
  metricAccess: document.getElementById('metric-access'),
  nodeSearch: document.getElementById('node-search'),
  nodeCount: document.getElementById('node-count'),
  nodeList: document.getElementById('node-list'),
  edgeList: document.getElementById('edge-list'),
  tabs: Array.from(document.querySelectorAll('.tab')),
  tabPanels: {
    graph: document.getElementById('tab-graph'),
    node: document.getElementById('tab-node'),
    habits: document.getElementById('tab-habits'),
    patterns: document.getElementById('tab-patterns'),
    conversations: document.getElementById('tab-conversations')
  },
  layoutSelect: document.getElementById('layout-select'),
  scopeSelect: document.getElementById('graph-scope'),
  reheatBtn: document.getElementById('reheat-btn'),
  canvas: document.getElementById('graph-canvas'),
  nodeTitle: document.getElementById('node-title'),
  nodeMeta: document.getElementById('node-meta'),
  nodeBody: document.getElementById('node-body'),
  nodeStructured: document.getElementById('node-structured'),
  nodeOutgoing: document.getElementById('node-outgoing'),
  nodeIncoming: document.getElementById('node-incoming'),
  versionList: document.getElementById('version-list'),
  habitsList: document.getElementById('habits-list'),
  patternsList: document.getElementById('patterns-list'),
  conversationNodeLabel: document.getElementById('conversation-node-label'),
  conversationList: document.getElementById('conversation-list'),
  conversationDetail: document.getElementById('conversation-detail')
};

const app = {
  fileMap: new Map(),
  roots: [],
  currentRoot: '',
  snapshot: { heads: {}, nodes: {} },
  versions: new Map(),
  accessLogs: [],
  habits: [],
  patterns: [],
  nodeConversations: new Map(),
  conversationFiles: new Map(),
  conversations: new Map(),
  model: {
    nodes: [],
    nodeById: new Map(),
    edges: [],
    outgoing: new Map(),
    incoming: new Map(),
    versionsByNode: new Map()
  },
  selectedNodeId: null,
  searchQuery: '',
  graph: {
    nodes: [],
    edges: [],
    running: false,
    width: 1200,
    height: 720,
    alpha: 1
  }
};

function normalizePath(path) {
  return String(path || '').replace(/\\/g, '/');
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatTimestamp(seconds) {
  const n = Number(seconds);
  if (!Number.isFinite(n) || n <= 0) return 'unknown';
  return new Date(n * 1000).toLocaleString('zh-CN');
}

function setStatus(text) {
  elements.status.textContent = text;
}

function buildFileMap(files) {
  const map = new Map();
  Array.from(files).forEach((file) => {
    const rel = normalizePath(file.webkitRelativePath || file.name);
    map.set(rel, file);
  });
  return map;
}

function detectStorageRoots(paths) {
  const stateSuffix = 'index/state.json';
  const roots = new Set();
  paths.forEach((p) => {
    if (p.endsWith(stateSuffix)) {
      roots.add(p.slice(0, -stateSuffix.length));
    }
  });
  return Array.from(roots).map(normalizePath).sort();
}

function updateRootSelect() {
  elements.rootSelect.innerHTML = '';
  if (app.roots.length === 0) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = '未检测到存储根';
    elements.rootSelect.appendChild(option);
    elements.rootSelect.disabled = true;
    return;
  }
  elements.rootSelect.disabled = false;
  app.roots.forEach((root) => {
    const option = document.createElement('option');
    option.value = root;
    option.textContent = root || '(当前目录)';
    elements.rootSelect.appendChild(option);
  });
  elements.rootSelect.value = app.currentRoot;
}

async function readJsonOptional(relativePath) {
  const file = app.fileMap.get(relativePath);
  if (!file) return null;
  return JSON.parse(await file.text());
}

async function readTextOptional(relativePath) {
  const file = app.fileMap.get(relativePath);
  if (!file) return null;
  return await file.text();
}

async function readJsonLines(relativePath) {
  const file = app.fileMap.get(relativePath);
  if (!file) return [];
  const text = await file.text();
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try { out.push(JSON.parse(trimmed)); } catch {}
  }
  return out;
}

function buildModel(snapshot, versions) {
  const heads = snapshot.heads || {};
  const nodes = snapshot.nodes || {};
  const nodeIds = new Set([...Object.keys(heads), ...Object.keys(nodes)]);
  const edges = [];
  const outgoing = new Map();
  const incoming = new Map();
  const versionsByNode = new Map();

  versions.forEach((ver, id) => {
    const nodeId = ver.node_id;
    if (!nodeId) return;
    if (!versionsByNode.has(nodeId)) versionsByNode.set(nodeId, []);
    versionsByNode.get(nodeId).push({ id, ...ver });
    nodeIds.add(nodeId);
  });

  Object.entries(heads).forEach(([nodeId, versionId]) => {
    const ver = versions.get(versionId);
    if (!ver) return;
    const links = Array.isArray(ver.content?.links) ? ver.content.links : [];
    links.forEach((link) => {
      if (!link?.target) return;
      edges.push({ source: nodeId, target: link.target, label: link.label || 'link' });
      if (!outgoing.has(nodeId)) outgoing.set(nodeId, []);
      outgoing.get(nodeId).push({ target: link.target, label: link.label });
      if (!incoming.has(link.target)) incoming.set(link.target, []);
      incoming.get(link.target).push({ source: nodeId, label: link.label });
      nodeIds.add(link.target);
    });
  });

  const nodeList = Array.from(nodeIds).map((id) => {
    const headId = heads[id];
    const head = headId ? versions.get(headId) : null;
    const title = head?.content?.title || id;
    return {
      id,
      title,
      headVersion: head,
      inDegree: incoming.get(id)?.length || 0,
      outDegree: outgoing.get(id)?.length || 0
    };
  }).sort((a, b) => a.id.localeCompare(b.id));

  return {
    nodes: nodeList,
    nodeById: new Map(nodeList.map(n => [n.id, n])),
    edges,
    outgoing,
    incoming,
    versionsByNode
  };
}

function renderNodeList() {
  const query = app.searchQuery.toLowerCase();
  const filtered = app.model.nodes.filter(n => n.id.toLowerCase().includes(query) || n.title.toLowerCase().includes(query));
  elements.nodeCount.textContent = `${filtered.length} nodes`;
  elements.nodeList.innerHTML = '';
  filtered.forEach((node) => {
    const div = document.createElement('div');
    div.className = 'node-item' + (node.id === app.selectedNodeId ? ' active' : '');
    div.innerHTML = `<strong>${escapeHtml(node.title)}</strong><div>${escapeHtml(node.id)}</div>`;
    div.onclick = () => selectNode(node.id);
    elements.nodeList.appendChild(div);
  });
}

function renderEdgeList() {
  elements.edgeList.innerHTML = '';
  app.model.edges.slice(0, 300).forEach((edge) => {
    const div = document.createElement('div');
    div.className = 'edge-item';
    div.textContent = `${edge.source} → ${edge.target} (${edge.label})`;
    elements.edgeList.appendChild(div);
  });
}

function renderNodeDetail(nodeId) {
  const node = app.model.nodeById.get(nodeId);
  if (!node) return;
  elements.nodeTitle.textContent = node.title || node.id;
  elements.nodeMeta.textContent = `ID: ${node.id} | in: ${node.inDegree} out: ${node.outDegree}`;

  const content = node.headVersion?.content || {};
  elements.nodeBody.innerHTML = content.body ? escapeHtml(content.body).replace(/\n/g, '<br>') : 'No body';

  elements.nodeStructured.innerHTML = '';
  const structured = content.structured_data || {};
  const entries = Object.entries(structured);
  if (entries.length === 0) {
    elements.nodeStructured.innerHTML = '<tr><td>empty</td><td></td></tr>';
  } else {
    entries.forEach(([k, v]) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<th>${escapeHtml(k)}</th><td>${escapeHtml(String(v))}</td>`;
      elements.nodeStructured.appendChild(tr);
    });
  }

  const out = app.model.outgoing.get(nodeId) || [];
  const inc = app.model.incoming.get(nodeId) || [];
  elements.nodeOutgoing.innerHTML = out.length ? '' : '<span class="chip">None</span>';
  out.forEach((o) => {
    const span = document.createElement('span');
    span.className = 'chip';
    span.textContent = o.target;
    span.onclick = () => selectNode(o.target);
    elements.nodeOutgoing.appendChild(span);
  });
  elements.nodeIncoming.innerHTML = inc.length ? '' : '<span class="chip">None</span>';
  inc.forEach((o) => {
    const span = document.createElement('span');
    span.className = 'chip';
    span.textContent = o.source;
    span.onclick = () => selectNode(o.source);
    elements.nodeIncoming.appendChild(span);
  });

  const versions = app.model.versionsByNode.get(nodeId) || [];
  elements.versionList.innerHTML = '';
  versions.slice().reverse().forEach((v) => {
    const li = document.createElement('li');
    li.textContent = `${formatTimestamp(v.timestamp)} | ${v.version || v.id}`;
    elements.versionList.appendChild(li);
  });
}

function renderHabits() {
  elements.habitsList.innerHTML = '';
  if (!app.habits.length) {
    elements.habitsList.innerHTML = '<div class="card">No habits</div>';
    return;
  }
  app.habits.slice().reverse().forEach((h) => {
    const div = document.createElement('div');
    div.className = 'card';
    div.innerHTML = `<strong>${escapeHtml(h.topic)}</strong><div>${escapeHtml(h.summary)}</div><div>${escapeHtml(h.details)}</div>`;
    elements.habitsList.appendChild(div);
  });
}

function renderPatterns() {
  elements.patternsList.innerHTML = '';
  if (!app.patterns.length) {
    elements.patternsList.innerHTML = '<div class="card">No patterns</div>';
    return;
  }
  app.patterns.slice().reverse().forEach((p) => {
    const div = document.createElement('div');
    div.className = 'card';
    div.innerHTML = `<strong>${escapeHtml(p.pattern_key)}</strong><div>${escapeHtml(p.summary)}</div><div>${escapeHtml(p.details)}</div>`;
    elements.patternsList.appendChild(div);
  });
}

function renderConversations(nodeId) {
  elements.conversationNodeLabel.textContent = nodeId ? `Node: ${nodeId}` : '未选择节点';
  elements.conversationList.innerHTML = '';
  elements.conversationDetail.textContent = '';
  if (!nodeId) return;
  const items = app.nodeConversations.get(nodeId) || [];
  if (!items.length) {
    elements.conversationList.innerHTML = '<li>None</li>';
    return;
  }
  items.forEach((item) => {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = '#';
    a.textContent = item.conversation_id;
    a.onclick = (e) => {
      e.preventDefault();
      showConversation(item.conversation_id);
    };
    li.appendChild(a);
    elements.conversationList.appendChild(li);
  });
}

async function showConversation(conversationId) {
  const cached = app.conversations.get(conversationId);
  if (cached) {
    elements.conversationDetail.textContent = JSON.stringify(cached, null, 2);
    return;
  }
  const path = app.conversationFiles.get(conversationId);
  if (!path) {
    elements.conversationDetail.textContent = 'Not found';
    return;
  }
  const data = await readJsonOptional(path);
  if (!data) {
    elements.conversationDetail.textContent = 'Unreadable';
    return;
  }
  app.conversations.set(conversationId, data);
  elements.conversationDetail.textContent = JSON.stringify(data, null, 2);
}

function switchTab(tab) {
  elements.tabs.forEach((t) => t.classList.remove('active'));
  document.querySelector(`.tab[data-tab="${tab}"]`).classList.add('active');
  Object.entries(elements.tabPanels).forEach(([key, panel]) => {
    panel.classList.toggle('active', key === tab);
  });
}

function selectNode(nodeId) {
  app.selectedNodeId = nodeId;
  renderNodeList();
  renderNodeDetail(nodeId);
  renderConversations(nodeId);
  if (elements.scopeSelect.value === 'selected') {
    buildGraph();
  }
}

function buildGraph() {
  const scope = elements.scopeSelect.value;
  let nodes = app.model.nodes;
  let edges = app.model.edges;
  if (scope === 'selected' && app.selectedNodeId) {
    const id = app.selectedNodeId;
    const neighborhood = new Set([id]);
    (app.model.outgoing.get(id) || []).forEach(e => neighborhood.add(e.target));
    (app.model.incoming.get(id) || []).forEach(e => neighborhood.add(e.source));
    nodes = nodes.filter(n => neighborhood.has(n.id));
    edges = edges.filter(e => neighborhood.has(e.source) && neighborhood.has(e.target));
  }

  app.graph.nodes = nodes.map((n) => ({
    id: n.id,
    label: n.title || n.id,
    tracked: Boolean(app.snapshot.heads[n.id]),
    x: Math.random() * app.graph.width,
    y: Math.random() * app.graph.height,
    vx: 0,
    vy: 0
  }));
  const nodeIndex = new Map(app.graph.nodes.map(n => [n.id, n]));
  app.graph.edges = edges.map((e) => ({
    source: nodeIndex.get(e.source),
    target: nodeIndex.get(e.target)
  })).filter(e => e.source && e.target);

  if (elements.layoutSelect.value === 'radial') {
    const center = { x: app.graph.width / 2, y: app.graph.height / 2 };
    const radius = Math.min(app.graph.width, app.graph.height) * 0.35;
    app.graph.nodes.forEach((n, i) => {
      const angle = (i / app.graph.nodes.length) * Math.PI * 2;
      n.x = center.x + Math.cos(angle) * radius;
      n.y = center.y + Math.sin(angle) * radius;
    });
    drawGraph();
  } else {
    app.graph.alpha = 1;
    if (!app.graph.running) {
      app.graph.running = true;
      requestAnimationFrame(tickGraph);
    }
  }
}

function tickGraph() {
  const alpha = app.graph.alpha;
  if (alpha < 0.02) {
    app.graph.running = false;
    drawGraph();
    return;
  }
  const k = 0.05;
  const centerX = app.graph.width / 2;
  const centerY = app.graph.height / 2;

  app.graph.nodes.forEach((n) => {
    n.vx += (centerX - n.x) * 0.0005;
    n.vy += (centerY - n.y) * 0.0005;
  });

  app.graph.edges.forEach((e) => {
    const dx = e.target.x - e.source.x;
    const dy = e.target.y - e.source.y;
    const dist = Math.sqrt(dx * dx + dy * dy) + 0.1;
    const force = (dist - 120) * k * 0.01;
    const fx = (dx / dist) * force;
    const fy = (dy / dist) * force;
    e.source.vx += fx;
    e.source.vy += fy;
    e.target.vx -= fx;
    e.target.vy -= fy;
  });

  for (let i = 0; i < app.graph.nodes.length; i++) {
    for (let j = i + 1; j < app.graph.nodes.length; j++) {
      const a = app.graph.nodes[i];
      const b = app.graph.nodes[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) + 0.1;
      const repulse = 300 / (dist * dist);
      const rx = (dx / dist) * repulse;
      const ry = (dy / dist) * repulse;
      a.vx -= rx;
      a.vy -= ry;
      b.vx += rx;
      b.vy += ry;
    }
  }

  app.graph.nodes.forEach((n) => {
    n.x += n.vx;
    n.y += n.vy;
    n.vx *= 0.85;
    n.vy *= 0.85;
  });

  app.graph.alpha *= 0.95;
  drawGraph();
  requestAnimationFrame(tickGraph);
}

function drawGraph() {
  const canvas = elements.canvas;
  const ctx = canvas.getContext('2d');
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * devicePixelRatio;
  canvas.height = rect.height * devicePixelRatio;
  ctx.scale(devicePixelRatio, devicePixelRatio);

  ctx.clearRect(0, 0, rect.width, rect.height);
  ctx.strokeStyle = '#9aa7b3';
  ctx.lineWidth = 1;
  app.graph.edges.forEach((e) => {
    ctx.beginPath();
    ctx.moveTo(e.source.x, e.source.y);
    ctx.lineTo(e.target.x, e.target.y);
    ctx.stroke();
  });

  app.graph.nodes.forEach((n) => {
    ctx.beginPath();
    ctx.fillStyle = n.tracked ? '#2a5bd7' : '#94b0ff';
    ctx.arc(n.x, n.y, 6, 0, Math.PI * 2);
    ctx.fill();
  });
}

function renderAll() {
  elements.metricNodes.textContent = app.model.nodes.length;
  elements.metricEdges.textContent = app.model.edges.length;
  elements.metricVersions.textContent = app.versions.size;
  elements.metricAccess.textContent = app.accessLogs.length;
  renderNodeList();
  renderEdgeList();
  renderHabits();
  renderPatterns();
  buildGraph();
  if (app.selectedNodeId) {
    renderNodeDetail(app.selectedNodeId);
    renderConversations(app.selectedNodeId);
  }
}

// events

elements.folderInput.addEventListener('change', (e) => {
  const files = e.target.files;
  if (!files || files.length === 0) return;
  app.fileMap = buildFileMap(files);
  const paths = Array.from(app.fileMap.keys());
  app.roots = detectStorageRoots(paths);
  app.currentRoot = app.roots[0] || '';
  updateRootSelect();
  setStatus(app.roots.length ? `Found ${app.roots.length} roots.` : 'No compatible data.');
});

elements.loadBtn.addEventListener('click', async () => {
  if (!app.currentRoot) return;
  const root = app.currentRoot;
  setStatus('Loading data...');
  const state = await readJsonOptional(`${root}index/state.json`);
  const heads = await readJsonOptional(`${root}index/heads.json`);
  const nodes = await readJsonOptional(`${root}index/nodes.json`);
  app.snapshot = { heads: heads || state?.heads || {}, nodes: nodes || state?.nodes || {} };
  app.accessLogs = await readJsonLines(`${root}index/access.log`);
  app.habits = await readJsonLines(`${root}index/user_habits.jsonl`);
  app.patterns = await readJsonLines(`${root}index/behavior_patterns.jsonl`);
  const nodeConversations = await readJsonLines(`${root}index/node_conversations.jsonl`);
  app.nodeConversations = new Map();
  nodeConversations.forEach((row) => {
    if (!row?.node_id) return;
    const list = app.nodeConversations.get(row.node_id) || [];
    list.push(row);
    app.nodeConversations.set(row.node_id, list);
  });
  app.conversationFiles = new Map();
  app.conversations = new Map();
  const convFiles = Array.from(app.fileMap.keys()).filter(p => p.startsWith(`${root}index/conversations/`) && p.endsWith('.json'));
  convFiles.forEach((p) => {
    const id = p.split('/').pop()?.replace(/\.json$/, '');
    if (id) app.conversationFiles.set(id, p);
  });

  app.versions.clear();
  const versionFiles = Array.from(app.fileMap.keys()).filter(p => p.startsWith(`${root}objects/`) && p.endsWith('.json'));
  for (const p of versionFiles) {
    const ver = await readJsonOptional(p);
    if (!ver) continue;
    const fileId = p.split('/').pop()?.replace(/\.json$/, '');
    const versionId = ver.version || ver.id || fileId;
    if (!versionId) continue;
    app.versions.set(versionId, { ...ver, version: versionId });
  }

  app.model = buildModel(app.snapshot, app.versions);
  app.selectedNodeId = app.model.nodes[0]?.id || null;
  renderAll();
  setStatus(`Loaded ${app.model.nodes.length} nodes, ${app.model.edges.length} edges.`);
});


elements.rootSelect.addEventListener('change', () => {
  app.currentRoot = elements.rootSelect.value;
});

elements.nodeSearch.addEventListener('input', () => {
  app.searchQuery = elements.nodeSearch.value || '';
  renderNodeList();
});

elements.tabs.forEach((tab) => {
  tab.addEventListener('click', () => switchTab(tab.dataset.tab));
});

elements.layoutSelect.addEventListener('change', buildGraph);

elements.scopeSelect.addEventListener('change', buildGraph);

elements.reheatBtn.addEventListener('click', () => {
  app.graph.alpha = 1;
  if (!app.graph.running) {
    app.graph.running = true;
    requestAnimationFrame(tickGraph);
  }
});

// init
switchTab('graph');
