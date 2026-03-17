import { Policy, PolicyDecision, PolicyRule, GovernanceRequest } from './types.js';

/** Cache of compiled patterns to avoid recompilation on every call. */
const patternCache = new Map<string, RegExp>();

/**
 * Match a pattern string (supporting `*` and `**` wildcards) against a value.
 * Returns `true` when the value matches the pattern.
 */
function matchPattern(pattern: string, value: string): boolean {
  let re = patternCache.get(pattern);
  if (!re) {
    // Escape regex special chars except `*`
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    // `**` → match anything including slashes; `*` → match anything except `/`
    const regexStr =
      '^' +
      escaped
        .replace(/\\\*\\\*/g, '.*')
        .replace(/\*/g, '[^/]*') +
      '$';
    try {
      re = new RegExp(regexStr, 'i');
    } catch {
      // If the pattern is invalid, fall back to exact match.
      re = new RegExp(`^${escaped}$`, 'i');
    }
    patternCache.set(pattern, re);
  }
  return re.test(value);
}

/**
 * Extract the primary "path-like" target from a tool's arguments.
 * Returns an empty string if none is found.
 */
function extractTargetPath(args: Record<string, unknown>): string {
  for (const key of ['path', 'node_id', 'command', 'start_node', 'target', 'query']) {
    if (typeof args[key] === 'string' && args[key]) {
      return args[key] as string;
    }
  }
  return '';
}

/**
 * Evaluate a single rule against the request.
 * Returns `true` if the rule matches (both `action` and `path` patterns pass).
 */
function ruleMatches(rule: PolicyRule, req: GovernanceRequest): boolean {
  if (rule.action !== undefined && rule.action !== '') {
    if (!matchPattern(rule.action, req.toolName)) {
      return false;
    }
  }
  if (rule.path !== undefined && rule.path !== '') {
    const target = extractTargetPath(req.args);
    if (!target || !matchPattern(rule.path, target)) {
      return false;
    }
  }
  return true;
}

/**
 * Match a governance request against the policy and return the effective
 * decision following priority order:  deny > allow > ask > default.
 *
 * Returns both the decision and the first matching rule (if any).
 */
export function matchRules(
  policy: Policy,
  req: GovernanceRequest,
): { decision: PolicyDecision; rule?: PolicyRule } {
  // Collect all matching rules per effect.
  const matching = policy.rules.filter((r) => ruleMatches(r, req));

  // Priority: deny first, then allow, then ask.
  const priorityOrder: PolicyDecision[] = ['deny', 'allow', 'ask'];
  for (const effect of priorityOrder) {
    const found = matching.find((r) => r.effect === effect);
    if (found) {
      return { decision: effect, rule: found };
    }
  }

  // No matching rule — use the policy default.
  return { decision: policy.default };
}
