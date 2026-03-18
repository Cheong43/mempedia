# Mempedia (Rust)

A lightweight long-term memory engine for AI agents with a 4-layer knowledge architecture:

1. **Core Knowledge** – hierarchical, graph-indexed nodes (Wikipedia-style); human-readable markdown projections; supports document import via `import-doc` CLI command
2. **Episodic Memory** – time-ordered scene records with BM25 keyword retrieval; importance decays over time; links back to core-knowledge nodes updated during the episode
3. **User Preferences** – single per-project markdown config file capturing habits, preferences, and personal info
4. **Agent Skills** – individual markdown skill files with BM25 fast retrieval; no graph indexing needed

Use cases: projects that need traceable, forkable, mergeable, and explainable structured memory, rather than plain-text RAG retrieval.

Naming:
- `Mempedia` = memory knowledge graph encyclopedia for agents

Default storage location (project-scoped):
- `<project>/.mempedia/memory`

---

## English

### 1. Quick Start

#### 1.1 Requirements

- Rust `1.93+` (latest stable recommended)
- macOS / Linux

#### 1.2 Run the CLI

```bash
cargo run -- --help
```

Embedding configuration (optional, for real vector search):
- `EMBEDDING_API_KEY` (or `OPENAI_API_KEY`)
- `EMBEDDING_BASE_URL` (optional, defaults to `https://api.openai.com/v1`)
- `EMBEDDING_MODEL` (optional, defaults to `text-embedding-3-small`)
- `EMBEDDING_TIMEOUT_MS` (optional, default 120000)

CLI will not write demo data automatically. You must pass an action JSON explicitly.
If `--project` is omitted, current working directory is used as project root.

#### 1.3 Common Dev Commands

```bash
cargo fmt
cargo check
cargo test
cargo run
```

#### 1.4 Local Demo from Scratch

```bash
# 1) Create a project first
cargo run -- --project /path/to/project --action '{"action":"create_project","project_id":"real_estate","name":"Real Estate KB","description":"Domain knowledge for real estate analysis and decision making"}'

# 2) Create a project index node
cat > action.json <<'JSON'
{"action":"ingest","node_id":"real_estate_index","title":"Real Estate Knowledge Base","text":"# Real Estate Knowledge Base\n\nThis project covers real estate market analysis, valuation methods, investment strategies, and regulatory frameworks.","source":"human","project":"real_estate","node_type":"index"}
JSON
cargo run -- --project /path/to/project --action-file action.json

# 3) Add a concept node
cargo run -- --project /path/to/project --action '{"action":"ingest","node_id":"cap_rate","title":"Capitalization Rate (Cap Rate)","text":"# Cap Rate\n\nThe cap rate is the ratio of net operating income to property value. Formula: Cap Rate = NOI / Property Value. A higher cap rate indicates higher risk and higher potential return.","source":"human","project":"real_estate","parent_node":"real_estate_index","node_type":"concept"}'

# 4) List project nodes
cargo run -- --project /path/to/project --action '{"action":"list_project_nodes","project_id":"real_estate"}'

# 5) Run tests
cargo test

# 6) Inspect generated data
find /path/to/project/.mempedia -maxdepth 5 -type f | sort
```

#### 1.5 Import Documents into Core Knowledge (import-doc)

```bash
# Import a single markdown file
node mempedia-codecli/src/index.tsx import-doc --file /path/to/doc.md

# Import with explicit node id and title
node mempedia-codecli/src/index.tsx import-doc --file /path/to/doc.md --node-id my_doc --title "My Document"

# Import all markdown files in a directory (non-recursive)
node mempedia-codecli/src/index.tsx import-doc --dir /path/to/docs

# Import recursively
node mempedia-codecli/src/index.tsx import-doc --dir /path/to/docs --recursive
```

### 2. Core Model in 5 Minutes

#### 2.1 Node and Version

- `Node` is identity and does not store mutable content directly.
- `NodeVersion` is an immutable snapshot at a point in time.
- Every update creates a new version (no in-place overwrite).

#### 2.2 Version DAG

Each `NodeVersion` has `parents: Vec<VersionId>`, enabling:
- Linear history
- Forks
- Merges (multi-parent)

#### 2.3 Append-only Principle

- Historical versions are never modified
- Head pointer moves to the latest version
- Index snapshots are written atomically

