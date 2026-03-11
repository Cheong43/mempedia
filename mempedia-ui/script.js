const SVG_NS = "http://www.w3.org/2000/svg";
const STORAGE_LANG_KEY = "mempedia_ui_lang";

const I18N = {
  en: {
    // ... existing I18N keys ...
    // Adding/Overwriting keys for new UI
    searchPlaceholder: "Search nodes...",
    rootNotDetected: "No storage roots detected",
    currentDirectory: "(current directory)",
    none: "None",
    statusWaiting: "Waiting for import...",
    statusParsing: "Parsing...",
    statusReady: "Ready: {nodes} nodes loaded.",
    statusParseFailed: "Failed: {message}",
    articleNone: "Main Page",
    articleGuide: "Welcome to Mempedia.",
    keywordPlaceholder: "Search Mempedia",
    // ...
  },
  "zh-CN": {
    searchPlaceholder: "搜索节点...",
    rootNotDetected: "未检测到存储根",
    currentDirectory: "（当前目录）",
    none: "无",
    statusWaiting: "等待导入...",
    statusParsing: "解析中...",
    statusReady: "就绪：已加载 {nodes} 个节点。",
    statusParseFailed: "失败：{message}",
    articleNone: "首页",
    articleGuide: "欢迎来到 Mempedia。",
    keywordPlaceholder: "搜索 Mempedia",
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
  habitsList: document.getElementById("habits-list"),
  patternsList: document.getElementById("patterns-list"),
  conversationList: document.getElementById("conversation-list"),
  conversationDetail: document.getElementById("conversation-detail"),
  conversationNodeLabel: document.getElementById("conversation-node-label"),
  
  relationSvg: document.getElementById("relation-svg"),
  versionSvg: document.getElementById("version-svg"),
  
  // Action Builder elements removed

  
  cliConnectBtn: document.getElementById("cli-connect-btn"),
  cliRefreshMemoryBtn: document.getElementById("cli-refresh-memory-btn"),
  cliBridgeStatus: document.getElementById("cli-bridge-status"),
  cliDialogueList: document.getElementById("cli-dialogue-list"),
  cliTraceList: document.getElementById("cli-trace-list"),
  cliQueryInput: document.getElementById("cli-query-input"),
  cliSendBtn: document.getElementById("cli-send-btn"),

  // New/Changed elements
  viewSpecialMain: document.getElementById("view-special-main"),
  viewArticle: document.getElementById("view-article"),
  viewTalk: document.getElementById("view-talk"),
  viewSource: document.getElementById("view-source"),
  viewHistory: document.getElementById("view-history"),
  viewHabits: document.getElementById("view-habits"),
  viewPatterns: document.getElementById("view-patterns"),
  viewConversations: document.getElementById("view-conversations"),
  infoboxTitle: document.getElementById("infobox-title"),
  lastModified: document.getElementById("last-modified"),
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
  cliConnected: false,
  cliMessages: [],
  cliTraces: [],
  activeTab: 'read'
};

function t(key, vars = {}) {
  const table = I18N[app.lang] || I18N.en;
  const fallback = I18N.en;
  const raw = table[key] ?? fallback[key] ?? key;
  return raw.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
}

// --- Tab Management ---
app.switchTab = (tabName) => {
  app.activeTab = tabName;
  
  // Update Tab Styling
  document.querySelectorAll('.mw-tab').forEach(el => el.classList.remove('active'));
  const tabEl = document.getElementById(`tab-${tabName}`);
  if (tabEl) tabEl.classList.add('active');

  // Update View Visibility
  const views = [
    'view-special-main',
    'view-article',
    'view-talk',
    'view-source',
    'view-history',
    'view-habits',
    'view-patterns',
    'view-conversations'
  ];
  views.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.add('hidden');
  });

  if (tabName === 'read') {
      if (app.selectedNodeId) {
          elements.viewArticle.classList.remove('hidden');
      } else {
          elements.viewSpecialMain.classList.remove('hidden');
      }
  } else if (tabName === 'talk') {
      elements.viewTalk.classList.remove('hidden');
  } else if (tabName === 'source') {
      elements.viewSource.classList.remove('hidden');
  } else if (tabName === 'history') {
      elements.viewHistory.classList.remove('hidden');
  } else if (tabName === 'habits') {
      elements.viewHabits.classList.remove('hidden');
  } else if (tabName === 'patterns') {
      elements.viewPatterns.classList.remove('hidden');
  } else if (tabName === 'conversations') {
      elements.viewConversations.classList.remove('hidden');
  }
};

