/**
 * Core types for the mempedia tool runtime.
 */

/** Context made available to every tool implementation during execution. */
export interface ToolExecutionContext {
  /** Current project root directory. */
  projectRoot: string;
  /** Logical agent identifier. */
  agentId: string;
  /** Per-run session identifier. */
  sessionId: string;
}

/** Result returned by a tool implementation. */
export interface ToolExecutionResult<T = unknown> {
  success: boolean;
  result?: T;
  error?: string;
  durationMs: number;
}

/**
 * A tool definition.  Every tool has a unique `name`, a human-readable
 * `description`, and an `execute` method.
 *
 * `TArgs` is the argument bag type; `TResult` is the resolved value type
 * (before wrapping in `ToolExecutionResult`).
 */
export interface ToolDefinition<
  TArgs extends Record<string, unknown> = Record<string, unknown>,
  TResult = unknown,
> {
  /** Unique tool name (matches agent/planner tool call names). */
  name: string;
  /** Human-readable description used in prompts / documentation. */
  description: string;
  /**
   * Execute the tool.
   *
   * Implementations must NOT throw — return a `ToolExecutionResult` with
   * `success: false` and an `error` message instead.
   */
  execute(args: TArgs, ctx: ToolExecutionContext): Promise<ToolExecutionResult<TResult>>;
}
