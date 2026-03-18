import * as fs from 'fs';
import * as path from 'path';
import { Policy, PolicyDecision } from './types.js';

/** Safe conservative default policy used when no policy file is found. */
export const DEFAULT_POLICY: Policy = {
  default: 'ask',
  rules: [
    // Allow all read-only mempedia operations without prompting.
    {
      effect: 'allow',
      action: 'mempedia_search',
      description: 'Allow mempedia search without prompting',
    },
    {
      effect: 'allow',
      action: 'mempedia_search_hybrid',
      description: 'Allow hybrid search without prompting',
    },
    {
      effect: 'allow',
      action: 'mempedia_read',
      description: 'Allow node reads without prompting',
    },
    {
      effect: 'allow',
      action: 'mempedia_traverse',
      description: 'Allow graph traversal without prompting',
    },
    {
      effect: 'allow',
      action: 'mempedia_history',
      description: 'Allow history inspection without prompting',
    },
    {
      effect: 'allow',
      action: 'mempedia_conversation_lookup',
      description: 'Allow conversation lookup without prompting',
    },
    // Write operations default to `ask` (handled by policy.default).
  ],
  guards: {
    externalDir: true,
    shellSafety: {
      enabled: true,
      decision: 'ask',
    },
    doomLoop: {
      enabled: true,
      maxRepeats: 3,
      windowSize: 20,
      decision: 'ask',
    },
  },
};

/**
 * Load policy from `<projectRoot>/.mempedia/policy.json`.
 * Falls back to `DEFAULT_POLICY` if the file is absent or invalid.
 */
export function loadPolicy(projectRoot: string): Policy {
  const policyPath = path.join(projectRoot, '.mempedia', 'policy.json');
  if (!fs.existsSync(policyPath)) {
    return DEFAULT_POLICY;
  }
  try {
    const raw = fs.readFileSync(policyPath, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<Policy>;
    return mergeWithDefaults(parsed);
  } catch {
    // File exists but is malformed — fall back to safe defaults.
    return DEFAULT_POLICY;
  }
}

function mergeWithDefaults(parsed: Partial<Policy>): Policy {
  const validDecisions: PolicyDecision[] = ['allow', 'ask', 'deny'];
  const defaultDecision: PolicyDecision = validDecisions.includes(parsed.default as PolicyDecision)
    ? (parsed.default as PolicyDecision)
    : DEFAULT_POLICY.default;

  const rules = Array.isArray(parsed.rules)
    ? parsed.rules.filter(
        (r) =>
          r &&
          typeof r === 'object' &&
          validDecisions.includes(r.effect as PolicyDecision),
      )
    : DEFAULT_POLICY.rules;

  const guards = parsed.guards
    ? {
        externalDir:
          typeof parsed.guards.externalDir === 'boolean'
            ? parsed.guards.externalDir
            : DEFAULT_POLICY.guards!.externalDir,
        shellSafety: parsed.guards.shellSafety
          ? {
              enabled: parsed.guards.shellSafety.enabled !== false,
              decision: validDecisions.includes(
                parsed.guards.shellSafety.decision as PolicyDecision,
              )
                ? (parsed.guards.shellSafety.decision as PolicyDecision)
                : DEFAULT_POLICY.guards!.shellSafety!.decision,
            }
          : DEFAULT_POLICY.guards!.shellSafety,
        doomLoop: parsed.guards.doomLoop
          ? {
              enabled: parsed.guards.doomLoop.enabled !== false,
              maxRepeats:
                Number.isFinite(Number(parsed.guards.doomLoop.maxRepeats)) &&
                Number(parsed.guards.doomLoop.maxRepeats) > 0
                  ? Number(parsed.guards.doomLoop.maxRepeats)
                  : DEFAULT_POLICY.guards!.doomLoop!.maxRepeats,
              windowSize:
                Number.isFinite(Number(parsed.guards.doomLoop.windowSize)) &&
                Number(parsed.guards.doomLoop.windowSize) > 0
                  ? Number(parsed.guards.doomLoop.windowSize)
                  : DEFAULT_POLICY.guards!.doomLoop!.windowSize,
              decision: validDecisions.includes(
                parsed.guards.doomLoop.decision as PolicyDecision,
              )
                ? (parsed.guards.doomLoop.decision as PolicyDecision)
                : DEFAULT_POLICY.guards!.doomLoop!.decision,
            }
          : DEFAULT_POLICY.guards!.doomLoop,
      }
    : DEFAULT_POLICY.guards;

  return { default: defaultDecision, rules, guards };
}
