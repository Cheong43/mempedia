---
name: planner-replay-harness
description: Run the mitosis-cli live planner replay harness and interpret the results. Use when testing branch-planner reliability, measuring fallback rates, comparing prompts under real model calls, checking for tool_call leakage, separating sandbox/network failures from planner failures, or verifying whether memory-save side effects are contaminating the outcome.
---

# Planner Replay Harness

## Overview

Use this skill to exercise the live planner replay harness in `mitosis-cli` and explain what kind of failure is actually happening. Start by ruling out deterministic regressions locally, then run the live harness, then classify the result as planner fallback, connection-layer failure, runtime exhaustion, or memory-save interference.

## Quick Start

Work from the repo root at `/Users/mac/Documents/CodeProject/M2W`.

1. Build `mitosis-cli`.
```bash
cd mitosis-cli
npm run build
```

2. Run the deterministic regression suite before touching live endpoints.
```bash
node --test dist/agent/Agent.integration.test.js
```

3. Run the live replay harness with the default failing prompt.
```bash
npm run test:planner:live
```

4. Run focused comparisons by overriding prompts and iteration count.
```bash
PLANNER_REPLAY_PROMPTS='挽救计划好看不||1+1等于多少？用一句话回答。||介绍一下苹果公司' \
PLANNER_REPLAY_ITERATIONS=1 \
npm run test:planner:live
```

## Workflow

### 1. Confirm the harness entry points

Use these repo files as the source of truth:

- Harness test: `mitosis-cli/src/agent/plannerReplay.integration.test.ts`
- Script entry: `mitosis-cli/package.json` key `test:planner:live`
- Planner logic: `mitosis-cli/src/agent/index.ts`
- LLM transport: `mitosis-cli/src/agent/llm.ts`

Do not diagnose prompt behavior from old thread transcripts alone when a live replay can be run.

### 2. Distinguish sandbox/network failure from planner failure

If the replay reports `Connection error.` before any useful tool activity, suspect the execution environment first.

Interpretation:

- `connectionError=true` under sandboxed execution often means the live model endpoint is blocked, not that the planner prompt is bad.
- If the same replay succeeds after elevated execution, treat the earlier result as an environment artifact.
- Do not tune prompt wording based only on sandbox `Connection error.` output.

### 3. Read the replay summary before reading the prose answer

The harness prints per-run fields that matter more than the final answer text:

- `plannerFallbacks`
- `connectionError`
- `exhausted`
- `leakedToolCall`
- `branches`
- `tools`

Classify runs this way:

- `plannerFallbacks > 0`: the model did not return valid structured planner JSON often enough; adjust planner prompt, parsing, or repair logic.
- `connectionError=true`: treat as transport or sandbox failure first.
- `exhausted=true` with `plannerFallbacks=0`: the planner likely produced valid steps, but the run failed later in execution or synthesis.
- `leakedToolCall=true`: user-facing sanitization regressed; fix final-answer cleanup before trusting the run.
- `tools=0` on an external knowledge prompt: check whether root gating is over-collapsing the plan or whether the first model step answered directly.

### 4. Compare prompts, not just one prompt

Use at least one prompt from each bucket when diagnosing planner behavior:

- The known failing or suspicious prompt, such as `挽救计划好看不`
- A trivial control prompt, such as `1+1等于多少？用一句话回答。`
- A general knowledge prompt, such as `介绍一下苹果公司`

This helps separate:

- prompt-specific failures
- general planner JSON failures
- endpoint-wide transport instability
- long-run performance issues on web-heavy tasks

### 5. Watch for background memory-save interference

If the replay answer looks fine but the process later logs a Rust panic such as `byte index 64 is not a char boundary`, the planner may be healthy while the background memory pipeline is not.

Use this check:

```bash
sed -n '2188,2200p' src/api/mod.rs
ls -l target/release/mempedia
```

If the source is fixed but the binary is stale, rebuild:

```bash
cargo build --release --bin mempedia
```

Then rerun the same live replay before drawing conclusions about planner reliability.

### 6. Clean up hanging replay processes if the test prints a summary but does not exit

First inspect whether the replay process is still alive:

```bash
ps -Ao pid,command | rg 'plannerReplay.integration.test.js|npm run test:planner:live'
```

If the replay is clearly stuck after emitting its summary, stop the lingering test processes and note that shutdown hygiene still needs investigation.

## Reporting Guidance

When summarizing results, report:

- the exact prompts used
- iteration count
- whether the run required elevated execution
- aggregate counts for `plannerFallbackRuns`, `connectionErrors`, and `exhaustedWithoutAnswer`
- whether raw `tool_call` or fenced code leaked to the user
- whether a stale `mempedia` binary or background memory-save panic affected the result

Lead with the dominant failure mode. For example:

- `The live replay no longer shows planner fallback; the earlier failure was sandbox networking.`
- `The planner still falls back on structured JSON for this prompt family.`
- `The planner succeeds, but post-run memory persistence is crashing on a stale Rust binary.`
