const SVG_NS = "http://www.w3.org/2000/svg";

const elements = {
  folderInput: document.getElementById("folder-input"),
  rootSelect: document.getElementById("root-select"),
  parseBtn: document.getElementById("parse-btn"),
  status: document.getElementById("status"),
  metricNodes: document.getElementById("metric-nodes"),
  metricEdges: document.getElementById("metric-edges"),
  metricVersions: document.getElementById("metric-versions"),
  metricAccess: document.getElementById("metric-access"),
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
  relationSvg: document.getElementById("relation-svg"),
  versionSvg: document.getElementById("version-svg"),
};

const app = {
  fileMap: new Map(),
  roots: [],
  currentRoot: "",
  snapshot: { heads: {}, nodes: {} },
  versions: new Map(),
  accessLogs: [],
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
  selectedNodeId: null,
  searchQuery: "",
};

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
    return "未知";
  }
  return new Date(n * 1000).toLocaleString("zh-CN", {
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
    option.textContent = "未检测到存储目录";
    elements.rootSelect.appendChild(option);
    elements.rootSelect.disabled = true;
    return;
  }

  elements.rootSelect.disabled = false;
  app.roots.forEach((root) => {
    const option = document.createElement("option");
    option.value = root;
    option.textContent = root || "(当前目录)";
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

async function readAccessLog(relativePath) {
  const file = app.fileMap.get(relativePath);
  if (!file) {
    return [];
  }

  const logs = [];
  const lines = (await file.text()).split(/\r?\n/);
  lines.forEach((line) => {
    if (!line.trim()) {
      return;
    }
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed.node_id === "string") {
        logs.push(parsed);
      }
    } catch (_) {
      // Ignore malformed log lines.
    }
  });
  return logs;
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
    return (
      node.id.toLowerCase().includes(query) ||
      node.title.toLowerCase().includes(query) ||
      node.body.toLowerCase().includes(query)
    );
  });
}

function renderNodeList() {
  const filtered = getFilteredNodes();
  elements.nodeCountLabel.textContent = `${filtered.length} / ${app.model.nodes.length} 个节点`;

  if (filtered.length === 0) {
    elements.nodeList.innerHTML = `<p class="hint">没有匹配的节点。</p>`;
    return;
  }

  const html = filtered
    .map((node) => {
      const active = node.id === app.selectedNodeId ? "active" : "";
      const title = node.title && node.title !== node.id ? node.title : "(无标题)";
      const tag = node.isTracked ? "主节点" : "引用节点";
      return `
        <button type="button" class="node-item ${active}" data-node-id="${escapeHtml(node.id)}">
          <strong>${escapeHtml(node.id)}</strong>
          <small>${escapeHtml(title)} | ${tag} | 出${node.outDegree} / 入${node.inDegree}</small>
        </button>
      `;
    })
    .join("");

  elements.nodeList.innerHTML = html;
}

function renderLinkButtons(nodeIds) {
  if (!nodeIds || nodeIds.length === 0) {
    return '<span class="hint">无</span>';
  }

  return nodeIds
    .map((id) => {
      return `<button type="button" class="wiki-link" data-node-id="${escapeHtml(id)}">${escapeHtml(id)}</button>`;
    })
    .join("");
}