// --- Basic Helpers ---
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
  if (!id) return "";
  return id.length <= 14 ? id : `${id.slice(0, 8)}...${id.slice(-4)}`;
}

function markdownToHtml(md) {
  if (!md) return "";
  const lines = escapeHtml(String(md)).split("\n");
  const html = [];
  let inCode = false;
  let codeLang = "";
  let codeLines = [];
  let listOpen = false;

  const flushList = () => {
    if (listOpen) {
      html.push("</ul>");
      listOpen = false;
    }
  };

  const renderInline = (text) => {
    let out = text;
    out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
    out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    out = out.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, label, url) => {
      if (!/^https?:\/\//i.test(url)) return label;
      return `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    });
    return out;
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, "");

    if (line.trim().startsWith("```")) {
      if (inCode) {
        html.push(
          `<pre><code${codeLang ? ` class=\"language-${codeLang}\"` : ""}>${codeLines.join("\n")}</code></pre>`
        );
        inCode = false;
        codeLang = "";
        codeLines = [];
      } else {
        flushList();
        inCode = true;
        codeLang = line.trim().slice(3).trim();
      }
      continue;
    }

    if (inCode) {
      codeLines.push(line);
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      flushList();
      const level = headingMatch[1].length;
      html.push(`<h${level}>${renderInline(headingMatch[2])}</h${level}>`);
      continue;
    }

    const listMatch = line.match(/^\s*([-*+]|\d+\.)\s+(.*)$/);
    if (listMatch) {
      if (!listOpen) {
        html.push("<ul>");
        listOpen = true;
      }
      html.push(`<li>${renderInline(listMatch[2])}</li>`);
      continue;
    }

    if (line.trim().startsWith(">")) {
      flushList();
      const quote = line.replace(/^\s*>\s?/, "");
      html.push(`<blockquote>${renderInline(quote)}</blockquote>`);
      continue;
    }

    if (line.trim() === "") {
      flushList();
      continue;
    }

    flushList();
    html.push(`<p>${renderInline(line)}</p>`);
  }

  flushList();
  if (inCode) {
    html.push(`<pre><code>${codeLines.join("\n")}</code></pre>`);
  }

  return html.join("\n");
}

function formatTimestamp(seconds) {
  const n = Number(seconds);
  if (!Number.isFinite(n) || n <= 0) return t("none");
  return new Date(n * 1000).toLocaleString(app.lang === "zh-CN" ? "zh-CN" : "en-US");
}

function createSvgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, String(value)));
  return el;
}

function toSafeObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value;
}

// --- Data Loading Logic ---
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
  const roots = new Set();
  paths.forEach((path) => {
    if (path.endsWith(stateSuffix)) {
      roots.add(path.slice(0, -stateSuffix.length));
    }
  });
  return Array.from(roots).map(normalizePath).sort();
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
  return file ? JSON.parse(await file.text()) : null;
}

async function readTextOptional(relativePath) {
  const file = app.fileMap.get(relativePath);
  return file ? await file.text() : null;
}

async function readJsonLines(relativePath) {
  const file = app.fileMap.get(relativePath);
  if (!file) return [];
  const lines = (await file.text()).split(/\r?\n/);
  const out = [];
  lines.forEach(line => {
    try {
      if(line.trim()) out.push(JSON.parse(line));
    } catch(_) {}
  });
  return out;
}

