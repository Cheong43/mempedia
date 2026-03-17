import { ToolRegistry } from './ToolRegistry.js';
import { ToolExecutionContext, ToolExecutionResult } from './types.js';
import { GovernanceRuntime } from '../governance/GovernanceRuntime.js';
import { GovernanceRequest } from '../governance/types.js';

export interface ToolRuntimeOptions {
  registry: ToolRegistry;
  governance: GovernanceRuntime;
  context: ToolExecutionContext;
}

/**
 * ToolRuntime is the execution entry point for all tool calls.
 *
 * For each call it:
 *  1. Looks up the tool in the registry.
 *  2. Asks GovernanceRuntime for an allow/deny decision.
 *  3. Executes the tool if allowed, or returns a denial result.
 *  4. Updates the audit log with the outcome and duration.
 */
export class ToolRuntime {
  private readonly registry: ToolRegistry;
  private readonly governance: GovernanceRuntime;
  private readonly ctx: ToolExecutionContext;

  constructor(options: ToolRuntimeOptions) {
    this.registry = options.registry;
    this.governance = options.governance;
    this.ctx = options.context;
  }

  /**
   * Execute a named tool with the given arguments, subject to governance.
   *
   * Always returns a `ToolExecutionResult` — never throws.
   */
  async execute(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<ToolExecutionResult> {
    const start = Date.now();

    // 1. Resolve the tool implementation.
    const tool = this.registry.get(toolName);
    if (!tool) {
      return {
        success: false,
        error: `ToolRuntime: unknown tool '${toolName}'`,
        durationMs: Date.now() - start,
      };
    }

    // 2. Governance check.
    const govReq: GovernanceRequest = {
      toolName,
      args,
      agentId: this.ctx.agentId,
      sessionId: this.ctx.sessionId,
    };

    const decision = await this.governance.evaluate(govReq);

    if (decision.decision === 'deny') {
      return {
        success: false,
        error: `Governance denied: ${decision.reason}`,
        durationMs: Date.now() - start,
      };
    }

    // 3. Execute.
    try {
      const result = await tool.execute(args, this.ctx);
      return {
        ...result,
        durationMs: Date.now() - start,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: `ToolRuntime: unhandled error in '${toolName}': ${message}`,
        durationMs: Date.now() - start,
      };
    }
  }

  /**
   * Reset per-session state in the governance runtime.
   * Call this at the start of each agent run.
   */
  resetSession(): void {
    this.governance.resetSession();
  }
}