#### 2.4 Project Hierarchy

Nodes can optionally belong to a **project** (domain/category), which:
- Groups related nodes under `knowledge/projects/<project_id>/`
- Supports Notion-style parent–child relationships via `parent_node`
- Classifies nodes by semantic type via `node_type` (index, concept, process, etc.)

Use `create_project` before adding project-scoped nodes, then set `project`, `parent_node`, and `node_type` when calling `ingest`, `agent_upsert_markdown`, or `sync_markdown`.

### 3. Storage Layout

```text
data/
  index/
    state.json              # index snapshot (heads + nodes)
    heads.json              # compatibility/readable copy
    nodes.json              # compatibility/readable copy
    access.log              # optional access log
    agent_actions.log       # autonomous agent update audit
    node_project_index.json # node_id → project_id mapping
  objects/
    <hash_prefix>/
      <version_hash>.json
  knowledge/
    nodes/                  # unclassified nodes (legacy / no project)
      <sanitized_node_id>-<hash8>.md
    projects/
      _index.json           # project metadata registry
      <project_id>/         # one directory per project
        <sanitized_node_id>-<hash8>.md
  episodic/               # Layer 2: Episodic memory
    memories.jsonl        # append-only list of EpisodicMemoryRecord (BM25 indexed)
  preferences.md          # Layer 3: User preferences (single markdown file)
  skills/                 # Layer 4: Agent skills
    <skill_id>-<hash8>.md # One file per skill (frontmatter + markdown body)
```

Notes:
- `version_hash = blake3(serialized_node_version)`
- Objects are bucketed by hash prefix
- Index files are atomically written (`tmp + rename + fsync`)
- Episodic memories are stored chronologically in JSONL; importance decays over time
- Project node directories are created on first write

### 4. Rust API

Entry: `src/api/mod.rs`

```rust
use mempedia::api::MemoryEngine;
use mempedia::core::{NodeContent, NodePatch};

let mut engine = MemoryEngine::open("./data")?;

let content = NodeContent::default();
let created = engine.create_node("MyNode", content, 0.8, 1.0)?;

let patch = NodePatch {
    body: Some("new body".to_string()),
    ..NodePatch::default()
};
let updated = engine.update_node("MyNode", patch, 0.9, 1.2)?;

let bfs = engine.traverse_bfs("MyNode", Some(2));
println!("{:?} {:?} {:?}", created.version, updated.version, bfs);
# Ok::<(), Box<dyn std::error::Error>>(())
```

### 5. Tool Protocol (JSON Action)

For agent-side direct calls:
- `upsert_node`
- `fork_node`
- `merge_node`
- `open_node`
- `access_node`
- `compare_versions`
- `traverse`
- `search_nodes`
- `search_hybrid`
- `suggest_exploration`
- `explore_with_budget`
- `auto_link_related`
- `agent_upsert_markdown` *(supports `project`, `parent_node`, `node_type`)*
- `ingest` *(supports `project`, `parent_node`, `node_type`)*
- `sync_markdown` *(supports `project`, `parent_node`, `node_type`)*
- `rollback_node`
- `node_history`
- `create_project`
- `list_projects`
- `get_project`
- `list_project_nodes`

Request examples:

```json
{ "action": "create_project", "project_id": "real_estate", "name": "Real Estate KB", "description": "Domain knowledge for real estate." }
```

```json
{
  "action": "ingest",
  "node_id": "cap_rate",
  "title": "Capitalization Rate",
  "text": "# Cap Rate\n\nCap Rate = NOI / Property Value.",
  "source": "human",
  "project": "real_estate",
  "parent_node": "real_estate_index",
  "node_type": "concept"
}
```

```json
{ "action": "list_project_nodes", "project_id": "real_estate" }
```

```json
{
  "action": "traverse",
  "start_node": "real_estate_index",
  "mode": "bfs",
  "depth_limit": 2
}
```

CLI examples:

```bash
cargo run -- --project /path/to/project --action '{"action":"create_project","project_id":"real_estate","name":"Real Estate KB","description":"Real estate domain knowledge"}'
cargo run -- --project /path/to/project --action-file action.json
cat action.json | cargo run -- --project /path/to/project --stdin
cargo run -- --project /path/to/project --action '{"action":"list_project_nodes","project_id":"real_estate"}'
cargo run -- --project /path/to/project --action '{"action":"sync_markdown","path":"/path/to/doc.md","project":"real_estate","node_type":"reference"}'
```