// --- Model Building ---
function buildModel(snapshot, versions, accessLogs) {
  const heads = toSafeObject(snapshot.heads);
  const nodes = toSafeObject(snapshot.nodes);
  const nodeIds = new Set([...Object.keys(nodes), ...Object.keys(heads)]);
  const edgeMap = new Map();
  const outgoing = new Map();
  const incoming = new Map();
  const versionsByNode = new Map();
  const accessByNode = new Map();

  accessLogs.forEach(log => {
      accessByNode.set(log.node_id, (accessByNode.get(log.node_id) || 0) + 1);
  });

  versions.forEach((version, versionId) => {
    const nodeId = version.node_id;
    if (!nodeId) return;
    if (!versionsByNode.has(nodeId)) versionsByNode.set(nodeId, []);
    versionsByNode.get(nodeId).push({
        id: versionId,
        timestamp: Number(version.timestamp) || 0,
        content: version.content || {},
        confidence: Number(version.confidence) || 0,
        importance: Number(version.importance) || 0,
        parents: version.parents || []
    });
    nodeIds.add(nodeId);
  });

  versionsByNode.forEach(list => list.sort((a, b) => a.timestamp - b.timestamp));

  Object.entries(heads).forEach(([sourceNode, headVersionId]) => {
    const version = versions.get(headVersionId);
    if (!version) return;
    
    const links = version.content?.links || [];
    links.forEach(link => {
        const target = link.target;
        if (!target) return;
        nodeIds.add(target);
        
        if (!outgoing.has(sourceNode)) outgoing.set(sourceNode, []);
        outgoing.get(sourceNode).push({ target, label: link.label, weight: link.weight });

        if (!incoming.has(target)) incoming.set(target, []);
        incoming.get(target).push({ source: sourceNode, label: link.label, weight: link.weight });
        
        const key = `${sourceNode}->${target}`;
        edgeMap.set(key, { source: sourceNode, target });
    });
  });

  const nodeList = Array.from(nodeIds).map(id => {
      const nodeInfo = nodes[id] || {};
      const headVerId = heads[id] || nodeInfo.head;
      const headVer = versions.get(headVerId);
      
      return {
          id,
          title: headVer?.content?.title || headVer?.content?.summary || id,
          headVersionId: headVerId,
          headVersion: headVer,
          updated: headVer?.timestamp || 0,
          accessCount: accessByNode.get(id) || 0,
          branches: nodeInfo.branches || []
      };
  }).sort((a, b) => b.updated - a.updated);

  return {
      nodes: nodeList,
      nodeById: new Map(nodeList.map(n => [n.id, n])),
      edges: Array.from(edgeMap.values()),
      outgoing,
      incoming,
      versionsByNode,
      accessByNode
  };
}

// --- UI Rendering ---

function renderNodeList() {
  const query = (elements.nodeSearch.value || "").toLowerCase();
  const filtered = app.model.nodes.filter(n => 
      n.id.toLowerCase().includes(query) || (n.title && n.title.toLowerCase().includes(query))
  );
  
  elements.nodeCountLabel.textContent = `${filtered.length} nodes`;
  elements.nodeList.innerHTML = "";
  
  filtered.forEach(node => {
      const div = document.createElement("div");
      div.className = "node-item";
      if (node.id === app.selectedNodeId) div.classList.add("active");
      
      div.innerHTML = `
          <div style="font-weight:bold; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(node.title)}</div>
          <div style="font-size:0.75em; color:#54595d;">${shortId(node.id)}</div>
      `;
      div.onclick = () => selectNode(node.id);
      elements.nodeList.appendChild(div);
  });
}

function selectNode(nodeId) {
    app.selectedNodeId = nodeId;
    renderNodeList();
    renderNode(nodeId);
    app.switchTab('read');
}

