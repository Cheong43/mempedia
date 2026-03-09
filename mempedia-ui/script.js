const SVG_NS = "http://www.w3.org/2000/svg";
const STORAGE_LANG_KEY = "mempedia_ui_lang";

const I18N = {
  en: {
    skipToMain: "Skip to main content",
    pageTitle: "Project Memory Graph Encyclopedia",
    pageSubtitle:
      "Browse nodes like a wiki page and inspect relationships with version evolution.",
    languageLabel: "Language",
    importData: "Import Data",
    chooseFolder: "Choose Folder",
    storageRoot: "Storage Root",
    parseBtn: "Parse",
    importHint:
      "Prefer selecting <code>.mempedia/memory</code> directly (compatible with <code>data</code> layout).",
    statusWaiting: "Waiting for folder import...",
    metricNodes: "Nodes",
    metricEdges: "Edges",
    metricVersions: "Versions",
    metricAccess: "Access Logs",
    keywordSearchTitle: "Knowledge Search",
    keywordQuery: "Keyword Query",
    keywordSearchBtn: "Search",
    keywordClearBtn: "Clear",
    keywordSummaryDefault: "Enter keywords to run ranked retrieval over current heads.",
    keywordPlaceholder: "Search across title/body/markdown",
    keywordNoResults: "No matched results.",
    keywordResults: "{count} results for \"{query}\"",
    keywordEmpty: "Please enter a keyword query.",
    articleNone: "No node selected",
    articleGuide: "Import data, then choose a node from the index on the right.",
    summary: "Summary",
    noContent: "No content yet.",
    structuredFields: "Structured Fields",
    field: "Field",
    value: "Value",
    highlightsTitle: "Highlights",
    relatedLinks: "Related Links",
    outgoingNodes: "Outgoing",
    incomingNodes: "Incoming",
    versionTimeline: "Version Timeline",
    markdownProjection: "Markdown Projection",
    markdownMissing: "No markdown projection file for this node.",
    markdownPath: "Path",
    markdownFallback: "Showing generated fallback markdown from current version.",
    agentAudit: "Agent Audit",
    auditEmpty: "No agent actions for this node.",
    auditAction: "Action",
    auditReason: "Reason",
    auditSource: "Source",
    nodeIndex: "Node Index",
    searchNodes: "Search Nodes",
    relationView: "Relation View (Current Node)",
    versionDag: "Version DAG (Current Node)",
    rootNotDetected: "No storage roots detected",
    currentDirectory: "(current directory)",
    statusRootsDetected: "Detected {count} storage root(s). Please click Parse.",
    statusNoRoots: "No compatible storage structure found.",
    statusMissingFolder: "Please choose a folder first.",
    statusParsing: "Parsing files...",
    statusReady:
      "Loaded {nodes} nodes, {edges} edges, {versions} versions, {audits} audit logs.",
    statusNoSnapshot: "Missing index files (state.json or heads/nodes).",
    statusParseFailed: "Parse failed: {message}",
    nodeCount: "{filtered} / {total} nodes",
    nodeCountOnly: "{total} nodes",
    noNodeMatched: "No matching node.",
    nodeTitleEmpty: "(untitled)",
    trackedNode: "tracked",
    referencedNode: "referenced",
    none: "None",
    noStructuredFields: "No structured fields",
    referencedWithoutHead: "This node is referenced but has no independent head content yet.",
    trackedWithoutBody: "This node currently has no body content.",
    relationHint: "Select a node to show relation view",
    versionHint: "Select a node to show version DAG",
    timelineEmpty: "No version records",
    rollbackTemplate: "Rollback Template",
    actionBuilder: "Action Builder",
    agentId: "Agent ID",
    actionReason: "Reason",
    actionSource: "Source",
    actionConfidence: "Confidence",
    actionImportance: "Importance",
    actionMarkdown: "Markdown Content",
    generateUpsert: "Generate Upsert JSON",
    generateRollback: "Generate Rollback JSON",
    copyAction: "Copy JSON",
    rollbackTargetNone: "Rollback target: not selected",
    rollbackTargetSet: "Rollback target: {version}",
    actionNeedNode: "Select a node first.",
    actionNeedReason: "Please fill Reason.",
    actionNeedMarkdown: "Please fill Markdown content.",
    actionRollbackNeedTarget: "Choose target version from timeline first.",
    actionCopyDone: "Action JSON copied to clipboard.",
    actionCopyFailed: "Copy failed. Select and copy manually.",
    actionGenerated: "Action JSON generated.",
    actionPreviewEmpty: "Generated action JSON will appear here.",
    metaNodeId: "Node ID",
    metaHead: "Head",
    metaUpdated: "Updated",
    metaConfidence: "Confidence",
    metaImportance: "Importance",
    metaAccess: "Access",
    versionTime: "Time",
    versionParents: "Parents",
    searchPlaceholder: "Filter by ID or title",
  },
  "zh-CN": {
    skipToMain: "跳到主要内容",
    pageTitle: "项目记忆图谱百科页",
    pageSubtitle: "像 Wiki 一样阅读节点内容，并查看关联关系与版本演进。",
    languageLabel: "语言",
    importData: "导入数据",
    chooseFolder: "选择目录",
    storageRoot: "存储根",
    parseBtn: "解析",
    importHint: "推荐直接选择 <code>.mempedia/memory</code>（兼容 <code>data</code> 布局）。",
    statusWaiting: "等待导入目录...",
    metricNodes: "节点",
    metricEdges: "关系边",
    metricVersions: "版本",
    metricAccess: "访问日志",
    keywordSearchTitle: "知识检索",
    keywordQuery: "关键词",
    keywordSearchBtn: "检索",
    keywordClearBtn: "清空",
    keywordSummaryDefault: "输入关键词，对当前 head 节点执行排序检索。",
    keywordPlaceholder: "搜索标题/正文/Markdown",
    keywordNoResults: "没有匹配结果。",
    keywordResults: "“{query}” 共 {count} 条结果",
    keywordEmpty: "请先输入关键词。",
    articleNone: "未选择节点",
    articleGuide: "导入后从右侧索引选择节点。",
    summary: "摘要",
    noContent: "暂无内容。",
    structuredFields: "结构化字段",
    field: "字段",
    value: "值",
    highlightsTitle: "高亮",
    relatedLinks: "本文关联",
    outgoingNodes: "指向节点",
    incomingNodes: "被引用来源",
    versionTimeline: "版本时间线",
    markdownProjection: "Markdown 投影",
    markdownMissing: "该节点暂无 markdown 投影文件。",
    markdownPath: "路径",
    markdownFallback: "当前显示基于版本内容生成的 markdown 回退视图。",
    agentAudit: "智能体审计",
    auditEmpty: "该节点暂无智能体操作日志。",
    auditAction: "动作",
    auditReason: "原因",
    auditSource: "来源",
    nodeIndex: "节点索引",
    searchNodes: "搜索节点",
    relationView: "关系视图（当前节点）",
    versionDag: "版本 DAG（当前节点）",
    rootNotDetected: "未检测到存储目录",
    currentDirectory: "（当前目录）",
    statusRootsDetected: "检测到 {count} 个存储根，请点击解析。",
    statusNoRoots: "未找到兼容的存储结构。",
    statusMissingFolder: "请先选择目录。",
    statusParsing: "正在解析文件...",
    statusReady: "已加载 {nodes} 个节点、{edges} 条边、{versions} 个版本、{audits} 条审计日志。",
    statusNoSnapshot: "缺少索引文件（state.json 或 heads/nodes）。",
    statusParseFailed: "解析失败：{message}",
    nodeCount: "{filtered} / {total} 个节点",
    nodeCountOnly: "{total} 个节点",
    noNodeMatched: "没有匹配节点。",
    nodeTitleEmpty: "（无标题）",
    trackedNode: "主节点",
    referencedNode: "引用节点",
    none: "无",
    noStructuredFields: "无结构化字段",
    referencedWithoutHead: "该节点是被引用节点，目前没有独立 head 内容。",
    trackedWithoutBody: "该节点暂无正文内容。",
    relationHint: "选择节点后显示关系视图",
    versionHint: "选择节点后显示版本 DAG",
    timelineEmpty: "暂无版本记录",
    rollbackTemplate: "回溯模板",
    actionBuilder: "动作生成器",
    agentId: "Agent ID",
    actionReason: "变更原因",
    actionSource: "来源",
    actionConfidence: "置信度",
    actionImportance: "重要性",
    actionMarkdown: "Markdown 内容",
    generateUpsert: "生成 Upsert JSON",
    generateRollback: "生成 Rollback JSON",
    copyAction: "复制 JSON",
    rollbackTargetNone: "回溯目标：未选择",
    rollbackTargetSet: "回溯目标：{version}",
    actionNeedNode: "请先选择节点。",
    actionNeedReason: "请填写变更原因。",
    actionNeedMarkdown: "请填写 Markdown 内容。",
    actionRollbackNeedTarget: "请先从时间线选择目标版本。",
    actionCopyDone: "Action JSON 已复制到剪贴板。",
    actionCopyFailed: "复制失败，请手动复制。",
    actionGenerated: "Action JSON 已生成。",
    actionPreviewEmpty: "生成的 action JSON 会显示在这里。",
    metaNodeId: "Node ID",
    metaHead: "Head",
    metaUpdated: "更新",
    metaConfidence: "Confidence",
    metaImportance: "Importance",
    metaAccess: "访问",
    versionTime: "时间",
    versionParents: "父版本",
    searchPlaceholder: "按 ID 或标题过滤",
  },
};

