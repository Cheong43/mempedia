import { AgentTraceEvent, PlannedBranch, PlannedToolCall, ToolObservation, TranscriptMessage } from './types.js';
import { Planner } from './SimplePlanner.js';
import { ToolExecutionResult } from '../tools/types.js';

interface AgentToolRuntime {
  execute(toolName: string, args: Record<string, unknown>): Promise<ToolExecutionResult>;
  resetSession(): void;
}

export interface AgentBranchState {
  id: string;
  parentId: string | null;
  depth: number;
  label: string;
  goal: string;
  priority: number;
  steps: number;
  transcript: TranscriptMessage[];
  savedNodeIds: string[];
  completionSummary?: string;
  finalAnswer?: string;
}

export interface BranchPlanInput {
  branch: AgentBranchState;
}

export interface BranchToolExecutionInput {
  branch: AgentBranchState;
  toolCall: PlannedToolCall;
  deferTrace?: boolean;
}

export interface BranchFinalizeInput {
  branch: AgentBranchState;
  reason: string;
}

export interface BranchSynthesisInput {
  userMessage: string;
  priorTranscript: TranscriptMessage[];
  branches: Array<{
    id: string;
    label: string;
    goal: string;
    savedNodeIds: string[];
    completionSummary?: string;
    finalAnswer: string;
  }>;
}

export interface AgentRuntimeOptions {
  planner: Planner;
  toolRuntime: AgentToolRuntime;
  /** Maximum ReAct loop iterations before forcing a final answer. */
  maxSteps?: number;
  /** Maximum branching depth. */
  maxBranchDepth?: number;
  /** Maximum children spawned in a single branching step. */
  maxBranchWidth?: number;
  /** Max completed branches to keep before synthesis. */
  maxCompletedBranches?: number;
  /** Max number of branches allowed to run simultaneously. */
  branchConcurrency?: number;
  /** Optional override for total work budget across all branches. */
  maxTotalSteps?: number;
  /** Optional branch-aware planner override. */
  planBranch?: (input: BranchPlanInput) => Promise<import('./types.js').AgentStep>;
  /** Optional branch-aware tool execution override. */
  executeToolCall?: (input: BranchToolExecutionInput) => Promise<ToolObservation>;
  /** Optional branch finalization override when a branch hits budget. */
  finalizeBranch?: (input: BranchFinalizeInput) => Promise<string>;
  /** Optional final synthesis hook when multiple branches finish. */
  synthesizeFinal?: (input: BranchSynthesisInput) => Promise<string>;
  /** Trace callback invoked after each loop step. */
  onTrace?: (event: AgentTraceEvent) => void;
}

/**
 * AgentRuntime orchestrates the ReAct loop:
 *   thought → tool call → observation → … → final answer
 *
 * It delegates planning to a `Planner` implementation and tool execution to
 * `ToolRuntime` (which in turn enforces governance rules).
 *
 * This is intentionally decoupled from the existing `Agent` class so it can
 * be adopted incrementally — the existing `Agent` can instantiate and delegate
 * to an `AgentRuntime` for the governed code path.
 */
export class AgentRuntime {
  private static readonly PARALLEL_SAFE_TOOL_NAMES = new Set(['read', 'search', 'web']);
  private readonly planner: Planner;
  private readonly toolRuntime: AgentToolRuntime;
  private readonly maxSteps: number;
  private readonly maxBranchDepth: number;
  private readonly maxBranchWidth: number;
  private readonly maxCompletedBranches: number;
  private readonly branchConcurrency: number;
  private readonly maxTotalSteps: number | null;
  private readonly planBranch?: (input: BranchPlanInput) => Promise<import('./types.js').AgentStep>;
  private readonly executeToolCall?: (input: BranchToolExecutionInput) => Promise<ToolObservation>;
  private readonly finalizeBranch?: (input: BranchFinalizeInput) => Promise<string>;
  private readonly synthesizeFinal?: (input: BranchSynthesisInput) => Promise<string>;
  private readonly onTrace: (event: AgentTraceEvent) => void;

