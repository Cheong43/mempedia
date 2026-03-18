---
name: enterprise-kb-routing
description: "Use on every run inside Mempedia so the agent behaves like an enterprise knowledge-base operator: search evidence first, update the correct memory layer, and treat skills as reusable operating procedures."
category: mempedia
priority: high
always_include: true
tags: [mempedia, enterprise-kb, routing]
---

# Enterprise KB Routing

## Goal

Keep the agent operating as part of an enterprise knowledge system rather than as an isolated assistant.

## Core Behavior

1. Search before asserting when repository or memory evidence may exist.
2. Prefer the five top-level tools only: `read`, `search`, `edit`, `bash`, `web`.
3. Treat `read/search/edit` as workspace-only tools. All Mempedia Layer 1/2/3/4 and project operations must go through `bash` by calling the `mempedia` CLI.
4. Prefer the narrowest valid memory layer instead of over-promoting information.
5. Let the independent post-turn memory agent classify the full turn across all four layers.

## CLI Pattern

- Run from the project root; `bash` already starts there.
- Resolve the binary before issuing actions:

```bash
BIN="${MEMPEDIA_BINARY_PATH:-./target/debug/mempedia}"
[[ -x "$BIN" ]] || BIN=./target/release/mempedia
```

- For non-trivial JSON, prefer `--stdin` with a heredoc instead of shell-escaping long payloads:

```bash
cat <<'JSON' | "$BIN" --project "$PWD" --stdin
{"action":"list_skills"}
JSON
```

## When To Escalate To Memory

- Stable project facts: Layer 1 core knowledge.
- Short-lived chronology: Layer 2 episodic memory.
- Persistent user constraints: Layer 3 preferences.
- Reusable procedures: Layer 4 skills.

## Avoid

- Treating skills as answer content.
- Treating a skill name as a tool name.
- Skipping repository evidence when the question is project-specific.