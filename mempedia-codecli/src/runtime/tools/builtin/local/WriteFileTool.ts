import * as fs from 'fs';
import * as path from 'path';
import { ToolDefinition, ToolExecutionContext, ToolExecutionResult } from '../../types.js';
import { resolveWithinProject } from './pathUtils.js';

interface WriteFileArgs extends Record<string, unknown> {
  path?: unknown;
  content?: unknown;
}

export class WriteFileTool implements ToolDefinition<WriteFileArgs, string> {
  readonly name = 'write_file';
  readonly description = 'Write UTF-8 text into a file inside the current project root.';

  async execute(args: WriteFileArgs, ctx: ToolExecutionContext): Promise<ToolExecutionResult<string>> {
    const startedAt = Date.now();

    try {
      const rawPath = typeof args.path === 'string' ? args.path.trim() : '';
      if (!rawPath) {
        return {
          success: false,
          error: 'write_file requires a non-empty path',
          durationMs: Date.now() - startedAt,
        };
      }

      const resolved = resolveWithinProject(ctx.projectRoot, rawPath);
      const content = typeof args.content === 'string' ? args.content : String(args.content ?? '');
      fs.mkdirSync(path.dirname(resolved), { recursive: true });
      fs.writeFileSync(resolved, content, 'utf-8');
      return {
        success: true,
        result: `File written to ${resolved}`,
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