function renderNode(nodeId) {
    const node = app.model.nodeById.get(nodeId);
    if (!node) {
        elements.articleTitle.textContent = "Node Not Found";
        return;
    }

    // Title & Meta
    elements.articleTitle.textContent = node.title || nodeId;
    elements.articleMeta.textContent = `Node ID: ${node.id} • Updated: ${formatTimestamp(node.updated)}`;
    elements.lastModified.textContent = formatTimestamp(node.updated);

    // Content
    const content = node.headVersion?.content || {};
    elements.articleBody.innerHTML = "";
    
    // Summary
    if (content.summary) {
        const p = document.createElement('p');
        p.innerHTML = `<strong>${markdownToHtml(content.summary)}</strong>`;
        elements.articleBody.appendChild(p);
    }
    
    const bodyText = content.body ?? content.details ?? content.text ?? "";
    if (bodyText) {
         const div = document.createElement('div');
         const contentType = content.structured_data?.content_type || content.content_type || "";
         if (String(contentType).toLowerCase() === "markdown") {
             div.innerHTML = markdownToHtml(bodyText);
         } else {
             div.textContent = String(bodyText);
         }
         elements.articleBody.appendChild(div);
    } else {
         elements.articleBody.innerHTML += `<div style="color:#54595d; font-style:italic;">No content body.</div>`;
    }

    elements.structuredTableBody.innerHTML = "";
    const structured = (content.structured_data && typeof content.structured_data === "object")
        ? content.structured_data
        : null;
    if (structured && Object.keys(structured).length > 0) {
        Object.entries(structured).forEach(([k, v]) => {
            if (typeof v === 'object') v = JSON.stringify(v);
            const tr = document.createElement('tr');
            tr.innerHTML = `<th scope="row">${escapeHtml(k)}</th><td>${escapeHtml(v)}</td>`;
            elements.structuredTableBody.appendChild(tr);
        });
        elements.infoboxTitle.textContent = "Structured Data";
    } else {
        // Fallback info
        elements.structuredTableBody.innerHTML = `
            <tr><th scope="row">Confidence</th><td>${node.headVersion?.confidence || 0}</td></tr>
            <tr><th scope="row">Importance</th><td>${node.headVersion?.importance || 0}</td></tr>
        `;
    }

    elements.highlightsList.innerHTML = "<ul></ul>";
    const ul = elements.highlightsList.querySelector('ul');
    const chips = Array.isArray(content.highlights)
        ? content.highlights
        : Array.isArray(content.keywords)
            ? content.keywords
            : [];
    if (chips.length > 0) {
        chips.forEach(kw => {
            const li = document.createElement('li');
            li.innerHTML = `<a href="#">${escapeHtml(kw)}</a>`;
            ul.appendChild(li);
        });
    } else {
        const li = document.createElement('li');
        li.textContent = "No highlights";
        ul.appendChild(li);
    }

    // Links
    renderLinks(nodeId);
    
    // History
    renderHistory(nodeId);
    
    // Source
    const md = app.markdownByNode.get(nodeId);
    if (md) {
        elements.markdownPath.textContent = md.path;
        elements.markdownContent.value = md.content;
    } else {
        elements.markdownPath.textContent = "No markdown projection";
        elements.markdownContent.value = JSON.stringify(content, null, 2);
    }
    
    // Audit
    renderAudit(nodeId);

    // Visualizations
    renderGraphs(nodeId);

    renderConversationsForNode(nodeId);
}

function renderLinks(nodeId) {
    const out = app.model.outgoing.get(nodeId) || [];
    const inc = app.model.incoming.get(nodeId) || [];
    
    const renderList = (list, container) => {
        container.innerHTML = "";
        if (list.length === 0) {
            container.textContent = "None";
            return;
        }
        const ul = document.createElement('ul');
        list.forEach(item => {
            const targetId = item.target || item.source;
            const targetNode = app.model.nodeById.get(targetId);
            const title = targetNode?.title || targetId;
            const li = document.createElement('li');
            li.innerHTML = `<a href="#" onclick="selectNode('${targetId}'); return false;">${escapeHtml(title)}</a> <span style="font-size:0.8em; color:#72777d">(${item.label || 'link'})</span>`;
            ul.appendChild(li);
        });
        container.appendChild(ul);
    };
    
    renderList(out, elements.outgoingLinks);
    renderList(inc, elements.incomingLinks);
}

