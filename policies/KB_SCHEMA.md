# KB Schema and Conventions

This document defines schema and naming conventions for markdown-first memory nodes.

## 1. Node Identity

- `node_id`: stable identifier used by API and version graph.
- Recommended format: lowercase snake_case.
- Avoid changing `node_id` after creation.

## 2. Markdown Projection File

Each head version is projected into:
- `.mempedia/memory/knowledge/nodes/<sanitized_node_id>-<hash8>.md`

Front matter fields:

```yaml
---
node_id: "<node_id>"
version: "<version_id>"
timestamp: <unix_seconds>
confidence: <0.0-1.0>
importance: <float_ge_0>
title: "<title>"
source: "<originating source, optional>"
origin: "<author or agent id, optional>"
parents:
  - "<version_id>"
---
```

Body:
- Preserve markdown body text from current head version.
- If body is empty, emit a single markdown heading from title.

## 3. Structured Data Keys

Reserved keys inserted by runtime:
- `content_type = markdown`
- `kb.last_agent_id`
- `kb.last_reason`
- `kb.last_source`
- `kb.updated_at`
- `meta.*` (derived from markdown front matter on parse)
  - `meta.source` / `meta.origin` are reflected in front matter when present

### 3.1 Optional Structured Sections in Markdown Body

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

## 4. Audit Log Schema

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

## 5. Retrieval Behavior

- Keyword search uses an in-memory inverted index generated from latest heads.
- Tokens include ASCII terms and CJK-friendly terms.
- Search result scores combine weighted term signals and token coverage.
