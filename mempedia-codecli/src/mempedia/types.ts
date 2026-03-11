export type ToolAction =
  | { action: 'upsert_node'; node_id: string; content?: any; patch?: any; confidence: number; importance: number }
  | { action: 'fork_node'; node_id: string }
  | { action: 'merge_node'; node_id: string; left_version: string; right_version: string }
  | { action: 'access_node'; node_id: string; agent_id?: string }
  | { action: 'compare_versions'; left_version: string; right_version: string }
  | { action: 'traverse'; start_node: string; mode: string; depth_limit?: number; min_confidence?: number }
  | { action: 'search_nodes'; query: string; limit?: number; include_highlight?: boolean }
  | { action: 'suggest_exploration'; node_id: string; limit?: number }
  | { action: 'explore_with_budget'; node_id: string; depth_budget?: number; per_layer_limit?: number; total_limit?: number; min_score?: number }
  | { action: 'auto_link_related'; node_id: string; limit?: number; min_score?: number }
  | { action: 'agent_upsert_markdown'; node_id: string; markdown: string; confidence: number; importance: number; agent_id: string; reason: string; source: string }
  | { action: 'rollback_node'; node_id: string; target_version: string; confidence: number; importance: number; agent_id?: string; reason: string }
  | { action: 'open_node'; node_id: string; markdown?: boolean; agent_id?: string }
  | { action: 'node_history'; node_id: string; limit?: number }
  | { action: 'record_user_habit'; topic: string; summary: string; details: string; agent_id: string; source: string }
  | { action: 'record_behavior_pattern'; pattern_key: string; summary: string; details: string; applicable_plan?: string; agent_id: string; source: string };

export type ToolResponse = 
  | { kind: 'version'; version: any }
  | { kind: 'optional_version'; version: any | null }
  | { kind: 'version_pair'; left: any; right: any }
  | { kind: 'node_list'; nodes: string[] }
  | { kind: 'search_results'; results: any[] }
  | { kind: 'explore_results'; results: any[] }
  | { kind: 'explore_budget_results'; results: any[] }
  | { kind: 'markdown'; node_id: string; version?: string; path?: string; markdown?: string }
  | { kind: 'history'; node_id: string; items: any[] }
  | { kind: 'ack'; message: string }
  | { kind: 'error'; message: string };
