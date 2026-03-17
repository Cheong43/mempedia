import * as fs from 'fs';
import * as path from 'path';
import { AuditEntry } from './types.js';

/**
 * Appends governance audit entries to `.mempedia/governance/audit.log` (NDJSON).
 *
 * The log file is created on first use.  All writes are best-effort — a failure
 * to write must never propagate to the caller.
 */
export class AuditLogger {
  private readonly logPath: string;

  constructor(projectRoot: string) {
    this.logPath = path.join(projectRoot, '.mempedia', 'governance', 'audit.log');
  }

  /** Write a single audit entry. */
  append(entry: AuditEntry): void {
    try {
      fs.mkdirSync(path.dirname(this.logPath), { recursive: true });
      const line = JSON.stringify(entry) + '\n';
      fs.appendFileSync(this.logPath, line, 'utf-8');
    } catch {
      // Best-effort — ignore write failures.
    }
  }

  /**
   * Read recent audit entries.  Returns at most `limit` entries ordered
   * newest-first.  Returns an empty array on any read error.
   */
  recent(limit = 100): AuditEntry[] {
    try {
      if (!fs.existsSync(this.logPath)) return [];
      const text = fs.readFileSync(this.logPath, 'utf-8');
      const entries: AuditEntry[] = [];
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          entries.push(JSON.parse(trimmed) as AuditEntry);
        } catch {
          // Skip malformed lines.
        }
      }
      return entries.slice(-limit).reverse();
    } catch {
      return [];
    }
  }
}
