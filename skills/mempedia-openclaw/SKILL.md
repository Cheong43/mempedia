---
name: "mempedia-openclaw"
description: "Integrates mempedia memory graph with OpenClaw agents. Invoke when building or configuring OpenClaw workflows to persist/read wiki-style long-term memory via CLI/runtime."
---

# Mempedia x OpenClaw

This skill connects OpenClaw agent workflows to the mempedia memory graph (append-only Node/Version DAG with markdown-first projection and audit).

## What It Does
- Provides standardized prompts and commands for OpenClaw agents to:
  - Read nodes (`open_node`, `open_markdown_node`)
  - Write markdown updates (`agent_upsert_markdown`)
  - Explore graph (`suggest_exploration`, `explore_with_budget`)
  - Auto-relate nodes (`auto_link_related`)
  - Rollback (`rollback_node`)
- Guides storage layout and governance (audit fields: `agent_id`, `reason`, `source`).

## When To Invoke
- Setting up OpenClaw tasks that need durable, explainable long-term memory.
- Persisting learning outputs and linking related knowledge automatically.
- Running offline curation or online runtime via CLI.

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

## Action Examples
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
{ "action": "open_node", "node_id": "memory_orchestration", "agent_id": "openclaw-agent" }
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