function renderHistory(nodeId) {
    const list = app.model.versionsByNode.get(nodeId) || [];
    elements.versionList.innerHTML = "";
    
    // Reverse chronological
    [...list].reverse().forEach(v => {
        const li = document.createElement('li');
        li.className = "history-item";
        li.innerHTML = `
            <a href="#">${formatTimestamp(v.timestamp)}</a>
            <span class="history-meta">by Agent • Confidence: ${v.confidence}</span>
            <div style="font-size:0.9em;">${v.content.summary ? escapeHtml(v.content.summary) : 'Update'}</div>
        `;
        // Click to rollback logic removed

        elements.versionList.appendChild(li);
    });
}

function renderAudit(nodeId) {
    const audits = app.agentActions.filter(a => a.node_id === nodeId);
    elements.auditList.innerHTML = "";
    if (audits.length === 0) {
        elements.auditList.textContent = "No audit logs.";
        return;
    }
    audits.forEach(a => {
        const li = document.createElement('li');
        li.innerHTML = `<strong>${a.action}</strong>: ${escapeHtml(a.reason)} <span style="font-size:0.8em; color:#72777d">(${formatTimestamp(a.timestamp)})</span>`;
        elements.auditList.appendChild(li);
    });
}

function renderHabits() {
    const container = elements.habitsList;
    container.innerHTML = '';
    if (!app.habits || app.habits.length === 0) {
        container.innerHTML = '<p class="mw-hint">No habits recorded.</p>';
        return;
    }
    app.habits
      .slice()
      .reverse()
      .forEach(item => {
        const div = document.createElement('div');
        div.className = 'mw-card';
        div.innerHTML = `
          <h4>${escapeHtml(item.topic || 'habit')}</h4>
          <p><strong>Summary:</strong> ${escapeHtml(item.summary || '')}</p>
          <p><strong>Details:</strong> ${escapeHtml(item.details || '')}</p>
          <p class="mw-hint">Updated: ${escapeHtml(formatTimestamp(item.timestamp))} | Agent: ${escapeHtml(item.agent_id || '')}</p>
        `;
        container.appendChild(div);
      });
}

function renderPatterns() {
    const container = elements.patternsList;
    container.innerHTML = '';
    if (!app.patterns || app.patterns.length === 0) {
        container.innerHTML = '<p class="mw-hint">No patterns recorded.</p>';
        return;
    }
    app.patterns
      .slice()
      .reverse()
      .forEach(item => {
        const div = document.createElement('div');
        div.className = 'mw-card';
        div.innerHTML = `
          <h4>${escapeHtml(item.pattern_key || 'pattern')}</h4>
          <p><strong>Summary:</strong> ${escapeHtml(item.summary || '')}</p>
          <p><strong>Details:</strong> ${escapeHtml(item.details || '')}</p>
          <p><strong>Plan:</strong> ${escapeHtml(item.applicable_plan || 'general')}</p>
          <p class="mw-hint">Updated: ${escapeHtml(formatTimestamp(item.timestamp))} | Agent: ${escapeHtml(item.agent_id || '')}</p>
        `;
        container.appendChild(div);
      });
}

function renderConversationsForNode(nodeId) {
    const label = elements.conversationNodeLabel;
    const list = elements.conversationList;
    const detail = elements.conversationDetail;
    list.innerHTML = '';
    detail.textContent = 'Select a conversation to view raw content.';

    if (!nodeId) {
        label.textContent = 'No node selected.';
        return;
    }
    label.textContent = `Node: ${nodeId}`;
    const items = app.nodeConversations.get(nodeId) || [];
    if (items.length === 0) {
        list.innerHTML = '<li class="mw-hint">No conversations mapped.</li>';
        return;
    }
    items.forEach(item => {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.className = 'mw-conv-link';
        a.textContent = `${item.conversation_id} (${item.reason || 'atomic_knowledge'})`;
        a.href = '#';
        a.onclick = (e) => {
            e.preventDefault();
            showConversation(item.conversation_id);
        };
        li.appendChild(a);
        list.appendChild(li);
    });
}