Runtime mode:

```bash
# start runtime process (line-delimited action JSON input / output)
cargo run -- --project /path/to/project --serve

# quit runtime
:quit
```

### 6. Web UI Localization

`mempedia-ui` now includes bilingual UI support:
- Default language: **English**
- Optional language: 简体中文
- Language selector in top-right of the page
- Selection persisted in browser `localStorage`

---

## 中文

### 1. 快速开始

#### 1.1 环境要求

- Rust `1.93+`（建议最新 stable）
- macOS / Linux

#### 1.2 运行 CLI

```bash
cargo run -- --help
```

CLI 不会自动写入示例数据，必须显式传入 action JSON。
未指定 `--project` 时，默认当前目录为项目根目录。

#### 1.3 开发常用命令

```bash
cargo fmt
cargo check
cargo test
cargo run
```

#### 1.4 本地从零体验

```bash
# 1) 创建项目
cargo run -- --project /path/to/project --action '{"action":"create_project","project_id":"real_estate","name":"房产知识库","description":"房地产市场分析、估值方法和投资策略"}'

# 2) 创建项目索引节点
cargo run -- --project /path/to/project --action '{"action":"ingest","node_id":"real_estate_index","title":"房产知识库索引","text":"# 房产知识库\n\n本项目涵盖房地产市场分析、估值方法、投资策略和法规框架。","source":"human","project":"real_estate","node_type":"index"}'

# 3) 添加概念节点
cargo run -- --project /path/to/project --action '{"action":"ingest","node_id":"cap_rate","title":"资本化率（Cap Rate）","text":"# 资本化率\n\nCap Rate = 净营业收入 / 物业价值。较高的资本化率意味着较高的风险和潜在回报。","source":"human","project":"real_estate","parent_node":"real_estate_index","node_type":"concept"}'

# 4) 查看项目下的节点
cargo run -- --project /path/to/project --action '{"action":"list_project_nodes","project_id":"real_estate"}'

cargo test
find /path/to/project/.mempedia -maxdepth 5 -type f | sort
```

### 2. 核心模型

- `Node` 是身份，不直接承载可变内容
- `NodeVersion` 是状态快照，内容不可变
- 任何更新都会创建新版本，不覆盖旧版本

`NodeVersion.parents` 支持线性历史、分叉和合并。

### 2.4 项目层级（Project Hierarchy）

节点可以归属于**项目**（领域/分类），实现：
- 按项目存储 markdown 文件：`knowledge/projects/<project_id>/`
- 通过 `parent_node` 建立 Notion 风格的父子层级结构
- 通过 `node_type` 标注语义类型（index、concept、process 等）

### 3. 存储结构

```text
data/
  index/
    state.json
    heads.json
    nodes.json
    access.log
    agent_actions.log
    node_project_index.json   # node_id → project_id 映射
  objects/
    <hash_prefix>/
      <version_hash>.json
  knowledge/
    nodes/                    # 未分类节点（兼容旧数据）
      <sanitized_node_id>-<hash8>.md
    projects/
      _index.json             # 项目元数据注册表
      <project_id>/           # 每个项目一个目录
        <sanitized_node_id>-<hash8>.md
```

### 4. API 与 Action

Rust API 入口：`src/api/mod.rs`。

支持 action：
- `upsert_node`
- `fork_node`
- `merge_node`
- `open_node`
- `access_node`
- `compare_versions`
- `traverse`
- `search_nodes`
- `search_hybrid`
- `suggest_exploration`
- `explore_with_budget`
- `auto_link_related`
- `agent_upsert_markdown`（支持 `project`、`parent_node`、`node_type`）
- `ingest`（支持 `project`、`parent_node`、`node_type`）
- `sync_markdown`（支持 `project`、`parent_node`、`node_type`）
- `rollback_node`
- `node_history`
- `create_project`
- `list_projects`
- `get_project`
- `list_project_nodes`

### 5. UI 多语言

`mempedia-ui` 已支持双语：
- 默认英文
- 可切换简体中文
- 右上角语言切换器
- 语言偏好会保存在浏览器本地
