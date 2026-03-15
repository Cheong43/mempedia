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
      name: 'mempedia_search_hybrid',
      description: 'Hybrid search using BM25/keyword + vector + graph with RRF fusion.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search query' },
          limit: { type: 'number', description: 'Max number of results' },
          rrf_k: { type: 'number', description: 'RRF k parameter (optional)' },
          bm25_weight: { type: 'number', description: 'Weight for BM25 list (optional)' },
          vector_weight: { type: 'number', description: 'Weight for vector list (optional)' },
          graph_weight: { type: 'number', description: 'Weight for graph list (optional)' },
          graph_depth: { type: 'number', description: 'Graph expansion depth (optional)' },
          graph_seed_limit: { type: 'number', description: 'Seed count from lexical/vector hits (optional)' },
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
      description: 'Save or update knowledge in mempedia using structured fields. Prefer title, summary, body, facts, evidence, and relations instead of markdown sections.',
      parameters: {
        type: 'object',
        properties: {
          node_id: { type: 'string', description: 'The ID of the node (unique)' },
          title: { type: 'string', description: 'Human-readable title of the node' },
          summary: { type: 'string', description: 'Short summary for retrieval and display' },
          body: { type: 'string', description: 'Main narrative body text; plain text or markdown body is fine, but do not encode facts/evidence as section bullets here' },
          facts: {
            type: 'object',
            description: 'Structured facts as key-value pairs',
            additionalProperties: { type: 'string' },
          },
          evidence: {
            type: 'array',
            description: 'Evidence strings stored in structured fields',
            items: { type: 'string' },
          },
          relations: {
            type: 'array',
            description: 'Graph relations to other nodes',
            items: {
              type: 'object',
              properties: {
                target: { type: 'string', description: 'Target node id or keyword' },
                label: { type: 'string', description: 'Optional relation label' },
                weight: { type: 'number', description: 'Optional relation weight' },
              },
              required: ['target'],
            },
          },
          source: { type: 'string', description: 'Optional source tag for this save' },
          content: { type: 'string', description: 'Legacy markdown content. Supported for compatibility, but structured fields are preferred.' },
        },
        required: ['node_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'mempedia_traverse',
      description: 'Traverse the knowledge graph from a start node.',
      parameters: {
        type: 'object',
        properties: {
          start_node: { type: 'string', description: 'Start node id' },
          mode: { type: 'string', description: 'Traversal mode: bfs | dfs | importance_first | confidence_filtered' },
          depth_limit: { type: 'number', description: 'Depth limit (optional)' },
          min_confidence: { type: 'number', description: 'Min confidence for confidence_filtered mode (optional)' },
        },
        required: ['start_node', 'mode'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'mempedia_history',
      description: 'Inspect the version history of a node.',
      parameters: {
        type: 'object',
        properties: {
          node_id: { type: 'string', description: 'Node id' },
          limit: { type: 'number', description: 'Max number of versions (optional)' },
        },
        required: ['node_id'],
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
