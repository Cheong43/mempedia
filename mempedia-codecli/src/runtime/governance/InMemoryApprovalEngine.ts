import { ApprovalEngine, GovernanceRequest } from './types.js';

/**
 * A simple in-memory `ApprovalEngine` implementation for use in non-interactive
 * or testing contexts.
 *
 * In interactive deployments this should be replaced with an implementation
 * that presents the pending request to the user via the UI/CLI.
 *
 * The `defaultAnswer` constructor parameter controls how the engine resolves
 * `ask` requests that have not been pre-configured:
 *   - `'allow'` — auto-approve all `ask` requests (useful in dev/test)
 *   - `'deny'`  — auto-reject all `ask` requests (safe/conservative default)
 */
export class InMemoryApprovalEngine implements ApprovalEngine {
  private readonly defaultAnswer: 'allow' | 'deny';
  private readonly overrides = new Map<string, 'allow' | 'deny'>();

  constructor(defaultAnswer: 'allow' | 'deny' = 'deny') {
    this.defaultAnswer = defaultAnswer;
  }

  /**
   * Pre-configure the answer for a specific tool name.
   * Useful in tests to allow or deny specific tools.
   */
  setAnswer(toolName: string, answer: 'allow' | 'deny'): void {
    this.overrides.set(toolName, answer);
  }

  async ask(request: GovernanceRequest, _reason: string): Promise<'allow' | 'deny'> {
    return this.overrides.get(request.toolName) ?? this.defaultAnswer;
  }
}
