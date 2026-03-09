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

## Running

```bash
npm start
```

## Architecture

- **React/Ink**: UI rendering.
- **Agent**: Logic loop using OpenAI.
- **Mempedia Client**: Communicates with `mempedia` binary via NDJSON over stdin/stdout.
- **Stateless**: The agent retrieves context from Mempedia at the start of each interaction.
