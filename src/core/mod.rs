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
    pub body: String,
    pub structured_data: BTreeMap<String, String>,
    pub links: Vec<Link>,
    pub highlights: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeVersion {
    pub node_id: NodeId,
    pub version: VersionId,
    pub parents: Vec<VersionId>,
    pub timestamp: u64,
    pub content: NodeContent,
    pub confidence: f32,
    pub importance: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct NodePatch {
    pub title: Option<String>,
    pub body: Option<String>,
    pub structured_upserts: BTreeMap<String, String>,
    pub add_links: Vec<Link>,
    pub add_highlights: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccessLog {
    pub agent_id: String,
    pub node_id: NodeId,
    pub version: VersionId,
    pub timestamp: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchHit {
    pub node_id: NodeId,
    pub score: f32,
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
