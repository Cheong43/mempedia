# Agent KB Governance Policy

This policy defines mandatory behavior for autonomous updates to the local knowledge base.

## 1. Core Principles

1. Markdown-first:
- Canonical human-readable content must remain in local markdown projection files under `knowledge/nodes/`.
- Agent updates must preserve original meaning, respect facts, and be as detailed as the source material allows. Stylistic rewrites are prohibited; information density must not decrease.

2. Hierarchical organization:
- Knowledge can be organized with `parent_node` links and `node_type` classifications.
- Index nodes should describe scope and link to major sub-topics.

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
3. Apply `parent_node` and `node_type` fields if provided.
4. Create or update node version (append-only).
5. Sync markdown projection to `knowledge/nodes/`.
7. Rebuild retrieval indexes.
8. Append audit log entry.

## 5. Knowledge Quality Requirements

- **Factual accuracy**: Do not invent or hallucinate facts. If uncertain, record the uncertainty in the `evidence` or `body` fields.
- **Detail preservation**: When writing from a source document, preserve key details, numbers, and specifics. Summary pruning is not permitted.
- **Perspective separation**: Keep verified facts separate from opinions, interpretations, and stakeholder viewpoints. Preserve attribution when it is known.
- **Historical fidelity**: When the source describes change over time, preserve the timeline or before/after state instead of flattening it into a timeless summary.
- **Source attribution**: Always include `source` (file path, URL, conversation ID, or human-supplied reference).
- **Structured enrichment**: Extract facts into the `Facts` section and evidence into `Evidence` to make knowledge machine-queryable.
- **Rich markdown bodies**: When material exists, also preserve `Data`, `History`, `Viewpoints`, and `Uncertainties` as markdown sections even if they are not all machine-indexed today.

## 6. Prohibited Actions

- Writing unverifiable facts without source metadata.
- Silent batch rewrites of existing node bodies that reduce information density.
- Bypassing audit log for autonomous updates.
- Rewriting history objects for rollback.
- Writing hierarchy metadata that does not match the intended node structure.

## 7. Suggested Operational Guardrails

- Use a dedicated `agent_id` per runtime identity.
- Keep `reason` concrete (what changed and why).
- Keep `source` concrete (ticket, chat id, URL, or input channel id).
- Periodically back up `.mempedia/memory` and store Git snapshots of policy and tooling files.
- When ingesting human-uploaded files, use `ingest` or `sync_markdown` with `node_type` set when appropriate.

