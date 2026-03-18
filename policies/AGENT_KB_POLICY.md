# Agent KB Governance Policy

This policy defines mandatory behavior for autonomous updates to the local knowledge base.

## 1. Core Principles

1. Markdown-first:
- Canonical human-readable content must remain in local markdown projection files, organized by project under `knowledge/projects/<project_id>/` or in `knowledge/nodes/` for unclassified nodes.
- Agent updates must preserve original meaning, respect facts, and be as detailed as the source material allows. Stylistic rewrites are prohibited; information density must not decrease.

2. Project-based classification:
- Knowledge is organized by domain/project. Each piece of knowledge should be assigned to the most appropriate project.
- Every project begins with an `index` node that describes the project scope and links to its major sub-topics.
- Nodes within a project should form a coherent hierarchy using `parent_node` links.

3. Append-only versioning:
- Every update creates a new immutable version.
- No in-place overwrite of historical versions.

4. Full traceability:
- Every autonomous update must include `agent_id`, `reason`, and `source`.
- Every autonomous update must append an audit record into `index/agent_actions.log`.

5. Deterministic rollback:
- Recovery must be done through `rollback_node` to create a new head from a historical version.
- Never delete version objects as part of rollback.

## 2. Required Validation Before Agent Writes

For `agent_upsert_markdown` and `ingest`, the runtime must enforce:

- `agent_id` is non-empty.
- `reason` length >= configured minimum (`min_reason_chars`).
- `source` is non-empty.
- markdown payload size <= configured limit (`max_markdown_bytes`).

If any check fails, the update must be rejected.

## 3. Update Workflow (Required Sequence)

1. Validate input and governance gates.
2. Parse markdown to structured node content.
3. Apply project, parent_node, and node_type fields if provided.
4. Create or update node version (append-only).
5. Sync markdown projection to the project-scoped path (or legacy nodes path).
6. Update `node_project_index` if project has changed.
7. Rebuild retrieval indexes.
8. Append audit log entry.

## 4. Project Management Workflow

To add a new knowledge domain:

1. `create_project` – register the project with name, description, owner, and tags.
2. Create an `index` node with `node_type: index` and `project: <project_id>` that describes the scope.
3. Add domain nodes with appropriate `project`, `parent_node`, and `node_type`.
4. Use `list_project_nodes` to audit the project's contents.

## 5. Knowledge Quality Requirements

- **Factual accuracy**: Do not invent or hallucinate facts. If uncertain, record the uncertainty in the `evidence` or `body` fields.
- **Detail preservation**: When writing from a source document, preserve key details, numbers, and specifics. Summary pruning is not permitted.
- **Source attribution**: Always include `source` (file path, URL, conversation ID, or human-supplied reference).
- **Structured enrichment**: Extract facts into the `Facts` section and evidence into `Evidence` to make knowledge machine-queryable.

## 6. Prohibited Actions

- Writing unverifiable facts without source metadata.
- Silent batch rewrites of existing node bodies that reduce information density.
- Bypassing audit log for autonomous updates.
- Rewriting history objects for rollback.
- Moving nodes between projects without updating `node_project_index`.

## 7. Suggested Operational Guardrails

- Use a dedicated `agent_id` per runtime identity.
- Keep `reason` concrete (what changed and why).
- Keep `source` concrete (ticket, chat id, URL, or input channel id).
- Periodically back up `.mempedia/memory` and store Git snapshots of policy and tooling files.
- When ingesting human-uploaded files, use `ingest` or `sync_markdown` with `project` and `node_type` set.

