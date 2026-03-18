export type ToolAction =
  | { action: 'upsert_node'; node_id: string; content?: any; patch?: any; importance: number }
  | { action: 'fork_node'; node_id: string }
  | { action: 'merge_node'; node_id: string; left_version: string; right_version: string }
  | { action: 'access_node'; node_id: string; agent_id?: string }
  | { action: 'compare_versions'; left_version: string; right_version: string }
  | { action: 'traverse'; start_node: string; mode: string; depth_limit?: number }
  | { action: 'search_nodes'; query: string; limit?: number; include_highlight?: boolean }
  | { action: 'search_hybrid'; query: string; limit?: number; rrf_k?: number; bm25_weight?: number; vector_weight?: number; graph_weight?: number; graph_depth?: number; graph_seed_limit?: number }
  | { action: 'suggest_exploration'; node_id: string; limit?: number }
  | { action: 'explore_with_budget'; node_id: string; depth_budget?: number; per_layer_limit?: number; total_limit?: number; min_score?: number }
  | { action: 'auto_link_related'; node_id: string; limit?: number; min_score?: number }
  | { action: 'agent_upsert_markdown'; node_id: string; markdown: string; importance: number; agent_id: string; reason: string; source: string; project?: string; parent_node?: string; node_type?: string }
  | { action: 'ingest'; node_id?: string; title?: string; text: string; summary?: string; facts?: Record<string, string>; relations?: { target: string; label?: string; weight?: number }[]; highlights?: string[]; evidence?: string[]; source: string; agent_id?: string; reason?: string; importance?: number; project?: string; parent_node?: string; node_type?: string }
  | { action: 'sync_markdown'; node_id?: string; path?: string; markdown?: string; agent_id?: string; reason?: string; source?: string; importance?: number; project?: string; parent_node?: string; node_type?: string }
  | { action: 'set_node_links'; node_id: string; links: { target: string; label?: string; weight?: number }[]; agent_id?: string; reason?: string; source?: string; importance?: number }
  | { action: 'rollback_node'; node_id: string; target_version: string; importance: number; agent_id?: string; reason: string }
  | { action: 'open_node'; node_id: string; markdown?: boolean; agent_id?: string }
  | { action: 'node_history'; node_id: string; limit?: number }
  // Layer 2: Episodic memory
  | { action: 'record_episodic'; scene_type: string; summary: string; raw_conversation_id?: string; importance?: number; core_knowledge_nodes?: string[]; tags?: string[]; agent_id?: string }
  | { action: 'search_episodic'; query: string; limit?: number }
  | { action: 'list_episodic'; limit?: number; before_ts?: number }
  // Layer 3: User preferences (single markdown file)
  | { action: 'read_user_preferences' }
  | { action: 'update_user_preferences'; content: string }
  // Layer 4: Agent skills
  | { action: 'upsert_skill'; skill_id: string; title: string; content: string; tags?: string[] }
  | { action: 'search_skills'; query: string; limit?: number }
  | { action: 'read_skill'; skill_id: string }
  | { action: 'list_skills' }
  // Project management
  | { action: 'create_project'; project_id: string; name: string; description: string; owner?: string; tags?: string[] }
  | { action: 'list_projects' }
  | { action: 'get_project'; project_id: string }
  | { action: 'list_project_nodes'; project_id: string };

export type ProjectRecord = {
  project_id: string;
  name: string;
  description: string;
  created_at: number;
  updated_at: number;
  owner?: string;
  tags: string[];
};

export type EpisodicMemoryRecord = {
  id: string;
  timestamp: number;
  scene_type: string;
  summary: string;
  raw_conversation_id?: string;
  importance: number;
  core_knowledge_nodes: string[];
  tags: string[];
  agent_id?: string;
  metadata?: Record<string, string>;
};

export type SkillRecord = {
  id: string;
  title: string;
  content: string;
  tags: string[];
  updated_at: number;
};

export type SkillSearchHit = {
  skill_id: string;
  title: string;
  score: number;
};

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
  | { kind: 'episodic_results'; memories: EpisodicMemoryRecord[] }
  | { kind: 'user_preferences'; content: string }
  | { kind: 'skill_result'; skill_id: string; title: string; content: string; tags: string[]; updated_at: number }
  | { kind: 'skill_results'; results: SkillSearchHit[] }
  | { kind: 'skill_list'; skills: SkillRecord[] }
  | { kind: 'project_result'; project: ProjectRecord }
  | { kind: 'project_list'; projects: ProjectRecord[] }
  | { kind: 'project_nodes'; project_id: string; nodes: string[] }
  | { kind: 'ack'; message: string }
  | { kind: 'error'; message: string };
