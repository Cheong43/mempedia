# Mempedia CodeCLI

A React-based CLI agent that interacts with Mempedia for context and knowledge management.

## Prerequisites

- Node.js
- Rust (to build Mempedia)
- OpenAI API Key OR Volcengine Ark (Doubao) API Key

## Setup

1. Build Mempedia (if not already built):
   ```bash
   cd ..
   cargo build --release
   cd mempedia-codecli
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure Environment:
   Create a `.env` file in `mempedia-codecli`.
   
   For Ark/Doubao (Recommended):
   ```
   ARK_API_KEY=your_key_here
   ARK_BASE_URL=https://ark.cn-beijing.volces.com/api/coding/v3
   ARK_MODEL=Kimi-K2.5
   ```

   For OpenAI:
   ```
   OPENAI_API_KEY=your_key_here
   OPENAI_MODEL=gpt-4o
   ```

   For embeddings used by Mempedia hybrid search (optional):
   ```
   EMBEDDING_API_KEY=your_key_here
   EMBEDDING_BASE_URL=https://api.openai.com/v1
   EMBEDDING_MODEL=text-embedding-3-small
   ```

   For separate memory extraction/saving model (optional):
   ```
   MEMORY_API_KEY=your_memory_key_here
   MEMORY_BASE_URL=https://aigw-gzgy2.cucloud.cn:8443/v1
   MEMORY_MODEL=Qwen3.5-397B-A17B
   ```

   Coding Plan aliases are also supported:
   ```
   CODING_PLAN_BASE_URL=https://aigw-gzgy2.cucloud.cn:8443/v1
   CODING_PLAN_MODEL=Qwen3.5-397B-A17B
   ```

   Supported Coding Plan model names:
   - MiniMax-M2.5
   - glm-5
   - kimi-k2.5
   - Qwen3.5-397B-A17B
   - Qwen3-235B-A22B
   - DeepSeek V3.1

   Optional timeout controls for memory background tasks:
   ```
   MEMPEDIA_REQUEST_TIMEOUT_MS=0
   MEMORY_SAVE_ACTION_TIMEOUT_MS=0
   MEMORY_TASK_TIMEOUT_MS=0
   ```
   Set any timeout to a positive value only when you need forced fail-fast behavior.

   Optional GitHub token for online skill search:
   ```
   GITHUB_TOKEN=your_github_token_here
   ```
   This is not required, but it raises the GitHub API rate limit for `/skills search <query>`.

   Optional sandbox controls:
   ```
   MEMPEDIA_SHELL_TIMEOUT_MS=15000
   ```
   `run_shell` now executes inside `.mempedia/sandbox` with project-local `HOME`, `TMPDIR`, config, and cache directories.
   The sandbox blocks `git clone`, `git pull`, `git fetch`, `gh repo clone`, remote shell/file transfer, privilege escalation, and download-then-exec patterns.

   Branching ReAct loop controls:
   ```
   REACT_BRANCH_MAX_DEPTH=2
   REACT_BRANCH_MAX_WIDTH=3
   REACT_BRANCH_MAX_STEPS=8
   REACT_BRANCH_MAX_COMPLETED=4
   REACT_BRANCH_CONCURRENCY=3
   ```
   These tune how aggressively the agent forks child reasoning loops when one thought step has multiple viable next actions. Child branches get their own local step budget, while `REACT_BRANCH_CONCURRENCY` caps how many branches can run at the same time.

## Running

```bash
npm start
```

## Claude Code Skills Compatibility

- `codecli` can load local skills from `../skills/*/SKILL.md` (Claude-style frontmatter + markdown body).
- Runtime commands:
  - `/skills` list local skills
   - `/skills search <query>` search public GitHub `SKILL.md` files and cache matches for activation
   - `/skills clear-remote` clear cached remote search results
  - `/skill <name>` activate a skill for subsequent turns
  - `/skill off` disable active skill
  - `/skill <name> <task>` run one task with a skill (one-shot)
  - `/ui start [port]` launch integrated mempedia-ui with CLI bridge
  - `/ui stop` stop integrated mempedia-ui server
  - `/ui status` show ui server status
  - `/help` show command list
  - `/clear` clear current screen history
- When a skill is active, its description and body are injected into the request prompt so the agent follows that skill behavior.
- Remote skill search uses the GitHub code search API and treats matching `SKILL.md` files the same way as local skills once cached.
- Shell execution is sandboxed. Use `run_shell` for local bash work inside the project, but repository sync and other sensitive shell patterns are blocked.
- Integrated UI features:
  - Embedded CLI dialogue window inside `mempedia-ui`
  - Trace visualization for thought/action/observation flow
  - Memory snapshot endpoint so UI parses the same `.mempedia/memory` used by CLI

## Architecture

- **React/Ink**: UI rendering.
- **Branching ReAct Agent**: The agent now treats ReAct as a functional loop. Each loop step can either:
   - continue linearly with one tool plan,
   - fork into multiple child branches when there are materially different strategies,
   - or finish with a final answer.
- **Agent-decided Async Memory Saves**: Memory is no longer auto-saved for every completed session. Instead, the agent can queue asynchronous saves from any ReAct branch when it decides the result is valuable enough to preserve.
- **Branch Synthesizer**: Completed branches are merged into one final user answer.
- **Mempedia Client**: Communicates with `mempedia` binary via NDJSON over stdin/stdout.
- **Governed Local Sandbox**: `run_shell`, `read_file`, and `write_file` now execute through the runtime governance layer. Shell commands run with project-local sandbox directories and command-level safety checks.
- **Memory Save Queue**: Explicit save jobs are serialized in the background so knowledge extraction and raw conversation logging do not block the main loop.