const elements = {
  langSelect: document.getElementById("lang-select"),
  folderInput: document.getElementById("folder-input"),
  rootSelect: document.getElementById("root-select"),
  parseBtn: document.getElementById("parse-btn"),
  status: document.getElementById("status"),
  metricNodes: document.getElementById("metric-nodes"),
  metricEdges: document.getElementById("metric-edges"),
  metricVersions: document.getElementById("metric-versions"),
  metricAccess: document.getElementById("metric-access"),
  keywordSearch: document.getElementById("keyword-search"),
  keywordSearchBtn: document.getElementById("keyword-search-btn"),
  keywordClearBtn: document.getElementById("keyword-clear-btn"),
  keywordSummary: document.getElementById("keyword-summary"),
  keywordResults: document.getElementById("keyword-results"),
  nodeSearch: document.getElementById("node-search"),
  nodeCountLabel: document.getElementById("node-count-label"),
  nodeList: document.getElementById("node-list"),
  articleTitle: document.getElementById("article-title"),
  articleMeta: document.getElementById("article-meta"),
  articleBody: document.getElementById("article-body"),
  structuredTableBody: document.getElementById("structured-table-body"),
  highlightsList: document.getElementById("highlights-list"),
  outgoingLinks: document.getElementById("outgoing-links"),
  incomingLinks: document.getElementById("incoming-links"),
  versionList: document.getElementById("version-list"),
  markdownPath: document.getElementById("markdown-path"),
  markdownContent: document.getElementById("markdown-content"),
  auditList: document.getElementById("audit-list"),
  relationSvg: document.getElementById("relation-svg"),
  versionSvg: document.getElementById("version-svg"),
  actionAgentId: document.getElementById("action-agent-id"),
  actionReason: document.getElementById("action-reason"),
  actionSource: document.getElementById("action-source"),
  actionConfidence: document.getElementById("action-confidence"),
  actionImportance: document.getElementById("action-importance"),
  actionMarkdown: document.getElementById("action-markdown"),
  generateUpsertBtn: document.getElementById("generate-upsert-btn"),
  generateRollbackBtn: document.getElementById("generate-rollback-btn"),
  copyActionBtn: document.getElementById("copy-action-btn"),
  actionTarget: document.getElementById("action-target"),
  actionPreview: document.getElementById("action-preview"),
};

const app = {
  lang: "en",
  fileMap: new Map(),
  roots: [],
  currentRoot: "",
  snapshot: { heads: {}, nodes: {} },
  versions: new Map(),
  accessLogs: [],
  agentActions: [],
  markdownByNode: new Map(),
  model: {
    nodes: [],
    nodeById: new Map(),
    edges: [],
    outgoing: new Map(),
    incoming: new Map(),
    versionsByNode: new Map(),
    accessByNode: new Map(),
    missingHeadObjects: 0,
  },
  keywordIndex: new Map(),
  selectedNodeId: null,
  searchQuery: "",
  keywordQuery: "",
  keywordResults: [],
  rollbackTargetVersion: "",
};

function t(key, vars = {}) {
  const table = I18N[app.lang] || I18N.en;
  const fallback = I18N.en;
  const raw = table[key] ?? fallback[key] ?? key;
  return raw.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
}

function setHtmlLang() {
  document.documentElement.lang = app.lang;
}

function applyStaticI18n() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    const msg = t(key);
    if (msg.includes("<code>")) {
      el.innerHTML = msg;
    } else {
      el.textContent = msg;
    }
  });
  elements.nodeSearch.placeholder = t("searchPlaceholder");
  elements.keywordSearch.placeholder = t("keywordPlaceholder");
}

function setStatus(text, type = "") {
  elements.status.textContent = text;
  elements.status.classList.remove("ok", "warn");
  if (type) {
    elements.status.classList.add(type);
  }
}