function showConversation(conversationId) {
    const detail = elements.conversationDetail;
    const cached = app.conversations.get(conversationId);
    if (cached) {
        detail.textContent = JSON.stringify(cached, null, 2);
        return;
    }
    const path = app.conversationFiles.get(conversationId);
    if (!path) {
        detail.textContent = 'Conversation file not found.';
        return;
    }
    readJsonOptional(path)
      .then((data) => {
        if (!data) {
            detail.textContent = 'Conversation file unreadable.';
            return;
        }
        app.conversations.set(conversationId, data);
        detail.textContent = JSON.stringify(data, null, 2);
      })
      .catch(() => {
        detail.textContent = 'Conversation file unreadable.';
      });
}

function renderGraphs(nodeId) {
    elements.relationSvg.innerHTML = "";
    elements.versionSvg.innerHTML = "";

    const relationTitle = createSvgEl("text", { x: 12, y: 20, fill: "#54595d", "font-size": 12 });
    relationTitle.textContent = "Relations";
    elements.relationSvg.appendChild(relationTitle);

    const outgoing = app.model.outgoing.get(nodeId) || [];
    const incoming = app.model.incoming.get(nodeId) || [];
    const centerX = 230;
    const centerY = 120;
    const centerNode = createSvgEl("circle", { cx: centerX, cy: centerY, r: 20, fill: "#36c", stroke: "#202122" });
    const centerLabel = createSvgEl("text", { x: centerX, y: centerY + 4, "text-anchor": "middle", fill: "#fff", "font-size": 11 });
    centerLabel.textContent = "Current";
    elements.relationSvg.appendChild(centerNode);
    elements.relationSvg.appendChild(centerLabel);

    const relationItems = [
        ...incoming.slice(0, 3).map(i => ({ type: "in", id: i.source })),
        ...outgoing.slice(0, 3).map(i => ({ type: "out", id: i.target }))
    ];
    relationItems.forEach((item, idx) => {
        const angle = (Math.PI * 2 * idx) / Math.max(1, relationItems.length);
        const x = centerX + Math.cos(angle) * 90;
        const y = centerY + Math.sin(angle) * 70;
        const line = createSvgEl("line", { x1: centerX, y1: centerY, x2: x, y2: y, stroke: "#a2a9b1" });
        const node = createSvgEl("circle", { cx: x, cy: y, r: 14, fill: item.type === "in" ? "#2a4b8d" : "#14866d" });
        const text = createSvgEl("text", { x, y: y + 4, "text-anchor": "middle", fill: "#fff", "font-size": 9 });
        text.textContent = shortId(item.id).slice(0, 6);
        elements.relationSvg.appendChild(line);
        elements.relationSvg.appendChild(node);
        elements.relationSvg.appendChild(text);
    });

    const versions = app.model.versionsByNode.get(nodeId) || [];
    if (versions.length === 0) {
        const noneText = createSvgEl("text", { x: 12, y: 24, fill: "#54595d", "font-size": 12 });
        noneText.textContent = "No versions";
        elements.versionSvg.appendChild(noneText);
        return;
    }

    versions.forEach((v, idx) => {
        const x = 40 + idx * 70;
        const y = 120;
        if (idx > 0) {
            const prevX = 40 + (idx - 1) * 70;
            const edge = createSvgEl("line", { x1: prevX + 14, y1: y, x2: x - 14, y2: y, stroke: "#72777d" });
            elements.versionSvg.appendChild(edge);
        }
        const circle = createSvgEl("circle", { cx: x, cy: y, r: 14, fill: "#36c" });
        const label = createSvgEl("text", { x, y: y + 4, "text-anchor": "middle", fill: "#fff", "font-size": 9 });
        label.textContent = String(idx + 1);
        const ts = createSvgEl("text", { x, y: y + 28, "text-anchor": "middle", fill: "#54595d", "font-size": 9 });
        ts.textContent = new Date((Number(v.timestamp) || 0) * 1000).toLocaleDateString();
        elements.versionSvg.appendChild(circle);
        elements.versionSvg.appendChild(label);
        elements.versionSvg.appendChild(ts);
    });
}

