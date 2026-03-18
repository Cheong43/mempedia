---
name: core-knowledge-curation
description: "Use when stable, reusable facts should be promoted into Layer 1 core knowledge from source code, docs, configuration, or verified project evidence."
category: mempedia
priority: high
tags: [mempedia, layer1, knowledge]
---

# Core Knowledge Curation

## Goal

Promote verified, reusable facts into Layer 1 core knowledge.

## Promote To Core Knowledge When

- The fact is stable across turns.
- The fact is grounded in repository files, configuration, schemas, or confirmed APIs.
- The fact is useful for future reasoning without the original conversation.

## Do Not Promote When

- The content is a greeting, temporary status, or planning chatter.
- The content is branch-control metadata or error output.
- The content is specific only to the current moment.

## Workflow

1. Distill the stable fact into clear title, summary, and body.
2. Separate evidence from narrative.
3. Preserve relations to other known nodes when they are explicit.
4. Save asynchronously whenever possible.

## Tool Guidance

- Use `read` and `search` against workspace files first.
- Use `bash` plus the `mempedia` CLI for Layer 1 inspection and updates.
- Prefer these actions:
	`search_nodes` to find existing knowledge,
	`open_node` to inspect a node,
	`ingest` to create or update stable knowledge,
	`node_history` when version history matters.
- Prefer `--stdin` for structured writes, for example:

```bash
BIN="${MEMPEDIA_BINARY_PATH:-./target/debug/mempedia}"
[[ -x "$BIN" ]] || BIN=./target/release/mempedia
cat <<'JSON' | "$BIN" --project "$PWD" --stdin
{
	"action": "ingest",
	"node_id": "example_node",
	"title": "Example Node",
	"text": "Verified project fact",
	"summary": "Short grounded summary",
	"source": "codecli-agent",
	"importance": 0.8
}
JSON
```

- Let the independent post-turn memory agent handle routine automatic promotion.