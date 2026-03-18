import * as path from 'path';

export function resolveWithinProject(projectRoot: string, rawPath: string): string {
  const safeRoot = path.resolve(projectRoot);
  const resolved = path.resolve(safeRoot, rawPath);
  const safeRootPrefix = safeRoot.endsWith(path.sep) ? safeRoot : `${safeRoot}${path.sep}`;

  if (resolved !== safeRoot && !resolved.startsWith(safeRootPrefix)) {
    throw new Error(`Path '${rawPath}' resolves outside project root '${safeRoot}'`);
  }

  return resolved;
}