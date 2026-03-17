use std::collections::{BTreeMap, HashMap, HashSet, VecDeque};
use std::env;
use std::path::Path;
use std::sync::{Arc, RwLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::core::{
    AccessLog, AccessStats, AgentActionLog, EpisodicMemoryRecord, ExploreBudgetItem,
    ExploreCandidate, Link, MemoryError, MemoryResult, Node, NodeContent, NodeHistoryItem,
    NodePatch, NodeVersion, ProjectRecord, SearchHit, SkillSearchHit,
};
use crate::decay::exponential_decay;
use crate::graph::GraphIndex;
use crate::markdown::{parse_markdown, parse_markdown_with_meta, render_node_markdown};
use crate::promotion::{PromotionSignal, compute_importance};
use crate::storage::{CachedVector, EmbeddingCache, FileStorage, IndexSnapshot};
use crate::versioning::VersionEngine;

pub struct MemoryEngine {
    storage: FileStorage,
    heads: HashMap<String, String>,
    nodes: HashMap<String, Node>,
    graph_index: GraphIndex,
    keyword_index: HashMap<String, HashMap<String, f32>>,
    bm25_index: Bm25Index,
    vector_index: VectorIndex,
    access_state: HashMap<String, AccessStats>,
    auto_promotion: AutoPromotionConfig,
    agent_governance: AgentGovernanceConfig,
    retrieval_config: RetrievalConfig,
    /// BM25 index over episodic memory summaries and tags.
    episodic_bm25: Bm25Index,
    /// BM25 index over agent-skill content.
    skills_bm25: Bm25Index,
    /// Maps node_id → project_id for project-scoped markdown paths.
    node_project_index: HashMap<String, String>,
}

pub type SharedMemoryEngine = Arc<RwLock<MemoryEngine>>;

#[derive(Debug, Clone)]
pub struct AutoPromotionConfig {
    pub enabled: bool,
    pub promote_every_n_access: u64,
    pub promote_interval_seconds: u64,
    pub alpha: f32,
    pub decay_lambda: f32,
}

impl Default for AutoPromotionConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            promote_every_n_access: 1,
            promote_interval_seconds: 300,
            alpha: 0.10,
            decay_lambda: 0.00002,
        }
    }
}

#[derive(Debug, Clone)]
pub struct AgentGovernanceConfig {
    pub min_confidence: f32,
    pub min_reason_chars: usize,
    pub max_markdown_bytes: usize,
}

impl Default for AgentGovernanceConfig {
    fn default() -> Self {
        Self {
            min_confidence: 0.55,
            min_reason_chars: 8,
            max_markdown_bytes: 200_000,
        }
    }
}

#[derive(Debug, Clone)]
pub struct RetrievalConfig {
    pub vector_dim: usize,
    pub rrf_k: usize,
    pub bm25_k1: f32,
    pub bm25_b: f32,
    pub bm25_weight: f32,
    pub vector_weight: f32,
    pub graph_weight: f32,
    pub graph_depth: usize,
    pub graph_seed_limit: usize,
}

impl Default for RetrievalConfig {
    fn default() -> Self {
        Self {
            vector_dim: 256,
            rrf_k: 60,
            bm25_k1: 1.4,
            bm25_b: 0.75,
            bm25_weight: 1.0,
            vector_weight: 1.0,
            graph_weight: 0.6,
            graph_depth: 1,
            graph_seed_limit: 6,
        }
    }
}

#[derive(Debug, Clone, Default)]
struct Bm25Index {
    postings: HashMap<String, HashMap<String, f32>>,
    doc_len: HashMap<String, f32>,
    avg_len: f32,
    doc_count: usize,
    df: HashMap<String, usize>,
}

#[derive(Debug, Clone)]
struct VectorIndex {
    dim: usize,
    vectors: HashMap<String, Vec<f32>>,
}

impl VectorIndex {
    fn new(dim: usize) -> Self {
        Self {
            dim: dim.max(64),
            vectors: HashMap::new(),
        }
    }
}

#[derive(Debug, Clone)]
struct EmbeddingClient {
    base_url: String,
    api_key: String,
    model: String,
    timeout: Duration,
}

impl EmbeddingClient {
    fn from_env() -> Option<Self> {
        let api_key = env::var("EMBEDDING_API_KEY").ok()?;
        let base_url = env::var("EMBEDDING_BASE_URL")
            .unwrap_or_else(|_| "https://api.openai.com/v1".to_string());
        let model = env::var("EMBEDDING_MODEL")
            .unwrap_or_else(|_| "text-embedding-3-small".to_string());
        let timeout_ms = env::var("EMBEDDING_TIMEOUT_MS")
            .ok()
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(120_000);

        Some(Self {
            base_url: base_url.trim_end_matches('/').to_string(),
            api_key,
            model,
            timeout: Duration::from_millis(timeout_ms),
        })
    }

