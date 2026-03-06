# Agent Memory Engine (Rust)

A lightweight long-term memory engine for AI agents:
- Append-only history
- Immutable versions
- Node/Version DAG
- Filesystem storage (no external database)

Use cases: projects that need traceable, forkable, mergeable, and explainable structured memory, rather than plain-text RAG retrieval.

Naming:
- `M2W` = `Memory to Wiki`

Default storage location (project-scoped):
- `<project>/.M2W/memory`

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
# 1) Create an action request
cat > action.json <<'JSON'
{"action":"create_node","node_id":"Fatigue_Model","content":{"title":"Fatigue Model","body":"Base assumptions","structured_data":{"state":"draft"},"links":[],"highlights":["recovery"]},"confidence":0.8,"importance":1.0}
JSON

# 2) Execute action (create node)
cargo run -- --project /path/to/project --action-file action.json

# 3) Open the node
cargo run -- --project /path/to/project --action '{"action":"open_node","node_id":"Fatigue_Model"}'

# 4) Run tests
cargo test

# 5) Inspect generated data
find /path/to/project/.M2W -maxdepth 4 -type f | sort
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

### 3. Storage Layout

```text
data/
  index/
    state.json      # index snapshot (heads + nodes)
    heads.json      # compatibility/readable copy
    nodes.json      # compatibility/readable copy
    access.log      # optional access log
  objects/
    <hash_prefix>/
      <version_hash>.json
```

Notes:
- `version_hash = blake3(serialized_node_version)`
- Objects are bucketed by hash prefix
- Index files are atomically written (`tmp + rename + fsync`)

### 4. Rust API

Entry: `src/api/mod.rs`

```rust
use agent_memory::api::MemoryEngine;
use agent_memory::core::{NodeContent, NodePatch};

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
- `create_node`
- `update_node`
- `fork_node`
- `merge_node`
- `open_node`
- `access_node`
- `compare_versions`
- `traverse`
- `search_by_highlight`
- `search_by_keyword`
- `suggest_exploration`
- `explore_with_budget`
- `auto_link_related`

Request example:

```json
{
  "action": "traverse",
  "start_node": "Fatigue_Model",
  "mode": "bfs",
  "depth_limit": 2,
  "min_confidence": null
}
```

CLI examples:

```bash
cargo run -- --project /path/to/project --action '{"action":"open_node","node_id":"Fatigue_Model","agent_id":"agent-main"}'
cargo run -- --project /path/to/project --action-file action.json
cat action.json | cargo run -- --project /path/to/project --stdin
```

Runtime mode:

```bash
# start runtime process (line-delimited action JSON input / output)
cargo run -- --project /path/to/project --serve

# quit runtime
:quit
```

### 6. Web UI Localization

`M2W-UI` now includes bilingual UI support:
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
cat > action.json <<'JSON'
{"action":"create_node","node_id":"Fatigue_Model","content":{"title":"Fatigue Model","body":"Base assumptions","structured_data":{"state":"draft"},"links":[],"highlights":["recovery"]},"confidence":0.8,"importance":1.0}
JSON

cargo run -- --project /path/to/project --action-file action.json
cargo run -- --project /path/to/project --action '{"action":"open_node","node_id":"Fatigue_Model"}'
cargo test
find /path/to/project/.M2W -maxdepth 4 -type f | sort
```

### 2. 核心模型

- `Node` 是身份，不直接承载可变内容
- `NodeVersion` 是状态快照，内容不可变
- 任何更新都会创建新版本，不覆盖旧版本

`NodeVersion.parents` 支持线性历史、分叉和合并。

### 3. 存储结构

```text
data/
  index/
    state.json
    heads.json
    nodes.json
    access.log
  objects/
    <hash_prefix>/
      <version_hash>.json
```

### 4. API 与 Action

Rust API 入口：`src/api/mod.rs`。

支持 action：
- `create_node`
- `update_node`
- `fork_node`
- `merge_node`
- `open_node`
- `access_node`
- `compare_versions`
- `traverse`
- `search_by_highlight`
- `search_by_keyword`
- `suggest_exploration`
- `explore_with_budget`
- `auto_link_related`

### 5. UI 多语言

`M2W-UI` 已支持双语：
- 默认英文
- 可切换简体中文
- 右上角语言切换器
- 语言偏好会保存在浏览器本地
