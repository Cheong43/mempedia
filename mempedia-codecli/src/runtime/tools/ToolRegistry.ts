import { ToolDefinition } from './types.js';

/**
 * ToolRegistry is a simple map from tool name to `ToolDefinition`.
 *
 * Tools are registered at bootstrap time and looked up by name during
 * tool execution.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  /** Register a tool.  Throws if a tool with the same name is already registered. */
  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`ToolRegistry: tool '${tool.name}' is already registered`);
    }
    this.tools.set(tool.name, tool);
  }

  /** Register multiple tools at once. */
  registerAll(tools: ToolDefinition[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  /** Look up a tool by name.  Returns `undefined` if not found. */
  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /** Return all registered tool names. */
  names(): string[] {
    return [...this.tools.keys()];
  }

  /** Return all registered tools. */
  all(): ToolDefinition[] {
    return [...this.tools.values()];
  }
}