function normalizePath(path) {
  return String(path || "").replace(/\\/g, "/");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function shortId(id) {
  if (!id) {
    return "";
  }
  return id.length <= 14 ? id : `${id.slice(0, 8)}...${id.slice(-4)}`;
}

function formatTimestamp(seconds) {
  const n = Number(seconds);
  if (!Number.isFinite(n) || n <= 0) {
    return t("none");
  }
  return new Date(n * 1000).toLocaleString(app.lang === "zh-CN" ? "zh-CN" : "en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function createSvgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([key, value]) => {
    el.setAttribute(key, String(value));
  });
  return el;
}

function toSafeObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value;
}

function buildFileMap(fileList) {
  const map = new Map();
  Array.from(fileList).forEach((file) => {
    const rel = normalizePath(file.webkitRelativePath || file.name);
    map.set(rel, file);
  });
  return map;
}

function detectStorageRoots(paths) {
  const stateSuffix = "index/state.json";
  const headsSuffix = "index/heads.json";
  const nodesSuffix = "index/nodes.json";
  const roots = new Set();

  paths.forEach((path) => {
    if (path.endsWith(stateSuffix)) {
      roots.add(path.slice(0, -stateSuffix.length));
    }
    if (path.endsWith(headsSuffix)) {
      roots.add(path.slice(0, -headsSuffix.length));
    }
    if (path.endsWith(nodesSuffix)) {
      roots.add(path.slice(0, -nodesSuffix.length));
    }

    const marker = "objects/";
    const idx = path.indexOf(marker);
    if (idx >= 0) {
      roots.add(path.slice(0, idx));
    }
  });

  return Array.from(roots)
    .map((root) => normalizePath(root))
    .filter((root) => {
      const hasIndex = paths.some((p) => p.startsWith(`${root}index/`));
      const hasObjects = paths.some((p) => p.startsWith(`${root}objects/`));
      return hasIndex && hasObjects;
    })
    .sort((a, b) => a.localeCompare(b));
}

function updateRootSelect() {
  elements.rootSelect.innerHTML = "";
  if (app.roots.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = t("rootNotDetected");
    elements.rootSelect.appendChild(option);
    elements.rootSelect.disabled = true;
    return;
  }

  elements.rootSelect.disabled = false;
  app.roots.forEach((root) => {
    const option = document.createElement("option");
    option.value = root;
    option.textContent = root || t("currentDirectory");
    elements.rootSelect.appendChild(option);
  });
  elements.rootSelect.value = app.currentRoot;
}

async function readJsonOptional(relativePath) {
  const file = app.fileMap.get(relativePath);
  if (!file) {
    return null;
  }
  return JSON.parse(await file.text());
}

async function readJsonLines(relativePath, validator) {
  const file = app.fileMap.get(relativePath);
  if (!file) {
    return [];
  }

  const out = [];
  const lines = (await file.text()).split(/\r?\n/);
  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (!validator || validator(parsed)) {
        out.push(parsed);
      }
    } catch (_) {
      // Ignore malformed line.
    }
  });
  return out;
}

function getNodeVersions(nodeId) {
  const ids = new Set();
  const branches = app.snapshot.nodes?.[nodeId]?.branches;
  if (Array.isArray(branches)) {
    branches.forEach((id) => ids.add(id));
  }

  const headId = app.snapshot.heads?.[nodeId];
  if (headId) {
    ids.add(headId);
  }

  const byNode = app.model.versionsByNode.get(nodeId) || [];
  byNode.forEach((item) => ids.add(item.id));

  const out = Array.from(ids).map((id) => {
    const version = app.versions.get(id);
    return {
      id,
      data: version || null,
      timestamp: Number(version?.timestamp) || 0,
      parents: Array.isArray(version?.parents) ? version.parents : [],
      confidence: Number(version?.confidence) || 0,
      importance: Number(version?.importance) || 0,
    };
  });

  out.sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id));
  return out;
}

function buildModel(snapshot, versions, accessLogs) {
  const heads = toSafeObject(snapshot.heads);
  const nodes = toSafeObject(snapshot.nodes);
  const nodeIds = new Set([...Object.keys(nodes), ...Object.keys(heads)]);

  const edgeMap = new Map();
  const outgoing = new Map();
  const incoming = new Map();
  const versionsByNode = new Map();
  const accessByNode = new Map();
  let missingHeadObjects = 0;

  accessLogs.forEach((log) => {
    const count = accessByNode.get(log.node_id) || 0;
    accessByNode.set(log.node_id, count + 1);
  });

  versions.forEach((version, versionId) => {
    const nodeId = typeof version.node_id === "string" ? version.node_id : "";
    if (!nodeId) {
      return;
    }

    if (!versionsByNode.has(nodeId)) {
      versionsByNode.set(nodeId, []);
    }
    versionsByNode.get(nodeId).push({
      id: versionId,
      timestamp: Number(version.timestamp) || 0,
      content: version.content || {},
      confidence: Number(version.confidence) || 0,
      importance: Number(version.importance) || 0,
      parents: Array.isArray(version.parents) ? version.parents : [],
    });

    nodeIds.add(nodeId);
  });

  versionsByNode.forEach((list) => {
    list.sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id));
  });

  Object.entries(heads).forEach(([sourceNode, headVersionId]) => {
    const version = versions.get(headVersionId);
    if (!version) {
      missingHeadObjects += 1;
      return;
    }

    const links = Array.isArray(version.content?.links) ? version.content.links : [];
    links.forEach((link) => {
      const target = typeof link?.target === "string" ? link.target.trim() : "";
      if (!target) {
        return;
      }
      const label = typeof link?.label === "string" ? link.label.trim() : "";
      const weight = Number(link?.weight);
      const safeWeight = Number.isFinite(weight) ? weight : 0;

      nodeIds.add(target);

      const key = `${sourceNode}\u0000${target}\u0000${label}`;
      const edge = edgeMap.get(key) || {
        source: sourceNode,
        target,
        label,
        count: 0,
        totalWeight: 0,
      };
      edge.count += 1;
      edge.totalWeight += safeWeight;
      edgeMap.set(key, edge);

      if (!outgoing.has(sourceNode)) {
        outgoing.set(sourceNode, new Set());
      }
      outgoing.get(sourceNode).add(target);

      if (!incoming.has(target)) {
        incoming.set(target, new Set());
      }
      incoming.get(target).add(sourceNode);
    });
  });

  const nodesOut = Array.from(nodeIds)
    .map((id) => {
      const isTracked = Object.prototype.hasOwnProperty.call(heads, id);
      const headVersionId = isTracked ? heads[id] : null;
      const headVersion = headVersionId ? versions.get(headVersionId) : null;
      const fallbackVersion = (versionsByNode.get(id) || []).at(-1) || null;
      const current = headVersion || fallbackVersion;

      return {
        id,
        isTracked,
        headVersionId,
        title: (current?.content?.title || id || "").trim(),
        body: current?.content?.body || "",
        confidence: Number(current?.confidence) || 0,
        importance: Number(current?.importance) || 0,
        updatedAt: Number(current?.timestamp) || 0,
        inDegree: incoming.get(id)?.size || 0,
        outDegree: outgoing.get(id)?.size || 0,
        accessCount: accessByNode.get(id) || 0,
      };
    })
    .sort((a, b) => {
      if (a.isTracked !== b.isTracked) {
        return a.isTracked ? -1 : 1;
      }
      return a.id.localeCompare(b.id);
    });

  const nodeById = new Map(nodesOut.map((node) => [node.id, node]));

  const edges = Array.from(edgeMap.values()).sort((a, b) => {
    return a.source.localeCompare(b.source) || a.target.localeCompare(b.target);
  });

  return {
    nodes: nodesOut,
    nodeById,
    edges,
    outgoing,
    incoming,
    versionsByNode,
    accessByNode,
    missingHeadObjects,
  };
}

