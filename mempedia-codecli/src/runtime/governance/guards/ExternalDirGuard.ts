import * as path from 'path';
import { GovernanceDecision, GovernanceRequest, PolicyDecision } from '../types.js';

/**
 * Argument keys that are considered "path-like" for external-directory checks.
 * Exported so other guards/matchers can reuse the same set of keys.
 */
export const PATH_ARG_KEYS = ['path', 'command', 'output_path', 'input_path', 'file', 'dir'] as const;

/**
 * ExternalDirGuard detects when a path-based tool argument resolves outside
 * the configured `projectRoot` directory.
 *
 * When a path escapes the project boundary the guard returns a configurable
 * decision (`deny` by default).  Requests with no path-like argument pass
 * through unchanged (return `undefined`).
 */
export class ExternalDirGuard {
  private readonly safeRoot: string;
  private readonly safeRootPrefix: string;
  private readonly outsideDecision: PolicyDecision;

  constructor(projectRoot: string, outsideDecision: PolicyDecision = 'deny') {
    this.safeRoot = path.resolve(projectRoot);
    // Ensure the prefix ends with the path separator so that e.g. `/foo/bar`
    // does not accidentally match `/foo/barpoisoned`.
    this.safeRootPrefix = this.safeRoot.endsWith(path.sep)
      ? this.safeRoot
      : this.safeRoot + path.sep;
    this.outsideDecision = outsideDecision;
  }

  /**
   * Evaluate the request.
   *
   * Returns a `GovernanceDecision` when a path escapes the project root.
   * Returns `undefined` to indicate no concern (caller should continue
   * evaluating other rules).
   */
  evaluate(req: GovernanceRequest): GovernanceDecision | undefined {
    const pathArgs = this.extractPathArgs(req.args);
    if (pathArgs.length === 0) return undefined;

    for (const rawPath of pathArgs) {
      const resolved = path.resolve(this.safeRoot, rawPath);
      // Allow access to the project root itself or any path beneath it.
      if (resolved !== this.safeRoot && !resolved.startsWith(this.safeRootPrefix)) {
        return {
          decision: this.outsideDecision,
          reason: `ExternalDirGuard: path '${rawPath}' resolves to '${resolved}' which is outside projectRoot '${this.safeRoot}'`,
          guardName: 'ExternalDirGuard',
        };
      }
    }
    return undefined;
  }

  private extractPathArgs(args: Record<string, unknown>): string[] {
    const candidates: string[] = [];
    for (const key of PATH_ARG_KEYS) {
      const val = args[key];
      if (typeof val === 'string' && val.trim()) {
        candidates.push(val.trim());
      }
    }
    return candidates;
  }
}