// --- CLI Bridge ---
async function connectCliBridge() {
    try {
      const resp = await fetch("/api/cli/status");
      const data = await resp.json();
      if (!resp.ok || !data?.ok) throw new Error(data?.error || "Bridge not available");
      
      app.cliConnected = true;
      elements.cliBridgeStatus.textContent = `CLI Connected (${data.memoryRoot})`;
      elements.cliBridgeStatus.style.color = "green";
      
      await refreshMemoryFromCliBridge();
      pollCliConversation();
    } catch (e) {
      app.cliConnected = false;
      elements.cliBridgeStatus.textContent = "CLI Disconnected";
      elements.cliBridgeStatus.style.color = "red";
    }
}

async function refreshMemoryFromCliBridge() {
    // Trigger a re-read of data if possible, or just notify user
    // In this static UI context, we might need to reload the folder or fetch from API
    // For now, just log
    console.log("Refreshing memory from bridge...");
}

async function pollCliConversation() {
    if (!app.cliConnected) return;
    try {
        const resp = await fetch("/api/cli/conversation");
        const data = await resp.json();
        if (data.ok && Array.isArray(data.history)) {
            renderCliMessages(data.history);
        }
    } catch (e) {
        console.error("Poll failed", e);
    }
    setTimeout(pollCliConversation, 2000);
}

function renderCliMessages(history) {
    elements.cliDialogueList.innerHTML = "";
    history.forEach(msg => {
        const div = document.createElement('div');
        div.className = `cli-msg ${msg.role}`;
        div.textContent = msg.content;
        elements.cliDialogueList.appendChild(div);
    });
    // Scroll to bottom
    elements.cliDialogueList.scrollTop = elements.cliDialogueList.scrollHeight;
}

async function sendCliQuery() {
    const text = elements.cliQueryInput.value.trim();
    if (!text) return;
    
    elements.cliQueryInput.value = "";
    // Optimistic render
    renderCliMessages([...app.cliMessages, { role: 'user', content: text }]);
    
    try {
        await fetch("/api/cli/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message: text })
        });
        // Poll will update the response
    } catch (e) {
        alert("Failed to send: " + e.message);
    }
}

// --- Main Init ---
elements.folderInput.addEventListener("change", async (e) => {
  const files = e.target.files;
  if (!files || files.length === 0) return;
  
  elements.status.textContent = "Scanning files...";
  app.fileMap = buildFileMap(files);
  const paths = Array.from(app.fileMap.keys());
  app.roots = detectStorageRoots(paths);
  
  if (app.roots.length > 0) {
      app.currentRoot = app.roots[0];
      updateRootSelect();
      elements.status.textContent = `Found ${app.roots.length} roots. Click Load Data.`;
  } else {
      elements.status.textContent = "No compatible Mempedia data found.";
  }
});

