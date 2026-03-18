/**
 * Runtime bootstrap module.
 *
 * `createRuntime(projectRoot, client)` is the single composition root for the
 * new governed tool / governance runtime.  Import and call this once at startup
 * to get a fully-wired `ToolRuntime` that can be used from the existing agent
 * or directly from App.tsx for UI-driven operations.
 *
 * Architecture:
 *
 *   Shell / UI / CLI
 *       │
 *       ▼
 *   AgentRuntime  ──────────► ToolRuntime
 *       │                         │
 *       │                         ▼
 *       │                  GovernanceRuntime
 *       │                    (policy + guards + audit)
 *       │                         │
 *       └──── (allow) ───────────►│
 *                                 ▼
 *                          ToolDefinition.execute()
 *                         (MempediaActionTool, …)
 */

import { MempediaClient } from '../mempedia/client.js';
import { ToolAction, ToolResponse } from '../mempedia/types.js';
import { ToolRegistry } from './tools/ToolRegistry.js';
import { ToolRuntime } from './tools/ToolRuntime.js';
import { GovernanceRuntime } from './governance/GovernanceRuntime.js';
import { InMemoryApprovalEngine } from './governance/InMemoryApprovalEngine.js';
import { MempediaActionTool } from './tools/builtin/mempedia/MempediaActionTool.js';
import { ToolExecutionResult } from './tools/types.js';
import { ReadFileTool } from './tools/builtin/local/ReadFileTool.js';
import { WriteFileTool } from './tools/builtin/local/WriteFileTool.js';
import { RunShellTool } from './tools/builtin/local/RunShellTool.js';
import { Policy } from './governance/types.js';

export { ToolRuntime } from './tools/ToolRuntime.js';
export { ToolRegistry } from './tools/ToolRegistry.js';
export { GovernanceRuntime } from './governance/GovernanceRuntime.js';
export { AuditLogger } from './governance/AuditLogger.js';
export { InMemoryApprovalEngine } from './governance/InMemoryApprovalEngine.js';
export { ExternalDirGuard } from './governance/guards/ExternalDirGuard.js';
export { DoomLoopGuard } from './governance/guards/DoomLoopGuard.js';
export { ShellSafetyGuard } from './governance/guards/ShellSafetyGuard.js';
export { MempediaActionTool } from './tools/builtin/mempedia/MempediaActionTool.js';
export { ReadFileTool } from './tools/builtin/local/ReadFileTool.js';
export { WriteFileTool } from './tools/builtin/local/WriteFileTool.js';
export { RunShellTool } from './tools/builtin/local/RunShellTool.js';
export { AgentRuntime } from './agent/AgentRuntime.js';
export { SimplePlanner } from './agent/SimplePlanner.js';

export type { Policy } from './governance/types.js';
export type { ToolDefinition, ToolExecutionContext, ToolExecutionResult } from './tools/types.js';
export type { AgentTraceEvent } from './agent/types.js';

export interface RuntimeConfig {
  projectRoot: string;
  agentId?: string;
  sessionId?: string;
  /** Override policy (useful in tests). */
  policy?: Policy;
  /**
   * Default answer for the `ask` approval engine when running non-interactively.
   * Defaults to `'allow'` so that the new runtime is transparent by default
   * until a custom `ApprovalEngine` is wired in.
   */
  askDefault?: 'allow' | 'deny';
}

export interface RuntimeHandle {
  toolRuntime: ToolRuntime;
  governance: GovernanceRuntime;
  registry: ToolRegistry;
  executeTool(toolName: string, args: Record<string, unknown>): Promise<ToolExecutionResult>;
  /**
   * Convenience method: execute a `ToolAction` through the governed
   * `mempedia_action` tool.  This is the drop-in replacement for
   * `agent.sendMempediaAction(action)`.
   */
  sendMempediaAction(action: ToolAction): Promise<ToolResponse>;
}

/**
 * Create and wire the full governed runtime.
 *
 * @param config - Runtime configuration.
 * @param client - An already-constructed (but not necessarily started)
 *   `MempediaClient` instance.
 */
export function createRuntime(config: RuntimeConfig, client: MempediaClient): RuntimeHandle {
  const {
    projectRoot,
    agentId = 'agent-main',
    sessionId = `session-${Date.now()}`,
    policy,
    askDefault = 'allow',
  } = config;

  // 1. Governance layer
  const approvalEngine = new InMemoryApprovalEngine(askDefault);
  const governance = new GovernanceRuntime({ projectRoot, policy, approvalEngine });

  // 2. Tool registry
  const registry = new ToolRegistry();
  registry.register(new MempediaActionTool(client));
  registry.registerAll([
    new ReadFileTool(),
    new WriteFileTool(),
    new RunShellTool(),
  ]);

  // 3. Tool runtime
  const toolRuntime = new ToolRuntime({
    registry,
    governance,
    context: { projectRoot, agentId, sessionId },
  });

  // 4. Convenience wrapper
  const executeTool = async (toolName: string, args: Record<string, unknown>) =>
    toolRuntime.execute(toolName, args);

  const sendMempediaAction = async (action: ToolAction): Promise<ToolResponse> => {
    const result = await toolRuntime.execute('mempedia_action', action as unknown as Record<string, unknown>);
    if (!result.success) {
      return { kind: 'error', message: result.error ?? 'unknown error' };
    }
    return result.result as ToolResponse;
  };

  return { toolRuntime, governance, registry, executeTool, sendMempediaAction };
}
