# KB Schema and Conventions

This document defines schema and naming conventions for markdown-first memory nodes.

## 1. Node Identity

- `node_id`: stable identifier used by API and version graph.
- Recommended format: lowercase snake_case.
- Avoid changing `node_id` after creation.

## 2. Node Hierarchy

Nodes can form a parent–child tree using the `parent_node` field.
This enables Notion-like hierarchical page nesting:

- A knowledge graph typically starts with an **index** node (`node_type: index`) that acts as the root.
- Child nodes reference their parent via `parent_node: <parent_node_id>`.
- The depth of the hierarchy is not bounded by the schema.

### 2.1 Node Types

Use `node_type` to classify the semantic role of a node:

| Value | Purpose |
|---|---|
| `index` | Root / table-of-contents page for a topic or subtopic |
| `concept` | Explanation of a domain concept or term |
| `process` | Step-by-step process or workflow description |
| `reference` | Reference data, specifications, or lookup table |
| `decision` | Decision record (ADR-style) with rationale |
| `glossary` | Definitions of domain-specific terms |

Other values are permitted; the above are conventions, not hard constraints.

## 3. Markdown Projection File

Each head version is projected into a markdown file at:

- `.mempedia/memory/knowledge/nodes/<sanitized_node_id>-<hash8>.md`

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
- Hierarchy membership is not a retrieval filter by default.

## 7. Storage Layout

```text
.mempedia/memory/
  index/
    state.json                    # index snapshot (heads + nodes)
    heads.json                    # compatibility/readable copy
    nodes.json                    # compatibility/readable copy
    access.log                    # optional access log
    agent_actions.log             # autonomous agent update audit
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
