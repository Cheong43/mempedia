import { ChatCompletionTool } from 'openai/resources/chat/completions';

export const TOOLS: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'read',
      description: 'Read workspace files only. For Mempedia core knowledge, episodic memory, preferences, skills, or projects, use bash to call the mempedia CLI as guided by the active SKILL.md.',
      parameters: {
        type: 'object',
        properties: {
          target: { type: 'string', enum: ['workspace'], description: 'What to read.' },
          path: { type: 'string', description: 'Workspace-relative file path.' },
        },
        required: ['target'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search',
      description: 'Search workspace files only, with grep or glob. For Mempedia searching, use bash to call the mempedia CLI as guided by the active SKILL.md.',
      parameters: {
        type: 'object',
        properties: {
          target: { type: 'string', enum: ['workspace'], description: 'What to search.' },
          mode: { type: 'string', enum: ['grep', 'glob'], description: 'Search mode.' },
          query: { type: 'string', description: 'Keyword query for grep.' },
          pattern: { type: 'string', description: 'Glob pattern when mode=glob.' },
          limit: { type: 'number', description: 'Maximum number of results.' },
        },
        required: ['target', 'mode'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit',
      description: 'Edit workspace files only. For Mempedia core knowledge, preferences, skills, or projects, use bash to call the mempedia CLI as guided by the active SKILL.md.',
      parameters: {
        type: 'object',
        properties: {
          target: { type: 'string', enum: ['workspace'], description: 'What to edit.' },
          path: { type: 'string', description: 'Workspace-relative file path.' },
          content: { type: 'string', description: 'Full content to write.' },
        },
        required: ['target'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'bash',
      description: 'Run a shell command inside the local sandbox. Dangerous operations must stay sandboxed and require confirmation.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The shell command to run.' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web',
      description: 'Search the web or fetch a specific web page when repository and Mempedia evidence are insufficient.',
      parameters: {
        type: 'object',
        properties: {
          mode: { type: 'string', enum: ['search', 'fetch'], description: 'Whether to run a web search or fetch a page.' },
          query: { type: 'string', description: 'Search query when mode=search.' },
          url: { type: 'string', description: 'URL to fetch when mode=fetch.' },
          limit: { type: 'number', description: 'Maximum number of search results.' },
        },
        required: ['mode'],
      },
    },
  },
];

export const TOOL_NAMES = TOOLS.map((tool) => tool.function.name) as ['read', 'search', 'edit', 'bash', 'web'];
