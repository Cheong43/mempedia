import { ChatCompletionTool } from 'openai/resources/chat/completions';

export const TOOLS: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'mempedia_search',
      description: 'Search for knowledge or past interactions in mempedia.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search query' },
          limit: { type: 'number', description: 'Max number of results' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'mempedia_read',
      description: 'Read the content of a specific mempedia node.',
      parameters: {
        type: 'object',
        properties: {
          node_id: { type: 'string', description: 'The ID of the node to read' },
        },
        required: ['node_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'mempedia_save',
      description: 'Save or update knowledge/interaction in mempedia.',
      parameters: {
        type: 'object',
        properties: {
          node_id: { type: 'string', description: 'The ID of the node (unique)' },
          title: { type: 'string', description: 'Title of the node' },
          content: { type: 'string', description: 'Markdown content' },
          tags: { type: 'string', description: 'Comma-separated tags' },
          links: { type: 'array', items: { type: 'string' }, description: 'List of node_ids to link to' },
        },
        required: ['node_id', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_shell',
      description: 'Run a shell command.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The command to run' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a file from the filesystem.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'The path to the file' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write content to a file.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'The path to the file' },
          content: { type: 'string', description: 'The content to write' },
        },
        required: ['path', 'content'],
      },
    },
  },
];