function updateMetrics() {
  elements.metricNodes.textContent = String(app.model.nodes.length);
  elements.metricEdges.textContent = String(app.model.edges.length);
  elements.metricVersions.textContent = String(app.versions.size);
  elements.metricAccess.textContent = String(app.accessLogs.length);
}

function getFilteredNodes() {
  const query = app.searchQuery.trim().toLowerCase();
  if (!query) {
    return app.model.nodes;
  }

  return app.model.nodes.filter((node) => {
    return node.id.toLowerCase().includes(query) || node.title.toLowerCase().includes(query);
  });
}

function renderNodeList() {
  const filtered = getFilteredNodes();
  const labelKey = filtered.length === app.model.nodes.length ? "nodeCountOnly" : "nodeCount";
  elements.nodeCountLabel.textContent = t(labelKey, {
    filtered: filtered.length,
    total: app.model.nodes.length,
  });

  if (filtered.length === 0) {
    elements.nodeList.innerHTML = `<p class="hint">${escapeHtml(t("noNodeMatched"))}</p>`;
    return;
  }

  const html = filtered
    .map((node) => {
      const active = node.id === app.selectedNodeId ? "active" : "";
      const title = node.title && node.title !== node.id ? node.title : t("nodeTitleEmpty");
      const tag = node.isTracked ? t("trackedNode") : t("referencedNode");
      return `
        <button type="button" class="node-item ${active}" data-node-id="${escapeHtml(node.id)}">
          <strong>${escapeHtml(node.id)}</strong>
          <small>${escapeHtml(title)} | ${escapeHtml(tag)} | out ${node.outDegree} / in ${node.inDegree}</small>
        </button>
      `;
    })
    .join("");

  elements.nodeList.innerHTML = html;
}

function renderLinkButtons(nodeIds) {
  if (!nodeIds || nodeIds.length === 0) {
    return `<span class="hint">${escapeHtml(t("none"))}</span>`;
  }

  return nodeIds
    .map((id) => {
      return `<button type="button" class="wiki-link" data-node-id="${escapeHtml(id)}">${escapeHtml(id)}</button>`;
    })
    .join("");
}

function renderInlineWikiLinks(text) {
  const escaped = escapeHtml(text);
  return escaped.replace(/\[\[([^[\]]+)\]\]/g, (_, rawTarget) => {
    const target = String(rawTarget || "").trim();
    if (!target) {
      return "";
    }
    const label = target;
    return `<button type="button" class="wiki-link wiki-inline-link" data-node-id="${escapeHtml(target)}">${escapeHtml(label)}</button>`;
  });
}

function renderWikiSummary(body) {
  const text = String(body || "").trim();
  if (!text) {
    return "";
  }

  const lines = text.split(/\r?\n/);
  const chunks = [];
  let paragraph = [];
  let listItems = [];

  function flushParagraph() {
    if (paragraph.length === 0) {
      return;
    }
    const joined = paragraph.join(" ").trim();
    if (joined) {
      chunks.push(`<p>${renderInlineWikiLinks(joined)}</p>`);
    }
    paragraph = [];
  }

  function flushList() {
    if (listItems.length === 0) {
      return;
    }
    chunks.push(`<ul>${listItems.map((item) => `<li>${renderInlineWikiLinks(item)}</li>`).join("")}</ul>`);
    listItems = [];
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }
    if (line.startsWith("# ")) {
      flushParagraph();
      flushList();
      chunks.push(`<h3>${renderInlineWikiLinks(line.slice(2).trim())}</h3>`);
      continue;
    }
    if (line.startsWith("## ")) {
      flushParagraph();
      flushList();
      chunks.push(`<h4>${renderInlineWikiLinks(line.slice(3).trim())}</h4>`);
      continue;
    }
    if (line.startsWith("- ") || line.startsWith("* ")) {
      flushParagraph();
      listItems.push(line.slice(2).trim());
      continue;
    }
    flushList();
    paragraph.push(line);
  }

  flushParagraph();
  flushList();
  return chunks.join("");
}

function parseFrontmatter(markdown) {
  const text = String(markdown || "");
  const trimmed = text.trimStart();
  if (!trimmed.startsWith("---\n")) {
    return { meta: {}, body: text };
  }

  const lines = trimmed.split(/\r?\n/);
  const meta = {};
  let i = 1;
  for (; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === "---") {
      i += 1;
      break;
    }
    const pair = line.split(":");
    if (pair.length < 2) {
      continue;
    }
    const key = pair.shift().trim();
    const value = pair.join(":").trim().replace(/^"|"$/g, "");
    if (key) {
      meta[key] = value;
    }
  }

  return { meta, body: lines.slice(i).join("\n") };
}

function extractTitleFromMarkdown(markdown) {
  const lines = String(markdown || "").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("# ")) {
      return trimmed.slice(2).trim();
    }
  }
  return "";
}

function deriveCurrentNodeContent(nodeId) {
  const node = app.model.nodeById.get(nodeId);
  const headVersionId = node?.headVersionId || app.snapshot.heads?.[nodeId] || "";
  const headVersion = headVersionId ? app.versions.get(headVersionId) : null;
  const fallbackVersion = getNodeVersions(nodeId).at(-1)?.data || null;
  const current = headVersion || fallbackVersion;

  const versionContent = current?.content || {};
  const markdownProjection = app.markdownByNode.get(nodeId);
  const markdownText = markdownProjection?.markdown || "";
  const markdownParsed = parseFrontmatter(markdownText);

  return {
    node,
    current,
    headVersionId,
    title: versionContent.title || extractTitleFromMarkdown(markdownParsed.body) || nodeId,
    body: versionContent.body || markdownParsed.body || "",
    highlights: Array.isArray(versionContent.highlights)
      ? [...new Set(versionContent.highlights.filter(Boolean))]
      : [],
    structured: toSafeObject(versionContent.structured_data),
    markdownProjection,
  };
}

