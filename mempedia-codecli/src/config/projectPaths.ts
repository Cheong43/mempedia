import * as fs from 'fs';
import * as path from 'path';

function findNearestAncestor(startDir: string, predicate: (dir: string) => boolean): string | null {
  let current = path.resolve(startDir);
  while (true) {
    if (predicate(current)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function isCodeCliRepoRoot(dir: string): boolean {
  return fs.existsSync(path.join(dir, 'package.json'))
    && fs.existsSync(path.join(dir, 'src'));
}

export function resolveCodeCliRoot(moduleDir: string): string {
  const searchStarts = [process.cwd(), moduleDir, path.resolve(moduleDir, '..')];
  for (const start of searchStarts) {
    const codeCliRoot = findNearestAncestor(start, isCodeCliRepoRoot);
    if (codeCliRoot) {
      return codeCliRoot;
    }
  }

  return path.resolve(moduleDir, '../..');
}

export function resolveProjectRoot(moduleDir: string, envProjectRoot = process.env.MEMPEDIA_PROJECT_ROOT): string {
  if (envProjectRoot && envProjectRoot.trim()) {
    return path.resolve(envProjectRoot);
  }

  return resolveCodeCliRoot(moduleDir);
}

export function resolveMempediaBinaryPath(moduleDir: string, explicitBinaryPath?: string): string {
  const configured = explicitBinaryPath || process.env.MEMPEDIA_BINARY_PATH;
  if (configured && configured.trim()) {
    return path.resolve(configured);
  }

  const projectRoot = resolveProjectRoot(moduleDir);
  const codeCliRoot = resolveCodeCliRoot(moduleDir);
  const candidates = [
    path.join(projectRoot, 'target', 'debug', 'mempedia'),
    path.join(projectRoot, 'target', 'release', 'mempedia'),
    path.join(codeCliRoot, '..', 'target', 'debug', 'mempedia'),
    path.join(codeCliRoot, '..', 'target', 'release', 'mempedia'),
    path.join(projectRoot, '..', 'target', 'debug', 'mempedia'),
    path.join(projectRoot, '..', 'target', 'release', 'mempedia'),
  ];

  const existing = candidates
    .filter((candidate, index, list) => list.indexOf(candidate) === index)
    .filter((candidate) => fs.existsSync(candidate))
    .map((candidate) => ({
      path: candidate,
      mtimeMs: fs.statSync(candidate).mtimeMs,
      isRelease: candidate.includes(`${path.sep}release${path.sep}`),
    }))
    .sort((left, right) => {
      if (right.mtimeMs !== left.mtimeMs) {
        return right.mtimeMs - left.mtimeMs;
      }
      if (left.isRelease !== right.isRelease) {
        return left.isRelease ? -1 : 1;
      }
      return 0;
    });

  if (existing.length > 0) {
    return existing[0].path;
  }

  return path.join(projectRoot, 'target', 'debug', 'mempedia');
}