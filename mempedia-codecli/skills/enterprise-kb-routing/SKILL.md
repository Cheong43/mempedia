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
3. Treat `read/search/edit` as workspace-only tools. All Mempedia Layer 1/2/3/4 operations must go through `bash` by calling the `mempedia` CLI.
4. Prefer the narrowest valid memory layer instead of over-promoting information.
5. Let the independent post-turn memory agent classify the full turn across all four layers.

## CLI Pattern

- Run from the project root; `bash` already starts there.
- Resolve the binary before issuing actions:

```bash
BIN="${MEMPEDIA_BINARY_PATH:-./target/debug/mempedia}"
[[ -x "$BIN" ]] || BIN=./target/release/mempedia
```

- For simple actions with no text content (search, list, read), use a single-line heredoc:

```bash
cat <<'JSON' | "$BIN" --project "$PWD" --stdin
{"action":"list_skills"}
JSON
```

- **CRITICAL — Writing rich content (Chinese, quotes, newlines, web-sourced text):**
  Heredoc JSON is INVALID when a string value contains literal newlines or unescaped double-quotes.
  Any content that includes multi-line markdown, non-ASCII text, or external webpage content **MUST use the two-step pattern** below.

  **Step 1**: write the markdown to a temp file via a shell heredoc (no Python triple-quotes = no risk of `"""` in content breaking the script).
  **Step 2**: Python reads the temp file and sends it through `json.dumps()` so all escaping is handled automatically.

  Use the unique delimiters `____MEMPEDIA_MD____` and `____MEMPEDIA_PY____` — content will almost never contain these exact strings.

```bash
BIN="${MEMPEDIA_BINARY_PATH:-./target/debug/mempedia}"
[[ -x "$BIN" ]] || BIN=./target/release/mempedia

# Step 1: write markdown to a temp file
MDTMP=$(mktemp)
cat > "$MDTMP" <<'____MEMPEDIA_MD____'
---
node_id: "example_node"
title: "Example Title"
---

# Example Title

Full markdown body here — can contain Chinese, quotes, newlines, code blocks, anything.
____MEMPEDIA_MD____

# Step 2: Python reads the file and sends via CLI with proper JSON escaping
MDTMP="$MDTMP" python3 - <<'____MEMPEDIA_PY____'
import json, subprocess, os

BIN = os.environ.get('MEMPEDIA_BINARY_PATH', './target/debug/mempedia')
if not os.path.isfile(BIN):
    BIN = './target/release/mempedia'

with open(os.environ['MDTMP']) as f:
    markdown = f.read()

payload = json.dumps({
    "action": "agent_upsert_markdown",
    "node_id": "example_node",
    "markdown": markdown,
    "importance": 1.9,
    "agent_id": "agent-main",
    "reason": "User-requested knowledge ingestion",
    "source": "web",
})
result = subprocess.run(
    [BIN, '--project', os.getcwd(), '--stdin'],
    input=payload, capture_output=True, text=True
)
print(result.stdout or result.stderr)
____MEMPEDIA_PY____
rm -f "$MDTMP"
```

  - **NEVER** use Python triple-quoted strings (`"""`) for markdown content — web-sourced content or Chinese text may contain `"""` which terminates the string prematurely.
  - **NEVER** embed a multi-line string value inside `<<'JSON'...JSON` — JSON does not allow literal newlines in string values.
  - The `agent_upsert_markdown` action accepts a full markdown string (YAML frontmatter + body) and correctly derives `summary`, `title`, and structured fields from it.

## When To Escalate To Memory

- Stable project facts: Layer 1 core knowledge.
- Short-lived chronology: Layer 2 episodic memory.
- Persistent user constraints: Layer 3 preferences.
- Reusable procedures: Layer 4 skills.

## Avoid

- Treating skills as answer content.
- Treating a skill name as a tool name.
- Skipping repository evidence when the question is project-specific.