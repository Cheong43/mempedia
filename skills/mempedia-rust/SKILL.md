---
name: mempedia-rust
description: Build, evolve, and review the Rust append-only versioned knowledge graph memory engine used in this repo. Use for requests about Node/Version DAG, filesystem object storage, graph traversal, merge/promotion/decay, tool protocol actions, and performance constraints (<=100k nodes, deterministic single-writer runtime).
---

# Mempedia Rust

Use this skill when the request is about implementing or modifying the memory engine in this repository.

Terminology:
- `Mempedia` is the project name.

## Scope

This engine is:
- append-only
- immutable by version
- filesystem-backed
- deterministic, single-process single-writer
- optimized for agent long-term structured memory

This engine is not:
- a general database
- a distributed system
- a vector database / generic RAG layer

## Mandatory Constraints

1. Never mutate historical `NodeVersion` objects.
2. Every state change creates a new version object.
3. Version history is a DAG via `parents: Vec<VersionId>`.
4. Persist version objects by content hash (`blake3`).
5. Use atomic file replacement for index snapshot updates (`index/state.json`).
6. Keep behavior deterministic and explicit.
7. Prefer minimal dependencies and simple data structures.
8. Default storage root must be project-local: `<project>/.mempedia/memory`.

## Repository Anchors

Read these first before major changes:
- `readme.md`
- `Projectv0.0.1.md`
- `src/core/mod.rs`
- `src/storage/mod.rs`
- `src/versioning/mod.rs`
- `src/graph/mod.rs`
- `src/api/mod.rs`

## Storage Contract

Data layout:
- `<project>/.mempedia/memory/index/state.json`
- `<project>/.mempedia/memory/index/heads.json` (compat mirror)
- `<project>/.mempedia/memory/index/nodes.json` (compat mirror)
- `<project>/.mempedia/memory/objects/<hash_prefix>/<version_hash>.json`

Write path:
1. Build new `NodeVersion` in memory.
2. Serialize and hash content.
3. Write object file if absent (dedupe by hash).
4. Atomically commit `index/state.json` (and keep compatibility mirrors in sync).
5. Rebuild or incrementally update graph index.

## Runtime and CLI Contract

Preferred execution modes:
1. One-shot CLI:
   - `mempedia --project /path/to/project --action '<json>'`
   - `mempedia --project /path/to/project --action-file action.json`
2. Runtime process mode:
   - `mempedia --project /path/to/project --serve`
   - stdin/stdout protocol is NDJSON (one request line -> one response line)

Rules:
- Use `--project` to select knowledge tree; each project is isolated.
- Avoid `--data` unless a custom path is explicitly required.
- In `--serve` mode, payloads must be line-delimited JSON.

## Protocol-First Rule

When tasks involve tool protocol actions:
1. Use explicit action schemas from this section.
2. Do not infer/guess missing fields.

### Canonical Action Schemas

`upsert_node`
```json
{
  "action": "upsert_node",
  "node_id": "string",
  "content": {
    "title": "string",
    "summary": "string (8-140 chars, concise and accurate)",
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
  "importance": 2.0
}
```

`search_nodes`
```json
{
  "action": "search_nodes",
  "query": "string",
  "limit": 10,
  "include_highlight": true
}
```

`open_node`
```json
{
  "action": "open_node",
  "node_id": "string",
  "markdown": false,
  "agent_id": "agent-main"
}
```

`agent_upsert_markdown`
```json
{
  "action": "agent_upsert_markdown",
  "node_id": "string",
  "markdown": "# Title\n\nBody",
  "importance": 2.4,
  "agent_id": "agent-main",
  "reason": "clear reason >= 8 chars",
  "source": "task_or_channel"
}
```

## Agent Decision Policy (LLM-Driven, Not Hardcoded)

This policy is for the calling AI agent to reason about whether to read, update, fork, or merge memory.
Do not require deterministic program-side hardcoded rules for this decision.

### Step 1: Default to Read-First

Before writing, the agent should usually:
1. `open_node` with `markdown=false` if node is known.
2. `traverse` for relevant neighborhood context.
3. `compare_versions` if conflicting history is suspected.
4. `explore_with_budget` to plan multi-hop exploration within bounded depth.

### Step 2: Choose Action by Evidence and Intent

Use these heuristics:

1. Read only (no write):
- User asks explanatory questions with no new durable fact.
- Content is speculative, temporary, or not source-grounded.
- Existing memory already answers with sufficient evidence.

2. Update existing node (`upsert_node` with `patch`):
- New information refines or extends existing concept.
- No major contradiction with current head.
- Agent can provide a clearer, more current, or better structured state.

3. Fork then evolve (`fork_node` + update path):
- New input conflicts with current head but cannot be confidently resolved now.
- Multiple valid hypotheses should coexist temporarily.
- Cross-agent disagreement exists and should remain traceable.

