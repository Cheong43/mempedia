---
name: "mempedia-openclaw"
description: "Integrates mempedia memory graph with OpenClaw agents. Invoke when building or configuring OpenClaw workflows to persist/read wiki-style long-term memory via CLI/runtime."
---

# Mempedia x OpenClaw

This skill connects OpenClaw agent workflows to the mempedia memory graph (append-only Node/Version DAG with markdown-first projection and audit).

## Strict Mode
- This skill runs in strict mode by default.
- Use mempedia CLI/runtime directly; do not create custom SDK/client layers.
- Do not scan full source code unless explicitly requested by user.

## What It Does
- Provides standardized prompts and commands for OpenClaw agents to:
  - Read nodes (`open_node`)
  - Upsert nodes (`upsert_node`)
  - Write markdown updates (`agent_upsert_markdown`)
  - Explore graph (`suggest_exploration`, `explore_with_budget`)
  - Search nodes (`search_nodes`)
  - Auto-relate nodes (`auto_link_related`)
  - Rollback (`rollback_node`)
- Guides storage layout and governance (audit fields: `agent_id`, `reason`, `source`).
- Ensures updates form explicit knowledge edges and graph structure.
- Captures user preferences/habits and agent behavior patterns as first-class nodes and links.

## When To Invoke
- Setting up OpenClaw tasks that need durable, explainable long-term memory.
- Persisting learning outputs and linking related knowledge automatically.
- Running offline curation or online runtime via CLI.

## Hard Constraints
- Must not generate Python/TypeScript wrappers or custom RPC adapters for mempedia.
- Must not create standalone client files to call mempedia.
- Must not read all project code for protocol discovery.
- Allowed protocol references are only:
  - `readme.md` action section
  - `skills/mempedia-openclaw/SKILL.md`
  - `src/api/mod.rs` enum `ToolAction` block when schema mismatch occurs
- If action fails, retry with corrected JSON action payload first.

## No-Guessing Rule
- Never guess action fields.
- Build payloads from the schemas below only.
- If required field is missing, stop and request/derive the exact field value from task context.

## Runtime Options
- One-shot CLI:
  - `mempedia --project <dir> --action '<json>'`
  - `mempedia --project <dir> --action-file action.json`
  - `cat action.json | mempedia --project <dir> --stdin`
- Runtime process (NDJSON over stdin/stdout):
  - `mempedia --project <dir> --serve`

## Storage Layout
- `<project>/.mempedia/memory/index/{state,heads,nodes}.json`
- `<project>/.mempedia/memory/objects/<hash_prefix>/<version_hash>.json`
- `<project>/.mempedia/memory/knowledge/nodes/<sanitized_node_id>-<hash8>.md`

## Governance Requirements
- Every autonomous write must include:
  - `agent_id`: OpenClaw agent identity
  - `reason`: clear change rationale (>= 8 chars)
  - `source`: input channel (e.g., task id, URL)
- Confidence must meet minimum; markdown size is bounded.

## Knowledge Graph Formation (Required)
- Each write should add or maintain explicit edges:
  - Use `content.links` (create) or `patch.add_links` (update) with clear labels.
  - If a node would have fewer than 2 outgoing links after the change, call `auto_link_related`.
- Always connect to an anchor node:
  - `user/<user_id>/profile` for user-related memory
  - `agent/<agent_id>/profile` for agent behavior memory
  - `project/<project_id>/context` for project-specific memory

## User Preferences & Habits (Required Modeling)
Represent preferences and habits as nodes + links (do not invent new actions).
- Node id patterns:
  - `user/<user_id>/preference/<topic>`
  - `user/<user_id>/habit/<topic>`
- Recommended `structured_data` keys:
  - `kind`: `user_preference` | `user_habit`
  - `user_id`
  - `topic`
  - `evidence`
  - `time_window`
  - `confidence_source`
- Required links:
  - From `user/<user_id>/profile` → preference/habit node
  - From preference/habit node → related domain node (tool, product, concept)

## Agent Behavior Patterns (Required Modeling)
Represent agent behavior patterns as nodes + links (do not invent new actions).
- Node id pattern:
  - `agent/<agent_id>/behavior/<pattern_key>`
- Recommended `structured_data` keys:
  - `kind`: `agent_behavior_pattern`
  - `agent_id`
  - `pattern_key`
  - `summary`
  - `details`
  - `applicable_plan`
  - `evidence`
- Required links:
  - From `agent/<agent_id>/profile` → behavior node
  - From behavior node → related workflow/tool nodes

