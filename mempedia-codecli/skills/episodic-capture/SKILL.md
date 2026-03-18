---
name: episodic-capture
description: "Use when the interaction is a transient event, greeting, one-off task update, or short-lived conversational episode that should stay in Layer 2 episodic memory."
category: mempedia
priority: high
tags: [mempedia, layer2, episodic]
---

# Episodic Capture

## Goal

Record time-bound interactions without polluting Layer 1.

## Good Episodic Cases

- Greetings and introductions.
- Short coordination messages.
- Session-local events, one-off tool runs, or temporary observations.
- Interaction logs that may help recall chronology later.

## Workflow

1. Summarize the event in one short scene description.
2. Link to core knowledge nodes only if they already exist and are genuinely relevant.
3. Keep the write asynchronous.

## Tool Guidance

- Prefer letting the independent post-turn memory agent classify the turn automatically.
- Use `bash` plus `list_episodic` or `search_episodic` when you need to inspect recent episodes.
- Use `bash` plus `record_episodic` only when the user explicitly asks for a direct episodic write and the content is truly episodic.
- Example write:

```bash
BIN="${MEMPEDIA_BINARY_PATH:-./target/debug/mempedia}"
[[ -x "$BIN" ]] || BIN=./target/release/mempedia
cat <<'JSON' | "$BIN" --project "$PWD" --stdin
{
	"action": "record_episodic",
	"scene_type": "task",
	"summary": "One-off workflow update",
	"tags": ["codecli"]
}
JSON
```

## Avoid

- Creating new Layer 1 nodes from greetings or transient chatter.
- Encoding scheduler metadata as memory content.