function renderArticle() {
  const nodeId = app.selectedNodeId;
  if (!nodeId) {
    elements.articleTitle.textContent = t("articleNone");
    elements.articleMeta.textContent = t("articleGuide");
    elements.articleBody.textContent = t("noContent");
    elements.structuredTableBody.innerHTML = `<tr><td colspan="2">${escapeHtml(t("noStructuredFields"))}</td></tr>`;
    elements.highlightsList.innerHTML = `<span class="chip">${escapeHtml(t("none"))}</span>`;
    elements.outgoingLinks.innerHTML = `<span class="hint">${escapeHtml(t("none"))}</span>`;
    elements.incomingLinks.innerHTML = `<span class="hint">${escapeHtml(t("none"))}</span>`;
    elements.versionList.innerHTML = `<li>${escapeHtml(t("timelineEmpty"))}</li>`;
    elements.markdownPath.textContent = t("markdownMissing");
    elements.markdownContent.textContent = "";
    elements.auditList.innerHTML = `<li>${escapeHtml(t("auditEmpty"))}</li>`;
    elements.actionMarkdown.value = "";
    app.rollbackTargetVersion = "";
    return;
  }

  const content = deriveCurrentNodeContent(nodeId);
  const node = content.node;
  const versions = getNodeVersions(nodeId);
  const current = content.current;
  const title = (content.title || nodeId).trim();
  const body = (content.body || "").trim();

  const outgoing = Array.from(app.model.outgoing.get(nodeId) || []).sort((a, b) => a.localeCompare(b));
  const incoming = Array.from(app.model.incoming.get(nodeId) || []).sort((a, b) => a.localeCompare(b));

  const metaParts = [
    `${t("metaNodeId")}: ${nodeId}`,
    `${t("metaHead")}: ${content.headVersionId ? shortId(content.headVersionId) : t("none")}`,
    `${t("metaUpdated")}: ${formatTimestamp(current?.timestamp)}`,
    `${t("metaConfidence")}: ${(Number(current?.confidence) || 0).toFixed(2)}`,
    `${t("metaImportance")}: ${(Number(current?.importance) || 0).toFixed(2)}`,
    `${t("metaAccess")}: ${node?.accessCount || 0}`,
  ];

  elements.articleTitle.textContent = title;
  elements.articleMeta.textContent = metaParts.join(" | ");

  if (body) {
    elements.articleBody.innerHTML = renderWikiSummary(body) || `<p>${escapeHtml(body)}</p>`;
  } else if (!node?.isTracked) {
    elements.articleBody.textContent = t("referencedWithoutHead");
  } else {
    elements.articleBody.textContent = t("trackedWithoutBody");
  }

  const structuredRows = Object.entries(content.structured)
    .map(([key, value]) => `<tr><th scope="row">${escapeHtml(key)}</th><td>${escapeHtml(value)}</td></tr>`)
    .join("");
  elements.structuredTableBody.innerHTML =
    structuredRows || `<tr><td colspan="2">${escapeHtml(t("noStructuredFields"))}</td></tr>`;

  elements.highlightsList.innerHTML =
    content.highlights.length > 0
      ? content.highlights.map((item) => `<span class="chip">${escapeHtml(item)}</span>`).join("")
      : `<span class="chip">${escapeHtml(t("none"))}</span>`;

  elements.outgoingLinks.innerHTML = renderLinkButtons(outgoing);
  elements.incomingLinks.innerHTML = renderLinkButtons(incoming);

  elements.versionList.innerHTML =
    versions.length === 0
      ? `<li>${escapeHtml(t("timelineEmpty"))}</li>`
      : versions
          .map((item) => {
            const parents = item.parents.length
              ? item.parents.map((parentId) => shortId(parentId)).join(", ")
              : t("none");
            return `
              <li>
                <strong>${escapeHtml(shortId(item.id))}</strong>
                <span class="mono"> ${escapeHtml(item.id)}</span><br/>
                ${escapeHtml(t("versionTime"))}: ${escapeHtml(formatTimestamp(item.timestamp))} |
                ${escapeHtml(t("versionParents"))}: ${escapeHtml(parents)}<br/>
                ${escapeHtml(t("metaConfidence"))}: ${item.confidence.toFixed(2)} |
                ${escapeHtml(t("metaImportance"))}: ${item.importance.toFixed(2)}
                <div class="timeline-actions">
                  <button type="button" class="timeline-rollback-btn" data-version-id="${escapeHtml(item.id)}">
                    ${escapeHtml(t("rollbackTemplate"))}
                  </button>
                </div>
              </li>
            `;
          })
          .join("");

  if (content.markdownProjection) {
    elements.markdownPath.textContent = `${t("markdownPath")}: ${content.markdownProjection.path}`;
    elements.markdownContent.textContent = content.markdownProjection.markdown;
  } else {
    elements.markdownPath.textContent = t("markdownFallback");
    elements.markdownContent.textContent = `# ${title}\n\n${body}`.trim();
  }

  const actions = app.agentActions
    .filter((item) => item.node_id === nodeId)
    .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));

  elements.auditList.innerHTML =
    actions.length === 0
      ? `<li>${escapeHtml(t("auditEmpty"))}</li>`
      : actions
          .map((item) => {
            return `
              <li>
                <strong>${escapeHtml(formatTimestamp(item.timestamp))}</strong>
                <span class="mono">${escapeHtml(item.version || "")}</span><br/>
                ${escapeHtml(t("auditAction"))}: ${escapeHtml(item.action || "")}
                | ${escapeHtml(t("auditReason"))}: ${escapeHtml(item.reason || "")}
                | ${escapeHtml(t("auditSource"))}: ${escapeHtml(item.source || "")}
              </li>
            `;
          })
          .join("");

  elements.actionMarkdown.value =
    content.markdownProjection?.markdown || elements.markdownContent.textContent || "";
}

