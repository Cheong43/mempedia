---
name: skill-authoring
description: "Use when a repeatable workflow should become a reusable skill document, and create or update a corresponding skills/<name>/SKILL.md file."
category: mempedia
priority: high
tags: [mempedia, layer4, skills]
---

# Skill Authoring

## Goal

Turn repeatable workflows into explicit, reusable skill documents.

## When To Create Or Update A Skill

- The same reasoning pattern or procedure is likely to recur.
- The workflow needs consistent tool-routing guidance.
- A prompt or ad hoc note has become de facto policy.

## Required Output

Every skill must live in `skills/<skill-name>/SKILL.md` and include:

1. YAML frontmatter with `name` and `description`
2. Clear trigger conditions
3. A compact workflow
4. Tool guidance
5. Explicit avoid/guardrail notes when needed

## Tool Guidance

- Use `edit` only for the local workspace file at `skills/<skill-name>/SKILL.md`.
- Use `bash` plus Layer 4 CLI actions when you need to inspect or publish skills in Mempedia:
	`list_skills`, `search_skills`, `read_skill`, `upsert_skill`.
- Example publish command:

```bash
BIN="${MEMPEDIA_BINARY_PATH:-./target/debug/mempedia}"
[[ -x "$BIN" ]] || BIN=./target/release/mempedia
cat <<'JSON' | "$BIN" --project "$PWD" --stdin
{
	"action": "upsert_skill",
	"skill_id": "example_skill",
	"title": "Example Skill",
	"content": "# Example Skill\n\nReusable workflow steps.",
	"tags": ["workflow", "mempedia"]
}
JSON
```