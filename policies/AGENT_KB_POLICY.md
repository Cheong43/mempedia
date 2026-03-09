# Agent KB Governance Policy

This policy defines mandatory behavior for autonomous updates to the local knowledge base.

## 1. Core Principles

1. Markdown-first:
- Canonical human-readable content must remain in local markdown projection files under `knowledge/nodes/`.
- Agent updates must preserve source wording where possible and avoid stylistic rewrites.

2. Append-only versioning:
- Every update creates a new immutable version.
- No in-place overwrite of historical versions.

3. Full traceability:
- Every autonomous update must include `agent_id`, `reason`, and `source`.
- Every autonomous update must append an audit record into `index/agent_actions.log`.

4. Deterministic rollback:
- Recovery must be done through `rollback_node` to create a new head from a historical version.
- Never delete version objects as part of rollback.

## 2. Required Validation Before Agent Writes

For `agent_upsert_markdown`, the runtime must enforce:

- `agent_id` is non-empty.
- `reason` length >= configured minimum (`min_reason_chars`).
- `source` is non-empty.
- `confidence` >= configured minimum (`min_confidence`).
- markdown payload size <= configured limit (`max_markdown_bytes`).

If any check fails, the update must be rejected.

## 3. Update Workflow (Required Sequence)

1. Validate input and governance gates.
2. Parse markdown to structured node content.
3. Create or update node version (append-only).
4. Sync markdown projection for latest head.
5. Rebuild retrieval indexes.
6. Append audit log entry.

## 4. Prohibited Actions

- Writing unverifiable facts without source metadata.
- Silent batch rewrites of existing node bodies.
- Bypassing audit log for autonomous updates.
- Rewriting history objects for rollback.

## 5. Suggested Operational Guardrails

- Use a dedicated `agent_id` per runtime identity.
- Keep `reason` concrete (what changed and why).
- Keep `source` concrete (ticket, chat id, URL, or input channel id).
- Periodically back up `.mempedia/memory` and store Git snapshots of policy and tooling files.