function renderRelationGraph() {
  const svg = elements.relationSvg;
  svg.innerHTML = "";

  const nodeId = app.selectedNodeId;
  if (!nodeId) {
    const text = createSvgEl("text", {
      x: 130,
      y: 142,
      fill: "#5a6779",
      "font-size": "14",
    });
    text.textContent = t("relationHint");
    svg.appendChild(text);
    return;
  }

  const center = { x: 230, y: 140 };

  const outgoing = Array.from(app.model.outgoing.get(nodeId) || []).sort((a, b) => a.localeCompare(b));
  const incoming = Array.from(app.model.incoming.get(nodeId) || []).sort((a, b) => a.localeCompare(b));

  const incomingOnly = incoming.filter((id) => !outgoing.includes(id));
  const outgoingOnly = outgoing.filter((id) => !incoming.includes(id));
  const both = incoming.filter((id) => outgoing.includes(id));

  const nodePos = new Map();
  nodePos.set(nodeId, center);

  function spread(items, x, yStart, yEnd) {
    if (items.length === 0) {
      return;
    }
    items.forEach((id, i) => {
      const ratio = items.length === 1 ? 0.5 : i / (items.length - 1);
      const y = yStart + (yEnd - yStart) * ratio;
      nodePos.set(id, { x, y });
    });
  }

  spread(incomingOnly, 82, 45, 235);
  spread(outgoingOnly, 378, 45, 235);
  spread(both, 230, 32, 248);

  const defs = createSvgEl("defs");
  const marker = createSvgEl("marker", {
    id: "ego-arrow",
    viewBox: "0 0 10 10",
    refX: "8",
    refY: "5",
    markerWidth: "7",
    markerHeight: "7",
    orient: "auto-start-reverse",
  });
  marker.appendChild(createSvgEl("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: "#88a0c8" }));
  defs.appendChild(marker);
  svg.appendChild(defs);

  incoming.forEach((source) => {
    const from = nodePos.get(source);
    if (!from) {
      return;
    }
    const line = createSvgEl("line", {
      x1: from.x,
      y1: from.y,
      x2: center.x,
      y2: center.y,
      stroke: "#9db2d8",
      "stroke-width": "1.4",
      "marker-end": "url(#ego-arrow)",
      opacity: "0.88",
    });
    svg.appendChild(line);
  });

  outgoing.forEach((target) => {
    const to = nodePos.get(target);
    if (!to) {
      return;
    }
    const line = createSvgEl("line", {
      x1: center.x,
      y1: center.y,
      x2: to.x,
      y2: to.y,
      stroke: "#6f95cd",
      "stroke-width": "1.6",
      "marker-end": "url(#ego-arrow)",
      opacity: "0.92",
    });
    svg.appendChild(line);
  });

  Array.from(nodePos.entries()).forEach(([id, pos]) => {
    const isCenter = id === nodeId;
    const group = createSvgEl("g", {
      role: "button",
      tabindex: "0",
      "aria-label": `${t("metaNodeId")}: ${id}`,
    });

    const circle = createSvgEl("circle", {
      cx: pos.x,
      cy: pos.y,
      r: isCenter ? 16 : 11,
      fill: isCenter ? "#015f83" : "#1f7a8c",
      stroke: "#ffffff",
      "stroke-width": "2",
    });

    const label = createSvgEl("text", {
      x: pos.x + (isCenter ? 20 : 13),
      y: pos.y + 4,
      fill: "#17324a",
      "font-size": isCenter ? "12" : "11",
      "font-weight": isCenter ? "700" : "500",
    });
    label.textContent = shortId(id);

    group.appendChild(circle);
    group.appendChild(label);

    group.addEventListener("click", () => selectNode(id));
    group.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectNode(id);
      }
    });

    svg.appendChild(group);
  });
}

function renderVersionGraph() {
  const svg = elements.versionSvg;
  svg.innerHTML = "";

  const nodeId = app.selectedNodeId;
  if (!nodeId) {
    const text = createSvgEl("text", {
      x: 126,
      y: 132,
      fill: "#5a6779",
      "font-size": "14",
    });
    text.textContent = t("versionHint");
    svg.appendChild(text);
    return;
  }

  const versions = getNodeVersions(nodeId);
  if (versions.length === 0) {
    const text = createSvgEl("text", {
      x: 176,
      y: 132,
      fill: "#5a6779",
      "font-size": "14",
    });
    text.textContent = t("timelineEmpty");
    svg.appendChild(text);
    return;
  }

  const pos = new Map();
  versions.forEach((item, idx) => {
    const lane = idx % 4;
    pos.set(item.id, { x: 58 + idx * 88, y: 48 + lane * 46 });
  });

  const defs = createSvgEl("defs");
  const marker = createSvgEl("marker", {
    id: "dag-arrow",
    viewBox: "0 0 10 10",
    refX: "8",
    refY: "5",
    markerWidth: "7",
    markerHeight: "7",
    orient: "auto-start-reverse",
  });
  marker.appendChild(createSvgEl("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: "#90a4c9" }));
  defs.appendChild(marker);
  svg.appendChild(defs);

  versions.forEach((item) => {
    const from = pos.get(item.id);
    item.parents.forEach((parentId) => {
      const to = pos.get(parentId);
      if (!to) {
        return;
      }
      const path = createSvgEl("path", {
        d: `M ${from.x} ${from.y} C ${from.x - 22} ${from.y}, ${to.x + 22} ${to.y}, ${to.x} ${to.y}`,
        fill: "none",
        stroke: "#90a4c9",
        "stroke-width": "1.2",
        "marker-end": "url(#dag-arrow)",
        opacity: "0.82",
      });
      svg.appendChild(path);
    });
  });

  versions.forEach((item) => {
    const p = pos.get(item.id);
    const circle = createSvgEl("circle", {
      cx: p.x,
      cy: p.y,
      r: 10,
      fill: "#015f83",
      stroke: "#ffffff",
      "stroke-width": "2",
    });
    svg.appendChild(circle);

    const label = createSvgEl("text", {
      x: p.x + 14,
      y: p.y + 4,
      fill: "#17324a",
      "font-size": "11",
    });
    label.textContent = shortId(item.id);
    svg.appendChild(label);
  });
}

function renderKeywordResults() {
  const results = app.keywordResults;
  if (!app.keywordQuery) {
    elements.keywordSummary.textContent = t("keywordSummaryDefault");
    elements.keywordResults.innerHTML = "";
    return;
  }

  elements.keywordSummary.textContent = t("keywordResults", {
    count: results.length,
    query: app.keywordQuery,
  });

  if (results.length === 0) {
    elements.keywordResults.innerHTML = `<p class="hint">${escapeHtml(t("keywordNoResults"))}</p>`;
    return;
  }

  elements.keywordResults.innerHTML = results
    .map((item) => {
      return `
        <button type="button" class="search-hit" data-node-id="${escapeHtml(item.nodeId)}">
          <strong>${escapeHtml(item.nodeId)}</strong>
          <span class="search-score">${item.score.toFixed(2)}</span>
          <small>${escapeHtml(item.snippet)}</small>
        </button>
      `;
    })
    .join("");
}

function renderActionTargetLabel() {
  if (!app.rollbackTargetVersion) {
    elements.actionTarget.textContent = t("rollbackTargetNone");
    return;
  }
  elements.actionTarget.textContent = t("rollbackTargetSet", {
    version: shortId(app.rollbackTargetVersion),
  });
}

function renderAll() {
  updateMetrics();
  renderNodeList();
  renderArticle();
  renderRelationGraph();
  renderVersionGraph();
  renderKeywordResults();
  renderActionTargetLabel();
  if (!elements.actionPreview.textContent.trim()) {
    elements.actionPreview.textContent = t("actionPreviewEmpty");
  }
}

function selectNode(nodeId) {
  if (!nodeId) {
    return;
  }
  app.selectedNodeId = nodeId;
  app.rollbackTargetVersion = "";
  renderAll();
}

async function loadMarkdownProjection(root) {
  const byNode = new Map();
  const prefix = `${root}knowledge/nodes/`;

  const files = Array.from(app.fileMap.entries()).filter(([path]) => {
    return path.startsWith(prefix) && path.endsWith(".md");
  });

  for (const [path, file] of files) {
    try {
      const markdown = await file.text();
      const parsed = parseFrontmatter(markdown);
      const frontNodeId = parsed.meta.node_id || "";
      let nodeId = String(frontNodeId).trim();
      if (!nodeId) {
        const filename = path.split("/").pop() || "";
        nodeId = filename.replace(/-[0-9a-f]{8}\.md$/i, "");
      }
      if (!nodeId) {
        continue;
      }
      byNode.set(nodeId, { path, markdown });
    } catch (_) {
      // Ignore malformed markdown files.
    }
  }

  return byNode;
}

function addTokenScore(index, token, nodeId, score) {
  if (!token) {
    return;
  }
  if (!index.has(token)) {
    index.set(token, new Map());
  }
  const bucket = index.get(token);
  bucket.set(nodeId, (bucket.get(nodeId) || 0) + score);
}

function isCjk(ch) {
  const code = ch.codePointAt(0);
  return (
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x20000 && code <= 0x2a6df)
  );
}

function tokenize(input) {
  const text = String(input || "");
  const out = text
    .split(/[^\p{L}\p{N}_]+/u)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length >= 2);

  let cjk = "";
  for (const ch of text) {
    if (isCjk(ch)) {
      cjk += ch;
      continue;
    }
    if (cjk.length >= 2) {
      out.push(cjk);
      for (let i = 0; i < cjk.length - 1; i += 1) {
        out.push(cjk.slice(i, i + 2));
      }
    }
    cjk = "";
  }
  if (cjk.length >= 2) {
    out.push(cjk);
    for (let i = 0; i < cjk.length - 1; i += 1) {
      out.push(cjk.slice(i, i + 2));
    }
  }

  return [...new Set(out)];
}