elements.parseBtn.addEventListener("click", async () => {
  if (!app.currentRoot) {
      alert("Please select a storage root.");
      return;
  }
  
  try {
      elements.status.textContent = "Loading indexes...";
      const root = app.currentRoot;
      const state = await readJsonOptional(`${root}index/state.json`);
      const heads = await readJsonOptional(`${root}index/heads.json`);
      const nodes = await readJsonOptional(`${root}index/nodes.json`);
      const accessLogs = await readJsonLines(`${root}index/access.log`);
      const agentActions = await readJsonLines(`${root}index/agent_actions.log`);
      const habits = await readJsonLines(`${root}index/user_habits.jsonl`);
      const patterns = await readJsonLines(`${root}index/behavior_patterns.jsonl`);
      const nodeConversations = await readJsonLines(`${root}index/node_conversations.jsonl`);
      
      app.snapshot = { 
          heads: heads || {}, 
          nodes: nodes || {},
          state: state || {}
      };
      app.accessLogs = accessLogs;
      app.agentActions = agentActions;
      app.habits = habits;
      app.patterns = patterns;
      app.nodeConversations = new Map();
      if (Array.isArray(nodeConversations)) {
          nodeConversations.forEach((row) => {
              if (!row || typeof row.node_id !== 'string') return;
              const list = app.nodeConversations.get(row.node_id) || [];
              list.push(row);
              app.nodeConversations.set(row.node_id, list);
          });
      }
      app.conversationFiles = new Map();
      app.conversations = new Map();

      elements.status.textContent = "Loading objects...";
      const versionFiles = Array.from(app.fileMap.keys()).filter(p => p.startsWith(`${root}objects/`) && p.endsWith('.json'));
      app.versions.clear();
      
      for (const p of versionFiles) {
          const ver = await readJsonOptional(p);
          if (!ver) continue;
          const fileVersionId = p.split('/').pop()?.replace(/\.json$/, "");
          const versionId = ver.version || ver.id || fileVersionId;
          if (!versionId) continue;
          app.versions.set(versionId, { ...ver, version: versionId });
      }

      const markdownFiles = Array.from(app.fileMap.keys()).filter(p => p.startsWith(`${root}knowledge/nodes/`) && p.endsWith('.md'));
      app.markdownByNode.clear();
      for (const p of markdownFiles) {
          const text = await readTextOptional(p);
          if (!text) continue;
          let nodeId = null;
          const fmMatch = text.match(/^---\s*\n([\s\S]*?)\n---/);
          if (fmMatch) {
              const nodeMatch = fmMatch[1].match(/^\s*node_id:\s*["']?([^"'\n]+)["']?\s*$/m);
              if (nodeMatch) nodeId = nodeMatch[1].trim();
          }
          if (!nodeId) {
              const fileName = p.split('/').pop() || "";
              nodeId = fileName.replace(/-[0-9a-f]{8}\.md$/i, "").replace(/\.md$/i, "");
          }
          app.markdownByNode.set(nodeId, { path: p, content: text });
      }
      
      const model = buildModel(app.snapshot, app.versions, accessLogs);
      app.model = model;
      
      elements.metricNodes.textContent = model.nodes.length;
      elements.metricEdges.textContent = model.edges.length;
      elements.metricVersions.textContent = app.versions.size;
      elements.metricAccess.textContent = accessLogs.length;
      
      renderNodeList();
      renderHabits();
      renderPatterns();
      renderConversationsForNode(app.selectedNodeId);

      const conversationFiles = Array.from(app.fileMap.keys()).filter(p => p.startsWith(`${root}index/conversations/`) && p.endsWith('.json'));
      conversationFiles.forEach((p) => {
          const id = p.split('/').pop()?.replace(/\\.json$/i, '');
          if (id) {
              app.conversationFiles.set(id, p);
          }
      });
      
      elements.status.textContent = `Loaded ${model.nodes.length} nodes, ${app.versions.size} versions, ${app.markdownByNode.size} markdown files.`;
      
  } catch (e) {
      console.error(e);
      elements.status.textContent = "Error: " + e.message;
  }
});

elements.cliConnectBtn.addEventListener("click", connectCliBridge);
elements.cliSendBtn.addEventListener("click", sendCliQuery);
elements.nodeSearch.addEventListener("input", renderNodeList);
elements.keywordSearchBtn.addEventListener("click", () => {
    // Simple client-side search
    const q = elements.keywordSearch.value.toLowerCase();
    const results = app.model.nodes.filter(n => 
        n.title.toLowerCase().includes(q) || 
        (n.headVersion?.content?.summary || "").toLowerCase().includes(q)
    );
    
    // Render results in Main Page special view
    app.selectedNodeId = null;
    app.switchTab('read');
    
    const container = elements.keywordResults;
    container.innerHTML = `<h3>Search Results for "${escapeHtml(q)}"</h3>`;
    if (results.length === 0) {
        container.innerHTML += "<p>No results found.</p>";
    } else {
        const ul = document.createElement('ul');
        results.forEach(n => {
            const li = document.createElement('li');
            li.innerHTML = `<a href="#" onclick="selectNode('${n.id}'); return false;">${escapeHtml(n.title)}</a> - ${escapeHtml(shortId(n.id))}`;
            ul.appendChild(li);
        });
        container.appendChild(ul);
    }
});

// Init
applyStaticI18n();
app.switchTab('read');
