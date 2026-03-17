import { TranscriptMessage, AgentStep, PlannedToolCall } from './types.js';

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
}

export class SimplePlanner implements Planner {
  private readonly complete: (messages: TranscriptMessage[]) => Promise<string>;
  private readonly systemPrompt: string;
  private readonly maxToolCalls: number;

  constructor(options: SimplePlannerOptions) {
    this.complete = options.complete;
    this.systemPrompt = options.systemPrompt;
    this.maxToolCalls = options.maxToolCalls ?? 5;
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

    if (parsed.kind === 'final') {
      return {
        kind: 'final',
        content: String(parsed.final_answer ?? parsed.thought ?? ''),
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
        };
      }

      return { kind: 'tool', toolCalls };
    }

    // Unrecognised kind — treat as final answer.
    return { kind: 'final', content: String(parsed.thought ?? raw.trim()) };
  }
}
