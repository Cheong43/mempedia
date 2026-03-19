# KB Schema and Conventions

This document defines schema and naming conventions for markdown-first memory nodes.

## 1. Node Identity

- `node_id`: stable identifier used by API and version graph.
- Recommended format: lowercase snake_case.
- Avoid changing `node_id` after creation.

## 2. Project Hierarchy

### 2.1 Projects

A **project** is a top-level domain or knowledge-base category (e.g., `real_estate`, `technology`, `product`).
Projects group related nodes and store their markdown files under a dedicated directory:

```
knowledge/projects/<project_id>/<sanitized_node_id>-<hash8>.md
```

Nodes that are not assigned to a project continue to use the legacy flat directory:

```
knowledge/nodes/<sanitized_node_id>-<hash8>.md
```

Project metadata is stored in `knowledge/projects/_index.json`.

### 2.2 Node Hierarchy (Notion-style)

Within a project, nodes can form a parent–child tree using the `parent_node` field.
This enables Notion-like hierarchical page nesting:

- A project typically starts with an **index** node (`node_type: index`) that acts as the root.
- Child nodes reference their parent via `parent_node: <parent_node_id>`.
- The depth of the hierarchy is not bounded by the schema.

### 2.3 Node Types

Use `node_type` to classify the semantic role of a node:

| Value | Purpose |
|---|---|
| `index` | Root / table-of-contents page for a project or subtopic |
| `concept` | Explanation of a domain concept or term |
| `process` | Step-by-step process or workflow description |
| `reference` | Reference data, specifications, or lookup table |
| `decision` | Decision record (ADR-style) with rationale |
| `glossary` | Definitions of domain-specific terms |

Other values are permitted; the above are conventions, not hard constraints.

## 3. Markdown Projection File

Each head version is projected into a markdown file whose location depends on the node's project:

- With project: `.mempedia/memory/knowledge/projects/<project_id>/<sanitized_node_id>-<hash8>.md`
- Without project: `.mempedia/memory/knowledge/nodes/<sanitized_node_id>-<hash8>.md`

Front matter fields:

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
project: "<project_id, optional>"
parent_node: "<parent node_id, optional>"
node_type: "<node type, optional>"
parents:
  - "<version_id>"
---
```

Body:
- Preserve markdown body text from current head version.
- If body is empty, emit a single markdown heading from title.
- AI writes must preserve original meaning, respect facts, and be detailed.

## 4. Structured Data Keys

Reserved keys inserted by runtime:
- `content_type = markdown`
- `kb.last_agent_id`
- `kb.last_reason`
- `kb.last_source`
- `kb.updated_at`
- `meta.*` (derived from markdown front matter on parse)
  - `meta.source` / `meta.origin` are reflected in front matter when present

### 4.1 Optional Structured Sections in Markdown Body

These sections allow humans to edit knowledge in markdown while keeping it structured for agents.
Section headings are case-insensitive and accept synonyms:

- Facts: `Facts`, `Fact`, `Claims`, `Claim`
- Relations: `Relations`, `Relation`, `Links`, `Link`
- Evidence: `Evidence`, `Sources`, `Source`

Format rules:

- **Facts**: bullet lines in `key: value` or `key = value` form.
  - Stored as `fact.<key>` in `structured_data` (key is normalized to `snake_case`).
- **Relations**: bullet lines in one of the following forms:
  - `Target | label | weight`
  - `Target(label=..., weight=...)`
  - `Target`
  - Stored as graph links with optional `label` and `weight`.
- **Evidence**: bullet lines, stored as `evidence.01`, `evidence.02`, etc.

### 4.2 Recommended Narrative Sections

The following sections are recommended for richer human-readable knowledge capture. They are preserved in markdown even when not all of them are currently normalized into structured keys:

- `Data`: concrete values such as numbers, dates, versions, limits, ports, paths, configuration values, and metrics.
- `History`: version evolution, migrations, regressions, chronology, and before/after changes.
- `Viewpoints`: opinions, interpretations, preferences, or stakeholder positions, ideally with attribution.
- `Uncertainties`: unresolved questions, caveats, conditions, and explicit unknowns.

These sections should never contain fabricated content; if the source does not support them, omit them.

## 5. Audit Log Schema

`index/agent_actions.log` (JSONL), one object per line:

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

## 6. Retrieval Behavior

- Keyword search uses an in-memory inverted index generated from latest heads.
- Tokens include ASCII terms and CJK-friendly terms.
- Search result scores combine weighted term signals and token coverage.
- Project membership is not a retrieval filter by default; use `list_project_nodes` to enumerate project contents.

## 7. Storage Layout

```text
.mempedia/memory/
  index/
    state.json                    # index snapshot (heads + nodes)
    heads.json                    # compatibility/readable copy
    nodes.json                    # compatibility/readable copy
    access.log                    # optional access log
    agent_actions.log             # autonomous agent update audit
    node_project_index.json       # node_id → project_id mapping
  objects/
    <hash_prefix>/
      <version_hash>.json
  knowledge/
    nodes/                        # nodes without a project (legacy / unclassified)
      <sanitized_node_id>-<hash8>.md
    projects/
      _index.json                 # project metadata registry
      <project_id>/               # one directory per project
        <sanitized_node_id>-<hash8>.md
  episodic/
    memories.jsonl
  preferences.md
  skills/
    <skill_id>-<hash8>.md
```