    fn embed(&self, text: &str) -> MemoryResult<Vec<f32>> {
        let client = reqwest::blocking::Client::builder()
            .timeout(self.timeout)
            .build()
            .map_err(|e| MemoryError::Invalid(format!("embedding client error: {e}")))?;
        let url = format!("{}/embeddings", self.base_url);
        let payload = json!({
            "model": self.model,
            "input": [text],
        });
        let resp = client
            .post(url)
            .bearer_auth(&self.api_key)
            .json(&payload)
            .send()
            .map_err(|e| MemoryError::Invalid(format!("embedding request error: {e}")))?;
        let status = resp.status();
        let text = resp
            .text()
            .map_err(|e| MemoryError::Invalid(format!("embedding response error: {e}")))?;
        let value: serde_json::Value = serde_json::from_str(&text)?;
        if !status.is_success() {
            return Err(MemoryError::Invalid(format!(
                "embedding request failed ({status}): {value}"
            )));
        }
        let embedding = value["data"][0]["embedding"]
            .as_array()
            .ok_or_else(|| MemoryError::Invalid("embedding missing in response".to_string()))?;
        let mut out = Vec::with_capacity(embedding.len());
        for v in embedding {
            out.push(v.as_f64().unwrap_or(0.0) as f32);
        }
        Ok(out)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IngestRelation {
    pub target: String,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub weight: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum ToolAction {
    UpsertNode {
        node_id: String,
        #[serde(default)]
        content: Option<NodeContent>,
        #[serde(default)]
        patch: Option<NodePatch>,
        confidence: f32,
        importance: f32,
    },
    ForkNode {
        node_id: String,
    },
    MergeNode {
        node_id: String,
        left_version: String,
        right_version: String,
    },
    AccessNode {
        node_id: String,
        #[serde(default)]
        agent_id: Option<String>,
    },
    CompareVersions {
        left_version: String,
        right_version: String,
    },
    Traverse {
        start_node: String,
        mode: TraverseMode,
        depth_limit: Option<usize>,
        min_confidence: Option<f32>,
    },
    SearchNodes {
        query: String,
        #[serde(default)]
        limit: Option<usize>,
        #[serde(default)]
        include_highlight: Option<bool>,
    },
    SearchHybrid {
        query: String,
        #[serde(default)]
        limit: Option<usize>,
        #[serde(default)]
        rrf_k: Option<usize>,
        #[serde(default)]
        bm25_weight: Option<f32>,
        #[serde(default)]
        vector_weight: Option<f32>,
        #[serde(default)]
        graph_weight: Option<f32>,
        #[serde(default)]
        graph_depth: Option<usize>,
        #[serde(default)]
        graph_seed_limit: Option<usize>,
    },
    SuggestExploration {
        node_id: String,
        limit: Option<usize>,
    },
    ExploreWithBudget {
        node_id: String,
        depth_budget: Option<usize>,
        per_layer_limit: Option<usize>,
        total_limit: Option<usize>,
        min_score: Option<f32>,
    },
    AutoLinkRelated {
        node_id: String,
        limit: Option<usize>,
        min_score: Option<f32>,
    },
    AgentUpsertMarkdown {
        node_id: String,
        markdown: String,
        confidence: f32,
        importance: f32,
        agent_id: String,
        reason: String,
        source: String,
        #[serde(default)]
        project: Option<String>,
        #[serde(default)]
        parent_node: Option<String>,
        #[serde(default)]
        node_type: Option<String>,
    },
    Ingest {
        #[serde(default)]
        node_id: Option<String>,
        #[serde(default)]
        title: Option<String>,
        text: String,
        #[serde(default)]
        summary: Option<String>,
        #[serde(default)]
        facts: Option<BTreeMap<String, String>>,
        #[serde(default)]
        relations: Option<Vec<IngestRelation>>,
        #[serde(default)]
        highlights: Option<Vec<String>>,
        #[serde(default)]
        evidence: Option<Vec<String>>,
        source: String,
        #[serde(default)]
        agent_id: Option<String>,
        #[serde(default)]
        reason: Option<String>,
        #[serde(default)]
        confidence: Option<f32>,
        #[serde(default)]
        importance: Option<f32>,
        #[serde(default)]
        project: Option<String>,
        #[serde(default)]
        parent_node: Option<String>,
        #[serde(default)]
        node_type: Option<String>,
    },
    SyncMarkdown {
        #[serde(default)]
        node_id: Option<String>,
        #[serde(default)]
        path: Option<String>,
        #[serde(default)]
        markdown: Option<String>,
        #[serde(default)]
        agent_id: Option<String>,
        #[serde(default)]
        reason: Option<String>,
        #[serde(default)]
        source: Option<String>,
        #[serde(default)]
        confidence: Option<f32>,
        #[serde(default)]
        importance: Option<f32>,
        #[serde(default)]
        project: Option<String>,
        #[serde(default)]
        parent_node: Option<String>,
        #[serde(default)]
        node_type: Option<String>,
    },
    SetNodeLinks {
        node_id: String,
        links: Vec<Link>,
        #[serde(default)]
        agent_id: Option<String>,
        #[serde(default)]
        reason: Option<String>,
        #[serde(default)]
        source: Option<String>,
        #[serde(default)]
        confidence: Option<f32>,
        #[serde(default)]
        importance: Option<f32>,
    },
    RollbackNode {
        node_id: String,
        target_version: String,
        confidence: f32,
        importance: f32,
        #[serde(default)]
        agent_id: Option<String>,
        reason: String,
    },
    OpenNode {
        node_id: String,
        #[serde(default)]
        markdown: Option<bool>,
        #[serde(default)]
        agent_id: Option<String>,
    },
    NodeHistory {
        node_id: String,
        limit: Option<usize>,
    },
    /// Record a user habit / environment preference (replaces legacy per-node approach).
    RecordUserHabit {
        topic: String,
        summary: String,
        details: String,
        agent_id: String,
        source: String,
    },
    /// Record a reusable agent behaviour pattern.
    RecordBehaviorPattern {
        pattern_key: String,
        summary: String,
        details: String,
        #[serde(default)]
        applicable_plan: Option<String>,
        agent_id: String,
        source: String,
    },
    // ── Layer 2: Episodic memory ────────────────────────────────────────────
    /// Append a new episodic memory record.
    RecordEpisodic {
        scene_type: String,
        summary: String,
        #[serde(default)]
        raw_conversation_id: Option<String>,
        #[serde(default)]
        importance: Option<f32>,
        #[serde(default)]
        core_knowledge_nodes: Option<Vec<String>>,
        #[serde(default)]
        tags: Option<Vec<String>>,
        #[serde(default)]
        agent_id: Option<String>,
    },
    /// BM25 keyword search over episodic memory records.
    SearchEpisodic {
        query: String,
        #[serde(default)]
        limit: Option<usize>,
    },
    /// List recent episodic memory records in reverse-chronological order.
    ListEpisodic {
        #[serde(default)]
        limit: Option<usize>,
        #[serde(default)]
        before_ts: Option<u64>,
    },
    // ── Layer 3: User preferences ───────────────────────────────────────────
    /// Read the project-scoped user-preferences markdown file.
    ReadUserPreferences {},
    /// Overwrite the project-scoped user-preferences markdown file.
    UpdateUserPreferences {
        content: String,
    },
    // ── Layer 4: Agent skills ───────────────────────────────────────────────
    /// Create or replace an agent skill stored as a markdown file.
    UpsertSkill {
        skill_id: String,
        title: String,
        content: String,
        #[serde(default)]
        tags: Option<Vec<String>>,
    },
    /// BM25 keyword search over skill files.
    SearchSkills {
        query: String,
        #[serde(default)]
        limit: Option<usize>,
    },
    /// Read a single skill by id.
    ReadSkill {
        skill_id: String,
    },
    // ── Project management ──────────────────────────────────────────────────
    /// Create or update a project (domain/knowledge-base category).
    CreateProject {
        project_id: String,
        name: String,
        description: String,
        #[serde(default)]
        owner: Option<String>,
        #[serde(default)]
        tags: Option<Vec<String>>,
    },
    /// List all projects with their metadata.
    ListProjects {},
    /// Get metadata for a single project.
    GetProject {
        project_id: String,
    },
    /// List all node ids that belong to a project.
    ListProjectNodes {
        project_id: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TraverseMode {
    Bfs,
    Dfs,
    ImportanceFirst,
    ConfidenceFiltered,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ToolResponse {
    Version {
        version: NodeVersion,
    },
    OptionalVersion {
        version: Option<NodeVersion>,
    },
    VersionPair {
        left: NodeVersion,
        right: NodeVersion,
    },
    NodeList {
        nodes: Vec<String>,
    },
    SearchResults {
        results: Vec<SearchHit>,
    },
    ExploreResults {
        results: Vec<ExploreCandidate>,
    },
    ExploreBudgetResults {
        results: Vec<ExploreBudgetItem>,
    },
    Markdown {
        node_id: String,
        version: Option<String>,
        path: Option<String>,
        markdown: Option<String>,
    },
    History {
        node_id: String,
        items: Vec<NodeHistoryItem>,
    },
    /// Episodic memory search / list results.
    EpisodicResults {
        memories: Vec<EpisodicMemoryRecord>,
    },
    /// Content of the user-preferences markdown file.
    UserPreferences {
        content: String,
    },
    /// A single skill record.
    SkillResult {
        skill_id: String,
        title: String,
        content: String,
        tags: Vec<String>,
        updated_at: u64,
    },
    /// Skill search results (BM25 hits).
    SkillResults {
        results: Vec<SkillSearchHit>,
    },
    /// A single project record.
    ProjectResult {
        project: ProjectRecord,
    },
    /// A list of project records.
    ProjectList {
        projects: Vec<ProjectRecord>,
    },
    /// A list of node ids within a project.
    ProjectNodes {
        project_id: String,
        nodes: Vec<String>,
    },
    Error {
        message: String,
    },
}

impl MemoryEngine {
    pub fn open<P: AsRef<Path>>(data_root: P) -> MemoryResult<Self> {
        let storage = FileStorage::new(data_root)?;
        let snapshot = storage.load_index_snapshot()?;
        let access_state = storage.load_access_state()?;
        let node_project_index = storage.load_node_project_index()?;
        let retrieval_config = RetrievalConfig::default();
        let mut engine = Self {
            storage,
            heads: snapshot.heads,
            nodes: snapshot.nodes,
            graph_index: GraphIndex::default(),
            keyword_index: HashMap::new(),
            bm25_index: Bm25Index::default(),
            vector_index: VectorIndex::new(retrieval_config.vector_dim),
            access_state,
            auto_promotion: AutoPromotionConfig::default(),
            agent_governance: AgentGovernanceConfig::default(),
            retrieval_config,
            episodic_bm25: Bm25Index::default(),
            skills_bm25: Bm25Index::default(),
            node_project_index,
        };
        engine.rebuild_index()?;
        engine.ensure_markdown_projection()?;
        Ok(engine)
    }

    pub fn open_shared<P: AsRef<Path>>(data_root: P) -> MemoryResult<SharedMemoryEngine> {
        Ok(Arc::new(RwLock::new(Self::open(data_root)?)))
    }

    pub fn set_auto_promotion_config(&mut self, config: AutoPromotionConfig) {
        self.auto_promotion = config;
    }

    pub fn set_agent_governance_config(&mut self, config: AgentGovernanceConfig) {
        self.agent_governance = config;
    }

    pub fn set_retrieval_config(&mut self, config: RetrievalConfig) -> MemoryResult<()> {
        self.retrieval_config = config;
        self.rebuild_index()
    }

    pub fn create_node(
        &mut self,
        node_id: &str,
        content: NodeContent,
        confidence: f32,
        importance: f32,
    ) -> MemoryResult<NodeVersion> {
        let content = normalize_content(content);
        let version = VersionEngine::create_node(
            &self.storage,
            &mut self.heads,
            &mut self.nodes,
            node_id,
            content,
            confidence,
            importance,
        )?;
        self.sync_markdown_for_version(node_id, &version)?;
        self.rebuild_index()?;
        Ok(version)
    }

    pub fn update_node(
        &mut self,
        node_id: &str,
        patch: NodePatch,
        confidence: f32,
        importance: f32,
    ) -> MemoryResult<NodeVersion> {
        let patch = self.normalize_patch_with_head(node_id, patch)?;
        let version = VersionEngine::update_node(
            &self.storage,
            &mut self.heads,
            &mut self.nodes,
            node_id,
            patch,
            confidence,
            importance,
        )?;
        self.sync_markdown_for_version(node_id, &version)?;
        self.rebuild_index()?;
        Ok(version)
    }

    pub fn replace_node(
        &mut self,
        node_id: &str,
        content: NodeContent,
        confidence: f32,
        importance: f32,
    ) -> MemoryResult<NodeVersion> {
        let content = normalize_content(content);
        let version = VersionEngine::replace_node(
            &self.storage,
            &mut self.heads,
            &mut self.nodes,
            node_id,
            content,
            confidence,
            importance,
        )?;
        self.sync_markdown_for_version(node_id, &version)?;
        self.rebuild_index()?;
        Ok(version)
    }

    pub fn fork_node(&mut self, node_id: &str) -> MemoryResult<NodeVersion> {
        let version =
            VersionEngine::fork_node(&self.storage, &mut self.heads, &mut self.nodes, node_id)?;
        self.sync_markdown_for_version(node_id, &version)?;
        self.rebuild_index()?;
        Ok(version)
    }

    pub fn merge_node(
        &mut self,
        node_id: &str,
        left_version: &str,
        right_version: &str,
    ) -> MemoryResult<NodeVersion> {
        let version = VersionEngine::merge_node(
            &self.storage,
            &mut self.heads,
            &mut self.nodes,
            node_id,
            left_version,
            right_version,
        )?;
        self.sync_markdown_for_version(node_id, &version)?;
        self.rebuild_index()?;
        Ok(version)
    }

    pub fn rollback_node(
        &mut self,
        node_id: &str,
        target_version: &str,
        confidence: f32,
        importance: f32,
    ) -> MemoryResult<NodeVersion> {
        let version = VersionEngine::rollback_node(
            &self.storage,
            &mut self.heads,
            &mut self.nodes,
            node_id,
            target_version,
            confidence,
            importance,
        )?;
        self.sync_markdown_for_version(node_id, &version)?;
        self.rebuild_index()?;
        Ok(version)
    }

    pub fn agent_upsert_markdown(
        &mut self,
        node_id: &str,
        markdown: &str,
        confidence: f32,
        importance: f32,
        agent_id: &str,
        reason: &str,
        source: &str,
        project: Option<String>,
        parent_node: Option<String>,
        node_type: Option<String>,
    ) -> MemoryResult<NodeVersion> {
        self.validate_agent_markdown_request(markdown, confidence, agent_id, reason, source)?;

        let mut content = parse_markdown(markdown);
        // Honour explicit project/parent_node/node_type arguments, falling back
        // to values already embedded in the markdown frontmatter.
        if project.is_some() { content.project = project; }
        if parent_node.is_some() { content.parent_node = parent_node; }
        if node_type.is_some() { content.node_type = node_type; }

        let (linked_body, auto_links) = self.auto_wikilink_markdown_body(node_id, &content.body)?;
        if linked_body != content.body {
            content.body = linked_body;
        }
        let mut existing_targets: HashSet<String> =
            content.links.iter().map(|link| link.target.clone()).collect();
        for link in auto_links {
            if existing_targets.insert(link.target.clone()) {
                content.links.push(link);
            }
        }
        let mut content = normalize_content(content);
        let now = now_ts();
        content
            .structured_data
            .insert("meta.source".to_string(), source.trim().to_string());
        content
            .structured_data
            .insert("meta.origin".to_string(), agent_id.to_string());
        content
            .structured_data
            .insert("kb.last_agent_id".to_string(), agent_id.to_string());
        content
            .structured_data
            .insert("kb.last_reason".to_string(), reason.trim().to_string());
        content
            .structured_data
            .insert("kb.last_source".to_string(), source.trim().to_string());
        content
            .structured_data
            .insert("kb.updated_at".to_string(), now.to_string());

        let version = if self.head(node_id).is_some() {
            let patch = NodePatch {
                title: Some(content.title.clone()),
                summary: Some(content.summary.clone()),
                body: Some(content.body.clone()),
                structured_upserts: content.structured_data.clone(),
                add_links: content.links.clone(),
                add_highlights: content.highlights.clone(),
                project: content.project.clone(),
                parent_node: content.parent_node.clone(),
                node_type: content.node_type.clone(),
            };
            self.update_node(node_id, patch, confidence, importance)?
        } else {
            self.create_node(node_id, content, confidence, importance)?
        };

        self.storage.append_agent_action_log(&AgentActionLog {
            timestamp: now,
            agent_id: agent_id.to_string(),
            action: "agent_upsert_markdown".to_string(),
            node_id: node_id.to_string(),
            version: version.version.clone(),
            reason: reason.trim().to_string(),
            source: source.trim().to_string(),
        })?;

        Ok(version)
    }

    pub fn sync_markdown(
        &mut self,
        node_id: Option<String>,
        path: Option<String>,
        markdown: Option<String>,
        agent_id: Option<String>,
        reason: Option<String>,
        source: Option<String>,
        confidence: Option<f32>,
        importance: Option<f32>,
        project: Option<String>,
        parent_node: Option<String>,
        node_type: Option<String>,
    ) -> MemoryResult<NodeVersion> {
        let markdown = if let Some(md) = markdown {
            md
        } else if let Some(path) = &path {
            std::fs::read_to_string(path)?
        } else if let Some(node_id) = &node_id {
            let proj = self.node_project_index.get(node_id.as_str()).map(|s| s.as_str());
            let (_, content) = self
                .storage
                .read_markdown_node(node_id, proj)?
                .ok_or_else(|| {
                    MemoryError::NotFound(format!("markdown for node {node_id} not found"))
                })?;
            content
        } else {
            return Err(MemoryError::Invalid(
                "sync_markdown requires markdown, path, or node_id".to_string(),
            ));
        };

        let parsed = parse_markdown_with_meta(&markdown);
        let node_id_from_meta = parsed.frontmatter.get("node_id").cloned();
        let resolved_node_id = match (node_id, node_id_from_meta) {
            (Some(from_arg), Some(from_meta)) => {
                if from_arg != from_meta {
                    return Err(MemoryError::Invalid(format!(
                        "node_id mismatch: action={from_arg} frontmatter={from_meta}"
                    )));
                }
                from_arg
            }
            (Some(from_arg), None) => from_arg,
            (None, Some(from_meta)) => from_meta,
            (None, None) => {
                return Err(MemoryError::Invalid(
                    "sync_markdown missing node_id (provide in action or frontmatter)"
                        .to_string(),
                ))
            }
        };

        let confidence = confidence
            .or_else(|| {
                parsed
                    .frontmatter
                    .get("confidence")
                    .and_then(|value| value.parse::<f32>().ok())
            })
            .unwrap_or(0.9);
        let importance = importance
            .or_else(|| {
                parsed
                    .frontmatter
                    .get("importance")
                    .and_then(|value| value.parse::<f32>().ok())
            })
            .unwrap_or(1.0);

        let agent_id = agent_id.unwrap_or_else(|| "human".to_string());
        let reason = reason.unwrap_or_else(|| "manual markdown sync".to_string());
        let source = source.unwrap_or_else(|| "manual_edit".to_string());
        self.validate_agent_markdown_request(&markdown, confidence, &agent_id, &reason, &source)?;

        let existing_head = self
            .head(&resolved_node_id)
            .and_then(|head_id| self.get_version(head_id).ok());

        let now = now_ts();
        let mut content = normalize_content(parsed.content);
        if let Some(head) = &existing_head {
            content.links = head.content.links.clone();
            // Preserve existing project/parent/type if not overridden.
            if content.project.is_none() {
                content.project = head.content.project.clone();
            }
            if content.parent_node.is_none() {
                content.parent_node = head.content.parent_node.clone();
            }
            if content.node_type.is_none() {
                content.node_type = head.content.node_type.clone();
            }
        }
        // Apply explicit overrides from the action arguments.
        if project.is_some() { content.project = project; }
        if parent_node.is_some() { content.parent_node = parent_node; }
        if node_type.is_some() { content.node_type = node_type; }

        content
            .structured_data
            .insert("meta.source".to_string(), source.trim().to_string());
        content
            .structured_data
            .insert("meta.origin".to_string(), agent_id.to_string());
        content
            .structured_data
            .insert("kb.last_agent_id".to_string(), agent_id.to_string());
        content
            .structured_data
            .insert("kb.last_reason".to_string(), reason.trim().to_string());
        content
            .structured_data
            .insert("kb.last_source".to_string(), source.trim().to_string());
        content
            .structured_data
            .insert("kb.updated_at".to_string(), now.to_string());

        let version = if self.head(&resolved_node_id).is_some() {
            self.replace_node(&resolved_node_id, content, confidence, importance)?
        } else {
            self.create_node(&resolved_node_id, content, confidence, importance)?
        };

        self.storage.append_agent_action_log(&AgentActionLog {
            timestamp: now,
            agent_id: agent_id.to_string(),
            action: "sync_markdown".to_string(),
            node_id: resolved_node_id.to_string(),
            version: version.version.clone(),
            reason: reason.trim().to_string(),
            source: source.trim().to_string(),
        })?;

        Ok(version)
    }

    pub fn set_node_links(
        &mut self,
        node_id: &str,
        links: Vec<Link>,
        agent_id: Option<String>,
        reason: Option<String>,
        source: Option<String>,
        confidence: Option<f32>,
        importance: Option<f32>,
    ) -> MemoryResult<NodeVersion> {
        let head_id = self
            .head(node_id)
            .ok_or_else(|| MemoryError::NotFound(format!("node {node_id} not found")))?
            .to_string();
        let head = self.get_version(&head_id)?;

        let agent_id = agent_id.unwrap_or_else(|| "ui-editor".to_string());
        let reason = reason.unwrap_or_else(|| "update canonical graph links".to_string());
        let source = source.unwrap_or_else(|| "graph_editor".to_string());
        let confidence = confidence.unwrap_or(head.confidence);
        let importance = importance.unwrap_or(head.importance);
        self.validate_agent_governed_request(confidence, &agent_id, &reason, &source)?;

        let now = now_ts();
        let mut content = normalize_content(head.content.clone());
        content.links = normalize_links(links);
        content
            .structured_data
            .insert("kb.last_agent_id".to_string(), agent_id.to_string());
        content
            .structured_data
            .insert("kb.last_reason".to_string(), reason.trim().to_string());
        content
            .structured_data
            .insert("kb.last_source".to_string(), source.trim().to_string());
        content
            .structured_data
            .insert("kb.updated_at".to_string(), now.to_string());

        let version = self.replace_node(node_id, content, confidence, importance)?;
        self.storage.append_agent_action_log(&AgentActionLog {
            timestamp: now,
            agent_id,
            action: "set_node_links".to_string(),
            node_id: node_id.to_string(),
            version: version.version.clone(),
            reason: reason.trim().to_string(),
            source: source.trim().to_string(),
        })?;
        Ok(version)
    }

    pub fn ingest_text(
        &mut self,
        node_id: Option<String>,
        title: Option<String>,
        text: &str,
        summary: Option<String>,
        facts: Option<BTreeMap<String, String>>,
        relations: Option<Vec<IngestRelation>>,
        highlights: Option<Vec<String>>,
        evidence: Option<Vec<String>>,
        source: &str,
        agent_id: Option<String>,
        reason: Option<String>,
        confidence: Option<f32>,
        importance: Option<f32>,
        project: Option<String>,
        parent_node: Option<String>,
        node_type: Option<String>,
    ) -> MemoryResult<NodeVersion> {
        let agent_id = agent_id.unwrap_or_else(|| "agent-ingest".to_string());
        let reason = reason.unwrap_or_else(|| "auto ingestion".to_string());
        let confidence = confidence.unwrap_or(self.agent_governance.min_confidence.max(0.7));
        let importance = importance.unwrap_or(1.0);
        self.validate_agent_governed_request(confidence, &agent_id, &reason, source)?;

        let parsed = parse_markdown_with_meta(text);
        let mut content = parsed.content;
        if let Some(title) = title {
            content.title = title;
        }
        if let Some(summary) = summary {
            content.summary = ensure_summary(&summary, &content.title, &content.body);
        } else {
            content.summary = ensure_summary(&content.summary, &content.title, &content.body);
        }

        if let Some(highlights) = highlights {
            for item in highlights {
                if !content.highlights.iter().any(|h| h == &item) {
                    content.highlights.push(item);
                }
            }
        }

        if let Some(facts) = facts {
            for (k, v) in facts {
                let key = normalize_fact_key(&k);
                if !key.is_empty() && !v.trim().is_empty() {
                    insert_fact(&mut content.structured_data, &key, v.trim());
                }
            }
        }

        for (k, v) in extract_inline_facts(&content.body) {
            let key = normalize_fact_key(&k);
            if !key.is_empty() && !v.trim().is_empty() {
                insert_fact(&mut content.structured_data, &key, v.trim());
            }
        }

        if let Some(relations) = relations {
            for relation in relations {
                let target = relation.target.trim().to_string();
                if target.is_empty() {
                    continue;
                }
                let label = relation.label.clone().unwrap_or_else(|| "related".to_string());
                let weight = relation.weight.unwrap_or(0.8).max(0.0);
                if !content
                    .links
                    .iter()
                    .any(|link| link.target == target && link.label.as_deref() == Some(&label))
                {
                    content.links.push(Link {
                        target,
                        label: Some(label),
                        weight,
                    });
                }
            }
        }

        if let Some(evidence) = evidence {
            for item in evidence {
                if !item.trim().is_empty() {
                    insert_evidence(&mut content.structured_data, item.trim());
                }
            }
        }

        let mut content = normalize_content(content);
        // Apply project-hierarchy fields. Values from explicit arguments take
        // precedence over those parsed from the markdown frontmatter.
        if project.is_some() { content.project = project; }
        if parent_node.is_some() { content.parent_node = parent_node; }
        if node_type.is_some() { content.node_type = node_type; }

        content
            .structured_data
            .insert("meta.source".to_string(), source.trim().to_string());
        content
            .structured_data
            .insert("meta.origin".to_string(), agent_id.to_string());

        let now = now_ts();
        content
            .structured_data
            .insert("kb.last_agent_id".to_string(), agent_id.to_string());
        content
            .structured_data
            .insert("kb.last_reason".to_string(), reason.trim().to_string());
        content
            .structured_data
            .insert("kb.last_source".to_string(), source.trim().to_string());
        content
            .structured_data
            .insert("kb.updated_at".to_string(), now.to_string());

        let resolved_node_id = node_id
            .or_else(|| parsed.frontmatter.get("node_id").cloned())
            .unwrap_or_else(|| derive_node_id(&content.title));
        let version = if self.head(&resolved_node_id).is_some() {
            let patch = NodePatch {
                title: Some(content.title.clone()),
                summary: Some(content.summary.clone()),
                body: Some(content.body.clone()),
                structured_upserts: content.structured_data.clone(),
                add_links: content.links.clone(),
                add_highlights: content.highlights.clone(),
                project: content.project.clone(),
                parent_node: content.parent_node.clone(),
                node_type: content.node_type.clone(),
            };
            self.update_node(&resolved_node_id, patch, confidence, importance)?
        } else {
            self.create_node(&resolved_node_id, content, confidence, importance)?
        };

        self.storage.append_agent_action_log(&AgentActionLog {
            timestamp: now,
            agent_id: agent_id.to_string(),
            action: "ingest".to_string(),
            node_id: resolved_node_id.to_string(),
            version: version.version.clone(),
            reason: reason.trim().to_string(),
            source: source.trim().to_string(),
        })?;

        Ok(version)
    }

    pub fn open_markdown_node(
        &self,
        node_id: &str,
    ) -> MemoryResult<Option<(String, String, Option<String>)>> {
        let project = self.node_project_index.get(node_id).map(|s| s.as_str());
        let (path, markdown) = match self.storage.read_markdown_node(node_id, project)? {
            Some(pair) => pair,
            None => return Ok(None),
        };

        let version = self.head(node_id).cloned();
        Ok(Some((
            path.to_string_lossy().to_string(),
            markdown,
            version,
        )))
    }

    pub fn node_history(&self, node_id: &str, limit: usize) -> MemoryResult<Vec<NodeHistoryItem>> {
        let node = self
            .nodes
            .get(node_id)
            .ok_or_else(|| MemoryError::NotFound(format!("node {node_id} not found")))?;
        let mut items = Vec::new();
        for version_id in &node.branches {
            let version = self.storage.read_object(version_id)?;
            items.push(NodeHistoryItem {
                version: version.version,
                timestamp: version.timestamp,
                parents: version.parents,
                confidence: version.confidence,
                importance: version.importance,
            });
        }

        items.sort_by(|a, b| {
            b.timestamp
                .cmp(&a.timestamp)
                .then_with(|| a.version.cmp(&b.version))
        });
        if items.len() > limit {
            items.truncate(limit);
        }
        Ok(items)
    }

    pub fn head(&self, node_id: &str) -> Option<&String> {
        self.heads.get(node_id)
    }

    pub fn get_version(&self, version_id: &str) -> MemoryResult<NodeVersion> {
        self.storage.read_object(version_id)
    }

    pub fn compare_versions(
        &self,
        left_version: &str,
        right_version: &str,
    ) -> MemoryResult<(NodeVersion, NodeVersion)> {
        let left = self.storage.read_object(left_version)?;
        let right = self.storage.read_object(right_version)?;
        Ok((left, right))
    }

    pub fn traverse_bfs(&self, start_node: &str, depth_limit: Option<usize>) -> Vec<String> {
        self.graph_index.bfs(start_node, depth_limit)
    }

    pub fn traverse_dfs(&self, start_node: &str, depth_limit: Option<usize>) -> Vec<String> {
        self.graph_index.dfs(start_node, depth_limit)
    }

    pub fn traverse_importance_first(
        &self,
        start_node: &str,
        depth_limit: Option<usize>,
    ) -> Vec<String> {
        self.graph_index.importance_first(start_node, depth_limit)
    }

    pub fn traverse_confidence_filtered(
        &self,
        start_node: &str,
        depth_limit: Option<usize>,
        min_confidence: f32,
    ) -> MemoryResult<Vec<String>> {
        self.graph_index.confidence_filtered(
            start_node,
            depth_limit,
            min_confidence,
            &self.heads,
            &self.storage,
        )
    }

    pub fn search_by_highlight(&self, query: &str) -> MemoryResult<Vec<String>> {
        let mut matches = Vec::new();
        for (node_id, version_id) in &self.heads {
            let version = self.storage.read_object(version_id)?;
            if version
                .content
                .highlights
                .iter()
                .any(|h| h.to_lowercase().contains(&query.to_lowercase()))
            {
                matches.push(node_id.clone());
            }
        }
        Ok(matches)
    }

    pub fn search_by_keyword(&self, query: &str, limit: usize) -> MemoryResult<Vec<SearchHit>> {
        let query_tokens = tokenize(query);
        if query_tokens.is_empty() {
            return Ok(Vec::new());
        }

        let mut scores: HashMap<String, f32> = HashMap::new();
        let mut matched_terms: HashMap<String, usize> = HashMap::new();
        for token in &query_tokens {
            if let Some(nodes) = self.keyword_index.get(token) {
                for (node_id, weight) in nodes {
                    *scores.entry(node_id.clone()).or_insert(0.0) += *weight;
                    *matched_terms.entry(node_id.clone()).or_insert(0) += 1;
                }
            }
        }

        let mut hits = Vec::new();
        for (node_id, score) in scores {
            let coverage = matched_terms.get(&node_id).copied().unwrap_or(0) as f32;
            if score > 0.0 {
                hits.push(SearchHit {
                    node_id,
                    score: score + coverage,
                });
            }
        }

        hits.sort_by(|a, b| {
            b.score
                .total_cmp(&a.score)
                .then_with(|| a.node_id.cmp(&b.node_id))
        });
        if hits.len() > limit {
            hits.truncate(limit);
        }
        Ok(hits)
    }

    pub fn search_bm25(&self, query: &str, limit: usize) -> Vec<SearchHit> {
        search_bm25(query, limit, &self.bm25_index, &self.retrieval_config)
    }

    pub fn search_vector(&self, query: &str, limit: usize) -> Vec<SearchHit> {
        search_vector(query, limit, &self.vector_index)
    }

    pub fn search_hybrid(
        &self,
        query: &str,
        limit: usize,
        rrf_k: Option<usize>,
        bm25_weight: Option<f32>,
        vector_weight: Option<f32>,
        graph_weight: Option<f32>,
        graph_depth: Option<usize>,
        graph_seed_limit: Option<usize>,
    ) -> MemoryResult<Vec<SearchHit>> {
        let limit = limit.max(1);
        let bm25_limit = limit.saturating_mul(4).max(12);
        let vector_limit = limit.saturating_mul(4).max(12);
        let graph_limit = limit.saturating_mul(4).max(12);

        let bm25_hits = self.search_bm25(query, bm25_limit);
        let vector_hits = self.search_vector(query, vector_limit);

        let seed_limit = graph_seed_limit.unwrap_or(self.retrieval_config.graph_seed_limit);
        let mut seeds = Vec::new();
        for hit in bm25_hits.iter().take(seed_limit) {
            seeds.push(hit.node_id.clone());
        }
        for hit in vector_hits.iter().take(seed_limit) {
            if !seeds.iter().any(|id| id == &hit.node_id) {
                seeds.push(hit.node_id.clone());
            }
        }

        let graph_hits = self.graph_candidates(
            &seeds,
            graph_depth.unwrap_or(self.retrieval_config.graph_depth),
            graph_limit,
        );

        let fused = rrf_fuse(
            vec![
                (bm25_hits, bm25_weight.unwrap_or(self.retrieval_config.bm25_weight)),
                (
                    vector_hits,
                    vector_weight.unwrap_or(self.retrieval_config.vector_weight),
                ),
                (
                    graph_hits,
                    graph_weight.unwrap_or(self.retrieval_config.graph_weight),
                ),
            ],
            rrf_k.unwrap_or(self.retrieval_config.rrf_k),
            limit,
        );
        Ok(fused)
    }

    fn graph_candidates(&self, seeds: &[String], depth_limit: usize, limit: usize) -> Vec<SearchHit> {
        if seeds.is_empty() || limit == 0 {
            return Vec::new();
        }

        let mut scores: HashMap<String, f32> = HashMap::new();
        let mut queue: VecDeque<(String, usize)> = VecDeque::new();
        let mut visited: HashSet<String> = HashSet::new();

        for seed in seeds {
            queue.push_back((seed.clone(), 0));
            visited.insert(seed.clone());
        }

        while let Some((node_id, depth)) = queue.pop_front() {
            let importance = self
                .graph_index
                .importance_index
                .get(&node_id)
                .copied()
                .unwrap_or(0.0);
            let depth_penalty = 1.0 / ((depth + 1) as f32);
            let base = if depth == 0 { 5.0 } else { 0.0 };
            let score = (importance + base) * depth_penalty;
            *scores.entry(node_id.clone()).or_insert(0.0) += score;

            if depth >= depth_limit {
                continue;
            }
            for neighbor in self.graph_index.neighbors(&node_id) {
                if visited.insert(neighbor.clone()) {
                    queue.push_back((neighbor, depth + 1));
                }
            }
            for neighbor in self.graph_index.inbound_neighbors(&node_id) {
                if visited.insert(neighbor.clone()) {
                    queue.push_back((neighbor, depth + 1));
                }
            }
        }

        let mut hits: Vec<SearchHit> = scores
            .into_iter()
            .map(|(node_id, score)| SearchHit { node_id, score })
            .collect();
        hits.sort_by(|a, b| b.score.total_cmp(&a.score).then_with(|| a.node_id.cmp(&b.node_id)));
        if hits.len() > limit {
            hits.truncate(limit);
        }
        hits
    }

    pub fn suggest_exploration(
        &self,
        node_id: &str,
        limit: usize,
    ) -> MemoryResult<Vec<ExploreCandidate>> {
        let head_id = self
            .head(node_id)
            .ok_or_else(|| MemoryError::NotFound(format!("node {node_id} not found")))?;
        let head = self.get_version(head_id)?;
        let head_outbound: HashSet<String> =
            self.graph_index.neighbors(node_id).into_iter().collect();
        let head_inbound: HashSet<String> = self
            .graph_index
            .inbound_neighbors(node_id)
            .into_iter()
            .collect();
        let head_structured_terms = extract_structured_terms(&head.content.structured_data);

        let mut candidates: HashMap<String, ExploreCandidate> = HashMap::new();

        for link in &head.content.links {
            if link.target == node_id {
                continue;
            }
            let importance = self
                .graph_index
                .importance_index
                .get(&link.target)
                .copied()
                .unwrap_or(0.0);
            let score = 90.0 + link.weight.max(0.0) * 5.0 + importance.min(10.0);
            upsert_candidate(
                &mut candidates,
                &link.target,
                score,
                format!("linked:{}", link.label.as_deref().unwrap_or("related")),
            );
        }

        for source in self.graph_index.inbound_neighbors(node_id) {
            if source == node_id {
                continue;
            }
            let importance = self
                .graph_index
                .importance_index
                .get(&source)
                .copied()
                .unwrap_or(0.0);
            let score = 70.0 + importance.min(10.0);
            upsert_candidate(&mut candidates, &source, score, "referenced_by".to_string());
        }

        let query = build_exploration_query(&head.content);
        for hit in self.search_by_keyword(&query, limit.saturating_mul(4).max(10))? {
            if hit.node_id == node_id {
                continue;
            }
            let score = 40.0 + hit.score;
            upsert_candidate(&mut candidates, &hit.node_id, score, "keyword".to_string());
        }

        for (candidate_id, candidate_head_id) in &self.heads {
            if candidate_id == node_id {
                continue;
            }
            let candidate = self.get_version(candidate_head_id)?;

            let candidate_outbound: HashSet<String> = self
                .graph_index
                .neighbors(candidate_id)
                .into_iter()
                .collect();
            let candidate_inbound: HashSet<String> = self
                .graph_index
                .inbound_neighbors(candidate_id)
                .into_iter()
                .collect();
            let candidate_terms = extract_structured_terms(&candidate.content.structured_data);

            let shared_outbound = overlap_ratio(&head_outbound, &candidate_outbound);
            if shared_outbound > 0.0 {
                upsert_candidate(
                    &mut candidates,
                    candidate_id,
                    12.0 + shared_outbound * 38.0,
                    "shared_outbound".to_string(),
                );
            }

            let shared_inbound = overlap_ratio(&head_inbound, &candidate_inbound);
            if shared_inbound > 0.0 {
                upsert_candidate(
                    &mut candidates,
                    candidate_id,
                    10.0 + shared_inbound * 32.0,
                    "shared_inbound".to_string(),
                );
            }

            let structured_overlap = overlap_ratio(&head_structured_terms, &candidate_terms);
            if structured_overlap > 0.0 {
                upsert_candidate(
                    &mut candidates,
                    candidate_id,
                    8.0 + structured_overlap * 44.0,
                    "structured_overlap".to_string(),
                );
            }

            let temporal = temporal_proximity_score(head.timestamp, candidate.timestamp);
            if temporal > 0.70 {
                let score = 6.0 + temporal * 12.0 + candidate.importance.max(0.0).min(5.0);
                upsert_candidate(
                    &mut candidates,
                    candidate_id,
                    score,
                    "temporal_proximity".to_string(),
                );
            }
        }

        if candidates.is_empty() {
            let mut fallback: Vec<(String, f32)> = self
                .graph_index
                .importance_index
                .iter()
                .filter(|(id, _)| *id != node_id)
                .map(|(id, imp)| (id.clone(), *imp))
                .collect();
            fallback.sort_by(|a, b| b.1.total_cmp(&a.1));
            for (id, imp) in fallback.into_iter().take(limit.max(1)) {
                upsert_candidate(
                    &mut candidates,
                    &id,
                    20.0 + imp.max(0.0),
                    "high_importance_fallback".to_string(),
                );
            }
        }

        let mut result: Vec<ExploreCandidate> = candidates.into_values().collect();
        result.sort_by(|a, b| {
            b.score
                .total_cmp(&a.score)
                .then_with(|| a.node_id.cmp(&b.node_id))
        });
        if result.len() > limit {
            result.truncate(limit);
        }
        Ok(result)
    }

    pub fn auto_link_related(
        &mut self,
        node_id: &str,
        limit: usize,
        min_score: f32,
    ) -> MemoryResult<NodeVersion> {
        let head_id = self
            .head(node_id)
            .ok_or_else(|| MemoryError::NotFound(format!("node {node_id} not found")))?
            .clone();
        let head = self.get_version(&head_id)?;
        let existing: HashSet<String> = head
            .content
            .links
            .iter()
            .map(|l| l.target.clone())
            .collect();

        let candidates = self.suggest_exploration(node_id, limit.saturating_mul(4).max(10))?;
        let mut add_links = Vec::new();
        for c in candidates {
            if c.node_id == node_id || existing.contains(&c.node_id) || c.score < min_score {
                continue;
            }
            let normalized = (c.score / 100.0).clamp(0.1, 1.0);
            add_links.push(Link {
                target: c.node_id,
                label: Some(format!("auto_related:{}", c.reason)),
                weight: normalized,
            });
            if add_links.len() >= limit {
                break;
            }
        }

        if add_links.is_empty() {
            return Err(MemoryError::Invalid(
                "no related candidates above min_score".to_string(),
            ));
        }

        let patch = NodePatch {
            add_links,
            ..NodePatch::default()
        };
        self.update_node(node_id, patch, head.confidence, head.importance)
    }

    pub fn explore_with_budget(
        &self,
        node_id: &str,
        depth_budget: usize,
        per_layer_limit: usize,
        total_limit: usize,
        min_score: f32,
    ) -> MemoryResult<Vec<ExploreBudgetItem>> {
        if depth_budget == 0 {
            return Err(MemoryError::Invalid(
                "depth_budget must be >= 1".to_string(),
            ));
        }
        if per_layer_limit == 0 || total_limit == 0 {
            return Err(MemoryError::Invalid(
                "per_layer_limit and total_limit must be >= 1".to_string(),
            ));
        }
        if self.head(node_id).is_none() {
            return Err(MemoryError::NotFound(format!("node {node_id} not found")));
        }

        let mut visited: HashSet<String> = HashSet::new();
        visited.insert(node_id.to_string());

        let mut frontier: Vec<String> = vec![node_id.to_string()];
        let mut items: Vec<ExploreBudgetItem> = Vec::new();

        for depth in 1..=depth_budget {
            if frontier.is_empty() || items.len() >= total_limit {
                break;
            }

            let mut next_frontier: Vec<String> = Vec::new();
            for parent in frontier {
                let suggestions = self.suggest_exploration(&parent, per_layer_limit)?;
                for cand in suggestions {
                    if cand.score < min_score || cand.node_id == node_id {
                        continue;
                    }
                    if !visited.insert(cand.node_id.clone()) {
                        continue;
                    }

                    let depth_penalty = 1.0 / (depth as f32);
                    items.push(ExploreBudgetItem {
                        node_id: cand.node_id.clone(),
                        depth,
                        score: cand.score * depth_penalty,
                        reason: cand.reason,
                        via: Some(parent.clone()),
                    });
                    next_frontier.push(cand.node_id);

                    if items.len() >= total_limit {
                        break;
                    }
                }
                if items.len() >= total_limit {
                    break;
                }
            }
            frontier = next_frontier;
        }

        items.sort_by(|a, b| {
            a.depth
                .cmp(&b.depth)
                .then_with(|| b.score.total_cmp(&a.score))
                .then_with(|| a.node_id.cmp(&b.node_id))
        });

        Ok(items)
    }

    pub fn log_access(&mut self, agent_id: &str, node_id: &str) -> MemoryResult<()> {
        let version = self
            .head(node_id)
            .ok_or_else(|| MemoryError::NotFound(format!("node {node_id} not found")))?
            .clone();
        let timestamp = now_ts();

        let log = AccessLog {
            agent_id: agent_id.to_string(),
            node_id: node_id.to_string(),
            version,
            timestamp,
        };

        self.storage.append_access_log(&log)?;

        let stats = self.access_state.entry(node_id.to_string()).or_default();
        stats.total_access = stats.total_access.saturating_add(1);
        stats.pending_access = stats.pending_access.saturating_add(1);
        stats.last_access_ts = timestamp;
        self.storage.persist_access_state(&self.access_state)?;

        self.maybe_auto_promote_from_access(node_id, timestamp)
    }

    pub fn promote_node(
        &mut self,
        node_id: &str,
        signal: PromotionSignal,
        confidence: f32,
    ) -> MemoryResult<NodeVersion> {
        let importance = compute_importance(signal);
        let patch = NodePatch::default();
        self.update_node(node_id, patch, confidence, importance)
    }

    fn maybe_auto_promote_from_access(
        &mut self,
        node_id: &str,
        timestamp: u64,
    ) -> MemoryResult<()> {
        if !self.auto_promotion.enabled {
            return Ok(());
        }

        let stats = match self.access_state.get(node_id) {
            Some(s) => s.clone(),
            None => return Ok(()),
        };

        let meets_count = stats.pending_access >= self.auto_promotion.promote_every_n_access;
        let meets_interval = self.auto_promotion.promote_interval_seconds > 0
            && stats.pending_access > 0
            && (timestamp.saturating_sub(stats.last_promote_ts)
                >= self.auto_promotion.promote_interval_seconds);

        if !meets_count && !meets_interval {
            return Ok(());
        }

        let head_version_id = self
            .head(node_id)
            .ok_or_else(|| MemoryError::NotFound(format!("node {node_id} not found")))?
            .clone();
        let head = self.get_version(&head_version_id)?;

        let age_seconds = timestamp.saturating_sub(head.timestamp) as f32;
        let decayed = exponential_decay(
            head.importance.max(0.0),
            self.auto_promotion.decay_lambda,
            age_seconds,
        );
        let access_boost = self.auto_promotion.alpha * (stats.pending_access as f32).ln_1p();
        let new_importance = (decayed + access_boost).max(0.0);

        let _ = self.update_node(
            node_id,
            NodePatch::default(),
            head.confidence,
            new_importance,
        )?;

        if let Some(mutable_stats) = self.access_state.get_mut(node_id) {
            mutable_stats.pending_access = 0;
            mutable_stats.last_promote_ts = timestamp;
        }
        self.storage.persist_access_state(&self.access_state)?;
        Ok(())
    }

    pub fn execute_action(&mut self, action: ToolAction) -> ToolResponse {
        let result = match action {
            ToolAction::UpsertNode {
                node_id,
                content,
                patch,
                confidence,
                importance,
            } => {
                if let Some(patch) = patch {
                    if self.head(&node_id).is_some() {
                        self.update_node(&node_id, patch, confidence, importance)
                            .map(|version| ToolResponse::Version { version })
                    } else if let Some(content) = content {
                        self.create_node(&node_id, content, confidence, importance)
                            .map(|version| ToolResponse::Version { version })
                    } else {
                        Err(MemoryError::NotFound(format!(
                            "node {node_id} not found for patch upsert"
                        )))
                    }
                } else if let Some(content) = content {
                    if self.head(&node_id).is_some() {
                        let patch = NodePatch {
                            title: Some(content.title),
                            summary: Some(content.summary),
                            body: Some(content.body),
                            structured_upserts: content.structured_data,
                            add_links: content.links,
                            add_highlights: content.highlights,
                            project: content.project,
                            parent_node: content.parent_node,
                            node_type: content.node_type,
                        };
                        self.update_node(&node_id, patch, confidence, importance)
                            .map(|version| ToolResponse::Version { version })
                    } else {
                        self.create_node(&node_id, content, confidence, importance)
                            .map(|version| ToolResponse::Version { version })
                    }
                } else {
                    Err(MemoryError::Invalid(
                        "upsert_node requires either content or patch".to_string(),
                    ))
                }
            }
            ToolAction::ForkNode { node_id } => self
                .fork_node(&node_id)
                .map(|version| ToolResponse::Version { version }),
            ToolAction::MergeNode {
                node_id,
                left_version,
                right_version,
            } => self
                .merge_node(&node_id, &left_version, &right_version)
                .map(|version| ToolResponse::Version { version }),
            ToolAction::AccessNode { node_id, agent_id } => {
                let agent = agent_id.unwrap_or_else(|| "agent-unknown".to_string());
                self.log_access(&agent, &node_id)
                    .map(|_| ToolResponse::NodeList {
                        nodes: vec![node_id],
                    })
            }
            ToolAction::CompareVersions {
                left_version,
                right_version,
            } => self
                .compare_versions(&left_version, &right_version)
                .map(|(left, right)| ToolResponse::VersionPair { left, right }),
            ToolAction::Traverse {
                start_node,
                mode,
                depth_limit,
                min_confidence,
            } => {
                let nodes_result = match mode {
                    TraverseMode::Bfs => Ok(self.traverse_bfs(&start_node, depth_limit)),
                    TraverseMode::Dfs => Ok(self.traverse_dfs(&start_node, depth_limit)),
                    TraverseMode::ImportanceFirst => {
                        Ok(self.traverse_importance_first(&start_node, depth_limit))
                    }
                    TraverseMode::ConfidenceFiltered => self.traverse_confidence_filtered(
                        &start_node,
                        depth_limit,
                        min_confidence.unwrap_or(0.0),
                    ),
                };
                nodes_result.map(|nodes| ToolResponse::NodeList { nodes })
            }
            ToolAction::SearchNodes {
                query,
                limit,
                include_highlight,
            } => self
                .search_by_keyword(&query, limit.unwrap_or(10))
                .and_then(|mut hits| {
                    if include_highlight.unwrap_or(true) {
                        for node_id in self.search_by_highlight(&query)? {
                            if hits.iter().any(|h| h.node_id == node_id) {
                                continue;
                            }
                            hits.push(SearchHit {
                                node_id,
                                score: 5.0,
                            });
                        }
                        hits.sort_by(|a, b| {
                            b.score
                                .total_cmp(&a.score)
                                .then_with(|| a.node_id.cmp(&b.node_id))
                        });
                        if hits.len() > limit.unwrap_or(10) {
                            hits.truncate(limit.unwrap_or(10));
                        }
                    }
                    Ok(ToolResponse::SearchResults { results: hits })
                }),
            ToolAction::SearchHybrid {
                query,
                limit,
                rrf_k,
                bm25_weight,
                vector_weight,
                graph_weight,
                graph_depth,
                graph_seed_limit,
            } => self
                .search_hybrid(
                    &query,
                    limit.unwrap_or(10),
                    rrf_k,
                    bm25_weight,
                    vector_weight,
                    graph_weight,
                    graph_depth,
                    graph_seed_limit,
                )
                .map(|results| ToolResponse::SearchResults { results }),
            ToolAction::SuggestExploration { node_id, limit } => self
                .suggest_exploration(&node_id, limit.unwrap_or(8))
                .map(|results| ToolResponse::ExploreResults { results }),
            ToolAction::ExploreWithBudget {
                node_id,
                depth_budget,
                per_layer_limit,
                total_limit,
                min_score,
            } => self
                .explore_with_budget(
                    &node_id,
                    depth_budget.unwrap_or(2),
                    per_layer_limit.unwrap_or(5),
                    total_limit.unwrap_or(12),
                    min_score.unwrap_or(35.0),
                )
                .map(|results| ToolResponse::ExploreBudgetResults { results }),
            ToolAction::AutoLinkRelated {
                node_id,
                limit,
                min_score,
            } => self
                .auto_link_related(&node_id, limit.unwrap_or(3), min_score.unwrap_or(45.0))
                .map(|version| ToolResponse::Version { version }),
            ToolAction::AgentUpsertMarkdown {
                node_id,
                markdown,
                confidence,
                importance,
                agent_id,
                reason,
                source,
                project,
                parent_node,
                node_type,
            } => self
                .agent_upsert_markdown(
                    &node_id, &markdown, confidence, importance, &agent_id, &reason, &source,
                    project, parent_node, node_type,
                )
                .map(|version| ToolResponse::Version { version }),
            ToolAction::Ingest {
                node_id,
                title,
                text,
                summary,
                facts,
                relations,
                highlights,
                evidence,
                source,
                agent_id,
                reason,
                confidence,
                importance,
                project,
                parent_node,
                node_type,
            } => self
                .ingest_text(
                    node_id,
                    title,
                    &text,
                    summary,
                    facts,
                    relations,
                    highlights,
                    evidence,
                    &source,
                    agent_id,
                    reason,
                    confidence,
                    importance,
                    project,
                    parent_node,
                    node_type,
                )
                .map(|version| ToolResponse::Version { version }),
            ToolAction::SyncMarkdown {
                node_id,
                path,
                markdown,
                agent_id,
                reason,
                source,
                confidence,
                importance,
                project,
                parent_node,
                node_type,
            } => self
                .sync_markdown(
                    node_id,
                    path,
                    markdown,
                    agent_id,
                    reason,
                    source,
                    confidence,
                    importance,
                    project,
                    parent_node,
                    node_type,
                )
                .map(|version| ToolResponse::Version { version }),
            ToolAction::SetNodeLinks {
                node_id,
                links,
                agent_id,
                reason,
                source,
                confidence,
                importance,
            } => self
                .set_node_links(
                    &node_id,
                    links,
                    agent_id,
                    reason,
                    source,
                    confidence,
                    importance,
                )
                .map(|version| ToolResponse::Version { version }),
            ToolAction::RollbackNode {
                node_id,
                target_version,
                confidence,
                importance,
                agent_id,
                reason,
            } => {
                let result = self.rollback_node(&node_id, &target_version, confidence, importance);
                if let (Ok(version), Some(agent)) = (&result, agent_id.as_deref()) {
                    let _ = self.storage.append_agent_action_log(&AgentActionLog {
                        timestamp: now_ts(),
                        agent_id: agent.to_string(),
                        action: "rollback_node".to_string(),
                        node_id: node_id.clone(),
                        version: version.version.clone(),
                        reason: reason.trim().to_string(),
                        source: "manual_rollback".to_string(),
                    });
                }
                result.map(|version| ToolResponse::Version { version })
            }
            ToolAction::OpenNode {
                node_id,
                markdown,
                agent_id,
            } => {
                if markdown.unwrap_or(false) {
                    self.open_markdown_node(&node_id).map(|opt| match opt {
                        Some((path, markdown, version)) => ToolResponse::Markdown {
                            node_id,
                            version,
                            path: Some(path),
                            markdown: Some(markdown),
                        },
                        None => ToolResponse::Markdown {
                            node_id,
                            version: None,
                            path: None,
                            markdown: None,
                        },
                    })
                } else if self.head(&node_id).is_none() {
                    Ok(ToolResponse::OptionalVersion { version: None })
                } else {
                    let agent = agent_id.unwrap_or_else(|| "agent-unknown".to_string());
                    match self.log_access(&agent, &node_id) {
                        Ok(_) => self
                            .head(&node_id)
                            .cloned()
                            .map_or(Ok(None), |head| self.get_version(&head).map(Some))
                            .map(|version| ToolResponse::OptionalVersion { version }),
                        Err(err) => Err(err),
                    }
                }
            }
            ToolAction::NodeHistory { node_id, limit } => self
                .node_history(&node_id, limit.unwrap_or(30))
                .map(|items| ToolResponse::History { node_id, items }),
            // ── User habits / behavior patterns ─────────────────────────────
            ToolAction::RecordUserHabit {
                topic,
                summary,
                details,
                agent_id,
                source,
            } => {
                use crate::core::UserHabitEnv;
                self.storage
                    .append_user_habit(&UserHabitEnv {
                        topic,
                        summary,
                        details,
                        timestamp: now_ts(),
                        agent_id,
                        source,
                    })
                    .map(|_| ToolResponse::NodeList { nodes: Vec::new() })
            }
            ToolAction::RecordBehaviorPattern {
                pattern_key,
                summary,
                details,
                applicable_plan,
                agent_id,
                source,
            } => {
                use crate::core::BehaviorPatternRecord;
                self.storage
                    .append_behavior_pattern(&BehaviorPatternRecord {
                        pattern_key,
                        summary,
                        details,
                        applicable_plan,
                        timestamp: now_ts(),
                        agent_id,
                        source,
                    })
                    .map(|_| ToolResponse::NodeList { nodes: Vec::new() })
            }
            // ── Episodic memory ──────────────────────────────────────────────
            ToolAction::RecordEpisodic {
                scene_type,
                summary,
                raw_conversation_id,
                importance,
                core_knowledge_nodes,
                tags,
                agent_id,
            } => {
                let id = {
                    let ts = now_ts();
                    // Include summary content (not just its length) to reduce collision risk
                    // when multiple episodes are recorded at the same millisecond.
                    let hash_input = format!("{ts}:{scene_type}:{}", &summary[..summary.len().min(64)]);
                    let h = blake3::hash(hash_input.as_bytes()).to_hex();
                    format!("ep_{ts}_{}", &h[..8])
                };
                let record = EpisodicMemoryRecord {
                    id,
                    timestamp: now_ts(),
                    scene_type,
                    summary,
                    raw_conversation_id,
                    importance: importance.unwrap_or(1.0),
                    core_knowledge_nodes: core_knowledge_nodes.unwrap_or_default(),
                    tags: tags.unwrap_or_default(),
                    agent_id,
                };
                self.storage
                    .append_episodic_memory(&record)
                    .and_then(|_| {
                        self.rebuild_episodic_bm25()?;
                        Ok(ToolResponse::EpisodicResults {
                            memories: vec![record],
                        })
                    })
            }
            ToolAction::SearchEpisodic { query, limit } => {
                let limit = limit.unwrap_or(10);
                let hits = search_bm25_simple(&query, limit, &self.episodic_bm25);
                self.storage
                    .list_episodic_memories(200, None)
                    .map(|memories| {
                        let hit_ids: std::collections::HashSet<&str> =
                            hits.iter().map(|h| h.node_id.as_str()).collect();
                        let mut results: Vec<EpisodicMemoryRecord> = memories
                            .into_iter()
                            .filter(|m| hit_ids.contains(m.id.as_str()))
                            .collect();
                        // Keep ordering by BM25 score
                        results.sort_by(|a, b| {
                            let sa = hits.iter().find(|h| h.node_id == a.id).map(|h| h.score).unwrap_or(0.0);
                            let sb = hits.iter().find(|h| h.node_id == b.id).map(|h| h.score).unwrap_or(0.0);
                            sb.total_cmp(&sa).then_with(|| b.timestamp.cmp(&a.timestamp))
                        });
                        if results.len() > limit {
                            results.truncate(limit);
                        }
                        ToolResponse::EpisodicResults { memories: results }
                    })
            }
            ToolAction::ListEpisodic { limit, before_ts } => self
                .storage
                .list_episodic_memories(limit.unwrap_or(20), before_ts)
                .map(|memories| ToolResponse::EpisodicResults { memories }),
            // ── User preferences ─────────────────────────────────────────────
            ToolAction::ReadUserPreferences {} => self
                .storage
                .read_user_preferences()
                .map(|content| ToolResponse::UserPreferences { content }),
            ToolAction::UpdateUserPreferences { content } => self
                .storage
                .write_user_preferences(&content)
                .map(|_| ToolResponse::UserPreferences { content }),
            // ── Agent skills ─────────────────────────────────────────────────
            ToolAction::UpsertSkill {
                skill_id,
                title,
                content,
                tags,
            } => {
                let ts = now_ts();
                let tags = tags.unwrap_or_default();
                self.storage
                    .upsert_skill(&skill_id, &title, &content, &tags, ts)
                    .and_then(|_| {
                        self.rebuild_skills_bm25()?;
                        Ok(ToolResponse::SkillResult {
                            skill_id,
                            title,
                            content,
                            tags,
                            updated_at: ts,
                        })
                    })
            }
            ToolAction::SearchSkills { query, limit } => {
                let limit = limit.unwrap_or(10);
                let hits = search_bm25_simple(&query, limit, &self.skills_bm25);
                self.storage.list_skills().map(|skills| {
                    let mut results: Vec<SkillSearchHit> = hits
                        .iter()
                        .filter_map(|h| {
                            skills.iter().find(|s| s.id == h.node_id).map(|s| SkillSearchHit {
                                skill_id: s.id.clone(),
                                title: s.title.clone(),
                                score: h.score,
                            })
                        })
                        .collect();
                    results.sort_by(|a, b| b.score.total_cmp(&a.score).then_with(|| a.skill_id.cmp(&b.skill_id)));
                    if results.len() > limit {
                        results.truncate(limit);
                    }
                    ToolResponse::SkillResults { results }
                })
            }
            ToolAction::ReadSkill { skill_id } => {
                self.storage.read_skill(&skill_id).map(|opt| match opt {
                    Some(s) => ToolResponse::SkillResult {
                        skill_id: s.id,
                        title: s.title,
                        content: s.content,
                        tags: s.tags,
                        updated_at: s.updated_at,
                    },
                    None => ToolResponse::Error {
                        message: format!("skill {skill_id} not found"),
                    },
                })
            }
            // ── Project management ────────────────────────────────────────────
            ToolAction::CreateProject {
                project_id,
                name,
                description,
                owner,
                tags,
            } => {
                let ts = now_ts();
                let record = ProjectRecord {
                    project_id: project_id.clone(),
                    name,
                    description,
                    created_at: ts,
                    updated_at: ts,
                    owner,
                    tags: tags.unwrap_or_default(),
                };
                self.storage
                    .upsert_project_record(&record)
                    .map(|_| ToolResponse::ProjectResult { project: record })
            }
            ToolAction::ListProjects {} => self
                .storage
                .list_project_records()
                .map(|projects| ToolResponse::ProjectList { projects }),
            ToolAction::GetProject { project_id } => {
                self.storage.read_project_record(&project_id).map(|opt| {
                    match opt {
                        Some(project) => ToolResponse::ProjectResult { project },
                        None => ToolResponse::Error {
                            message: format!("project {project_id} not found"),
                        },
                    }
                })
            }
            ToolAction::ListProjectNodes { project_id } => {
                let mut nodes =
                    self.storage.list_project_nodes(&project_id, &self.node_project_index);
                nodes.sort();
                Ok(ToolResponse::ProjectNodes { project_id, nodes })
            }
        };

        result.unwrap_or_else(|err| ToolResponse::Error {
            message: err.to_string(),
        })
    }

    pub fn execute_action_json(&mut self, payload: &str) -> String {
        match serde_json::from_str::<ToolAction>(payload) {
            Ok(action) => serde_json::to_string(&self.execute_action(action)).unwrap_or_else(|e| {
                format!(r#"{{"kind":"error","message":"serialization error: {e}"}}"#)
            }),
            Err(err) => serde_json::to_string(&ToolResponse::Error {
                message: format!("invalid action payload: {err}"),
            })
            .unwrap_or_else(|e| {
                format!(r#"{{"kind":"error","message":"serialization error: {e}"}}"#)
            }),
        }
    }

    pub fn snapshot(&self) -> IndexSnapshot {
        IndexSnapshot {
            heads: self.heads.clone(),
            nodes: self.nodes.clone(),
        }
    }

    pub fn get_access_stats(&self, node_id: &str) -> Option<&AccessStats> {
        self.access_state.get(node_id)
    }

    fn rebuild_index(&mut self) -> MemoryResult<()> {
        self.graph_index = GraphIndex::build(&self.storage, &self.heads)?;
        self.keyword_index = build_keyword_index(&self.storage, &self.heads)?;
        self.bm25_index = build_bm25_index(&self.storage, &self.heads)?;
        self.vector_index = build_vector_index(
            &self.storage,
            &self.heads,
            self.retrieval_config.vector_dim,
        )?;
        self.rebuild_episodic_bm25()?;
        self.rebuild_skills_bm25()?;
        Ok(())
    }

    fn rebuild_episodic_bm25(&mut self) -> MemoryResult<()> {
        let memories = self.storage.list_episodic_memories(usize::MAX, None)?;
        let mut postings: HashMap<String, HashMap<String, f32>> = HashMap::new();
        let mut doc_len: HashMap<String, f32> = HashMap::new();
        let mut df: HashMap<String, usize> = HashMap::new();

        for mem in &memories {
            let text = format!(
                "{} {} {} {}",
                mem.scene_type,
                mem.summary,
                mem.tags.join(" "),
                mem.core_knowledge_nodes.join(" ")
            );
            let tokens = tokenize(&text);
            let len = tokens.len() as f32;
            doc_len.insert(mem.id.clone(), len);
            for token in &tokens {
                *postings
                    .entry(token.clone())
                    .or_default()
                    .entry(mem.id.clone())
                    .or_insert(0.0) += 1.0;
            }
            let seen: std::collections::HashSet<&str> = tokens.iter().map(|t| t.as_str()).collect();
            for token in seen {
                *df.entry(token.to_string()).or_insert(0) += 1;
            }
        }

        let avg_len = if memories.is_empty() {
            1.0
        } else {
            doc_len.values().sum::<f32>() / memories.len() as f32
        };

        self.episodic_bm25 = Bm25Index {
            postings,
            doc_len,
            avg_len,
            doc_count: memories.len(),
            df,
        };
        Ok(())
    }

    fn rebuild_skills_bm25(&mut self) -> MemoryResult<()> {
        let skills = self.storage.list_skills()?;
        let mut postings: HashMap<String, HashMap<String, f32>> = HashMap::new();
        let mut doc_len: HashMap<String, f32> = HashMap::new();
        let mut df: HashMap<String, usize> = HashMap::new();

        for skill in &skills {
            let text = format!(
                "{} {} {}",
                skill.title,
                skill.tags.join(" "),
                skill.content
            );
            let tokens = tokenize(&text);
            let len = tokens.len() as f32;
            doc_len.insert(skill.id.clone(), len);
            for token in &tokens {
                *postings
                    .entry(token.clone())
                    .or_default()
                    .entry(skill.id.clone())
                    .or_insert(0.0) += 1.0;
            }
            let seen: std::collections::HashSet<&str> = tokens.iter().map(|t| t.as_str()).collect();
            for token in seen {
                *df.entry(token.to_string()).or_insert(0) += 1;
            }
        }

        let avg_len = if skills.is_empty() {
            1.0
        } else {
            doc_len.values().sum::<f32>() / skills.len() as f32
        };

        self.skills_bm25 = Bm25Index {
            postings,
            doc_len,
            avg_len,
            doc_count: skills.len(),
            df,
        };
        Ok(())
    }

    fn sync_markdown_for_version(
        &mut self,
        node_id: &str,
        version: &NodeVersion,
    ) -> MemoryResult<()> {
        let project = version.content.project.as_deref();
        // Keep the node-project index up to date.
        if let Some(proj) = project {
            let changed = self
                .node_project_index
                .get(node_id)
                .map(|p| p != proj)
                .unwrap_or(true);
            if changed {
                self.node_project_index.insert(node_id.to_string(), proj.to_string());
                self.storage.persist_node_project_index(&self.node_project_index)?;
            }
        }
        let markdown = render_node_markdown(node_id, version);
        let _ = self.storage.write_markdown_node(node_id, &markdown, project)?;
        Ok(())
    }

    fn ensure_markdown_projection(&mut self) -> MemoryResult<()> {
        for (node_id, version_id) in &self.heads.clone() {
            let project = self.node_project_index.get(node_id).map(|s| s.as_str());
            if self.storage.read_markdown_node(node_id, project)?.is_some() {
                continue;
            }
            let version = self.storage.read_object(version_id)?;
            // Use project from content if available, fall back to index.
            let proj = version
                .content
                .project
                .as_deref()
                .or(project);
            let markdown = render_node_markdown(node_id, &version);
            self.storage.write_markdown_node(node_id, &markdown, proj)?;
        }
        Ok(())
    }

    fn normalize_patch_with_head(
        &self,
        node_id: &str,
        patch: NodePatch,
    ) -> MemoryResult<NodePatch> {
        let head_id = self
            .head(node_id)
            .ok_or_else(|| MemoryError::NotFound(format!("node {node_id} not found")))?;
        let head = self.get_version(head_id)?;
        Ok(normalize_patch(
            patch,
            &head.content.title,
            &head.content.body,
        ))
    }

    fn validate_agent_markdown_request(
        &self,
        markdown: &str,
        confidence: f32,
        agent_id: &str,
        reason: &str,
        source: &str,
    ) -> MemoryResult<()> {
        if markdown.is_empty() {
            return Err(MemoryError::Invalid(
                "markdown content cannot be empty".to_string(),
            ));
        }
        if markdown.len() > self.agent_governance.max_markdown_bytes {
            return Err(MemoryError::Invalid(format!(
                "markdown exceeds max bytes limit ({})",
                self.agent_governance.max_markdown_bytes
            )));
        }
        if confidence < self.agent_governance.min_confidence {
            return Err(MemoryError::Invalid(format!(
                "confidence {} is below governance minimum {}",
                confidence, self.agent_governance.min_confidence
            )));
        }
        if agent_id.trim().is_empty() {
            return Err(MemoryError::Invalid("agent_id is required".to_string()));
        }
        if reason.trim().chars().count() < self.agent_governance.min_reason_chars {
            return Err(MemoryError::Invalid(format!(
                "reason must be at least {} characters",
                self.agent_governance.min_reason_chars
            )));
        }
        if source.trim().is_empty() {
            return Err(MemoryError::Invalid("source is required".to_string()));
        }
        Ok(())
    }

    fn validate_agent_governed_request(
        &self,
        confidence: f32,
        agent_id: &str,
        reason: &str,
        source: &str,
    ) -> MemoryResult<()> {
        if confidence < self.agent_governance.min_confidence {
            return Err(MemoryError::Invalid(format!(
                "confidence {} is below governance minimum {}",
                confidence, self.agent_governance.min_confidence
            )));
        }
        if agent_id.trim().is_empty() {
            return Err(MemoryError::Invalid("agent_id is required".to_string()));
        }
        if reason.trim().chars().count() < self.agent_governance.min_reason_chars {
            return Err(MemoryError::Invalid(format!(
                "reason must be at least {} characters",
                self.agent_governance.min_reason_chars
            )));
        }
        if source.trim().is_empty() {
            return Err(MemoryError::Invalid("source is required".to_string()));
        }
        Ok(())
    }

    fn auto_wikilink_markdown_body(
        &self,
        node_id: &str,
        body: &str,
    ) -> MemoryResult<(String, Vec<Link>)> {
        let mut out = body.to_string();
        let mut links = Vec::new();
        let mut linked_targets: HashSet<String> = HashSet::new();
        let mut token_to_targets: HashMap<String, HashSet<String>> = HashMap::new();
        let mut candidates: Vec<(String, Vec<String>, Vec<String>)> = Vec::new();
        for (target, version_id) in &self.heads {
            if target == node_id {
                continue;
            }
            let mut replace_keywords = vec![target.clone()];
            let mut alias_keywords = Vec::new();
            let version = self.storage.read_object(version_id)?;
            let title = version.content.title.trim();
            if title.chars().count() >= 2 {
                replace_keywords.push(title.to_string());
            }
            for alias in extract_node_id_alias_tokens(target) {
                token_to_targets
                    .entry(alias.to_lowercase())
                    .or_default()
                    .insert(target.clone());
                alias_keywords.push(alias);
            }
            for alias in extract_structured_alias_keywords(&version.content.structured_data) {
                token_to_targets
                    .entry(alias.to_lowercase())
                    .or_default()
                    .insert(target.clone());
                alias_keywords.push(alias);
            }
            candidates.push((target.clone(), replace_keywords, alias_keywords));
        }

        for (target, replace_keywords, mut alias_keywords) in candidates {
            if linked_targets.contains(&target) {
                continue;
            }
            if out.contains(&format!("[[{target}]]")) {
                linked_targets.insert(target.clone());
                links.push(Link {
                    target: target.clone(),
                    label: Some("wikilink_present".to_string()),
                    weight: 0.8,
                });
                continue;
            }
            alias_keywords.retain(|k| {
                token_to_targets
                    .get(&k.to_lowercase())
                    .map(|set| set.len() == 1)
                    .unwrap_or(false)
            });
            alias_keywords.sort_by(|a, b| {
                b.chars()
                    .count()
                    .cmp(&a.chars().count())
                    .then_with(|| a.cmp(b))
            });

            let mut linked = false;
            for keyword in &replace_keywords {
                if replace_keyword_with_wikilink_once(&mut out, keyword, &target) {
                    linked = true;
                    break;
                }
            }
            if !linked {
                for keyword in &alias_keywords {
                    let precise =
                        keyword.contains('/') || keyword.contains('-') || keyword.contains('.') || keyword.contains('_');
                    if !precise {
                        continue;
                    }
                    if replace_keyword_with_wikilink_once(&mut out, keyword, &target) {
                        linked = true;
                        break;
                    }
                }
            }
            if !linked {
                for keyword in &replace_keywords {
                    if contains_keyword_with_boundary(&out, keyword) {
                        linked = true;
                        break;
                    }
                }
            }
            if !linked {
                for keyword in &alias_keywords {
                    if contains_keyword_with_boundary(&out, keyword) {
                        linked = true;
                        break;
                    }
                }
            }
            if linked {
                linked_targets.insert(target.clone());
                links.push(Link {
                    target,
                    label: Some("auto_keyword".to_string()),
                    weight: 0.75,
                });
            }
        }
        Ok((out, links))
    }
}

fn tokenize(input: &str) -> Vec<String> {
    let mut tokens: Vec<String> = input
        .split(|c: char| !c.is_alphanumeric() && c != '_')
        .map(|s| s.trim().to_lowercase())
        .filter(|s| s.len() >= 2)
        .collect();

    let mut cjk_buf = String::new();
    for ch in input.chars() {
        if is_cjk(ch) {
            cjk_buf.push(ch);
            continue;
        }
        flush_cjk_tokens(&mut tokens, &mut cjk_buf);
    }
    flush_cjk_tokens(&mut tokens, &mut cjk_buf);

    tokens.sort();
    tokens.dedup();
    tokens
}

fn ensure_summary(summary: &str, title: &str, body: &str) -> String {
    let trimmed = summary.trim();
    let length = trimmed.chars().count();
    if (8..=140).contains(&length) {
        return trimmed.to_string();
    }
    derive_summary_for_text(title, body)
}

fn derive_summary_for_text(title: &str, body: &str) -> String {
    for line in body.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let normalized = trimmed.split_whitespace().collect::<Vec<_>>().join(" ");
        let compact: String = normalized.chars().take(140).collect();
        if compact.chars().count() >= 8 {
            return compact;
        }
    }
    let title_trimmed = title.trim();
    if title_trimmed.chars().count() >= 8 {
        return title_trimmed.chars().take(140).collect();
    }
    format!("{title_trimmed} summary")
}

fn normalize_fact_key(key: &str) -> String {
    let mut out = String::new();
    let mut prev_underscore = false;
    for ch in key.trim().chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            prev_underscore = false;
        } else if ch == ' ' || ch == '-' || ch == '_' {
            if !prev_underscore && !out.is_empty() {
                out.push('_');
                prev_underscore = true;
            }
        }
    }
    while out.ends_with('_') {
        out.pop();
    }
    out
}

fn insert_fact(structured: &mut BTreeMap<String, String>, key: &str, value: &str) {
    let base = format!("fact.{key}");
    if !structured.contains_key(&base) {
        structured.insert(base, value.to_string());
        return;
    }
    let mut i = 2;
    loop {
        let candidate = format!("{base}.{i}");
        if !structured.contains_key(&candidate) {
            structured.insert(candidate, value.to_string());
            break;
        }
        i += 1;
    }
}

fn insert_evidence(structured: &mut BTreeMap<String, String>, evidence: &str) {
    let mut i = 1;
    loop {
        let key = format!("evidence.{:02}", i);
        if !structured.contains_key(&key) {
            structured.insert(key, evidence.to_string());
            break;
        }
        i += 1;
    }
}

fn derive_node_id(title: &str) -> String {
    let mut out = String::new();
    let mut prev_underscore = false;
    for ch in title.trim().chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            prev_underscore = false;
        } else if ch == ' ' || ch == '-' || ch == '_' {
            if !prev_underscore && !out.is_empty() {
                out.push('_');
                prev_underscore = true;
            }
        }
    }
    while out.ends_with('_') {
        out.pop();
    }
    if out.is_empty() {
        "untitled".to_string()
    } else {
        out
    }
}

fn extract_inline_facts(text: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let (left, right) = if let Some(pair) = trimmed.split_once(':') {
            pair
        } else if let Some(pair) = trimmed.split_once('=') {
            pair
        } else {
            continue;
        };
        let key = left.trim();
        let value = right.trim();
        if key.len() < 2 || key.len() > 40 {
            continue;
        }
        if value.len() < 2 || value.len() > 160 {
            continue;
        }
        out.push((key.to_string(), value.to_string()));
        if out.len() >= 12 {
            break;
        }
    }
    out
}

fn normalize_content(mut content: NodeContent) -> NodeContent {
    content.title = content.title.trim().to_string();
    if content.title.is_empty() {
        content.title = "Untitled".to_string();
    }

    content.body = content.body.trim().to_string();
    if content.body.is_empty() {
        content.body = format!("# {}", content.title);
    }
    content.summary = ensure_summary(&content.summary, &content.title, &content.body);
    content.highlights = normalize_highlights(content.highlights);
    content.links = normalize_links(content.links);

    let mut cleaned = BTreeMap::new();
    for (k, v) in content.structured_data {
        let key = k.trim();
        let value = v.trim();
        if key.is_empty() || value.is_empty() {
            continue;
        }
        let normalized_key = if let Some(rest) = key.strip_prefix("fact.") {
            let suffix = normalize_fact_key(rest);
            if suffix.is_empty() {
                continue;
            }
            format!("fact.{suffix}")
        } else {
            key.to_string()
        };
        cleaned.insert(normalized_key, value.to_string());
    }
    content.structured_data = cleaned;

    content
}

fn normalize_patch(mut patch: NodePatch, base_title: &str, base_body: &str) -> NodePatch {
    if let Some(title) = patch.title {
        let trimmed = title.trim().to_string();
        patch.title = Some(if trimmed.is_empty() {
            "Untitled".to_string()
        } else {
            trimmed
        });
    }
    if let Some(body) = patch.body {
        let trimmed = body.trim().to_string();
        patch.body = Some(trimmed);
    }
    if let Some(summary) = patch.summary {
        let title = patch.title.as_deref().unwrap_or(base_title);
        let body = patch.body.as_deref().unwrap_or(base_body);
        patch.summary = Some(ensure_summary(&summary, title, body));
    } else if patch.body.is_some() {
        let title = patch.title.as_deref().unwrap_or(base_title);
        let body = patch.body.as_deref().unwrap_or(base_body);
        patch.summary = Some(ensure_summary("", title, body));
    }

    if !patch.add_links.is_empty() {
        patch.add_links = normalize_links(patch.add_links);
    }
    if !patch.add_highlights.is_empty() {
        patch.add_highlights = normalize_highlights(patch.add_highlights);
    }

    patch
}

fn normalize_highlights(items: Vec<String>) -> Vec<String> {
    let mut out = Vec::new();
    for item in items {
        let trimmed = item.trim();
        if trimmed.is_empty() {
            continue;
        }
        if out.iter().any(|h| h == trimmed) {
            continue;
        }
        out.push(trimmed.to_string());
        if out.len() >= 12 {
            break;
        }
    }
    out
}

fn normalize_links(links: Vec<Link>) -> Vec<Link> {
    let mut map: HashMap<(String, String), f32> = HashMap::new();
    for link in links {
        let target = link.target.trim();
        if target.is_empty() {
            continue;
        }
        let label = link.label.unwrap_or_else(|| "related".to_string());
        let key = (target.to_string(), label.clone());
        let entry = map.entry(key).or_insert(link.weight);
        if link.weight > *entry {
            *entry = link.weight;
        }
    }

    let mut out = Vec::new();
    for ((target, label), weight) in map {
        out.push(Link {
            target,
            label: Some(label),
            weight,
        });
    }
    out.sort_by(|a, b| a.target.cmp(&b.target).then_with(|| a.label.cmp(&b.label)));
    out
}

fn build_keyword_index(
    storage: &FileStorage,
    heads: &HashMap<String, String>,
) -> MemoryResult<HashMap<String, HashMap<String, f32>>> {
    let mut index: HashMap<String, HashMap<String, f32>> = HashMap::new();

    for (node_id, version_id) in heads {
        let version = storage.read_object(version_id)?;
        index_content_tokens(&mut index, node_id, &version.content);
    }
    Ok(index)
}

fn index_content_tokens(
    index: &mut HashMap<String, HashMap<String, f32>>,
    node_id: &str,
    content: &NodeContent,
) {
    add_text_tokens(index, node_id, &content.title, 5.0);
    add_text_tokens(index, node_id, &content.summary, 4.0);
    add_text_tokens(index, node_id, &content.body, 2.0);
    add_text_tokens(index, node_id, &content.highlights.join(" "), 2.5);

    for (k, v) in &content.structured_data {
        add_text_tokens(index, node_id, k, 1.0);
        add_text_tokens(index, node_id, v, 1.5);
    }
}

fn add_text_tokens(
    index: &mut HashMap<String, HashMap<String, f32>>,
    node_id: &str,
    text: &str,
    weight: f32,
) {
    for token in tokenize(text) {
        let entry = index.entry(token).or_default();
        *entry.entry(node_id.to_string()).or_insert(0.0) += weight;
    }
}

fn tokenize_with_counts(input: &str) -> HashMap<String, f32> {
    let mut counts: HashMap<String, f32> = HashMap::new();
    let mut ascii_buf = String::new();
    let mut cjk_buf = String::new();

    for ch in input.chars() {
        if is_cjk(ch) {
            if !ascii_buf.is_empty() {
                push_ascii_token(&mut counts, &ascii_buf);
                ascii_buf.clear();
            }
            cjk_buf.push(ch);
            continue;
        }

        if ch.is_alphanumeric() || ch == '_' {
            if !cjk_buf.is_empty() {
                flush_cjk_counts(&mut counts, &mut cjk_buf);
            }
            ascii_buf.push(ch);
            continue;
        }

        if !ascii_buf.is_empty() {
            push_ascii_token(&mut counts, &ascii_buf);
            ascii_buf.clear();
        }
        if !cjk_buf.is_empty() {
            flush_cjk_counts(&mut counts, &mut cjk_buf);
        }
    }

    if !ascii_buf.is_empty() {
        push_ascii_token(&mut counts, &ascii_buf);
    }
    if !cjk_buf.is_empty() {
        flush_cjk_counts(&mut counts, &mut cjk_buf);
    }

    counts
}

fn push_ascii_token(counts: &mut HashMap<String, f32>, token: &str) {
    let token = token.trim().to_lowercase();
    if token.len() < 2 {
        return;
    }
    *counts.entry(token).or_insert(0.0) += 1.0;
}

fn flush_cjk_counts(counts: &mut HashMap<String, f32>, buf: &mut String) {
    let len = buf.chars().count();
    if len < 2 {
        buf.clear();
        return;
    }

    *counts.entry(buf.clone()).or_insert(0.0) += 1.0;
    let chars: Vec<char> = buf.chars().collect();
    for window in chars.windows(2) {
        let mut gram = String::new();
        for ch in window {
            gram.push(*ch);
        }
        *counts.entry(gram).or_insert(0.0) += 1.0;
    }
    buf.clear();
}

fn collect_weighted_tokens(content: &NodeContent) -> HashMap<String, f32> {
    let mut counts: HashMap<String, f32> = HashMap::new();
    add_text_counts(&mut counts, &content.title, 4.5);
    add_text_counts(&mut counts, &content.summary, 3.5);
    add_text_counts(&mut counts, &content.body, 2.0);
    add_text_counts(&mut counts, &content.highlights.join(" "), 2.5);
    for (k, v) in &content.structured_data {
        add_text_counts(&mut counts, k, 1.0);
        add_text_counts(&mut counts, v, 1.5);
    }
    counts
}

fn add_text_counts(counts: &mut HashMap<String, f32>, text: &str, weight: f32) {
    for (token, count) in tokenize_with_counts(text) {
        *counts.entry(token).or_insert(0.0) += count * weight;
    }
}

fn build_bm25_index(storage: &FileStorage, heads: &HashMap<String, String>) -> MemoryResult<Bm25Index> {
    let mut postings: HashMap<String, HashMap<String, f32>> = HashMap::new();
    let mut doc_len: HashMap<String, f32> = HashMap::new();
    let mut total_len = 0.0;

    for (node_id, version_id) in heads {
        let version = storage.read_object(version_id)?;
        let counts = collect_weighted_tokens(&version.content);
        if counts.is_empty() {
            continue;
        }
        let length: f32 = counts.values().sum();
        doc_len.insert(node_id.clone(), length.max(1.0));
        total_len += length.max(1.0);
        for (token, tf) in counts {
            postings
                .entry(token)
                .or_default()
                .insert(node_id.clone(), tf);
        }
    }

    let mut df: HashMap<String, usize> = HashMap::new();
    for (token, posting) in &postings {
        df.insert(token.clone(), posting.len());
    }

    let doc_count = doc_len.len();
    let avg_len = if doc_count == 0 {
        0.0
    } else {
        total_len / (doc_count as f32)
    };

    Ok(Bm25Index {
        postings,
        doc_len,
        avg_len,
        doc_count,
        df,
    })
}

fn search_bm25(
    query: &str,
    limit: usize,
    index: &Bm25Index,
    config: &RetrievalConfig,
) -> Vec<SearchHit> {
    search_bm25_with_params(query, limit, index, config.bm25_k1, config.bm25_b)
}

/// BM25 search using default k1/b parameters, suitable for episodic and skill indexes.
fn search_bm25_simple(query: &str, limit: usize, index: &Bm25Index) -> Vec<SearchHit> {
    search_bm25_with_params(query, limit, index, 1.4, 0.75)
}

fn search_bm25_with_params(
    query: &str,
    limit: usize,
    index: &Bm25Index,
    k1: f32,
    b: f32,
) -> Vec<SearchHit> {
    if limit == 0 || index.doc_count == 0 {
        return Vec::new();
    }
    let query_counts = tokenize_with_counts(query);
    if query_counts.is_empty() {
        return Vec::new();
    }

    let mut scores: HashMap<String, f32> = HashMap::new();
    let avg_len = if index.avg_len > 0.0 { index.avg_len } else { 1.0 };
    let n = index.doc_count as f32;

    for (token, qtf) in query_counts {
        let posting = match index.postings.get(&token) {
            Some(p) => p,
            None => continue,
        };
        let df = *index.df.get(&token).unwrap_or(&0) as f32;
        let idf = ((n - df + 0.5) / (df + 0.5) + 1.0).ln();
        for (node_id, tf) in posting {
            let doc_len = index.doc_len.get(node_id).copied().unwrap_or(1.0);
            let denom = tf + k1 * (1.0 - b + b * (doc_len / avg_len));
            let score = idf * (tf * (k1 + 1.0) / denom.max(0.0001));
            *scores.entry(node_id.clone()).or_insert(0.0) += score * qtf;
        }
    }

    let mut hits: Vec<SearchHit> = scores
        .into_iter()
        .map(|(node_id, score)| SearchHit { node_id, score })
        .collect();
    hits.sort_by(|a, b| b.score.total_cmp(&a.score).then_with(|| a.node_id.cmp(&b.node_id)));
    if hits.len() > limit {
        hits.truncate(limit);
    }
    hits
}

fn build_vector_index(
    storage: &FileStorage,
    heads: &HashMap<String, String>,
    dim: usize,
) -> MemoryResult<VectorIndex> {
    let mut index = VectorIndex::new(dim);
    let cache = storage.load_embedding_cache().unwrap_or_default();
    let client = EmbeddingClient::from_env();
    let mut expected_dim: Option<usize> = None;

    if let Some(client) = &client {
        let probe = client.embed("mempedia embedding probe")?;
        if !probe.is_empty() {
            expected_dim = Some(probe.len());
            index.dim = probe.len();
        }
    }

    let mut updated_cache = EmbeddingCache {
        vectors: HashMap::new(),
    };

    for (node_id, version_id) in heads {
        if let Some(cached) = cache.vectors.get(node_id) {
            if cached.version == *version_id && cached.dim > 0 {
                if let Some(expected) = expected_dim {
                    if cached.dim != expected {
                        // Skip stale cache from a different embedding dimension.
                        continue;
                    }
                } else if index.dim != cached.dim {
                    index.dim = cached.dim;
                }
                index.vectors.insert(node_id.clone(), cached.vector.clone());
                updated_cache
                    .vectors
                    .insert(node_id.clone(), cached.clone());
                continue;
            }
        }

        let version = storage.read_object(version_id)?;
        let text = build_embedding_text(&version.content);
        let vector = if let Some(client) = &client {
            client.embed(&text)?
        } else {
            let counts = collect_weighted_tokens(&version.content);
            embed_counts(&counts, index.dim)
        };

        if vector.is_empty() {
            continue;
        }
        if let Some(expected) = expected_dim {
            if vector.len() != expected {
                return Err(MemoryError::Invalid(format!(
                    "embedding dimension mismatch (expected {expected}, got {})",
                    vector.len()
                )));
            }
        } else if index.dim != vector.len() {
            index.dim = vector.len();
        }
        index.vectors.insert(node_id.clone(), vector.clone());
        updated_cache.vectors.insert(
            node_id.clone(),
            CachedVector {
                version: version_id.clone(),
                dim: vector.len(),
                vector,
            },
        );
    }

    if !updated_cache.vectors.is_empty() {
        storage.persist_embedding_cache(&updated_cache)?;
    }

    Ok(index)
}

fn search_vector(query: &str, limit: usize, index: &VectorIndex) -> Vec<SearchHit> {
    if limit == 0 || index.vectors.is_empty() {
        return Vec::new();
    }
    let counts = tokenize_with_counts(query);
    if counts.is_empty() {
        return Vec::new();
    }
    let query_vec = embed_counts(&counts, index.dim);
    if query_vec.is_empty() {
        return Vec::new();
    }

    let mut hits = Vec::new();
    for (node_id, vec) in &index.vectors {
        let score = cosine_similarity(&query_vec, vec);
        if score > 0.0 {
            hits.push(SearchHit {
                node_id: node_id.clone(),
                score,
            });
        }
    }
    hits.sort_by(|a, b| b.score.total_cmp(&a.score).then_with(|| a.node_id.cmp(&b.node_id)));
    if hits.len() > limit {
        hits.truncate(limit);
    }
    hits
}

fn embed_counts(counts: &HashMap<String, f32>, dim: usize) -> Vec<f32> {
    if dim == 0 {
        return Vec::new();
    }
    let mut vec = vec![0.0f32; dim];
    for (token, weight) in counts {
        let (idx, sign) = hash_token(token, dim);
        vec[idx] += sign * weight.sqrt();
    }
    normalize_vector(&mut vec);
    vec
}

fn hash_token(token: &str, dim: usize) -> (usize, f32) {
    let hash = blake3::hash(token.as_bytes());
    let bytes = hash.as_bytes();
    let mut buf = [0u8; 8];
    buf.copy_from_slice(&bytes[0..8]);
    let value = u64::from_le_bytes(buf);
    let idx = (value % (dim as u64)) as usize;
    let sign = if (value & 1) == 0 { 1.0 } else { -1.0 };
    (idx, sign)
}

fn normalize_vector(vec: &mut [f32]) {
    let mut norm = 0.0;
    for v in vec.iter() {
        norm += v * v;
    }
    if norm <= 0.0 {
        return;
    }
    let inv = norm.sqrt().recip();
    for v in vec.iter_mut() {
        *v *= inv;
    }
}

fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() {
        return 0.0;
    }
    let mut dot = 0.0;
    for i in 0..a.len() {
        dot += a[i] * b[i];
    }
    dot
}

fn build_embedding_text(content: &NodeContent) -> String {
    let mut parts = Vec::new();
    if !content.title.trim().is_empty() {
        parts.push(content.title.trim().to_string());
    }
    if !content.summary.trim().is_empty() {
        parts.push(content.summary.trim().to_string());
    }
    if !content.body.trim().is_empty() {
        parts.push(content.body.trim().to_string());
    }
    if !content.highlights.is_empty() {
        parts.push(content.highlights.join(" "));
    }
    if !content.structured_data.is_empty() {
        let mut facts = Vec::new();
        for (k, v) in &content.structured_data {
            if k.starts_with("fact.") || k.starts_with("evidence.") {
                facts.push(format!("{k}: {v}"));
            }
        }
        if !facts.is_empty() {
            parts.push(facts.join("\n"));
        }
    }
    parts.join("\n\n")
}

fn rrf_fuse(
    lists: Vec<(Vec<SearchHit>, f32)>,
    k: usize,
    limit: usize,
) -> Vec<SearchHit> {
    let mut scores: HashMap<String, f32> = HashMap::new();
    let denom = k.max(1) as f32;

    for (mut list, weight) in lists {
        if weight <= 0.0 || list.is_empty() {
            continue;
        }
        list.sort_by(|a, b| b.score.total_cmp(&a.score).then_with(|| a.node_id.cmp(&b.node_id)));
        for (idx, item) in list.into_iter().enumerate() {
            let rank = (idx + 1) as f32;
            let score = weight / (denom + rank);
            *scores.entry(item.node_id).or_insert(0.0) += score;
        }
    }

    let mut hits: Vec<SearchHit> = scores
        .into_iter()
        .map(|(node_id, score)| SearchHit { node_id, score })
        .collect();
    hits.sort_by(|a, b| b.score.total_cmp(&a.score).then_with(|| a.node_id.cmp(&b.node_id)));
    if hits.len() > limit {
        hits.truncate(limit);
    }
    hits
}

fn is_cjk(c: char) -> bool {
    ('\u{4E00}'..='\u{9FFF}').contains(&c)
        || ('\u{3400}'..='\u{4DBF}').contains(&c)
        || ('\u{20000}'..='\u{2A6DF}').contains(&c)
}

fn flush_cjk_tokens(tokens: &mut Vec<String>, buf: &mut String) {
    if buf.chars().count() < 2 {
        buf.clear();
        return;
    }

    tokens.push(buf.clone());
    let chars: Vec<char> = buf.chars().collect();
    for window in chars.windows(2) {
        let mut gram = String::new();
        for ch in window {
            gram.push(*ch);
        }
        tokens.push(gram);
    }
    buf.clear();
}

fn build_exploration_query(content: &NodeContent) -> String {
    let mut parts = vec![content.title.clone(), content.summary.clone()];
    parts.extend(content.highlights.clone());

    for (k, v) in &content.structured_data {
        if k.contains("keyword")
            || k.contains("topic")
            || k.contains("category")
            || k.contains("tag")
            || k.contains("inspiration")
            || k.contains("parent")
        {
            parts.push(v.clone());
        }
    }

    if parts.len() < 4 {
        let body_tokens: Vec<String> = tokenize(&content.body).into_iter().take(8).collect();
        parts.extend(body_tokens);
    }

    parts.join(" ")
}

fn upsert_candidate(
    map: &mut HashMap<String, ExploreCandidate>,
    node_id: &str,
    score: f32,
    reason: String,
) {
    match map.get_mut(node_id) {
        Some(existing) => {
            if score > existing.score {
                existing.score = score;
            }
            if !existing.reason.contains(&reason) {
                existing.reason = format!("{},{}", existing.reason, reason);
            }
        }
        None => {
            map.insert(
                node_id.to_string(),
                ExploreCandidate {
                    node_id: node_id.to_string(),
                    score,
                    reason,
                },
            );
        }
    }
}

fn overlap_ratio(left: &HashSet<String>, right: &HashSet<String>) -> f32 {
    if left.is_empty() || right.is_empty() {
        return 0.0;
    }
    let inter = left.intersection(right).count();
    if inter == 0 {
        return 0.0;
    }
    let union = left.len() + right.len() - inter;
    inter as f32 / union as f32
}

fn extract_structured_terms(
    structured_data: &std::collections::BTreeMap<String, String>,
) -> HashSet<String> {
    let mut terms = HashSet::new();
    for (k, v) in structured_data {
        let key_lc = k.to_lowercase();
        if !(key_lc.contains("tag")
            || key_lc.contains("topic")
            || key_lc.contains("category")
            || key_lc.contains("keyword")
            || key_lc.contains("domain")
            || key_lc.contains("parent")
            || key_lc.contains("scope"))
        {
            continue;
        }
        for token in tokenize(v) {
            terms.insert(token);
        }
    }
    terms
}

fn temporal_proximity_score(left_ts: u64, right_ts: u64) -> f32 {
    let delta = left_ts.abs_diff(right_ts) as f32;
    let days = delta / 86_400.0;
    1.0 / (1.0 + days)
}

fn replace_keyword_with_wikilink_once(text: &mut String, keyword: &str, target: &str) -> bool {
    let needle = keyword.trim();
    if needle.chars().count() < 2 {
        return false;
    }

    let mut cursor = 0usize;
    while let Some((start, end)) = find_keyword_span(text, needle, cursor) {
        if is_inside_existing_wikilink(text, start) {
            cursor = end;
            continue;
        }
        if !is_token_boundary(text, start, end) {
            cursor = end;
            continue;
        }
        text.replace_range(start..end, &format!("[[{target}]]"));
        return true;
    }
    false
}

fn contains_keyword_with_boundary(text: &str, keyword: &str) -> bool {
    let needle = keyword.trim();
    if needle.chars().count() < 2 {
        return false;
    }
    let mut cursor = 0usize;
    while let Some((start, end)) = find_keyword_span(text, needle, cursor) {
        if is_inside_existing_wikilink(text, start) {
            cursor = end;
            continue;
        }
        if !is_token_boundary(text, start, end) {
            cursor = end;
            continue;
        }
        return true;
    }
    false
}

fn find_keyword_span(text: &str, needle: &str, from: usize) -> Option<(usize, usize)> {
    if from >= text.len() {
        return None;
    }
    if let Some(offset) = text[from..].find(needle) {
        let start = from + offset;
        return Some((start, start + needle.len()));
    }
    if !needle.is_ascii() {
        return None;
    }
    let start = find_ascii_case_insensitive(text, needle, from)?;
    Some((start, start + needle.len()))
}

fn find_ascii_case_insensitive(text: &str, needle: &str, from: usize) -> Option<usize> {
    let hay = text.as_bytes();
    let ned = needle.as_bytes();
    if ned.is_empty() || hay.len() < ned.len() || from >= hay.len() {
        return None;
    }
    let last = hay.len() - ned.len();
    for i in from..=last {
        if hay[i..i + ned.len()].eq_ignore_ascii_case(ned) {
            return Some(i);
        }
    }
    None
}

fn extract_node_id_alias_tokens(node_id: &str) -> Vec<String> {
    const STOPWORDS: &[&str] = &[
        "github", "repo", "repos", "node", "nodes", "memory", "draft", "notes",
    ];
    let mut out = Vec::new();
    for token in node_id
        .split(|c: char| !c.is_ascii_alphanumeric())
        .map(|s| s.trim().to_lowercase())
        .filter(|s| s.len() >= 4)
    {
        if STOPWORDS.contains(&token.as_str()) {
            continue;
        }
        if token.chars().all(|c| c.is_ascii_digit()) {
            continue;
        }
        if !out.iter().any(|x| x == &token) {
            out.push(token);
        }
    }
    out
}

fn extract_structured_alias_keywords(
    structured: &std::collections::BTreeMap<String, String>,
) -> Vec<String> {
    let mut out = Vec::new();
    for (k, v) in structured {
        let key = k.to_lowercase();
        if !(key.contains("name")
            || key.contains("title")
            || key.contains("id")
            || key.contains("slug")
            || key.contains("handle")
            || key.contains("url")
            || key.contains("repo")
            || key.contains("project")
            || key.contains("topic")
            || key.contains("keyword")
            || key.contains("tag")
            || key.contains("entity"))
        {
            continue;
        }
        let value = v.trim().trim_matches('"');
        if value.is_empty() {
            continue;
        }

        let mut add_alias = |alias: &str| {
            let candidate = alias.trim().trim_matches('/');
            if candidate.chars().count() < 4 {
                return;
            }
            if !out.iter().any(|x| x == candidate) {
                out.push(candidate.to_string());
            }
        };

        if value.contains("://") {
            for alias in extract_url_aliases(value) {
                add_alias(&alias);
            }
        }

        if value.contains('/') || value.contains('-') || value.contains('_') || value.contains('.') {
            add_alias(value);
        }
    }
    out
}

fn extract_url_aliases(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let lower = text.to_lowercase();
    let start = match lower.find("://") {
        Some(idx) => idx + 3,
        None => return out,
    };
    let mut rest = &text[start..];
    if let Some(q) = rest.find('?') {
        rest = &rest[..q];
    }
    if let Some(h) = rest.find('#') {
        rest = &rest[..h];
    }
    let rest = rest.trim_matches('/');
    let mut parts = rest.split('/').filter(|p| !p.trim().is_empty());
    let host = parts.next().unwrap_or("").trim();
    let mut path_parts: Vec<String> = parts.map(|p| p.trim().trim_matches('/').to_string()).collect();
    if !host.is_empty() {
        out.push(host.to_string());
    }
    if !path_parts.is_empty() {
        let last = path_parts.last().cloned().unwrap_or_default();
        if !last.is_empty() {
            out.push(last);
        }
        if path_parts.len() >= 2 {
            let right = path_parts.pop().unwrap();
            let left = path_parts.pop().unwrap();
            if !left.is_empty() && !right.is_empty() {
                out.push(format!("{left}/{right}"));
            }
        }
    }
    out
}

fn is_inside_existing_wikilink(text: &str, start: usize) -> bool {
    let left = text[..start].rfind("[[");
    let right = text[..start].rfind("]]");
    matches!((left, right), (Some(l), Some(r)) if l > r) || matches!((left, right), (Some(_), None))
}

fn is_token_boundary(text: &str, start: usize, end: usize) -> bool {
    let prev = text[..start].chars().next_back();
    let next = text[end..].chars().next();
    let left_ok = prev.map(|c| !is_word_char(c)).unwrap_or(true);
    let right_ok = next.map(|c| !is_word_char(c)).unwrap_or(true);
    left_ok && right_ok
}

fn is_word_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_' || is_cjk(c)
}

