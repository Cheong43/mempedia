import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { ToolDefinition, ToolExecutionContext, ToolExecutionResult } from '../../types.js';

interface RunShellArgs extends Record<string, unknown> {
  command?: unknown;
}

function ensureSandboxLayout(projectRoot: string): {
  sandboxRoot: string;
  homeDir: string;
  tmpDir: string;
  cacheDir: string;
  configDir: string;
} {
  const sandboxRoot = path.join(projectRoot, '.mempedia', 'sandbox');
  const homeDir = path.join(sandboxRoot, 'home');
  const tmpDir = path.join(sandboxRoot, 'tmp');
  const cacheDir = path.join(sandboxRoot, 'cache');
  const configDir = path.join(sandboxRoot, 'config');

  for (const dir of [sandboxRoot, homeDir, tmpDir, cacheDir, configDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  return { sandboxRoot, homeDir, tmpDir, cacheDir, configDir };
}

/**
 * Resolve the mempedia binary path for injection into the shell environment.
 * Checks several candidate locations relative to projectRoot and returns the
 * first existing executable, preferring the most recently modified build.
 * If the env var MEMPEDIA_BINARY_PATH is already set, that value is used as-is.
 */
function resolveBinaryPathForShell(projectRoot: string): string | undefined {
  const existing = process.env.MEMPEDIA_BINARY_PATH?.trim();
  if (existing) {
    return existing;
  }
  const candidates = [
    path.join(projectRoot, 'target', 'debug', 'mempedia'),
    path.join(projectRoot, 'target', 'release', 'mempedia'),
    path.join(projectRoot, '..', 'target', 'debug', 'mempedia'),
    path.join(projectRoot, '..', 'target', 'release', 'mempedia'),
  ].map((p) => path.resolve(p));

  const deduplicated = [...new Set(candidates)].filter((p) => {
    try {
      return fs.existsSync(p);
    } catch {
      return false;
    }
  });

  if (deduplicated.length === 0) {
    return undefined;
  }

  // Prefer most recently modified; favour debug over release.
  deduplicated.sort((a, b) => {
    const mtA = fs.statSync(a).mtimeMs;
    const mtB = fs.statSync(b).mtimeMs;
    if (mtB !== mtA) {
      return mtB - mtA;
    }
    return a.includes(`${path.sep}release${path.sep}`) ? 1 : -1;
  });

  return deduplicated[0];
}

export class RunShellTool implements ToolDefinition<RunShellArgs, string> {
  readonly name = 'run_shell';
  readonly description = 'Run a shell command inside the project-local sandbox. Repository clone/pull/fetch operations are blocked.';

  async execute(args: RunShellArgs, ctx: ToolExecutionContext): Promise<ToolExecutionResult<string>> {
    const startedAt = Date.now();
    const command = typeof args.command === 'string' ? args.command.trim() : '';

    if (!command) {
      return {
        success: false,
        error: 'run_shell requires a non-empty command',
        durationMs: Date.now() - startedAt,
      };
    }

    const { homeDir, tmpDir, cacheDir, configDir } = ensureSandboxLayout(ctx.projectRoot);
    const timeoutMs = Number(process.env.MEMPEDIA_SHELL_TIMEOUT_MS ?? 15000);
    // Resolve the binary path once and inject it so the skill's
    // ${MEMPEDIA_BINARY_PATH:-./target/debug/mempedia} pattern always resolves
    // even when the binary lives outside the projectRoot (e.g. ../target/).
    const resolvedBinary = resolveBinaryPathForShell(ctx.projectRoot);
    const binaryEnv = resolvedBinary ? { MEMPEDIA_BINARY_PATH: resolvedBinary } : {};

    return await new Promise<ToolExecutionResult<string>>((resolve) => {
      exec(command, {
        cwd: ctx.projectRoot,
        shell: '/bin/zsh',
        timeout: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 15000,
        maxBuffer: 1024 * 1024,
        env: {
          ...process.env,
          ...binaryEnv,
          HOME: homeDir,
          TMPDIR: tmpDir,
          XDG_CACHE_HOME: cacheDir,
          XDG_CONFIG_HOME: configDir,
          GIT_CONFIG_GLOBAL: path.join(configDir, 'git', 'config'),
          npm_config_cache: path.join(cacheDir, 'npm'),
          MEMPEDIA_SANDBOX_ROOT: path.join(ctx.projectRoot, '.mempedia', 'sandbox'),
        },
      }, (error, stdout, stderr) => {
        const output = [stdout, stderr].filter(Boolean).join('');
        if (error) {
          resolve({
            success: false,
            error: output.trim() || error.message,
            durationMs: Date.now() - startedAt,
          });
          return;
        }

        resolve({
          success: true,
          result: output.trim() || 'Command executed successfully.',
          durationMs: Date.now() - startedAt,
        });
      });
    });
  }
}