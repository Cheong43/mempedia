---
name: agent-memory-rust
description: Build, evolve, and review the Rust append-only versioned knowledge graph memory engine used in this repo. Use for requests about Node/Version DAG, filesystem object storage, graph traversal, merge/promotion/decay, tool protocol actions, and performance constraints (<=100k nodes, deterministic single-writer runtime).
---

# Agent Memory Rust

Use this skill when the request is about implementing or modifying the memory engine in this repository.

## Scope

This engine is:
- append-only
- immutable by version
- filesystem-backed
- deterministic, single-process single-writer
- optimized for agent long-term structured memory

This engine is not:
- a general database
- a distributed system
- a vector database / generic RAG layer

## Mandatory Constraints

1. Never mutate historical `NodeVersion` objects.
2. Every state change creates a new version object.
3. Version history is a DAG via `parents: Vec<VersionId>`.
4. Persist version objects by content hash (`blake3`).
5. Use atomic file replacement for index updates (`heads.json`, `nodes.json`).
6. Keep behavior deterministic and explicit.
7. Prefer minimal dependencies and simple data structures.

## Repository Anchors

Read these first before major changes:
- `readme.md`
- `Projectv0.0.1.md`
- `src/core/mod.rs`
- `src/storage/mod.rs`
- `src/versioning/mod.rs`
- `src/graph/mod.rs`
- `src/api/mod.rs`

## Storage Contract

Data layout:
- `data/index/nodes.json`
- `data/index/heads.json`
- `data/objects/<hash_prefix>/<version_hash>.json`

Write path:
1. Build new `NodeVersion` in memory.
2. Serialize and hash content.
3. Write object file if absent (dedupe by hash).
4. Atomically update `heads.json` and `nodes.json`.
5. Rebuild or incrementally update graph index.

## Execution Workflow

1. Clarify operation type:
- node lifecycle (`create`, `update`, `fork`, `merge`)
- traversal (`BFS`, `DFS`, importance-first, confidence-filtered)
- scoring (`promotion`, `decay`)
- protocol/API actions (`open_node`, `compare_versions`, etc.)

2. Implement in the correct layer:
- schema: `core`
- persistence: `storage`
- version transitions: `versioning`
- in-memory connectivity: `graph`
- external interface: `api`
- orchestration/demo: `runtime`

3. Keep compatibility checks explicit:
- parent links valid
- node ownership for merge inputs
- missing head/version returns typed errors

4. Verify locally:
- `cargo fmt`
- `cargo check`
- `cargo run`
- `cargo test` (when tests exist)

## Merge Rules

Support two modes:
1. Non-conflicting fields: merge automatically.
2. Conflicting fields: prefer higher confidence or emit conflict markers.

Output is always a new version with multiple parents.

## Promotion and Decay

Importance should combine:
- in-degree
- access frequency
- highlight weights
- cross-branch presence
- time decay

Recommended formula pattern:
`importance = decay(log(in_degree+1) + access + highlights + cross_branch_presence)`

## Review Checklist

Before finalizing, confirm:
1. No old version overwrite exists.
2. All writes are append-only for objects.
3. Index updates are atomic.
4. Traversal complexity stays predictable.
5. Error paths are explicit and typed.
6. New behavior is covered by at least demo flow or tests.

## Output Style for Tasks Using This Skill

When asked to implement changes:
1. State which module(s) changed and why.
2. Summarize invariant preservation (immutability, append-only, determinism).
3. Report verification commands and key results.
4. Call out any tradeoffs or deferred items.
