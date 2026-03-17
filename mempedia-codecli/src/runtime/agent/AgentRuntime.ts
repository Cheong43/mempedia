import { AgentTraceEvent, ToolObservation, TranscriptMessage } from './types.js';
import { Planner } from './SimplePlanner.js';
import { ToolRuntime } from '../tools/ToolRuntime.js';

export interface AgentRuntimeOptions {
  planner: Planner;
  toolRuntime: ToolRuntime;
  /** Maximum ReAct loop iterations before forcing a final answer. */
  maxSteps?: number;
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
  private readonly planner: Planner;
  private readonly toolRuntime: ToolRuntime;
  private readonly maxSteps: number;
  private readonly onTrace: (event: AgentTraceEvent) => void;

  constructor(options: AgentRuntimeOptions) {
    this.planner = options.planner;
    this.toolRuntime = options.toolRuntime;
    this.maxSteps = options.maxSteps ?? 10;
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

    const transcript: TranscriptMessage[] = [
      ...priorTranscript,
      { role: 'user', content: userMessage },
    ];

    for (let step = 0; step < this.maxSteps; step++) {
      const agentStep = await this.planner.plan(transcript);

      if (agentStep.kind === 'final') {
        this.emit({ type: 'final', content: agentStep.content });
        return agentStep.content;
      }

      // Tool step: execute each call and accumulate observations.
      const observations: ToolObservation[] = [];
      for (const toolCall of agentStep.toolCalls) {
        this.emit({
          type: 'action',
          content: `Calling ${toolCall.name}${toolCall.goal ? ` — ${toolCall.goal}` : ''}`,
          metadata: { toolName: toolCall.name, args: toolCall.arguments },
        });

        const execResult = await this.toolRuntime.execute(toolCall.name, toolCall.arguments);

        const observation: ToolObservation = {
          toolName: toolCall.name,
          result: execResult.success
            ? JSON.stringify(execResult.result ?? '')
            : `ERROR: ${execResult.error ?? 'unknown error'}`,
          success: execResult.success,
        };

        observations.push(observation);

        this.emit({
          type: 'observation',
          content: observation.result,
          metadata: { toolName: toolCall.name },
        });
      }

      // Append assistant thought and observations to transcript.
      transcript.push({
        role: 'assistant',
        content: JSON.stringify({ kind: 'tool', tool_calls: agentStep.toolCalls }),
      });

      const observationText = observations
        .map((o) => `TOOL OBSERVATION for ${o.toolName}:\n${o.result}`)
        .join('\n\n');
      transcript.push({ role: 'user', content: observationText });
    }

    // Max steps exceeded — force a final answer.
    const forced = 'Maximum steps reached without a final answer.';
    this.emit({ type: 'final', content: forced });
    return forced;
  }

  private emit(event: AgentTraceEvent): void {
    try {
      this.onTrace(event);
    } catch {
      // Never let trace callbacks crash the loop.
    }
  }
}
