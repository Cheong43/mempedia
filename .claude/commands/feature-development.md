---
name: feature-development
description: Workflow command scaffold for feature-development in mempedia.
allowed_tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---

# /feature-development

Use this workflow when working on **feature-development** in `mempedia`.

## Goal

Standard feature implementation workflow

## Common Files

- `mempedia-codecli/node_modules/@cspotcode/source-map-support/*`
- `mempedia-codecli/node_modules/@jridgewell/sourcemap-codec/src/*`
- `mempedia-codecli/node_modules/@types/node-fetch/*`
- `**/*.test.*`
- `**/api/**`

## Suggested Sequence

1. Understand the current state and failure mode before editing.
2. Make the smallest coherent change that satisfies the workflow goal.
3. Run the most relevant verification for touched files.
4. Summarize what changed and what still needs review.

## Typical Commit Signals

- Add feature implementation
- Add tests for feature
- Update documentation

## Notes

- Treat this as a scaffold, not a hard-coded script.
- Update the command if the workflow evolves materially.