## Action Whitelist (Preferred)
- `upsert_node`
- `open_node`
- `search_nodes`
- `suggest_exploration`
- `explore_with_budget`
- `auto_link_related`
- `agent_upsert_markdown`
- `rollback_node`

## Canonical Input Schemas
### upsert_node
Notes:
- `content` and `patch` are optional, but at least one must be provided.
- Use `content` for create/replace, `patch` for incremental updates.
```json
{
  "action": "upsert_node",
  "node_id": "string",
  "content": {
    "title": "string",
    "summary": "string (can be empty, 0-140 chars)",
    "body": "string",
    "structured_data": { "key": "value" },
    "links": [{ "target": "string", "label": "string|null", "weight": 0.8 }],
    "highlights": ["string"]
  },
  "patch": {
    "title": "string|null",
    "summary": "string|null",
    "body": "string|null",
    "structured_upserts": { "key": "value" },
    "add_links": [{ "target": "string", "label": "string|null", "weight": 0.8 }],
    "add_highlights": ["string"]
  },
  "confidence": 0.86,
  "importance": 2.4
}
```

### open_node
```json
{
  "action": "open_node",
  "node_id": "string",
  "markdown": false,
  "agent_id": "openclaw-agent"
}
```

### search_nodes
```json
{
  "action": "search_nodes",
  "query": "string",
  "limit": 8,
  "include_highlight": true
}
```

### suggest_exploration
```json
{
  "action": "suggest_exploration",
  "node_id": "string",
  "limit": 8
}
```

### explore_with_budget
```json
{
  "action": "explore_with_budget",
  "node_id": "string",
  "depth_budget": 2,
  "per_layer_limit": 4,
  "total_limit": 10,
  "min_score": 0.0
}
```

### auto_link_related
```json
{
  "action": "auto_link_related",
  "node_id": "string",
  "limit": 8,
  "min_score": 0.4
}
```

### agent_upsert_markdown
```json
{
  "action": "agent_upsert_markdown",
  "node_id": "string",
  "markdown": "# Title\n\nBody",
  "confidence": 0.86,
  "importance": 2.4,
  "agent_id": "openclaw-agent",
  "reason": "至少8字符的变更原因",
  "source": "task_or_channel_id"
}
```

## Action Templates
### Open Resource (version)
```json
{
  "action": "open_node",
  "node_id": "memory_orchestration",
  "markdown": false,
  "agent_id": "openclaw-agent"
}
```

### Open Resource (markdown)
```json
{
  "action": "open_node",
  "node_id": "memory_orchestration",
  "markdown": true
}
```

### Search Nodes
```json
{
  "action": "search_nodes",
  "query": "memory graph",
  "limit": 8,
  "include_highlight": true
}
```

## Action Examples
### Upsert Node (create/update merged)
```json
{
  "action": "upsert_node",
  "node_id": "memory_orchestration",
  "content": {
    "title": "Memory Orchestration",
    "summary": "核心内存编排节点，描述流程与约束。",
    "body": "Design notes...",
    "structured_data": {},
    "links": [],
    "highlights": []
  },
  "confidence": 0.86,
  "importance": 2.4
}
```

### Append Markdown
```json
{
  "action": "agent_upsert_markdown",
  "node_id": "memory_orchestration",
  "markdown": "# Memory Orchestration\\n\\nDesign notes...",
  "confidence": 0.86,
  "importance": 2.4,
  "agent_id": "openclaw-agent",
  "reason": "记录架构与约束",
  "source": "openclaw_task_42"
}
```

### Read and Explore
```json
{ "action": "open_node", "node_id": "memory_orchestration", "agent_id": "openclaw-agent", "markdown": false }
{ "action": "open_node", "node_id": "memory_orchestration", "markdown": true }
{ "action": "search_nodes", "query": "memory graph", "limit": 8, "include_highlight": true }
{ "action": "suggest_exploration", "node_id": "memory_orchestration", "limit": 8 }
{ "action": "explore_with_budget", "node_id": "memory_orchestration", "depth_budget": 2, "per_layer_limit": 4, "total_limit": 10, "min_score": 0.0 }
```

## Recommended Prompt Snippets
- Persist learning outcome:
  - "Summarize findings as markdown. Include links and highlights. Write via `agent_upsert_markdown` with proper audit fields."
- Auto-link:
  - "If outgoing graph is sparse, call `auto_link_related` with sensible `min_score`."

## Notes
- Prefer explicit links for explainability; keyword/auto signals are fused to suggest candidates.
- Use rollback to create a new head from historical version; never rewrite objects.
- If an OpenClaw flow tries to implement a client layer, stop and switch back to direct CLI/runtime JSON actions.