function renderArticle() {
  const nodeId = app.selectedNodeId;
  if (!nodeId) {
    elements.articleTitle.textContent = "未选择节点";
    elements.articleMeta.textContent = "导入后从右侧索引选择节点。";
    elements.articleBody.textContent = "暂无内容。";
    elements.structuredTableBody.innerHTML = '<tr><td colspan="2">无结构化字段</td></tr>';
    elements.highlightsList.innerHTML = '<span class="chip">无</span>';
    elements.outgoingLinks.innerHTML = '<span class="hint">无</span>';
    elements.incomingLinks.innerHTML = '<span class="hint">无</span>';
    elements.versionList.innerHTML = "";
    return;
  }

  const node = app.model.nodeById.get(nodeId);
  const versions = getNodeVersions(nodeId);
  const headVersionId = node?.headVersionId || app.snapshot.heads?.[nodeId] || "";
  const headVersion = headVersionId ? app.versions.get(headVersionId) : null;
  const fallbackVersion = versions.at(-1)?.data || null;
  const current = headVersion || fallbackVersion;

  const title = (current?.content?.title || node?.title || nodeId).trim();
  const body = (current?.content?.body || "").trim();
  const structured = toSafeObject(current?.content?.structured_data);
  const highlights = Array.isArray(current?.content?.highlights)
    ? [...new Set(current.content.highlights.filter(Boolean))]
    : [];

  const outgoing = Array.from(app.model.outgoing.get(nodeId) || []).sort((a, b) => a.localeCompare(b));
  const incoming = Array.from(app.model.incoming.get(nodeId) || []).sort((a, b) => a.localeCompare(b));

  const metaParts = [
    `Node ID: ${nodeId}`,
    `Head: ${headVersionId ? shortId(headVersionId) : "无"}`,
    `更新: ${formatTimestamp(current?.timestamp)}`,
    `Confidence: ${(Number(current?.confidence) || 0).toFixed(2)}`,
    `Importance: ${(Number(current?.importance) || 0).toFixed(2)}`,
    `访问: ${node?.accessCount || 0}`,
  ];

  elements.articleTitle.textContent = title || nodeId;
  elements.articleMeta.textContent = metaParts.join(" | ");

  if (body) {
    elements.articleBody.textContent = body;
  } else if (!node?.isTracked) {
    elements.articleBody.textContent = "该节点是被引用节点，目前没有独立 head 内容。";
  } else {
    elements.articleBody.textContent = "该节点暂无正文内容。";
  }

  const structuredRows = Object.entries(structured)
    .map(([key, value]) => {
      return `<tr><th scope="row">${escapeHtml(key)}</th><td>${escapeHtml(value)}</td></tr>`;
    })
    .join("");
  elements.structuredTableBody.innerHTML =
    structuredRows || '<tr><td colspan="2">无结构化字段</td></tr>';

  elements.highlightsList.innerHTML =
    highlights.length > 0
      ? highlights.map((item) => `<span class="chip">${escapeHtml(item)}</span>`).join("")
      : '<span class="chip">无</span>';

  elements.outgoingLinks.innerHTML = renderLinkButtons(outgoing);
  elements.incomingLinks.innerHTML = renderLinkButtons(incoming);

  elements.versionList.innerHTML = versions
    .map((item) => {
      const parents = item.parents.length
        ? item.parents.map((parentId) => shortId(parentId)).join(", ")
        : "无";
      return `
        <li>
          <strong>${escapeHtml(shortId(item.id))}</strong>
          <span class="mono"> ${escapeHtml(item.id)}</span><br/>
          时间: ${escapeHtml(formatTimestamp(item.timestamp))} | 父版本: ${escapeHtml(parents)}<br/>
          Confidence: ${item.confidence.toFixed(2)} | Importance: ${item.importance.toFixed(2)}
        </li>
      `;
    })
    .join("");
}

