# Agent Memory Engine (Rust)

一个为 AI Agent 设计的轻量级长期记忆引擎：
- 追加写（append-only）
- 版本不可变（immutable）
- Node/Version DAG
- 文件系统存储（无外部数据库）

适用场景：需要可追溯、可分叉、可合并、可解释的结构化记忆，而不是传统 RAG 文本召回。

## 1. 快速开始

### 1.1 环境要求

- Rust 1.93+（建议 stable 最新版）
- macOS / Linux

### 1.2 运行 CLI（生产入口）

```bash
cargo run -- --help
```

CLI 不会自动写入示例数据，必须显式传入 action JSON。

### 1.3 开发常用命令

```bash
cargo fmt
cargo check
cargo test
cargo run
```

### 1.4 从零开始本地体验（推荐顺序）

```bash
# 1) 写一个 action 请求
cat > action.json <<'JSON'
{"action":"create_node","node_id":"Fatigue_Model","content":{"title":"Fatigue Model","body":"Base assumptions","structured_data":{"state":"draft"},"links":[],"highlights":["recovery"]},"confidence":0.8,"importance":1.0}
JSON

# 2) 执行 action（创建节点）
cargo run -- --action-file action.json

# 3) 再执行读取
cargo run -- --action '{"action":"open_node","node_id":"Fatigue_Model"}'

# 4) 运行测试，确认核心行为可用
cargo test

# 5) 查看产生的数据结构
find data -maxdepth 3 -type f | sort
```

## 2. 5 分钟理解核心模型

### 2.1 Node 和 Version

- `Node` 是身份（identity），不直接存内容
- `NodeVersion` 是某时刻状态（state），内容不可变
- 任意更新都创建新版本，不覆盖旧版本

### 2.2 Version DAG

每个 `NodeVersion` 有 `parents: Vec<VersionId>`，支持：
- 线性历史
- 分叉（fork）
- 合并（merge，多父）

### 2.3 追加写原则

- 历史版本对象只增不改
- 头指针（head）移动到新版本
- 索引以快照原子落盘

## 3. 存储布局

```text
data/
  index/
    state.json      # 索引快照（heads + nodes）
    heads.json      # 兼容/可读副本
    nodes.json      # 兼容/可读副本
    access.log      # 可选访问日志
  objects/
    <hash_prefix>/
      <version_hash>.json
```

说明：
- `version_hash = blake3(serialized_node_version)`
- 对象文件按 hash 分桶存储
- 索引使用原子写入（tmp + rename + fsync）

## 4. API 用法（Rust）

入口文件：`src/api/mod.rs`

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

### 4.1 最小接入流程（你的业务代码）

1. 进程启动时创建/打开引擎：`MemoryEngine::open("./data")`
2. 每次业务状态变化调用 `update_node`（不要原地改旧版本）
3. Agent 推理前调用 `traverse_*` 获取候选上下文
4. 关键访问记录 `log_access(agent_id, node_id)`
5. 周期性按 signal 调用 `promote_node`

## 5. Tool Protocol（JSON Action）

用于 Agent 直接调用：
- `create_node`
- `update_node`
- `fork_node`
- `merge_node`
- `open_node`
- `compare_versions`
- `traverse`
- `search_by_highlight`

### 5.1 请求示例

```json
{
  "action": "traverse",
  "start_node": "Fatigue_Model",
  "mode": "bfs",
  "depth_limit": 2,
  "min_confidence": null
}
```

### 5.2 调用方式

```rust
let output_json = engine.execute_action_json(input_json_str);
```

### 5.2.1 CLI 调用方式

```bash
cargo run -- --action '{"action":"open_node","node_id":"Fatigue_Model"}'
cargo run -- --action-file action.json
cat action.json | cargo run -- --stdin
```

### 5.3 完整请求示例（create -> update -> open）

```json
{
  "action": "create_node",
  "node_id": "Fatigue_Model",
  "content": {
    "title": "Fatigue Model",
    "body": "Base assumptions",
    "structured_data": {"state": "draft"},
    "links": [],
    "highlights": ["recovery"]
  },
  "confidence": 0.8,
  "importance": 1.0
}
```

```json
{
  "action": "update_node",
  "node_id": "Fatigue_Model",
  "patch": {
    "title": null,
    "body": "Base assumptions + wearable telemetry",
    "structured_upserts": {"state": "validated"},
    "add_links": [],
    "add_highlights": ["circadian"]
  },
  "confidence": 0.9,
  "importance": 1.3
}
```

```json
{
  "action": "open_node",
  "node_id": "Fatigue_Model"
}
```

返回统一是 `ToolResponse` JSON（`version`/`optional_version`/`node_list`/`error`）。

## 6. 当前模块结构

```text
src/
  core/         # 数据模型与错误类型
  storage/      # 文件系统持久化与索引快照
  versioning/   # create/update/fork/merge
  graph/        # BFS/DFS/importance/confidence traversal
  merge/        # 合并策略
  promotion/    # importance 计算
  decay/        # 时间衰减
  api/          # 对外接口 + tool protocol
  main.rs       # CLI 入口（action JSON 执行）
```

## 7. 生产约束（必须遵守）

1. 不引入外部数据库（PostgreSQL/Neo4j/Redis/RocksDB）。
2. 不做分布式写入与集群一致性。
3. 保持单进程单写者模型，优先确定性与可解释性。
4. 任何历史版本不得覆盖修改。

## 8. 性能目标

- 节点规模：`<= 100k`
- 启动时间：`< 3s`（目标）
- Head 查询：`O(1)`
- 图遍历：`O(N + E)`

## 9. 常见问题

### Q1: 这是数据库吗？
不是。它是 Agent 记忆运行时组件。

### Q2: 支持向量检索吗？
核心不内置。可作为未来可选扩展，不污染主路径。

### Q3: 为什么不用多进程并发写？
设计目标是简单、稳定、可预测。当前明确采用单写者模型。

### Q4: 如何重置本地数据？

```bash
rm -rf data
cargo run
```

### Q5: 启动时报 object missing 怎么办？
通常是索引引用了不存在的对象文件。处理方式：
1. 先备份 `data/`
2. 检查 `data/index/state.json` 中的 `heads` 指向
3. 确认 `data/objects/<prefix>/<version>.json` 文件存在
4. 必要时回滚到可用备份，避免手工篡改历史对象

## 10. 给集成方的建议

1. 将 `MemoryEngine` 作为进程级单例，避免重复加载索引。
2. 把 `NodeId` 设计成稳定业务主键，不要随展示文案变化。
3. 对外暴露 `execute_action_json` 时，建议在网关层做输入校验和限流。
4. 高频写入场景下，优先批量组织 patch，减少碎片版本数量。

## 11. 设计一句话

`Git + Wiki + In-memory Graph Index`，面向 Agent 推理的结构化长期记忆内核。
