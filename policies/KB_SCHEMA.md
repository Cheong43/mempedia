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
