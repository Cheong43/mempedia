/**
 * Core governance types for the mempedia runtime.
 *
 * These types define the policy model used to govern tool execution:
 *   - ask / allow / deny decisions
 *   - rule-based matching
 *   - guard configuration
 *   - audit logging
 */

/** The three possible governance decisions. */
export type PolicyDecision = 'allow' | 'ask' | 'deny';

/**
 * A single policy rule.  Rules are evaluated in declaration order; the first
 * matching rule wins.  The priority order across effects is:
 *   deny > allow > ask > default
 */
export interface PolicyRule {
  /** Effect to apply when this rule matches. */
  effect: PolicyDecision;

  /**
   * Glob/exact match for the tool name.  If omitted the rule matches all tools.
   * Supports simple `*` wildcards (e.g. `mempedia_*`).
   */
  action?: string;

  /**
   * Glob/exact match applied to the first path-like argument of the request
   * (`path`, `node_id`, `command`, …).  If omitted the rule matches regardless
   * of the target value.
   * Supports simple `*` and `**` wildcards.
   */
  path?: string;

  /** Human-readable description / comment for this rule. */
  description?: string;
}

/** Guard-specific configuration embedded in the policy. */
export interface GuardConfig {
  /** Enable the external-directory guard.  Defaults to `true`. */
  externalDir?: boolean;

  /** Enable command-level shell safety checks. */
  shellSafety?: {
    enabled: boolean;
    /** Decision to emit when a forbidden shell command is detected. */
    decision?: PolicyDecision;
  };

  /** Doom-loop detection configuration. */
  doomLoop?: {
    enabled: boolean;
    /** How many identical consecutive requests trigger a doom-loop decision. */
    maxRepeats: number;
    /** How many recent requests to keep in the rolling window. */
    windowSize?: number;
    /** Decision to emit when a doom loop is detected. */
    decision?: PolicyDecision;
  };
}

/** The full policy document loaded from `.mempedia/policy.json`. */
export interface Policy {
  /** Fallback decision when no rule matches. */
  default: PolicyDecision;
  /** Ordered list of rules; first match wins. */
  rules: PolicyRule[];
  /** Guard configuration. */
  guards?: GuardConfig;
}

/** Contextual information passed to the governance layer for every tool call. */
export interface GovernanceRequest {
  /** Name of the tool being invoked. */
  toolName: string;
  /** Raw arguments passed to the tool. */
  args: Record<string, unknown>;
  /** Logical agent identifier (e.g. `agent-main`). */
  agentId?: string;
  /** Per-run session identifier. */
  sessionId?: string;
}

/** The outcome of a governance evaluation. */
export interface GovernanceDecision {
  decision: PolicyDecision;
  /** The rule that triggered this decision, if any. */
  rule?: PolicyRule;
  /** Human-readable reason for the decision. */
  reason: string;
  /** Guard that produced this decision, if applicable. */
  guardName?: string;
}

/** A single record written to the audit log. */
export interface AuditEntry {
  ts: string;
  sessionId?: string;
  agentId?: string;
  toolName: string;
  args: Record<string, unknown>;
  decision: PolicyDecision;
  reason: string;
  rule?: PolicyRule;
  guardName?: string;
  /** Outcome set after the tool has finished executing. */
  outcome?: 'success' | 'denied' | 'error';
  durationMs?: number;
}

/**
 * Abstraction for the human-in-the-loop `ask` flow.
 *
 * In interactive sessions this could display a prompt; in non-interactive or
 * test contexts an `InMemoryApprovalEngine` implementation is provided that
 * resolves immediately with a configurable default answer.
 */
export interface ApprovalEngine {
  ask(request: GovernanceRequest, reason: string): Promise<'allow' | 'deny'>;
}
