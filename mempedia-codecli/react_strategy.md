# Branching ReAct Strategy for Mempedia

This guide describes the rewritten CodeCLI strategy: ReAct is treated as a functional loop, and one loop can spawn child loops when multiple real options exist.

## Core Loop

Each loop iteration must do exactly one of the following:

1. **THOUGHT → TOOL**
   Pick the single best next tool call and continue the same branch.

2. **THOUGHT → BRANCH**
   If there are multiple materially different strategies, create several child branches.
   Each child branch gets its own local objective and keeps running its own ReAct cycle.

3. **THOUGHT → FINAL**
   If the branch is done, emit a final answer for that branch.

4. **THOUGHT → ASYNC SAVE (optional)**
   If a branch has discovered durable value, call the async memory-save tool immediately.
   This should preserve only valuable information plus the raw conversation snapshot, without blocking the main loop.

Completed branches are synthesized into one user-facing answer.

## When to Branch

Branch only if the alternatives are genuinely different, for example:

- lexical search vs. graph traversal
- read top hit vs. verify version history
- inspect code path A vs. code path B
- quick answer path vs. validation path

Do **not** branch for trivial wording variations.

## When to Save Memory

Use async memory save only when at least one of these is true:

- a reusable project fact was discovered
- a stable workflow/pattern was confirmed
- a valuable branch result should be preserved before the session ends

Do **not** save every branch by default.

## Tool Order (Recommended)

1. `mempedia_search_hybrid`  
   Use for high-recall retrieval. Ask for `limit=8-12` first.

2. `mempedia_read`  
   Open the top 1-3 nodes to confirm details.

3. `mempedia_traverse`  
   Expand the graph when you need related context or dependencies.

4. `mempedia_history`  
   Validate how a fact evolved over time, or resolve conflicts.

5. `mempedia_save`  
   Persist new systematic knowledge nodes or updates after the task.

## Search Patterns

- Broad query → `mempedia_search_hybrid(query, limit=10)`
- Disambiguate → `mempedia_read(node_id)`
- Explore neighbors → `mempedia_traverse(start_node, mode="bfs", depth_limit=1)`
- Check versions → `mempedia_history(node_id, limit=5)`

## Save Discipline

- Save only reusable, systematic knowledge nodes.
- Avoid storing transient or conversational noise.
- Always include a clean title and concise summary in the markdown.
- Do not stop at a terse summary when richer evidence exists. Preserve facts, numbers, version details, timeline changes, viewpoints, caveats, and evidence in structured markdown sections.
- Prefer fewer, denser nodes that organize one topic or subsystem coherently instead of scattering related facts across many tiny entries.
- Prefer explicit sections such as `Facts`, `Data`, `History`, `Viewpoints`, `Uncertainties`, `Relations`, and `Evidence` when they help future retrieval.
- Never invent missing facts.
