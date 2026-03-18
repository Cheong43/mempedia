import { TranscriptMessage, AgentStep, PlannedBranch, PlannedToolCall } from './types.js';

/**
 * SimplePlanner implements a minimal ReAct-style planning step.
 *
 * Given the current transcript it produces the next `AgentStep` by parsing
 * a JSON blob returned from an LLM completion.  This is intentionally
 * lightweight — more sophisticated planners (branching, multi-agent, …) can
 * be swapped in by implementing the same interface.
 *
 * Expected LLM output schema:
 * ```json
 * {
 *   "kind": "tool" | "final",
 *   "thought": "...",
 *   "tool_calls": [{ "name": "...", "arguments": {}, "goal": "..." }],
 *   "final_answer": "..."
 * }
 * ```
 */

export interface Planner {
  /** Produce the next step given the current transcript. */
  plan(transcript: TranscriptMessage[]): Promise<AgentStep>;
}

export interface SimplePlannerOptions {
  /**
   * Completion function.  Accepts a list of messages and returns the model's
   * text response.  Decoupled here so the planner does not depend on a
   * specific OpenAI client version.
   */
  complete: (messages: TranscriptMessage[]) => Promise<string>;
  systemPrompt: string;
  maxToolCalls?: number;
  maxBranches?: number;
}

export class SimplePlanner implements Planner {
  private readonly complete: (messages: TranscriptMessage[]) => Promise<string>;
  private readonly systemPrompt: string;
  private readonly maxToolCalls: number;
  private readonly maxBranches: number;

  constructor(options: SimplePlannerOptions) {
    this.complete = options.complete;
    this.systemPrompt = options.systemPrompt;
    this.maxToolCalls = options.maxToolCalls ?? 5;
    this.maxBranches = options.maxBranches ?? 3;
  }

  async plan(transcript: TranscriptMessage[]): Promise<AgentStep> {
    const messages: TranscriptMessage[] = [
      { role: 'system', content: this.systemPrompt },
      ...transcript,
    ];

    const raw = await this.complete(messages);
    return this.parse(raw);
  }

  private parse(raw: string): AgentStep {
    // Strip markdown code fences if present.
    const stripped = raw
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/, '')
      .trim();

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(stripped);
    } catch {
      // If the model returned plain text, treat it as a final answer.
      return { kind: 'final', content: raw.trim() };
    }

    const thought = typeof parsed.thought === 'string' ? parsed.thought : undefined;

    if (parsed.kind === 'final') {
      return {
        kind: 'final',
        content: String(parsed.final_answer ?? parsed.thought ?? ''),
        completionSummary: typeof parsed.completion_summary === 'string' ? parsed.completion_summary : undefined,
        thought,
      };
    }

    if (parsed.kind === 'tool') {
      const rawCalls = Array.isArray(parsed.tool_calls) ? parsed.tool_calls : [];
      const toolCalls: PlannedToolCall[] = rawCalls
        .slice(0, this.maxToolCalls)
        .filter(
          (c): c is { name: string; args?: Record<string, unknown>; arguments?: Record<string, unknown>; goal?: string } =>
            c && typeof c === 'object' && typeof c.name === 'string',
        )
        .map((c) => ({
          name: c.name,
          arguments: c.arguments ?? c.args ?? {},
          goal: typeof c.goal === 'string' ? c.goal : undefined,
        }));

      if (toolCalls.length === 0) {
        // Degenerate: treat as final.
        return {
          kind: 'final',
          content: String(parsed.thought ?? 'No tool calls provided.'),
          thought,
        };
      }

      return { kind: 'tool', toolCalls, thought };
    }

    if (parsed.kind === 'branch') {
      const rawBranches = Array.isArray(parsed.branches) ? parsed.branches : [];
      const branches: PlannedBranch[] = rawBranches
        .slice(0, this.maxBranches)
        .filter(
          (branch): branch is { label: string; goal: string; why?: string; priority?: number } =>
            Boolean(
              branch
              && typeof branch === 'object'
              && typeof branch.label === 'string'
              && typeof branch.goal === 'string',
            ),
        )
        .map((branch) => ({
          label: branch.label.trim(),
          goal: branch.goal.trim(),
          why: typeof branch.why === 'string' ? branch.why.trim() : undefined,
          priority: typeof branch.priority === 'number' ? branch.priority : undefined,
        }))
        .filter((branch) => branch.label.length > 0 && branch.goal.length > 0);

      if (branches.length === 0) {
        return {
          kind: 'final',
          content: String(parsed.thought ?? 'No valid branches provided.'),
          thought,
        };
      }

      return { kind: 'branch', branches, thought };
    }

    // Unrecognised kind — treat as final answer.
    return { kind: 'final', content: String(parsed.thought ?? raw.trim()), thought };
  }
}