  constructor(options: AgentRuntimeOptions) {
    this.planner = options.planner;
    this.toolRuntime = options.toolRuntime;
    this.maxSteps = options.maxSteps ?? 10;
    this.maxBranchDepth = options.maxBranchDepth ?? 2;
    this.maxBranchWidth = options.maxBranchWidth ?? 3;
    this.maxCompletedBranches = options.maxCompletedBranches ?? 4;
    this.branchConcurrency = options.branchConcurrency ?? 3;
    this.maxTotalSteps = options.maxTotalSteps ?? null;
    this.planBranch = options.planBranch;
    this.executeToolCall = options.executeToolCall;
    this.finalizeBranch = options.finalizeBranch;
    this.synthesizeFinal = options.synthesizeFinal;
    this.onTrace = options.onTrace ?? (() => undefined);
  }

  /**
   * Run the agent loop for a single user turn.
   *
   * @param userMessage - The user's input message.
   * @param priorTranscript - Previous conversation turns for context.
   * @returns The agent's final answer string.
   */
  async run(
    userMessage: string,
    priorTranscript: TranscriptMessage[] = [],
  ): Promise<string> {
    // Reset session-level governance state (doom-loop counter, etc.).
    this.toolRuntime.resetSession();

    const rootBranch: AgentBranchState = {
      id: 'B0',
      parentId: null,
      depth: 0,
      label: 'root',
      goal: 'Solve the user request end-to-end.',
      priority: 1,
      steps: 0,
      savedNodeIds: [],
      transcript: [
        ...priorTranscript,
        { role: 'user', content: userMessage },
      ],
    };

    const queue: AgentBranchState[] = [rootBranch];
    const completed: AgentBranchState[] = [];
    let lastTouchedBranch: AgentBranchState | null = rootBranch;
    let totalLoopSteps = 0;
    const totalLoopBudget = this.maxTotalSteps
      ?? Math.max(this.maxSteps, this.maxSteps * this.maxBranchWidth * (this.maxBranchDepth + 1));

    const traceMeta = (branch: AgentBranchState, extra: Record<string, unknown> = {}) => ({
      branchId: branch.id,
      parentBranchId: branch.parentId,
      branchLabel: branch.label,
      depth: branch.depth,
      step: branch.steps,
      ...extra,
    });

    const emitBranchTrace = (
      type: AgentTraceEvent['type'],
      branch: AgentBranchState,
      content: string,
      extra: Record<string, unknown> = {},
    ) => {
      this.emit({ type, content, metadata: traceMeta(branch, extra) });
    };

    const renderObservation = (toolCall: PlannedToolCall, execResult: ToolExecutionResult): ToolObservation => ({
      toolName: toolCall.name,
      result: execResult.success
        ? JSON.stringify(execResult.result ?? '')
        : `ERROR: ${execResult.error ?? 'unknown error'}`,
      success: execResult.success,
    });

    const shouldRuntimeTraceTool = (deferTrace: boolean) => !this.executeToolCall || deferTrace;

    const executeSingleToolCall = async (
      branch: AgentBranchState,
      toolCall: PlannedToolCall,
      options: { deferTrace?: boolean } = {},
    ): Promise<ToolObservation> => {
      const deferTrace = options.deferTrace === true;
      if (shouldRuntimeTraceTool(deferTrace)) {
        emitBranchTrace(
          'action',
          branch,
          `Calling ${toolCall.name}${toolCall.goal ? ` — ${toolCall.goal}` : ''}`,
          { toolName: toolCall.name, args: toolCall.arguments },
        );
      }

      if (this.executeToolCall) {
        return this.executeToolCall({ branch, toolCall, deferTrace });
      }

      const execResult = await this.toolRuntime.execute(toolCall.name, toolCall.arguments);
      return renderObservation(toolCall, execResult);
    };

    const emitObservationTrace = (branch: AgentBranchState, observation: ToolObservation) => {
      emitBranchTrace('observation', branch, observation.result, { toolName: observation.toolName });
    };

    const canRunToolCallsConcurrently = (toolCalls: PlannedToolCall[]) =>
      toolCalls.length > 1
      && toolCalls.every((toolCall) => AgentRuntime.PARALLEL_SAFE_TOOL_NAMES.has(toolCall.name));

    const executeToolStep = async (branch: AgentBranchState, toolCalls: PlannedToolCall[]) => {
      let observations: ToolObservation[];
      if (canRunToolCallsConcurrently(toolCalls)) {
        observations = await Promise.all(
          toolCalls.map((toolCall) => executeSingleToolCall(branch, toolCall, { deferTrace: true })),
        );
        observations.forEach((observation) => emitObservationTrace(branch, observation));
      } else {
        observations = [];
        for (const toolCall of toolCalls) {
          const observation = await executeSingleToolCall(branch, toolCall);
          observations.push(observation);
          if (shouldRuntimeTraceTool(false)) {
            emitObservationTrace(branch, observation);
          }
        }
      }

      branch.transcript.push({
        role: 'assistant',
        content: JSON.stringify({ kind: 'tool', tool_calls: toolCalls }),
      });
      branch.transcript.push({
        role: 'user',
        content: observations
          .map((o) => `TOOL OBSERVATION for ${o.toolName}:\n${o.result}`)
          .join('\n\n'),
      });
    };

    const buildChildBranches = (
      branch: AgentBranchState,
      branches: PlannedBranch[],
    ): AgentBranchState[] => branches.map((child, index) => ({
      id: `${branch.id}.${index + 1}`,
      parentId: branch.id,
      depth: branch.depth + 1,
      label: child.label,
      goal: child.goal,
      priority: Math.max(0.05, branch.priority * (child.priority ?? Math.max(0.2, 1 - index * 0.2))),
      steps: 0,
      savedNodeIds: branch.savedNodeIds.slice(),
      transcript: [
        ...branch.transcript,
        {
          role: 'assistant',
          content: JSON.stringify({ kind: 'branch', branches }),
        },
        {
          role: 'user',
          content: `Continue only this child branch.\nChild label: ${child.label}\nChild goal: ${child.goal}\nWhy this branch exists: ${child.why || 'Distinct strategy'}\nDo not repeat sibling work unless needed.`,
        },
      ],
    }));

    const runBranch = async (branch: AgentBranchState): Promise<AgentBranchState[]> => {
      while (true) {
        if (branch.steps >= this.maxSteps || totalLoopSteps >= totalLoopBudget) {
          const reason = totalLoopSteps >= totalLoopBudget ? 'total budget reached' : 'step budget reached';
          if (this.finalizeBranch) {
            branch.finalAnswer = await this.finalizeBranch({ branch, reason });
          }
          branch.finalAnswer = branch.finalAnswer || `Branch ${branch.id} stopped because ${reason}.`;
          completed.push(branch);
          emitBranchTrace('observation', branch, `Branch completed after hitting ${reason}.`);
          return [];
        }

        branch.steps += 1;
        totalLoopSteps += 1;
        lastTouchedBranch = branch;

        const agentStep = this.planBranch
          ? await this.planBranch({ branch })
          : await this.planner.plan(branch.transcript);
        if (agentStep.thought) {
          emitBranchTrace('thought', branch, agentStep.thought);
        }

        if (agentStep.kind === 'final') {
          branch.finalAnswer = agentStep.content;
          branch.completionSummary = agentStep.completionSummary ?? branch.completionSummary;
          completed.push(branch);
          emitBranchTrace('observation', branch, 'Branch completed.');
          return [];
        }

        if (agentStep.kind === 'tool') {
          const toolCalls = agentStep.toolCalls.slice(0, this.maxBranchWidth);
          if (toolCalls.length === 0) {
            branch.transcript.push({
              role: 'user',
              content: 'You selected kind="tool" but provided no tool calls. Either call a tool or finish.',
            });
            continue;
          }
          await executeToolStep(branch, toolCalls);
          continue;
        }

        const childPlans = agentStep.branches.slice(0, this.maxBranchWidth);
        if (branch.depth >= this.maxBranchDepth || childPlans.length < 2) {
          branch.transcript.push({
            role: 'user',
            content: `Branching was rejected because ${branch.depth >= this.maxBranchDepth ? 'the branch depth budget is exhausted' : 'fewer than two valid child branches were provided'}. Continue this branch without splitting.`,
          });
          continue;
        }

        emitBranchTrace('action', branch, `Spawning ${childPlans.length} child branches.`, { childCount: childPlans.length });
        const childBranches = buildChildBranches(branch, childPlans);
        for (const childBranch of childBranches) {
          this.emit({
            type: 'observation',
            content: `Spawned child branch ${childBranch.id}: ${childBranch.label}`,
            metadata: traceMeta(childBranch),
          });
        }
        return childBranches;
      }
    };

    const prioritySort = (a: AgentBranchState, b: AgentBranchState) =>
      (b.priority - a.priority) || (a.depth - b.depth) || (a.steps - b.steps);
    const active = new Set<Promise<void>>();
    const canContinue = () =>
      completed.length < this.maxCompletedBranches && totalLoopSteps < totalLoopBudget;

    const fillSlots = () => {
      queue.sort(prioritySort);
      while (active.size < this.branchConcurrency && queue.length > 0 && canContinue()) {
        const branch = queue.shift()!;
        let task: Promise<void>;
        task = runBranch(branch)
          .then((childBranches) => {
            active.delete(task);
            if (canContinue()) {
              childBranches.forEach((child) => queue.push(child));
            }
            fillSlots();
          })
          .catch((error: unknown) => {
            active.delete(task);
            emitBranchTrace('error', branch, error instanceof Error ? error.message : String(error));
            fillSlots();
          });
        active.add(task);
        emitBranchTrace('thought', branch, `[scheduler] Branch ${branch.id} started (${active.size}/${this.branchConcurrency} slots in use).`);
      }
    };

    fillSlots();
    while (active.size > 0) {
      await Promise.race(active);
    }

    if (completed.length === 0 && lastTouchedBranch) {
      lastTouchedBranch.finalAnswer = lastTouchedBranch.finalAnswer || 'No branch produced a final answer.';
      completed.push(lastTouchedBranch);
    }

    const finalBranches = completed
      .filter((branch) => typeof branch.finalAnswer === 'string' && branch.finalAnswer.length > 0)
      .slice(0, this.maxCompletedBranches);
    const synthesized = await this.synthesize(userMessage, priorTranscript, finalBranches);
    this.emit({ type: 'final', content: synthesized });
    return synthesized;
  }

  private async synthesize(
    userMessage: string,
    priorTranscript: TranscriptMessage[],
    branches: AgentBranchState[],
  ): Promise<string> {
    if (branches.length === 0) {
      return 'Maximum steps reached without a final answer.';
    }

    if (this.synthesizeFinal) {
      return this.synthesizeFinal({
        userMessage,
        priorTranscript,
        branches: branches.map((branch) => ({
          id: branch.id,
          label: branch.label,
          goal: branch.goal,
          savedNodeIds: branch.savedNodeIds,
          completionSummary: branch.completionSummary,
          finalAnswer: branch.finalAnswer ?? '',
        })),
      });
    }

    if (branches.length === 1) {
      return branches[0].finalAnswer ?? 'Maximum steps reached without a final answer.';
    }

    return [...branches]
      .map((branch) => branch.finalAnswer || '')
      .find((answer) => answer.length > 0)
      ?? 'Maximum steps reached without a final answer.';
  }

  private emit(event: AgentTraceEvent): void {
    try {
      this.onTrace(event);
    } catch {
      // Never let trace callbacks crash the loop.
    }
  }
}