function renderRelationGraph() {
  const svg = elements.relationSvg;
  svg.innerHTML = "";

  const nodeId = app.selectedNodeId;
  if (!nodeId) {
    const text = createSvgEl("text", {
      x: 145,
      y: 142,
      fill: "#5a6779",
      "font-size": "14",
    });
    text.textContent = "选择节点后显示关系";
    svg.appendChild(text);
    return;
  }

  const width = 460;
  const height = 280;
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
    const to = center;
    if (!from) {
      return;
    }
    const line = createSvgEl("line", {
      x1: from.x,
      y1: from.y,
      x2: to.x,
      y2: to.y,
      stroke: "#9db2d8",
      "stroke-width": "1.4",
      "marker-end": "url(#ego-arrow)",
      opacity: "0.88",
    });
    svg.appendChild(line);
  });

  outgoing.forEach((target) => {
    const from = center;
    const to = nodePos.get(target);
    if (!to) {
      return;
    }
    const line = createSvgEl("line", {
      x1: from.x,
      y1: from.y,
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
      "aria-label": `查看节点 ${id}`,
    });

    const circle = createSvgEl("circle", {
      cx: pos.x,
      cy: pos.y,
      r: isCenter ? 16 : 11,
      fill: isCenter ? "#2a5db0" : "#6f95cd",
      stroke: "#ffffff",
      "stroke-width": "2",
    });

    const label = createSvgEl("text", {
      x: pos.x + (isCenter ? 20 : 13),
      y: pos.y + 4,
      fill: "#1f2a37",
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

function renderVersionDag() {
  const svg = elements.versionSvg;
  svg.innerHTML = "";

  const nodeId = app.selectedNodeId;
  if (!nodeId) {
    const text = createSvgEl("text", {
      x: 145,
      y: 126,
      fill: "#5a6779",
      "font-size": "14",
    });
    text.textContent = "选择节点后显示版本 DAG";
    svg.appendChild(text);
    return;
  }

  const versions = getNodeVersions(nodeId);
  if (versions.length === 0) {
    const text = createSvgEl("text", {
      x: 120,
      y: 126,
      fill: "#5a6779",
      "font-size": "14",
    });
    text.textContent = "该节点暂无版本对象";
    svg.appendChild(text);
    return;
  }

  const ordered = [...versions].sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id));
  const laneByVersion = new Map();
  let nextRootLane = 0;

  ordered.forEach((record) => {
    const parentLanes = record.parents
      .map((parentId) => laneByVersion.get(parentId))
      .filter((lane) => lane !== undefined);

    let lane = 0;
    if (parentLanes.length === 0) {
      lane = nextRootLane;
      nextRootLane += 1;
    } else if (parentLanes.length === 1) {
      lane = parentLanes[0];
    } else {
      lane = Math.min(...parentLanes);
    }
    laneByVersion.set(record.id, lane);
  });

  const maxLane = Math.max(...Array.from(laneByVersion.values()), 0);
  const height = Math.max(240, 110 + (maxLane + 1) * 52);
  svg.setAttribute("viewBox", `0 0 460 ${height}`);

  const marginX = 28;
  const spacingX = ordered.length > 1 ? (460 - marginX * 2) / (ordered.length - 1) : 0;
  const laneGap = maxLane > 0 ? Math.min(64, (height - 90) / maxLane) : 0;

  const points = new Map();
  ordered.forEach((record, i) => {
    const lane = laneByVersion.get(record.id) || 0;
    points.set(record.id, {
      x: marginX + i * spacingX,
      y: 48 + lane * laneGap,
    });
  });

  ordered.forEach((record) => {
    const to = points.get(record.id);
    record.parents.forEach((parentId) => {
      const from = points.get(parentId);
      if (!from) {
        return;
      }

      const path = createSvgEl("path", {
        d: `M ${from.x + 9} ${from.y} C ${from.x + 32} ${from.y}, ${to.x - 32} ${to.y}, ${to.x - 9} ${to.y}`,
        fill: "none",
        stroke: "#98abcc",
        "stroke-width": "1.5",
      });
      svg.appendChild(path);
    });
  });

  const headVersionId = app.snapshot.heads?.[nodeId] || "";
  ordered.forEach((record) => {
    const point = points.get(record.id);
    const isHead = record.id === headVersionId;
    const circle = createSvgEl("circle", {
      cx: point.x,
      cy: point.y,
      r: isHead ? 9 : 7,
      fill: isHead ? "#2a5db0" : "#5f87c2",
      stroke: "#ffffff",
      "stroke-width": "1.8",
    });

    const idText = createSvgEl("text", {
      x: point.x - 15,
      y: point.y - 11,
      fill: "#1f2a37",
      "font-size": "9.5",
      "font-family": "JetBrains Mono, Menlo, Consolas, monospace",
    });
    idText.textContent = shortId(record.id);

    const timeText = createSvgEl("text", {
      x: point.x - 21,
      y: point.y + 16,
      fill: "#5a6779",
      "font-size": "9",
    });
    const ts = formatTimestamp(record.timestamp);
    timeText.textContent = ts === "未知" ? ts : ts.slice(5);

    svg.appendChild(circle);
    svg.appendChild(idText);
    svg.appendChild(timeText);
  });
}

function renderAll() {
  updateMetrics();
  renderNodeList();
  renderArticle();
  renderRelationGraph();
  renderVersionDag();
}

function selectNode(nodeId) {
  if (!nodeId) {
    return;
  }
  app.selectedNodeId = nodeId;
  renderAll();
}

async function parseAndRender() {
  if (app.roots.length === 0) {
    setStatus("请先选择包含 index/objects 的目录。", "warn");
    return;
  }

  try {
    const root = app.currentRoot;
    const stateJson = await readJsonOptional(`${root}index/state.json`);

    let heads = {};
    let nodes = {};

    if (stateJson && typeof stateJson === "object") {
      heads = toSafeObject(stateJson.heads);
      nodes = toSafeObject(stateJson.nodes);
    } else {
      heads = toSafeObject(await readJsonOptional(`${root}index/heads.json`));
      nodes = toSafeObject(await readJsonOptional(`${root}index/nodes.json`));
    }

    app.snapshot = { heads, nodes };

    const versions = new Map();
    let objectFileCount = 0;
    let objectParseErrorCount = 0;

    app.fileMap.forEach((_, path) => {
      if (path.startsWith(`${root}objects/`) && path.endsWith(".json")) {
        objectFileCount += 1;
      }
    });

    for (const [path, file] of app.fileMap.entries()) {
      if (!path.startsWith(`${root}objects/`) || !path.endsWith(".json")) {
        continue;
      }

      const fileName = path.split("/").pop() || "";
      const versionId = fileName.replace(/\.json$/i, "");

      try {
        const parsed = JSON.parse(await file.text());
        if (!parsed || typeof parsed !== "object") {
          objectParseErrorCount += 1;
          continue;
        }
        if (!parsed.version) {
          parsed.version = versionId;
        }
        versions.set(versionId, parsed);
      } catch (_) {
        objectParseErrorCount += 1;
      }
    }

    app.versions = versions;
    app.accessLogs = await readAccessLog(`${root}index/access.log`);
    app.model = buildModel(app.snapshot, app.versions, app.accessLogs);

    const tracked = app.model.nodes.filter((node) => node.isTracked);
    app.selectedNodeId = tracked[0]?.id || app.model.nodes[0]?.id || null;

    renderAll();

    const summary = [
      `已解析：${root || "(当前目录)"}`,
      `节点 ${app.model.nodes.length}`,
      `关系边 ${app.model.edges.length}`,
      `版本 ${app.versions.size}/${objectFileCount}`,
    ];

    if (objectParseErrorCount > 0) {
      summary.push(`对象解析失败 ${objectParseErrorCount}`);
    }
    if (app.model.missingHeadObjects > 0) {
      summary.push(`head 缺失对象 ${app.model.missingHeadObjects}`);
    }

    setStatus(summary.join(" | "), objectParseErrorCount > 0 ? "warn" : "ok");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus(`解析失败：${message}`, "warn");
  }
}

function clearVisuals() {
  app.snapshot = { heads: {}, nodes: {} };
  app.versions = new Map();
  app.accessLogs = [];
  app.model = buildModel(app.snapshot, app.versions, app.accessLogs);
  app.selectedNodeId = null;
  app.searchQuery = "";
  if (elements.nodeSearch) {
    elements.nodeSearch.value = "";
  }
  renderAll();
}

function handleNodeJumpClick(event) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const btn = target.closest("[data-node-id]");
  if (!(btn instanceof HTMLElement)) {
    return;
  }

  const nodeId = btn.getAttribute("data-node-id") || "";
  if (!nodeId) {
    return;
  }

  selectNode(nodeId);
}

elements.folderInput.addEventListener("change", async (event) => {
  const files = event.target.files;

  if (!files || files.length === 0) {
    app.fileMap.clear();
    app.roots = [];
    app.currentRoot = "";
    updateRootSelect();
    clearVisuals();
    setStatus("未选择任何目录。", "warn");
    return;
  }

  app.fileMap = buildFileMap(files);
  const paths = Array.from(app.fileMap.keys());
  app.roots = detectStorageRoots(paths);
  app.currentRoot = app.roots[0] || "";
  updateRootSelect();

  if (app.roots.length === 0) {
    clearVisuals();
    setStatus("未检测到 M2W 存储结构（需要 index/ + objects/）。", "warn");
    return;
  }

  if (app.roots.length === 1) {
    setStatus(`已检测到存储目录：${app.currentRoot || "(当前目录)"}，正在解析...`);
    await parseAndRender();
  } else {
    setStatus(`检测到 ${app.roots.length} 个存储目录，请选择后点击“解析”。`, "ok");
  }
});

elements.rootSelect.addEventListener("change", () => {
  app.currentRoot = elements.rootSelect.value;
});

elements.parseBtn.addEventListener("click", async () => {
  app.currentRoot = elements.rootSelect.value;
  await parseAndRender();
});

elements.nodeSearch.addEventListener("input", () => {
  app.searchQuery = elements.nodeSearch.value || "";
  renderNodeList();
});

elements.nodeList.addEventListener("click", handleNodeJumpClick);

elements.outgoingLinks.addEventListener("click", handleNodeJumpClick);

elements.incomingLinks.addEventListener("click", handleNodeJumpClick);

clearVisuals();
