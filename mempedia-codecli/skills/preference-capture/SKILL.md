---
name: preference-capture
description: "Use when the user expresses a stable preference, working style, formatting requirement, or persistent constraint that belongs in Layer 3 user preferences."
category: mempedia
priority: high
tags: [mempedia, layer3, preferences]
---

# Preference Capture

## Goal

Preserve stable user preferences that should influence future behavior.

## Capture When

- The user states persistent coding, formatting, language, or workflow preferences.
- The instruction is likely to matter across future tasks in the same project.

## Do Not Capture When

- The request is only for the current turn.
- The user is brainstorming rather than setting a policy.

## Tool Guidance

- Read existing preferences with `bash` and the `read_user_preferences` action.
- Update preferences with `bash` and the `update_user_preferences` action only after merging with the current file content.
- Prefer `--stdin` for multiline markdown payloads, for example:

```bash
BIN="${MEMPEDIA_BINARY_PATH:-./target/debug/mempedia}"
[[ -x "$BIN" ]] || BIN=./target/release/mempedia
cat <<'JSON' | "$BIN" --project "$PWD" --stdin
{
	"action": "update_user_preferences",
	"content": "# User Preferences\n- Prefer concise technical answers"
}
JSON
```

- Prefer letting the independent post-turn memory agent classify stable preferences automatically.