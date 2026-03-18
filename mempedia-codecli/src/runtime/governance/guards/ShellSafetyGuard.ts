import { GovernanceDecision, GovernanceRequest, PolicyDecision } from '../types.js';

interface ForbiddenCommandPattern {
  pattern: RegExp;
  label: string;
  reason: string;
}

const FORBIDDEN_COMMAND_PATTERNS: ForbiddenCommandPattern[] = [
  {
    pattern: /(^|[;&|]\s*)git\s+(clone|pull|fetch)\b/i,
    label: 'git-sync',
    reason: 'Repository cloning and syncing are blocked in the local sandbox.',
  },
  {
    pattern: /(^|[;&|]\s*)gh\s+repo\s+clone\b/i,
    label: 'gh-repo-clone',
    reason: 'GitHub CLI repository cloning is blocked in the local sandbox.',
  },
  {
    pattern: /\b(curl|wget)\b[^\n]*(\|\s*(sh|bash|zsh)\b|(?:^|\s)(-o|--output)\b)/i,
    label: 'download-and-exec',
    reason: 'Downloading payloads to disk or piping them into a shell is blocked in the local sandbox.',
  },
  {
    pattern: /(^|[;&|]\s*)(sudo|su)\b/i,
    label: 'privilege-escalation',
    reason: 'Privilege escalation commands are blocked in the local sandbox.',
  },
  {
    pattern: /\b(ssh|scp|rsync)\b/i,
    label: 'remote-shell-transfer',
    reason: 'Remote shell and file transfer commands are blocked in the local sandbox.',
  },
];

export class ShellSafetyGuard {
  constructor(private readonly decision: PolicyDecision = 'deny') {}

  evaluate(req: GovernanceRequest): GovernanceDecision | undefined {
    if (req.toolName !== 'run_shell') {
      return undefined;
    }

    const command = typeof req.args.command === 'string' ? req.args.command.trim() : '';
    if (!command) {
      return undefined;
    }

    for (const entry of FORBIDDEN_COMMAND_PATTERNS) {
      if (entry.pattern.test(command)) {
        return {
          decision: this.decision,
          reason: `ShellSafetyGuard: command matched forbidden pattern '${entry.label}'. ${entry.reason}`,
          guardName: 'ShellSafetyGuard',
        };
      }
    }

    return undefined;
  }
}