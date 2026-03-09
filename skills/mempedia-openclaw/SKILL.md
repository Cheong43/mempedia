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
```json
{
  "action": "upsert_node",
  "node_id": "string",
  "content": {
    "title": "string",
    "body": "string",
    "structured_data": { "key": "value" },
    "links": [{ "target": "string", "label": "string|null", "weight": 0.8 }],
    "highlights": ["string"]
  },
  "patch": {
    "title": "string|null",
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
