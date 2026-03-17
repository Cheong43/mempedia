import { Policy, GovernanceRequest, GovernanceDecision, ApprovalEngine, AuditEntry } from './types.js';
import { loadPolicy } from './PolicyLoader.js';
import { matchRules } from './RuleMatcher.js';
import { AuditLogger } from './AuditLogger.js';
import { InMemoryApprovalEngine } from './InMemoryApprovalEngine.js';
import { ExternalDirGuard } from './guards/ExternalDirGuard.js';
import { DoomLoopGuard } from './guards/DoomLoopGuard.js';

export interface GovernanceRuntimeOptions {
  projectRoot: string;
  /** Override the loaded policy (useful in tests). */
  policy?: Policy;
  /** Approval engine used to resolve `ask` decisions. */
  approvalEngine?: ApprovalEngine;
}

/**
 * GovernanceRuntime is the central decision-making component.
 *
 * For every incoming tool request it:
 *  1. Runs active guards (ExternalDirGuard, DoomLoopGuard).
 *  2. Matches the request against the loaded policy rules.
 *  3. Resolves `ask` decisions through the ApprovalEngine.
 *  4. Appends an audit log entry.
 *
 * Returns a `GovernanceDecision` whose `.decision` is `'allow'` or `'deny'`.
 * (`ask` is resolved transparently before returning.)
 */
export class GovernanceRuntime {
  private readonly policy: Policy;
  private readonly auditLogger: AuditLogger;
  private readonly approvalEngine: ApprovalEngine;
  private readonly externalDirGuard: ExternalDirGuard | null;
  private readonly doomLoopGuard: DoomLoopGuard | null;

  constructor(options: GovernanceRuntimeOptions) {
    const { projectRoot } = options;
    this.policy = options.policy ?? loadPolicy(projectRoot);
    this.auditLogger = new AuditLogger(projectRoot);
    this.approvalEngine = options.approvalEngine ?? new InMemoryApprovalEngine('allow');

    // Initialise guards based on policy configuration.
    const guards = this.policy.guards ?? {};

    this.externalDirGuard =
      guards.externalDir !== false ? new ExternalDirGuard(projectRoot) : null;

    const dl = guards.doomLoop;
    this.doomLoopGuard =
      dl?.enabled !== false
        ? new DoomLoopGuard(dl?.maxRepeats ?? 3, dl?.windowSize ?? 20, dl?.decision ?? 'ask')
        : null;
  }

  /**
   * Evaluate a governance request and return the final `allow`/`deny` decision.
   *
   * Side effects:
   *   - Appends an audit log entry.
   *   - DoomLoopGuard advances its session history.
   */
  async evaluate(req: GovernanceRequest): Promise<GovernanceDecision> {
    const startTs = new Date().toISOString();

    // 1. Run guards first — their decisions take precedence over policy rules.
    const guardDecision = this.runGuards(req);
    if (guardDecision) {
      const resolved = await this.resolveDecision(req, guardDecision);
      this.writeAudit(startTs, req, resolved);
      return resolved;
    }

    // 2. Match against policy rules.
    const { decision, rule } = matchRules(this.policy, req);
    const ruleDecision: GovernanceDecision = {
      decision,
      rule,
      reason: rule
        ? `Rule matched: ${rule.description ?? `effect=${rule.effect}`}`
        : `Policy default: ${this.policy.default}`,
    };

    const resolved = await this.resolveDecision(req, ruleDecision);
    this.writeAudit(startTs, req, resolved);
    return resolved;
  }

  /** Reset session-scoped state (call at the start of each agent run). */
  resetSession(): void {
    this.doomLoopGuard?.reset();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private runGuards(req: GovernanceRequest): GovernanceDecision | undefined {
    if (this.externalDirGuard) {
      const result = this.externalDirGuard.evaluate(req);
      if (result) return result;
    }
    if (this.doomLoopGuard) {
      const result = this.doomLoopGuard.evaluate(req);
      if (result) return result;
    }
    return undefined;
  }

  private async resolveDecision(
    req: GovernanceRequest,
    decision: GovernanceDecision,
  ): Promise<GovernanceDecision> {
    if (decision.decision !== 'ask') {
      return decision;
    }
    // Resolve ask → allow/deny via the approval engine.
    const answer = await this.approvalEngine.ask(req, decision.reason);
    return {
      ...decision,
      decision: answer,
      reason: `${decision.reason} → user/engine answered: ${answer}`,
    };
  }

  private writeAudit(ts: string, req: GovernanceRequest, decision: GovernanceDecision): void {
    const entry: AuditEntry = {
      ts,
      sessionId: req.sessionId,
      agentId: req.agentId,
      toolName: req.toolName,
      args: req.args,
      decision: decision.decision,
      reason: decision.reason,
      rule: decision.rule,
      guardName: decision.guardName,
    };
    this.auditLogger.append(entry);
  }
}
