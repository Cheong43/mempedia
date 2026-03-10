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

## Running

```bash
npm start
```

## Architecture

- **React/Ink**: UI rendering.
- **Agent**: Logic loop using OpenAI.
- **Mempedia Client**: Communicates with `mempedia` binary via NDJSON over stdin/stdout.
- **Stateless**: The agent retrieves context from Mempedia at the start of each interaction.
