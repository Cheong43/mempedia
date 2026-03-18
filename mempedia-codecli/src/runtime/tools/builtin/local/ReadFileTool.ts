import * as fs from 'fs';
import { ToolDefinition, ToolExecutionContext, ToolExecutionResult } from '../../types.js';
import { resolveWithinProject } from './pathUtils.js';

interface ReadFileArgs extends Record<string, unknown> {
  path?: unknown;
}

export class ReadFileTool implements ToolDefinition<ReadFileArgs, string> {
  readonly name = 'read_file';
  readonly description = 'Read a UTF-8 text file from inside the current project root.';

  async execute(args: ReadFileArgs, ctx: ToolExecutionContext): Promise<ToolExecutionResult<string>> {
    const startedAt = Date.now();

    try {
      const rawPath = typeof args.path === 'string' ? args.path.trim() : '';
      if (!rawPath) {
        return {
          success: false,
          error: 'read_file requires a non-empty path',
          durationMs: Date.now() - startedAt,
        };
      }

      const resolved = resolveWithinProject(ctx.projectRoot, rawPath);
      const content = fs.readFileSync(resolved, 'utf-8');
      return {
        success: true,
        result: content,
        durationMs: Date.now() - startedAt,
      };
    } catch (error: unknown) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startedAt,
      };
    }
  }
}