function buildKeywordIndex() {
  const index = new Map();

  app.model.nodes.forEach((node) => {
    const nodeId = node.id;
    const content = deriveCurrentNodeContent(nodeId);

    tokenize(content.title).forEach((token) => addTokenScore(index, token, nodeId, 5.0));
    tokenize(content.body).forEach((token) => addTokenScore(index, token, nodeId, 2.0));
    content.highlights.forEach((text) => {
      tokenize(text).forEach((token) => addTokenScore(index, token, nodeId, 2.5));
    });
    Object.entries(content.structured).forEach(([k, v]) => {
      tokenize(k).forEach((token) => addTokenScore(index, token, nodeId, 1.0));
      tokenize(v).forEach((token) => addTokenScore(index, token, nodeId, 1.5));
    });
    if (content.markdownProjection?.markdown) {
      tokenize(content.markdownProjection.markdown).forEach((token) => {
        addTokenScore(index, token, nodeId, 1.2);
      });
    }
  });

  app.keywordIndex = index;
}

function makeSnippet(nodeId, queryTokens) {
  const content = deriveCurrentNodeContent(nodeId);
  const text = `${content.body}\n${content.markdownProjection?.markdown || ""}`.replace(/\s+/g, " ").trim();
  if (!text) {
    return nodeId;
  }

  const lower = text.toLowerCase();
  let pos = -1;
  for (const token of queryTokens) {
    pos = lower.indexOf(token.toLowerCase());
    if (pos >= 0) {
      break;
    }
  }

  if (pos < 0) {
    return text.slice(0, 120);
  }

  const start = Math.max(0, pos - 26);
  const end = Math.min(text.length, pos + 92);
  return `${start > 0 ? "..." : ""}${text.slice(start, end)}${end < text.length ? "..." : ""}`;
}

function runKeywordSearch() {
  const query = elements.keywordSearch.value.trim();
  app.keywordQuery = query;

  if (!query) {
    app.keywordResults = [];
    renderKeywordResults();
    setStatus(t("keywordEmpty"), "warn");
    return;
  }

  const tokens = tokenize(query);
  const scores = new Map();
  const coverage = new Map();

  tokens.forEach((token) => {
    const hitMap = app.keywordIndex.get(token);
    if (!hitMap) {
      return;
    }
    hitMap.forEach((score, nodeId) => {
      scores.set(nodeId, (scores.get(nodeId) || 0) + score);
      coverage.set(nodeId, (coverage.get(nodeId) || 0) + 1);
    });
  });

  const ranked = Array.from(scores.entries())
    .map(([nodeId, score]) => {
      const total = score + (coverage.get(nodeId) || 0);
      return {
        nodeId,
        score: total,
        snippet: makeSnippet(nodeId, tokens),
      };
    })
    .sort((a, b) => b.score - a.score || a.nodeId.localeCompare(b.nodeId))
    .slice(0, 20);

  app.keywordResults = ranked;
  renderKeywordResults();
  setStatus(t("keywordResults", { count: ranked.length, query }), "ok");
}

function resetKeywordSearch() {
  app.keywordQuery = "";
  app.keywordResults = [];
  elements.keywordSearch.value = "";
  renderKeywordResults();
}

function buildUpsertAction() {
  if (!app.selectedNodeId) {
    setStatus(t("actionNeedNode"), "warn");
    return null;
  }

  const reason = elements.actionReason.value.trim();
  const markdown = elements.actionMarkdown.value;
  if (!reason) {
    setStatus(t("actionNeedReason"), "warn");
    return null;
  }
  if (!markdown.trim()) {
    setStatus(t("actionNeedMarkdown"), "warn");
    return null;
  }

  return {
    action: "agent_upsert_markdown",
    node_id: app.selectedNodeId,
    markdown,
    confidence: Number(elements.actionConfidence.value || 0.85),
    importance: Number(elements.actionImportance.value || 2.0),
    agent_id: elements.actionAgentId.value.trim() || "agent-codex",
    reason,
    source: elements.actionSource.value.trim() || "local_ui",
  };
}