4. Merge branches (`merge_node`):
- Two branches represent complementary truth and can be reconciled.
- Conflicts are resolvable via recency, importance, and source quality.

### Step 3: Uncertainty and Explainability Discipline

When the agent writes:
1. Prefer adding structured fields over rewriting free text blindly.
2. Preserve uncertainty explicitly (do not overstate certainty).
3. Keep version history interpretable so future agents can audit reasoning.
4. Log significant reads/writes when reasoning trace is useful.

### Step 4: High-Risk Domains

For legal/medical/financial/safety-critical topics:
1. Bias toward read + verify before write.
2. If evidence is weak or conflicting, fork instead of force-updating head.
3. Keep changes conservative and traceable.

### Decision Output Requirement

For each non-trivial memory operation, the calling AI should internally justify:
1. Why read was enough, or why write was needed.
2. Why update vs fork vs merge was selected.
3. Why this preserves long-term memory quality.

## Execution Workflow

1. Clarify operation type:
- node lifecycle (`upsert`, `fork`, `merge`)
- traversal (`BFS`, `DFS`, importance-first)
- scoring (`promotion`, `decay`)
- protocol/API actions (`open_node`, `access_node`, `compare_versions`, `search_nodes`, `suggest_exploration`, `explore_with_budget`, `auto_link_related`, etc.)

2. Implement in the correct layer:
- schema: `core`
- persistence: `storage`
- version transitions: `versioning`
- in-memory connectivity: `graph`
- external interface: `api`
- runtime process: `runtime`

3. Keep compatibility checks explicit:
- parent links valid
- node ownership for merge inputs
- missing head/version returns typed errors

4. Verify locally:
- `cargo fmt`
- `cargo check`
- `cargo run -- --help`
- `cargo test` (when tests exist)

## Merge Rules

Support two modes:
1. Non-conflicting fields: merge automatically.
2. Conflicting fields: prefer newer or higher-importance content, or emit conflict markers.

Output is always a new version with multiple parents.

## Promotion and Decay

Importance should combine:
- in-degree
- access frequency
- highlight weights
- cross-branch presence
- time decay

Recommended formula pattern:
`importance = decay(log(in_degree+1) + access + highlights + cross_branch_presence)`

Important runtime behavior:
1. Every access should be recorded (`open_node` with `agent_id`, or explicit `access_node`/`log_access`).
2. Access increments persisted counters in `index/access_state.json`.
3. Default auto-promotion is enabled: access can trigger `importance` update via appended versions.
4. Access alone does not create separate certainty metadata.
5. Agent may still call `promote_node` for additional policy-driven re-scoring.

## Exploration Protocol (Default)

Goal: help agents know what to explore next, especially when a node has sparse links.

Recommended sequence:
1. `open_node` current topic (`markdown=false`).
2. `explore_with_budget` to get multi-hop candidates constrained by depth/branch budgets.
3. `suggest_exploration` for focused next-step candidates with reasons:
   - `linked:*` (explicit graph edge, highest trust)
   - `referenced_by` (inbound edge)
   - `keyword` (fuzzy semantic candidate)
   - `high_importance_fallback` (last-resort discovery)
4. Explore top candidates with `open_node`.
5. If current node has weak outgoing graph, use `auto_link_related` to append high-score links.

Notes:
- Prefer explicit links for explainability.
- Use keyword candidates for expansion, then write links back so future traversals become deterministic.
- Use `explore_with_budget` when the task needs controllable breadth/depth search in one turn.
- `auto_link_related` is optional and should be used conservatively with sensible `min_score`.

## Wiki-Style Content Guidance

When writing `NodeContent`, prefer wiki-like structure:
1. `title`: clear canonical concept name.
2. `body`: Markdown format with concise sections.
3. `structured_data`: durable facts/keys for machine-friendly retrieval.
4. `highlights`: short keyword anchors for quick recall.

Recommended Markdown skeleton for `body`:
```markdown
# Summary
One paragraph overview.

## Key Facts
- Fact 1
- Fact 2

## Details
Deeper explanation and caveats.

## Sources or Evidence
- Optional source notes
```

## Review Checklist

Before finalizing, confirm:
1. No old version overwrite exists.
2. All writes are append-only for objects.
3. Index updates are atomic.
4. Traversal complexity stays predictable.
5. Error paths are explicit and typed.
6. New behavior is covered by CLI/runtime flow tests or unit tests.

## Output Style for Tasks Using This Skill

When asked to implement changes:
1. State which module(s) changed and why.
2. Summarize invariant preservation (immutability, append-only, determinism).
3. Report verification commands and key results.
4. Call out any tradeoffs or deferred items.
