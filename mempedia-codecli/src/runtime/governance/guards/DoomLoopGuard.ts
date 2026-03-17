import { GovernanceDecision, GovernanceRequest, PolicyDecision } from '../types.js';

interface HistoryEntry {
  key: string;
  ts: number;
}

/**
 * DoomLoopGuard detects when the same tool is called with identical arguments
 * repeatedly within a session, which is a strong signal of an agent stuck in
 * a loop.
 *
 * When the repeat count of an identical `(toolName, args)` pair exceeds
 * `maxRepeats` within the rolling `windowSize` history the guard fires and
 * returns the configured `loopDecision` (`ask` by default).
 */
export class DoomLoopGuard {
  private readonly maxRepeats: number;
  private readonly windowSize: number;
  private readonly loopDecision: PolicyDecision;
  private readonly history: HistoryEntry[] = [];

  constructor(
    maxRepeats = 3,
    windowSize = 20,
    loopDecision: PolicyDecision = 'ask',
  ) {
    this.maxRepeats = maxRepeats;
    this.windowSize = windowSize;
    this.loopDecision = loopDecision;
  }

  /**
   * Record the request and evaluate for doom-loop patterns.
   *
   * Returns a `GovernanceDecision` when a doom loop is detected.
   * Returns `undefined` to indicate no concern.
   */
  evaluate(req: GovernanceRequest): GovernanceDecision | undefined {
    const key = this.buildKey(req);
    const now = Date.now();

    // Add to rolling history.
    this.history.push({ key, ts: now });
    if (this.history.length > this.windowSize) {
      this.history.splice(0, this.history.length - this.windowSize);
    }

    // Count how many times this exact key appears in recent history.
    const repeatCount = this.history.filter((e) => e.key === key).length;

    if (repeatCount > this.maxRepeats) {
      return {
        decision: this.loopDecision,
        reason: `DoomLoopGuard: '${req.toolName}' called with identical arguments ${repeatCount} times (max ${this.maxRepeats}) in the last ${this.windowSize} requests`,
        guardName: 'DoomLoopGuard',
      };
    }
    return undefined;
  }

  /** Clear the session history (e.g. at the start of a new agent run). */
  reset(): void {
    this.history.splice(0);
  }

  private buildKey(req: GovernanceRequest): string {
    try {
      const stableArgs = stableStringify(req.args);
      return `${req.toolName}::${stableArgs}`;
    } catch {
      return req.toolName;
    }
  }
}

/**
 * Produce a stable JSON string by recursively sorting object keys.
 * This ensures that `{ b: 2, a: 1 }` and `{ a: 1, b: 2 }` produce the same
 * string and are therefore treated as identical requests.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return JSON.stringify(value);
  }
  const sorted = Object.keys(value as Record<string, unknown>)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = (value as Record<string, unknown>)[key];
      return acc;
    }, {});
  return JSON.stringify(sorted, (_k, v: unknown) => {
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      return Object.keys(v as Record<string, unknown>)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = (v as Record<string, unknown>)[k];
          return acc;
        }, {});
    }
    return v;
  });
}
