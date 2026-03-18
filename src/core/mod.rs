use std::collections::BTreeMap;
use std::fmt::{Display, Formatter};

use serde::{Deserialize, Serialize};

pub type NodeId = String;
pub type VersionId = String;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Node {
    pub id: NodeId,
    pub head: VersionId,
    pub branches: Vec<VersionId>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Link {
    pub target: NodeId,
    pub label: Option<String>,
    pub weight: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct NodeContent {
    pub title: String,
    #[serde(default)]
    pub summary: String,
    pub body: String,
    pub structured_data: BTreeMap<String, String>,
    pub links: Vec<Link>,
    pub highlights: Vec<String>,
    /// Project (domain/category) this node belongs to. Nodes within the same
    /// project are co-located under `knowledge/projects/<project_id>/`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project: Option<String>,
    /// Optional parent node id for hierarchical (Notion-like) page structure
    /// within a project.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_node: Option<String>,
    /// Semantic type of this node, e.g. "index", "concept", "process",
    /// "reference", "decision", "glossary".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub node_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeVersion {
    pub node_id: NodeId,
    pub version: VersionId,
    pub parents: Vec<VersionId>,
    pub timestamp: u64,
    pub content: NodeContent,
    pub importance: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct NodePatch {
    pub title: Option<String>,
    pub summary: Option<String>,
    pub body: Option<String>,
    pub structured_upserts: BTreeMap<String, String>,
    pub add_links: Vec<Link>,
    pub add_highlights: Vec<String>,
    /// Update project association.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project: Option<String>,
    /// Update parent node (hierarchical relationship).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_node: Option<String>,
    /// Update semantic node type.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub node_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccessLog {
    pub agent_id: String,
    pub node_id: NodeId,
    pub version: VersionId,
    pub timestamp: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserHabitEnv {
    pub topic: String,
    pub summary: String,
    pub details: String,
    pub timestamp: u64,
    pub agent_id: String,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BehaviorPatternRecord {
    pub pattern_key: String,
    pub summary: String,
    pub details: String,
    pub applicable_plan: Option<String>,
    pub timestamp: u64,
    pub agent_id: String,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchHit {
    pub node_id: NodeId,
    pub score: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeHistoryItem {
    pub version: VersionId,
    pub timestamp: u64,
    pub parents: Vec<VersionId>,
    pub importance: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExploreCandidate {
    pub node_id: NodeId,
    pub score: f32,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExploreBudgetItem {
    pub node_id: NodeId,
    pub depth: usize,
    pub score: f32,
    pub reason: String,
    pub via: Option<NodeId>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AccessStats {
    pub total_access: u64,
    pub pending_access: u64,
    pub last_access_ts: u64,
    pub last_promote_ts: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentActionLog {
    pub timestamp: u64,
    pub agent_id: String,
    pub action: String,
    pub node_id: NodeId,
    pub version: VersionId,
    pub reason: String,
    pub source: String,
}

/// A single episodic memory record stored in chronological order.
/// Importance decays over time and is not graph-indexed.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EpisodicMemoryRecord {
    pub id: String,
    pub timestamp: u64,
    /// Scene category: "conversation", "task", "learning", etc.
    pub scene_type: String,
    /// Compressed/summarised content of the episode.
    pub summary: String,
    /// Optional reference to a raw conversation file id.
    #[serde(default)]
    pub raw_conversation_id: Option<String>,
    /// Importance score (decays over time).
    pub importance: f32,
    /// Core-knowledge node ids that were created or updated during this episode.
    #[serde(default)]
    pub core_knowledge_nodes: Vec<String>,
    /// Keyword tags used for BM25 retrieval.
    #[serde(default)]
    pub tags: Vec<String>,
    /// Agent or user that created this record.
    #[serde(default)]
    pub agent_id: Option<String>,
    /// Optional structured metadata for scene-specific payloads.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub metadata: BTreeMap<String, String>,
}

/// Lightweight metadata for a single agent-skill stored as a markdown file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillRecord {
    pub id: String,
    pub title: String,
    pub content: String,
    #[serde(default)]
    pub tags: Vec<String>,
    pub updated_at: u64,
}

/// A search hit from skills BM25 retrieval.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillSearchHit {
    pub skill_id: String,
    pub title: String,
    pub score: f32,
}

/// Metadata record for a project (domain/knowledge-base category).
///
/// Projects group related knowledge nodes together and are stored in a
/// dedicated subdirectory under `knowledge/projects/<project_id>/`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectRecord {
    pub project_id: String,
    pub name: String,
    pub description: String,
    pub created_at: u64,
    pub updated_at: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub owner: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum MergeConflict {
    FieldConflict(String),
}

#[derive(Debug)]
pub enum MemoryError {
    Io(std::io::Error),
    Serde(serde_json::Error),
    NotFound(String),
    Invalid(String),
}

impl Display for MemoryError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(err) => write!(f, "io error: {err}"),
            Self::Serde(err) => write!(f, "serde error: {err}"),
            Self::NotFound(msg) => write!(f, "not found: {msg}"),
            Self::Invalid(msg) => write!(f, "invalid: {msg}"),
        }
    }
}

impl std::error::Error for MemoryError {}

impl From<std::io::Error> for MemoryError {
    fn from(value: std::io::Error) -> Self {
        Self::Io(value)
    }
}

impl From<serde_json::Error> for MemoryError {
    fn from(value: serde_json::Error) -> Self {
        Self::Serde(value)
    }
}

pub type MemoryResult<T> = Result<T, MemoryError>;