function buildRollbackAction() {
  if (!app.selectedNodeId) {
    setStatus(t("actionNeedNode"), "warn");
    return null;
  }
  if (!app.rollbackTargetVersion) {
    setStatus(t("actionRollbackNeedTarget"), "warn");
    return null;
  }
  const reason = elements.actionReason.value.trim();
  if (!reason) {
    setStatus(t("actionNeedReason"), "warn");
    return null;
  }

  return {
    action: "rollback_node",
    node_id: app.selectedNodeId,
    target_version: app.rollbackTargetVersion,
    confidence: Number(elements.actionConfidence.value || 0.9),
    importance: Number(elements.actionImportance.value || 2.0),
    agent_id: elements.actionAgentId.value.trim() || "agent-codex",
    reason,
  };
}

function renderActionPreview(actionObj) {
  if (!actionObj) {
    return;
  }
  elements.actionPreview.textContent = JSON.stringify(actionObj, null, 2);
}

async function copyActionPreview() {
  const text = elements.actionPreview.textContent;
  if (!text || text === t("actionPreviewEmpty")) {
    return;
  }

  try {
    await navigator.clipboard.writeText(text);
    setStatus(t("actionCopyDone"), "ok");
  } catch (_) {
    setStatus(t("actionCopyFailed"), "warn");
  }
}

async function parseCurrentRoot() {
  if (!app.currentRoot) {
    setStatus(t("statusMissingFolder"), "warn");
    return;
  }

  setStatus(t("statusParsing"));

  try {
    const statePath = `${app.currentRoot}index/state.json`;
    const headsPath = `${app.currentRoot}index/heads.json`;
    const nodesPath = `${app.currentRoot}index/nodes.json`;

    const state = await readJsonOptional(statePath);
    const heads = state?.heads || (await readJsonOptional(headsPath));
    const nodes = state?.nodes || (await readJsonOptional(nodesPath));

    if (!heads || !nodes) {
      setStatus(t("statusNoSnapshot"), "warn");
      return;
    }

    app.snapshot = { heads, nodes };

    const versionFiles = new Map();
    Array.from(app.fileMap.keys())
      .filter((path) => path.startsWith(`${app.currentRoot}objects/`) && path.endsWith(".json"))
      .forEach((path) => {
        const id = path.split("/").pop().replace(/\.json$/, "");
        versionFiles.set(id, app.fileMap.get(path));
      });

    const loadedVersions = new Map();
    for (const [versionId, file] of versionFiles.entries()) {
      try {
        const parsed = JSON.parse(await file.text());
        loadedVersions.set(versionId, parsed);
      } catch (_) {
        // Ignore malformed object files.
      }
    }
    app.versions = loadedVersions;

    app.accessLogs = await readJsonLines(`${app.currentRoot}index/access.log`, (item) => {
      return item && typeof item.node_id === "string";
    });

    app.agentActions = await readJsonLines(`${app.currentRoot}index/agent_actions.log`, (item) => {
      return item && typeof item.node_id === "string" && typeof item.action === "string";
    });

    app.markdownByNode = await loadMarkdownProjection(app.currentRoot);

    app.model = buildModel(app.snapshot, app.versions, app.accessLogs);
    buildKeywordIndex();

    if (!app.selectedNodeId || !app.model.nodeById.has(app.selectedNodeId)) {
      app.selectedNodeId = app.model.nodes[0]?.id || null;
    }

    app.rollbackTargetVersion = "";
    resetKeywordSearch();
    renderAll();

    setStatus(
      t("statusReady", {
        nodes: app.model.nodes.length,
        edges: app.model.edges.length,
        versions: app.versions.size,
        audits: app.agentActions.length,
      }),
      "ok",
    );
  } catch (error) {
    setStatus(t("statusParseFailed", { message: error.message || String(error) }), "warn");
  }
}

function resetViewForLanguage() {
  applyStaticI18n();
  updateRootSelect();
  renderAll();
}

function setLanguage(lang) {
  app.lang = I18N[lang] ? lang : "en";
  elements.langSelect.value = app.lang;
  localStorage.setItem(STORAGE_LANG_KEY, app.lang);
  setHtmlLang();
  resetViewForLanguage();
}

function bindEvents() {
  elements.langSelect.addEventListener("change", () => {
    setLanguage(elements.langSelect.value);
  });

  elements.folderInput.addEventListener("change", () => {
    const files = elements.folderInput.files;
    app.fileMap = buildFileMap(files || []);
    app.roots = detectStorageRoots(Array.from(app.fileMap.keys()));
    app.currentRoot = app.roots[0] || "";
    updateRootSelect();

    if (app.roots.length > 0) {
      setStatus(t("statusRootsDetected", { count: app.roots.length }), "ok");
    } else {
      setStatus(t("statusNoRoots"), "warn");
    }
  });

  elements.rootSelect.addEventListener("change", () => {
    app.currentRoot = elements.rootSelect.value;
  });

  elements.parseBtn.addEventListener("click", () => {
    parseCurrentRoot();
  });

  elements.nodeSearch.addEventListener("input", () => {
    app.searchQuery = elements.nodeSearch.value;
    renderNodeList();
  });

  elements.keywordSearchBtn.addEventListener("click", () => {
    runKeywordSearch();
  });

  elements.keywordClearBtn.addEventListener("click", () => {
    resetKeywordSearch();
    setStatus(t("statusWaiting"));
  });

  elements.keywordSearch.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      runKeywordSearch();
    }
  });

  elements.nodeList.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-node-id]");
    if (!btn) {
      return;
    }
    selectNode(btn.dataset.nodeId);
  });

  elements.keywordResults.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-node-id]");
    if (!btn) {
      return;
    }
    selectNode(btn.dataset.nodeId);
  });

  document.addEventListener("click", (event) => {
    const link = event.target.closest(".wiki-link[data-node-id]");
    if (!link) {
      return;
    }
    selectNode(link.dataset.nodeId);
  });

  elements.versionList.addEventListener("click", (event) => {
    const btn = event.target.closest(".timeline-rollback-btn[data-version-id]");
    if (!btn) {
      return;
    }
    app.rollbackTargetVersion = btn.dataset.versionId;
    renderActionTargetLabel();
  });

  elements.generateUpsertBtn.addEventListener("click", () => {
    const action = buildUpsertAction();
    if (!action) {
      return;
    }
    renderActionPreview(action);
    setStatus(t("actionGenerated"), "ok");
  });

  elements.generateRollbackBtn.addEventListener("click", () => {
    const action = buildRollbackAction();
    if (!action) {
      return;
    }
    renderActionPreview(action);
    setStatus(t("actionGenerated"), "ok");
  });

  elements.copyActionBtn.addEventListener("click", () => {
    copyActionPreview();
  });
}

function init() {
  bindEvents();
  updateRootSelect();
  app.selectedNodeId = null;
  elements.actionPreview.textContent = t("actionPreviewEmpty");
  const storedLang = localStorage.getItem(STORAGE_LANG_KEY) || "en";
  setLanguage(storedLang);
  setStatus(t("statusWaiting"));
}

init();