fn now_ts() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time before unix epoch")
        .as_secs()
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::{MemoryEngine, ToolAction, ToolResponse, TraverseMode};
    use crate::core::{Link, NodeContent, NodePatch};

    fn temp_data_dir(name: &str) -> PathBuf {
        let base = std::env::temp_dir();
        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let path = base.join(format!("agent-memory-{name}-{ts}"));
        let _ = fs::create_dir_all(&path);
        path
    }

    fn sample_content(title: &str, body: &str, link_target: &str) -> NodeContent {
        let mut structured = BTreeMap::new();
        structured.insert("state".to_string(), "draft".to_string());
        NodeContent {
            title: title.to_string(),
            summary: format!("{title} concise summary"),
            body: body.to_string(),
            structured_data: structured,
            links: vec![Link {
                target: link_target.to_string(),
                label: Some("depends_on".to_string()),
                weight: 1.0,
            }],
            highlights: vec!["focus".to_string(), "recovery".to_string()],
            ..Default::default()
        }
    }

    #[test]
    fn append_only_update_preserves_old_version() {
        let dir = temp_data_dir("append-only");
        let mut engine = MemoryEngine::open(&dir).expect("open engine");

        let v0 = engine
            .create_node(
                "Fatigue_Model",
                sample_content("Fatigue", "v0 body", "SleepSignals"),
                0.8,
                1.0,
            )
            .expect("create node");

        let patch = NodePatch {
            body: Some("v1 body".to_string()),
            ..NodePatch::default()
        };

        let v1 = engine
            .update_node("Fatigue_Model", patch, 0.85, 1.2)
            .expect("update node");

        let old = engine.get_version(&v0.version).expect("old version read");
        let head = engine.get_version(&v1.version).expect("head version read");

        assert_eq!(old.content.body, "v0 body");
        assert_eq!(head.content.body, "v1 body");
        assert_ne!(v0.version, v1.version);
    }

    #[test]
    fn create_node_normalizes_empty_summary() {
        let dir = temp_data_dir("summary-normalize");
        let mut engine = MemoryEngine::open(&dir).expect("open engine");
        let mut content = sample_content("SummaryRule", "body text", "Ref");
        content.summary = "".to_string();
        let version = engine
            .create_node("SummaryRule", content, 0.8, 1.0)
            .expect("should normalize summary");
        assert!(!version.content.summary.trim().is_empty());
        assert!(version.content.summary.chars().count() >= 8);
    }

    #[test]
    fn merge_creates_multi_parent_version() {
        let dir = temp_data_dir("merge");
        let mut engine = MemoryEngine::open(&dir).expect("open engine");

        let _ = engine
            .create_node("Model", sample_content("Model", "base", "Ref"), 0.7, 0.8)
            .expect("create node");

        let v1 = engine
            .update_node(
                "Model",
                NodePatch {
                    body: Some("branch-a".to_string()),
                    ..NodePatch::default()
                },
                0.8,
                1.0,
            )
            .expect("update branch a");

        let v2 = engine.fork_node("Model").expect("fork branch b");
        let merged = engine
            .merge_node("Model", &v1.version, &v2.version)
            .expect("merge");

        assert_eq!(merged.parents.len(), 2);
        assert!(merged.parents.contains(&v1.version));
        assert!(merged.parents.contains(&v2.version));
    }

    #[test]
    fn reload_preserves_snapshot_and_graph() {
        let dir = temp_data_dir("reload");

        {
            let mut engine = MemoryEngine::open(&dir).expect("open engine");
            engine
                .create_node("A", sample_content("A", "body a", "B"), 0.9, 1.2)
                .expect("create A");
            engine
                .create_node("B", sample_content("B", "body b", "C"), 0.8, 1.1)
                .expect("create B");
        }

        let engine = MemoryEngine::open(&dir).expect("reopen engine");
        let bfs = engine.traverse_bfs("A", Some(2));
        assert_eq!(bfs, vec!["A".to_string(), "B".to_string(), "C".to_string()]);

        let hits = engine.search_by_highlight("recovery").expect("search");
        assert!(hits.contains(&"A".to_string()));
        assert!(hits.contains(&"B".to_string()));
    }

    #[test]
    fn tool_protocol_json_flow() {
        let dir = temp_data_dir("tool-json");
        let mut engine = MemoryEngine::open(&dir).expect("open engine");

        let action = ToolAction::UpsertNode {
            node_id: "ProtocolNode".to_string(),
            content: Some(sample_content("Protocol", "from tool", "Target")),
            patch: None,
            confidence: 0.88,
            importance: 1.4,
        };

        let resp = engine.execute_action(action);
        match resp {
            ToolResponse::Version { version } => {
                assert_eq!(version.node_id, "ProtocolNode");
            }
            other => panic!("unexpected response: {other:?}"),
        }

        let payload = r#"{"action":"traverse","start_node":"ProtocolNode","mode":"bfs","depth_limit":1,"min_confidence":null}"#;
        let out = engine.execute_action_json(payload);
        assert!(out.contains("node_list"));

        let action = ToolAction::Traverse {
            start_node: "ProtocolNode".to_string(),
            mode: TraverseMode::ConfidenceFiltered,
            depth_limit: Some(1),
            min_confidence: Some(0.5),
        };

        let resp = engine.execute_action(action);
        match resp {
            ToolResponse::NodeList { nodes } => {
                assert_eq!(nodes.first().map(String::as_str), Some("ProtocolNode"));
            }
            other => panic!("unexpected response: {other:?}"),
        }
    }

    #[test]
    fn merged_upsert_and_open_actions_work() {
        let dir = temp_data_dir("merged-upsert-open");
        let mut engine = MemoryEngine::open(&dir).expect("open engine");

        let resp = engine.execute_action(ToolAction::UpsertNode {
            node_id: "MergedNode".to_string(),
            content: Some(sample_content("Merged", "seed body", "RefNode")),
            patch: None,
            confidence: 0.86,
            importance: 1.5,
        });
        match resp {
            ToolResponse::Version { version } => assert_eq!(version.node_id, "MergedNode"),
            other => panic!("unexpected response: {other:?}"),
        }

        let resp = engine.execute_action(ToolAction::UpsertNode {
            node_id: "MergedNode".to_string(),
            content: None,
            patch: Some(NodePatch {
                body: Some("patched body".to_string()),
                ..NodePatch::default()
            }),
            confidence: 0.9,
            importance: 1.7,
        });
        match resp {
            ToolResponse::Version { version } => assert_eq!(version.content.body, "patched body"),
            other => panic!("unexpected response: {other:?}"),
        }

        let open_resp = engine.execute_action(ToolAction::OpenNode {
            node_id: "MergedNode".to_string(),
            markdown: Some(false),
            agent_id: Some("agent-main".to_string()),
        });
        match open_resp {
            ToolResponse::OptionalVersion { version } => assert!(version.is_some()),
            other => panic!("unexpected response: {other:?}"),
        }

        let md_resp = engine.execute_action(ToolAction::OpenNode {
            node_id: "MergedNode".to_string(),
            markdown: Some(true),
            agent_id: None,
        });
        match md_resp {
            ToolResponse::Markdown { markdown, .. } => assert!(markdown.is_some()),
            other => panic!("unexpected response: {other:?}"),
        }
    }

    #[test]
    fn merged_search_action_combines_keyword_and_highlight() {
        let dir = temp_data_dir("merged-search");
        let mut engine = MemoryEngine::open(&dir).expect("open engine");

        engine
            .create_node(
                "SearchNode",
                NodeContent {
                    title: "Search Node".to_string(),
                    summary: "Node used for merged keyword and highlight search.".to_string(),
                    body: "contains graph memory topic".to_string(),
                    structured_data: BTreeMap::new(),
                    links: vec![],
                    highlights: vec!["graph-memory".to_string()],
                            ..Default::default()
        },
                0.9,
                1.6,
            )
            .expect("create node");

        let resp = engine.execute_action(ToolAction::SearchNodes {
            query: "graph memory".to_string(),
            limit: Some(5),
            include_highlight: Some(true),
        });

        match resp {
            ToolResponse::SearchResults { results } => {
                assert!(results.iter().any(|h| h.node_id == "SearchNode"));
            }
            other => panic!("unexpected response: {other:?}"),
        }
    }

    #[test]
    fn keyword_search_returns_ranked_wiki_like_hits() {
        let dir = temp_data_dir("keyword-search");
        let mut engine = MemoryEngine::open(&dir).expect("open engine");

        engine
            .create_node(
                "Circadian_Model",
                NodeContent {
                    title: "Circadian Fatigue Wiki".to_string(),
                    summary: "Circadian fatigue signals and telemetry notes.".to_string(),
                    body: "# Summary\nWearable telemetry and circadian rhythm markers.".to_string(),
                    structured_data: BTreeMap::from([(
                        "keywords".to_string(),
                        "fatigue circadian telemetry".to_string(),
                    )]),
                    links: vec![],
                    highlights: vec!["circadian".to_string(), "fatigue".to_string()],
                            ..Default::default()
        },
                0.9,
                1.5,
            )
            .expect("create circadian");

        engine
            .create_node(
                "Nutrition",
                NodeContent {
                    title: "Nutrition Notes".to_string(),
                    summary: "Basic nutrition and hydration reminders.".to_string(),
                    body: "Protein planning and hydration.".to_string(),
                    structured_data: BTreeMap::new(),
                    links: vec![],
                    highlights: vec!["diet".to_string()],
                            ..Default::default()
        },
                0.8,
                1.0,
            )
            .expect("create nutrition");

        let hits = engine
            .search_by_keyword("circadian fatigue telemetry", 5)
            .expect("keyword search");
        assert_eq!(
            hits.first().map(|h| h.node_id.as_str()),
            Some("Circadian_Model")
        );
        assert!(hits.iter().all(|h| h.score > 0.0));

        let resp = engine.execute_action(ToolAction::SearchNodes {
            query: "fatigue telemetry".to_string(),
            limit: Some(3),
            include_highlight: Some(true),
        });
        match resp {
            ToolResponse::SearchResults { results } => {
                assert_eq!(
                    results.first().map(|h| h.node_id.as_str()),
                    Some("Circadian_Model")
                );
            }
            other => panic!("unexpected response: {other:?}"),
        }
    }

    #[test]
    fn access_auto_updates_importance() {
        let dir = temp_data_dir("access-auto");
        let mut engine = MemoryEngine::open(&dir).expect("open engine");

        let v0 = engine
            .create_node("A", sample_content("A", "# Summary\nBase", "B"), 0.8, 1.0)
            .expect("create");

        engine.log_access("agent-main", "A").expect("log access");
        let head_id = engine.head("A").expect("head exists").clone();
        let head = engine.get_version(&head_id).expect("head version");

        assert_ne!(v0.version, head.version);
        assert!(head.importance > v0.importance);
        let stats = engine.get_access_stats("A").expect("stats");
        assert_eq!(stats.total_access, 1);
        assert_eq!(stats.pending_access, 0);
    }

    #[test]
    fn open_node_action_auto_logs_access() {
        let dir = temp_data_dir("open-access");
        let mut engine = MemoryEngine::open(&dir).expect("open engine");

        engine
            .create_node("OpenNode", sample_content("Open", "Body", "Ref"), 0.8, 1.0)
            .expect("create node");

        let response = engine.execute_action(ToolAction::OpenNode {
            node_id: "OpenNode".to_string(),
            markdown: Some(false),
            agent_id: None,
        });
        match response {
            ToolResponse::OptionalVersion { version } => {
                let version = version.expect("version exists");
                assert!(!version.version.is_empty());
            }
            other => panic!("unexpected response: {other:?}"),
        }

        let stats = engine.get_access_stats("OpenNode").expect("stats");
        assert_eq!(stats.total_access, 1);
    }

    #[test]
    fn suggest_exploration_prioritizes_links_then_keywords() {
        let dir = temp_data_dir("suggest-exploration");
        let mut engine = MemoryEngine::open(&dir).expect("open engine");

        engine
            .create_node(
                "swift_learning_resources",
                NodeContent {
                    title: "Swift 学习资源与设计开发工具".to_string(),
                    summary: "收集 Swift 学习资源与设计灵感来源。".to_string(),
                    body: "## Summary\n包含 y combinator 与 design inspiration".to_string(),
                    structured_data: BTreeMap::from([
                        ("category".to_string(), "resources_tools".to_string()),
                        (
                            "inspiration".to_string(),
                            "product_hunt,apple_design_awards,yc".to_string(),
                        ),
                    ]),
                    links: vec![Link {
                        target: "swift_learning_path".to_string(),
                        label: Some("next".to_string()),
                        weight: 0.9,
                    }],
                    highlights: vec!["resources".to_string(), "inspiration".to_string()],
                            ..Default::default()
        },
                0.9,
                2.0,
            )
            .expect("create source");

        engine
            .create_node(
                "swift_learning_path",
                sample_content("Swift Path", "roadmap", "swift_learning_resources"),
                0.8,
                1.5,
            )
            .expect("create linked");

        engine
            .create_node(
                "y_combinator_overview",
                NodeContent {
                    title: "Y Combinator - 全球顶级创业加速器".to_string(),
                    summary: "YC 创业加速器基础信息与项目线索。".to_string(),
                    body: "startup accelerator and demo day".to_string(),
                    structured_data: BTreeMap::new(),
                    links: vec![],
                    highlights: vec!["yc".to_string(), "startup".to_string()],
                            ..Default::default()
        },
                0.9,
                3.0,
            )
            .expect("create yc");

        let results = engine
            .suggest_exploration("swift_learning_resources", 5)
            .expect("suggest");
        assert!(!results.is_empty());
        assert_eq!(
            results.first().map(|r| r.node_id.as_str()),
            Some("swift_learning_path")
        );
        assert!(
            results.iter().any(|r| r.node_id == "y_combinator_overview"),
            "keyword expansion should surface yc node"
        );
    }

    #[test]
    fn suggest_exploration_uses_structured_and_graph_signals() {
        let dir = temp_data_dir("suggest-multi-signals");
        let mut engine = MemoryEngine::open(&dir).expect("open engine");

        engine
            .create_node(
                "memory_orchestration",
                NodeContent {
                    title: "Memory Orchestration".to_string(),
                    summary: "Core orchestration node for memory pipeline.".to_string(),
                    body: "pipeline design and indexing".to_string(),
                    structured_data: BTreeMap::from([
                        ("meta.category".to_string(), "agent_memory".to_string()),
                        ("meta.topic".to_string(), "knowledge_graph".to_string()),
                    ]),
                    links: vec![
                        Link {
                            target: "retrieval_pattern".to_string(),
                            label: Some("related".to_string()),
                            weight: 0.7,
                        },
                        Link {
                            target: "ranking_strategy".to_string(),
                            label: Some("related".to_string()),
                            weight: 0.7,
                        },
                    ],
                    highlights: vec!["memory".to_string()],
                            ..Default::default()
        },
                0.9,
                2.6,
            )
            .expect("create source");

        engine
            .create_node(
                "graph_memory_pipeline",
                NodeContent {
                    title: "Graph Memory Pipeline".to_string(),
                    summary: "Candidate pipeline node for graph memory workflows.".to_string(),
                    body: "execution planning for memory".to_string(),
                    structured_data: BTreeMap::from([
                        ("meta.category".to_string(), "agent_memory".to_string()),
                        ("meta.topic".to_string(), "knowledge_graph".to_string()),
                    ]),
                    links: vec![
                        Link {
                            target: "retrieval_pattern".to_string(),
                            label: Some("related".to_string()),
                            weight: 0.8,
                        },
                        Link {
                            target: "ranking_strategy".to_string(),
                            label: Some("related".to_string()),
                            weight: 0.8,
                        },
                    ],
                    highlights: vec!["graph".to_string()],
                            ..Default::default()
        },
                0.88,
                2.4,
            )
            .expect("create candidate");

        engine
            .create_node(
                "retrieval_pattern",
                sample_content("Retrieval Pattern", "ranking and filtering", "x"),
                0.8,
                1.4,
            )
            .expect("create helper");

        engine
            .create_node(
                "ranking_strategy",
                sample_content("Ranking Strategy", "score fusion", "x"),
                0.8,
                1.4,
            )
            .expect("create helper2");

        let results = engine
            .suggest_exploration("memory_orchestration", 5)
            .expect("suggest");
        assert!(
            results.iter().any(|r| r.node_id == "graph_memory_pipeline"),
            "structured + graph overlap should surface candidate"
        );
    }

    #[test]
    fn auto_link_related_adds_links_for_lonely_node() {
        let dir = temp_data_dir("auto-link-related");
        let mut engine = MemoryEngine::open(&dir).expect("open engine");

        engine
            .create_node(
                "y_combinator_overview",
                NodeContent {
                    title: "Y Combinator - 全球顶级创业加速器".to_string(),
                    summary: "YC overview focused on accelerator operations.".to_string(),
                    body: "startup accelerator demo day alumni".to_string(),
                    structured_data: BTreeMap::from([(
                        "category".to_string(),
                        "startup_accelerator".to_string(),
                    )]),
                    links: vec![],
                    highlights: vec!["yc".to_string(), "startup".to_string()],
                            ..Default::default()
        },
                0.95,
                3.5,
            )
            .expect("create yc");

        engine
            .create_node(
                "startup_accelerator_model",
                sample_content(
                    "Startup Accelerator Model",
                    "program structure and mentorship",
                    "x",
                ),
                0.8,
                2.2,
            )
            .expect("create model");

        engine
            .create_node(
                "demo_day_playbook",
                sample_content("Demo Day Playbook", "pitching and investor workflow", "x"),
                0.8,
                2.0,
            )
            .expect("create demo day");

        let updated = engine
            .auto_link_related("y_combinator_overview", 2, 35.0)
            .expect("auto link");
        assert!(!updated.content.links.is_empty());
    }

    #[test]
    fn explore_with_budget_returns_multi_depth_candidates() {
        let dir = temp_data_dir("explore-budget");
        let mut engine = MemoryEngine::open(&dir).expect("open engine");

        engine
            .create_node(
                "swift_learning_resources",
                NodeContent {
                    title: "Swift 学习资源与设计开发工具".to_string(),
                    summary: "Swift learning hub entry with resource links.".to_string(),
                    body: "swift resource hub".to_string(),
                    structured_data: BTreeMap::from([(
                        "category".to_string(),
                        "resources_tools".to_string(),
                    )]),
                    links: vec![Link {
                        target: "swift_learning_path".to_string(),
                        label: Some("next".to_string()),
                        weight: 0.9,
                    }],
                    highlights: vec!["swift".to_string(), "resources".to_string()],
                            ..Default::default()
        },
                0.9,
                2.0,
            )
            .expect("create root");

        engine
            .create_node(
                "swift_learning_path",
                NodeContent {
                    title: "Swift Learning Path".to_string(),
                    summary: "Learning path node connecting to inspiration resources.".to_string(),
                    body: "covers startup inspiration and yc".to_string(),
                    structured_data: BTreeMap::new(),
                    links: vec![Link {
                        target: "y_combinator_overview".to_string(),
                        label: Some("inspiration".to_string()),
                        weight: 0.8,
                    }],
                    highlights: vec!["learning".to_string()],
                            ..Default::default()
        },
                0.8,
                1.8,
            )
            .expect("create middle");

        engine
            .create_node(
                "y_combinator_overview",
                NodeContent {
                    title: "Y Combinator".to_string(),
                    summary: "Startup accelerator concept node.".to_string(),
                    body: "startup accelerator".to_string(),
                    structured_data: BTreeMap::new(),
                    links: vec![],
                    highlights: vec!["yc".to_string()],
                            ..Default::default()
        },
                0.95,
                3.2,
            )
            .expect("create leaf");

        let results = engine
            .explore_with_budget("swift_learning_resources", 2, 4, 10, 0.0)
            .expect("explore with budget");
        assert!(
            results
                .iter()
                .any(|i| i.node_id == "swift_learning_path" && i.depth == 1)
        );
        assert!(
            results
                .iter()
                .any(|i| i.node_id == "y_combinator_overview" && i.depth <= 2)
        );

        let resp = engine.execute_action(ToolAction::ExploreWithBudget {
            node_id: "swift_learning_resources".to_string(),
            depth_budget: Some(2),
            per_layer_limit: Some(4),
            total_limit: Some(10),
            min_score: Some(0.0),
        });
        match resp {
            ToolResponse::ExploreBudgetResults { results } => {
                assert!(!results.is_empty());
            }
            other => panic!("unexpected response: {other:?}"),
        }
    }

    #[test]
    fn agent_upsert_markdown_creates_audit_and_markdown_projection() {
        let dir = temp_data_dir("agent-upsert-markdown");
        let mut engine = MemoryEngine::open(&dir).expect("open engine");

        let markdown = r#"# 记忆规范

这是一段用于测试的 markdown 原文。
引用 [[policy_node]]。
"#;
        let response = engine.execute_action(ToolAction::AgentUpsertMarkdown {
            node_id: "kb_policy".to_string(),
            markdown: markdown.to_string(),
            confidence: 0.9,
            importance: 1.4,
            agent_id: "agent-main".to_string(),
            reason: "同步新的知识规范".to_string(),
            source: "user_request".to_string(),
                    project: None,
            parent_node: None,
            node_type: None,
        });

        let created = match response {
            ToolResponse::Version { version } => version,
            other => panic!("unexpected response: {other:?}"),
        };
        assert_eq!(created.node_id, "kb_policy");

        let md = engine
            .open_markdown_node("kb_policy")
            .expect("read markdown")
            .expect("markdown exists");
        assert!(md.1.contains("记忆规范"));

        let audit_path = dir.join("index").join("agent_actions.log");
        let audit = fs::read_to_string(audit_path).expect("read audit log");
        assert!(audit.contains("agent_upsert_markdown"));
        assert!(audit.contains("agent-main"));
    }

    #[test]
    fn agent_upsert_markdown_auto_links_related_keywords() {
        let dir = temp_data_dir("agent-upsert-auto-keyword-link");
        let mut engine = MemoryEngine::open(&dir).expect("open engine");

        engine
            .create_node(
                "rust_memory_engine",
                NodeContent {
                    title: "Rust Memory Engine".to_string(),
                    summary: "Rust implementation of append-only memory engine.".to_string(),
                    body: "append-only node versioning".to_string(),
                    structured_data: BTreeMap::new(),
                    links: vec![],
                    highlights: vec!["rust".to_string()],
                            ..Default::default()
        },
                0.9,
                2.0,
            )
            .expect("create related node");

        let markdown = r#"# 知识草案

这里记录 Rust Memory Engine 在项目中的作用。
"#;
        let response = engine.execute_action(ToolAction::AgentUpsertMarkdown {
            node_id: "kb_draft".to_string(),
            markdown: markdown.to_string(),
            confidence: 0.9,
            importance: 1.4,
            agent_id: "agent-main".to_string(),
            reason: "补充知识草案内容".to_string(),
            source: "user_request".to_string(),
                    project: None,
            parent_node: None,
            node_type: None,
        });

        let created = match response {
            ToolResponse::Version { version } => version,
            other => panic!("unexpected response: {other:?}"),
        };
        assert!(created.content.body.contains("[[rust_memory_engine]]"));
        assert!(
            created
                .content
                .links
                .iter()
                .any(|link| link.target == "rust_memory_engine")
        );
    }

    #[test]
    fn agent_upsert_markdown_auto_links_github_repo_alias_to_existing_node() {
        let dir = temp_data_dir("agent-upsert-github-alias-link");
        let mut engine = MemoryEngine::open(&dir).expect("open engine");

        engine
            .create_node(
                "github-kortix-suna",
                NodeContent {
                    title: "Suna by Kortix".to_string(),
                    summary: "Kortix AI agent platform".to_string(),
                    body: "repo overview".to_string(),
                    structured_data: BTreeMap::new(),
                    links: vec![],
                    highlights: vec!["suna".to_string()],
                            ..Default::default()
        },
                0.9,
                2.0,
            )
            .expect("create related github node");

        let markdown = r#"# Top 100 GitHub Repositories

Notable repos include `kortix-ai/suna`.
"#;
        let response = engine.execute_action(ToolAction::AgentUpsertMarkdown {
            node_id: "github-top-100-repos".to_string(),
            markdown: markdown.to_string(),
            confidence: 0.9,
            importance: 1.4,
            agent_id: "agent-main".to_string(),
            reason: "补充 top100 仓库引用信息".to_string(),
            source: "user_request".to_string(),
                    project: None,
            parent_node: None,
            node_type: None,
        });

        let created = match response {
            ToolResponse::Version { version } => version,
            other => panic!("unexpected response: {other:?}"),
        };
        assert!(created.content.body.contains("kortix-ai/suna"));
        assert!(
            created
                .content
                .links
                .iter()
                .any(|link| link.target == "github-kortix-suna")
        );
    }

    #[test]
    fn rollback_node_creates_new_head_from_old_version() {
        let dir = temp_data_dir("rollback-node");
        let mut engine = MemoryEngine::open(&dir).expect("open engine");

        let v1 = engine
            .create_node(
                "design_doc",
                sample_content("Design Doc", "v1 baseline", "x"),
                0.8,
                1.0,
            )
            .expect("create");

        let _v2 = engine
            .update_node(
                "design_doc",
                NodePatch {
                    body: Some("v2 changed".to_string()),
                    ..NodePatch::default()
                },
                0.85,
                1.1,
            )
            .expect("update");

        let restored = engine
            .rollback_node("design_doc", &v1.version, 0.88, 1.2)
            .expect("rollback");
        assert!(restored.parents.iter().any(|p| p == &v1.version));
        assert_eq!(restored.content.body, "v1 baseline");

        let history = engine.node_history("design_doc", 10).expect("history");
        assert!(history.len() >= 3);
    }

    #[test]
    fn keyword_search_supports_chinese_terms() {
        let dir = temp_data_dir("keyword-cn");
        let mut engine = MemoryEngine::open(&dir).expect("open engine");

        engine
            .create_node(
                "cn_node",
                NodeContent {
                    title: "知识库检索".to_string(),
                    summary: "中文知识检索与回溯能力说明。".to_string(),
                    body: "支持中文关键词检索与版本回溯".to_string(),
                    structured_data: BTreeMap::new(),
                    links: vec![],
                    highlights: vec!["检索".to_string()],
                            ..Default::default()
        },
                0.9,
                1.8,
            )
            .expect("create");

        let hits = engine
            .search_by_keyword("中文 检索", 5)
            .expect("search by keyword");
        assert!(hits.iter().any(|h| h.node_id == "cn_node"));
    }

    #[test]
    fn project_create_and_list() {
        let dir = temp_data_dir("project-create-list");
        let mut engine = MemoryEngine::open(&dir).expect("open engine");

        let resp = engine.execute_action(ToolAction::CreateProject {
            project_id: "real_estate".to_string(),
            name: "Real Estate KB".to_string(),
            description: "Domain knowledge for real estate analysis.".to_string(),
            owner: Some("team-re".to_string()),
            tags: Some(vec!["property".to_string(), "investment".to_string()]),
        });
        match resp {
            ToolResponse::ProjectResult { project } => {
                assert_eq!(project.project_id, "real_estate");
                assert_eq!(project.name, "Real Estate KB");
            }
            other => panic!("unexpected: {other:?}"),
        }

        let list_resp = engine.execute_action(ToolAction::ListProjects {});
        match list_resp {
            ToolResponse::ProjectList { projects } => {
                assert_eq!(projects.len(), 1);
                assert_eq!(projects[0].project_id, "real_estate");
            }
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn project_scoped_ingest_and_list_nodes() {
        let dir = temp_data_dir("project-ingest-nodes");
        let mut engine = MemoryEngine::open(&dir).expect("open engine");

        // Create project
        engine.execute_action(ToolAction::CreateProject {
            project_id: "tech".to_string(),
            name: "Technology KB".to_string(),
            description: "Technology domain knowledge.".to_string(),
            owner: None,
            tags: None,
        });

        // Ingest index node
        let resp = engine.execute_action(ToolAction::Ingest {
            node_id: Some("tech_index".to_string()),
            title: Some("Technology Index".to_string()),
            text: "# Technology Knowledge Base\n\nRoot index for tech domain.".to_string(),
            summary: None,
            facts: None,
            relations: None,
            highlights: None,
            evidence: None,
            source: "test".to_string(),
            agent_id: Some("test-agent".to_string()),
            reason: Some("create index node for project".to_string()),
            confidence: Some(0.9),
            importance: Some(1.5),
            project: Some("tech".to_string()),
            parent_node: None,
            node_type: Some("index".to_string()),
        });
        match &resp {
            ToolResponse::Version { version } => {
                assert_eq!(version.content.project, Some("tech".to_string()));
                assert_eq!(version.content.node_type, Some("index".to_string()));
            }
            other => panic!("unexpected: {other:?}"),
        }

        // Ingest a concept child node
        engine.execute_action(ToolAction::Ingest {
            node_id: Some("rust_lang".to_string()),
            title: Some("Rust Programming Language".to_string()),
            text: "# Rust\n\nA systems programming language focused on safety and performance.".to_string(),
            summary: None,
            facts: None,
            relations: None,
            highlights: None,
            evidence: None,
            source: "test".to_string(),
            agent_id: Some("test-agent".to_string()),
            reason: Some("add rust concept to tech project".to_string()),
            confidence: Some(0.9),
            importance: Some(1.2),
            project: Some("tech".to_string()),
            parent_node: Some("tech_index".to_string()),
            node_type: Some("concept".to_string()),
        });

        // Verify markdown was written to project directory
        let md_path = dir.join("knowledge").join("projects").join("tech");
        assert!(md_path.exists(), "project directory should exist");

        // List project nodes
        let nodes_resp = engine.execute_action(ToolAction::ListProjectNodes {
            project_id: "tech".to_string(),
        });
        match nodes_resp {
            ToolResponse::ProjectNodes { project_id, nodes } => {
                assert_eq!(project_id, "tech");
                assert_eq!(nodes.len(), 2);
                assert!(nodes.contains(&"tech_index".to_string()));
                assert!(nodes.contains(&"rust_lang".to_string()));
            }
            other => panic!("unexpected: {other:?}"),
        }

        // Reload engine and verify project index is persisted
        let engine2 = MemoryEngine::open(&dir).expect("reload engine");
        assert!(engine2.head("tech_index").is_some());
        assert!(engine2.head("rust_lang").is_some());
    }

    #[test]
    fn project_frontmatter_roundtrip() {
        let dir = temp_data_dir("project-frontmatter");
        let mut engine = MemoryEngine::open(&dir).expect("open engine");

        engine.execute_action(ToolAction::Ingest {
            node_id: Some("concept_node".to_string()),
            title: Some("Concept Node".to_string()),
            text: "# Concept Node\n\nA test concept.".to_string(),
            summary: None,
            facts: None,
            relations: None,
            highlights: None,
            evidence: None,
            source: "test".to_string(),
            agent_id: Some("test-agent".to_string()),
            reason: Some("test project frontmatter roundtrip".to_string()),
            confidence: Some(0.9),
            importance: Some(1.0),
            project: Some("test_project".to_string()),
            parent_node: Some("root_node".to_string()),
            node_type: Some("concept".to_string()),
        });

        let (_, md, _) = engine
            .open_markdown_node("concept_node")
            .expect("read ok")
            .expect("node exists");

        assert!(md.contains("project: \"test_project\""));
        assert!(md.contains("parent_node: \"root_node\""));
        assert!(md.contains("node_type: \"concept\""));
    }
}
