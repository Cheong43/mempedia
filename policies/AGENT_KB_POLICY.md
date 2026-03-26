# Agent KB Governance Policy

This policy defines mandatory behavior for autonomous updates to the local
knowledge base. It reflects the current implementation, not older project-plan
drafts.

## 1. Implemented Requirements

### 1.1 Core Principles

1. Markdown-first:
- Canonical human-readable content must remain in local markdown projection files under `knowledge/nodes/`.
- Agent updates must preserve original meaning, respect facts, and maintain information density.

2. Stable hierarchy fields:
- Agents may use `parent_node` to create parent-child relationships.
- Agents may use `node_type` to describe the semantic role of a node.
- These are the stable hierarchy controls today.

3. Append-only versioning:
- Every update creates a new immutable version.
- Historical versions must not be edited in place.

4. Full traceability:
- Every autonomous update must include `agent_id`, `reason`, and `source`.
- Every autonomous update must append an audit record into `index/agent_actions.log`.

5. Deterministic rollback:
- Recovery must be done through `rollback_node` to create a new head from a historical version.
- Do not rewrite or delete historical versions during rollback.

### 1.2 Required Validation Before Agent Writes

For `agent_upsert_markdown`, `ingest`, and governed markdown sync flows, the
runtime must enforce:

- `agent_id` is non-empty when required by the action
- `reason` length is at least `min_reason_chars`
- `source` is non-empty
- markdown payload size is within `max_markdown_bytes`

If any check fails, the write must be rejected.

### 1.3 Update Workflow

Required sequence:

1. Validate input and governance gates.
2. Parse markdown into structured node content.
3. Apply `parent_node` and `node_type` if provided.
4. Create or update a node version using append-only semantics.
5. Sync markdown projection to `knowledge/nodes/`.
6. Rebuild retrieval indexes.
7. Append an audit log entry.

### 1.4 Knowledge Quality Requirements

- **Factual accuracy**: do not invent facts; if uncertain, preserve that uncertainty.
- **Detail preservation**: preserve important details, numbers, and specific constraints.
- **Perspective separation**: keep verified facts separate from opinions or viewpoints.
- **Historical fidelity**: preserve version evolution and before/after changes when present.
- **Source attribution**: always include a concrete `source`.
- **Structured enrichment**: prefer explicit `Facts` and `Evidence` sections when the source supports them.
- **Rich markdown bodies**: preserve `Data`, `History`, `Viewpoints`, and `Uncertainties` when available.

### 1.5 Prohibited Actions

- Writing unverifiable facts without source metadata.
- Silent rewrites that reduce information density.
- Bypassing audit logging for autonomous updates.
- Rewriting history objects as part of rollback.
- Assuming a project registry or project-scoped storage exists when it does not.

## 2. Planned, Not Yet Enforced

The following workflows are design intentions, not current runtime guarantees:

- project registration and lifecycle management
- project-scoped markdown projection directories
- node-to-project index maintenance
- project enumeration or project-specific audit actions

Until those land end-to-end, agents should not depend on `project`,
`create_project`, `list_projects`, `get_project`, or `list_project_nodes`.

## 3. Suggested Operational Guardrails

- Use a dedicated `agent_id` per runtime identity.
- Keep `reason` concrete about what changed and why.
- Keep `source` concrete: ticket, chat id, URL, file path, or input channel id.
- Periodically back up `.mempedia/memory` and keep Git snapshots of policy/tooling files.
- When ingesting human-authored material, prefer `ingest` or `sync_markdown` with `node_type` and optional `parent_node` set appropriately.
