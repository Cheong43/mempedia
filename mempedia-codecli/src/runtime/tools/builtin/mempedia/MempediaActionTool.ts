import { MempediaClient } from '../../../../mempedia/client.js';
import { ToolAction, ToolResponse } from '../../../../mempedia/types.js';
import { ToolDefinition, ToolExecutionContext, ToolExecutionResult } from '../../types.js';

function isErrorResponse(r: ToolResponse): r is { kind: 'error'; message: string } {
  return r.kind === 'error';
}

/**
 * MempediaActionTool wraps the `MempediaClient` as a governed `ToolDefinition`.
 *
 * It accepts any `ToolAction` payload (passed as the `args` argument bag) and
 * forwards it to the running mempedia process via the client.
 *
 * The `action` field of the args bag is used as the mempedia action discriminant.
 * All other fields are forwarded verbatim.
 *
 * Tool name: `mempedia_action`
 */
export class MempediaActionTool implements ToolDefinition<Record<string, unknown>, ToolResponse> {
  readonly name = 'mempedia_action';
  readonly description =
    'Execute a mempedia engine action (read, write, search, traverse, …). ' +
    'The `action` field in args selects the operation; all other fields are forwarded.';

  constructor(private readonly client: MempediaClient) {}

  async execute(
    args: Record<string, unknown>,
    _ctx: ToolExecutionContext,
  ): Promise<ToolExecutionResult<ToolResponse>> {
    const start = Date.now();
    if (!args.action || typeof args.action !== 'string') {
      return {
        success: false,
        error: 'MempediaActionTool: missing or invalid `action` field in args',
        durationMs: Date.now() - start,
      };
    }
    try {
      const response = await this.client.send(args as unknown as ToolAction);
      const failed = isErrorResponse(response);
      return {
        success: !failed,
        result: response,
        error: failed ? response.message : undefined,
        durationMs: Date.now() - start,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: `MempediaActionTool: ${message}`,
        durationMs: Date.now() - start,
      };
    }
  }
}
