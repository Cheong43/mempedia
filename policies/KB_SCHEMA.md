# KB Schema and Conventions

This document describes the current markdown-first schema used by Mempedia.
It intentionally separates implemented behavior from planned extensions so the
docs stay aligned with the codebase.

## 1. Implemented Now

### 1.1 Node Identity

- `node_id`: stable identifier used by the API and version graph.
- Recommended format: lowercase snake_case.
- Avoid changing `node_id` after creation.

### 1.2 Hierarchy and Node Semantics

The currently implemented hierarchy fields are:

- `parent_node`: optional parent node id used for Notion-style nesting.
- `node_type`: optional semantic role marker.

Recommended `node_type` values:

| Value | Purpose |
|---|---|
| `index` | Root / table-of-contents page for a topic |
| `concept` | Explanation of a domain concept or term |
| `process` | Step-by-step workflow description |
| `reference` | Reference data, specifications, or lookup table |
| `decision` | Decision record (ADR-style) with rationale |
| `glossary` | Definitions of domain-specific terms |

Other values are permitted; the table above is convention, not a hard schema.

### 1.3 Markdown Projection File

Each head version is projected to:

```text
.mempedia/memory/knowledge/nodes/<sanitized_node_id>-<hash8>.md
```

Current front matter fields:

```yaml
---
node_id: "<node_id>"
version: "<version_id>"
timestamp: <unix_seconds>
importance: <float_ge_0>
title: "<title>"
summary: "<summary>"
source: "<originating source, optional>"
origin: "<author or agent id, optional>"
parent_node: "<parent node_id, optional>"
node_type: "<node type, optional>"
parents:
  - "<version_id>"
---
```

Important current constraint:

- `project` is not a stable persisted front matter field today.
- Markdown projection paths are not project-scoped today.

Body rules:

- Preserve markdown body text from the current head version.
- If body is empty, emit a single markdown heading from title.
- AI writes must preserve meaning, respect facts, and avoid information loss.

### 1.4 Structured Data Keys

Reserved keys inserted by the runtime:

- `content_type = markdown`
- `kb.last_agent_id`
- `kb.last_reason`
- `kb.last_source`
- `kb.updated_at`
- `meta.*` derived from markdown front matter on parse
  - `meta.source`
  - `meta.origin`
  - `meta.parent_node`
  - `meta.node_type`

### 1.5 Optional Structured Sections in Markdown Body

These sections are human-editable and partially normalized by the parser.
Section headings are case-insensitive and accept synonyms:

- Facts: `Facts`, `Fact`, `Claims`, `Claim`
- Relations: `Relations`, `Relation`, `Links`, `Link`
- Evidence: `Evidence`, `Sources`, `Source`

Format rules:

- **Facts**: bullet lines in `key: value` or `key = value` form.
  Stored as `fact.<key>` in `structured_data` after key normalization.
- **Relations**: bullet lines in one of the following forms:
  - `Target | label | weight`
  - `Target(label=..., weight=...)`
  - `Target`
  Stored as graph links with optional `label` and `weight`.
- **Evidence**: bullet lines, stored as `evidence.01`, `evidence.02`, and so on.

### 1.6 Recommended Narrative Sections

These sections are preserved in markdown even when not all of them are
normalized into structured keys:

- `Data`: numbers, dates, versions, limits, ports, paths, config values, metrics
- `History`: migrations, regressions, chronology, before/after changes
- `Viewpoints`: opinions, interpretations, preferences, with attribution when possible
- `Uncertainties`: unresolved questions, caveats, conditions, explicit unknowns

Do not fabricate any of this content. Omit unsupported sections instead.

### 1.7 Audit Log Schema

`index/agent_actions.log` is JSONL, one object per line:

```json
{
  "timestamp": 0,
  "agent_id": "agent-main",
  "action": "agent_upsert_markdown",
  "node_id": "example_node",
  "version": "version_hash",
  "reason": "why update happened",
  "source": "input_channel_or_ref"
}
```

### 1.8 Retrieval Behavior

- Keyword search uses an in-memory inverted index built from latest heads.
- Tokens include ASCII terms and CJK-friendly terms.
- Search result scores combine weighted term signals and token coverage.
- Hybrid retrieval combines BM25, vectors, and graph signals when embeddings are available.
- There is no implemented project-scoped retrieval filter today.

### 1.9 Storage Layout

```text
.mempedia/memory/
  index/
    state.json
    heads.json
    nodes.json
    access.log
    agent_actions.log
  objects/
    <hash_prefix>/
      <version_hash>.json
  knowledge/
    nodes/
      <sanitized_node_id>-<hash8>.md
  episodic/
    memories.jsonl
  preferences.md
  skills/
    <skill_id>-<hash8>.md
```

## 2. Planned, Not Yet Stable

The following ideas may still be implemented later, but should not be treated
as current schema guarantees:

- `project` as a stable node field persisted through markdown and runtime APIs
- project-scoped markdown directories such as `knowledge/projects/<project_id>/...`
- project registry files such as `knowledge/projects/_index.json`
- indexes such as `node_project_index.json`
- dedicated project actions such as `create_project`, `list_projects`, `get_project`, or `list_project_nodes`

Until those are implemented end-to-end, documentation and tooling should treat
`parent_node` and `node_type` as the stable hierarchy features.
