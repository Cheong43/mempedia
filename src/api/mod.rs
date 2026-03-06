use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::core::{
    AccessLog, AccessStats, MemoryError, MemoryResult, Node, NodeContent, NodePatch, NodeVersion,
    SearchHit,
};
use crate::decay::exponential_decay;
use crate::graph::GraphIndex;
use crate::promotion::{PromotionSignal, compute_importance};
use crate::storage::{FileStorage, IndexSnapshot};
use crate::versioning::VersionEngine;

pub struct MemoryEngine {
    storage: FileStorage,
    heads: HashMap<String, String>,
    nodes: HashMap<String, Node>,
    graph_index: GraphIndex,
    access_state: HashMap<String, AccessStats>,
    auto_promotion: AutoPromotionConfig,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum ToolAction {
    CreateNode {
        node_id: String,
        content: NodeContent,
        confidence: f32,
        importance: f32,
    },
    UpdateNode {
        node_id: String,
        patch: NodePatch,
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
    OpenNode {
        node_id: String,
        #[serde(default)]
        agent_id: Option<String>,
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
    SearchByHighlight {
        query: String,
    },
    SearchByKeyword {
        query: String,
        limit: Option<usize>,
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
    Error {
        message: String,
    },
}

impl MemoryEngine {
    pub fn open<P: AsRef<Path>>(data_root: P) -> MemoryResult<Self> {
        let storage = FileStorage::new(data_root)?;
        let snapshot = storage.load_index_snapshot()?;
        let graph_index = GraphIndex::build(&storage, &snapshot.heads)?;
        let access_state = storage.load_access_state()?;

        Ok(Self {
            storage,
            heads: snapshot.heads,
            nodes: snapshot.nodes,
            graph_index,
            access_state,
            auto_promotion: AutoPromotionConfig::default(),
        })
    }

    pub fn open_shared<P: AsRef<Path>>(data_root: P) -> MemoryResult<SharedMemoryEngine> {
        Ok(Arc::new(RwLock::new(Self::open(data_root)?)))
    }

    pub fn set_auto_promotion_config(&mut self, config: AutoPromotionConfig) {
        self.auto_promotion = config;
    }

    pub fn create_node(
        &mut self,
        node_id: &str,
        content: NodeContent,
        confidence: f32,
        importance: f32,
    ) -> MemoryResult<NodeVersion> {
        let version = VersionEngine::create_node(
            &self.storage,
            &mut self.heads,
            &mut self.nodes,
            node_id,
            content,
            confidence,
            importance,
        )?;
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
        let version = VersionEngine::update_node(
            &self.storage,
            &mut self.heads,
            &mut self.nodes,
            node_id,
            patch,
            confidence,
            importance,
        )?;
        self.rebuild_index()?;
        Ok(version)
    }

    pub fn fork_node(&mut self, node_id: &str) -> MemoryResult<NodeVersion> {
        let version =
            VersionEngine::fork_node(&self.storage, &mut self.heads, &mut self.nodes, node_id)?;
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
        self.rebuild_index()?;
        Ok(version)
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

        let mut hits = Vec::new();
        for (node_id, version_id) in &self.heads {
            let version = self.storage.read_object(version_id)?;
            let score = keyword_score(&version.content, &query_tokens);
            if score > 0.0 {
                hits.push(SearchHit {
                    node_id: node_id.clone(),
                    score,
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
            ToolAction::CreateNode {
                node_id,
                content,
                confidence,
                importance,
            } => self
                .create_node(&node_id, content, confidence, importance)
                .map(|version| ToolResponse::Version { version }),
            ToolAction::UpdateNode {
                node_id,
                patch,
                confidence,
                importance,
            } => self
                .update_node(&node_id, patch, confidence, importance)
                .map(|version| ToolResponse::Version { version }),
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
            ToolAction::OpenNode { node_id, agent_id } => {
                if self.head(&node_id).is_none() {
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
            ToolAction::SearchByHighlight { query } => self
                .search_by_highlight(&query)
                .map(|nodes| ToolResponse::NodeList { nodes }),
            ToolAction::SearchByKeyword { query, limit } => self
                .search_by_keyword(&query, limit.unwrap_or(10))
                .map(|results| ToolResponse::SearchResults { results }),
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
        Ok(())
    }
}

fn keyword_score(content: &NodeContent, query_tokens: &[String]) -> f32 {
    let title = content.title.to_lowercase();
    let body = content.body.to_lowercase();
    let highlights = content.highlights.join(" ").to_lowercase();
    let structured = content
        .structured_data
        .iter()
        .map(|(k, v)| format!("{k} {v}"))
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase();

    let mut score = 0.0;
    for token in query_tokens {
        if token.is_empty() {
            continue;
        }
        if title.contains(token) {
            score += 5.0;
        }
        if body.contains(token) {
            score += 2.0;
        }
        if highlights.contains(token) {
            score += 2.5;
        }
        if structured.contains(token) {
            score += 1.5;
        }
    }

    let covered = query_tokens
        .iter()
        .filter(|token| title.contains(token.as_str()) || body.contains(token.as_str()))
        .count() as f32;
    score + covered
}

fn tokenize(input: &str) -> Vec<String> {
    input
        .split(|c: char| !c.is_alphanumeric() && c != '_')
        .map(|s| s.trim().to_lowercase())
        .filter(|s| s.len() >= 2)
        .collect()
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
            body: body.to_string(),
            structured_data: structured,
            links: vec![Link {
                target: link_target.to_string(),
                label: Some("depends_on".to_string()),
                weight: 1.0,
            }],
            highlights: vec!["focus".to_string(), "recovery".to_string()],
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

        let action = ToolAction::CreateNode {
            node_id: "ProtocolNode".to_string(),
            content: sample_content("Protocol", "from tool", "Target"),
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
    fn keyword_search_returns_ranked_wiki_like_hits() {
        let dir = temp_data_dir("keyword-search");
        let mut engine = MemoryEngine::open(&dir).expect("open engine");

        engine
            .create_node(
                "Circadian_Model",
                NodeContent {
                    title: "Circadian Fatigue Wiki".to_string(),
                    body: "# Summary\nWearable telemetry and circadian rhythm markers.".to_string(),
                    structured_data: BTreeMap::from([(
                        "keywords".to_string(),
                        "fatigue circadian telemetry".to_string(),
                    )]),
                    links: vec![],
                    highlights: vec!["circadian".to_string(), "fatigue".to_string()],
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
                    body: "Protein planning and hydration.".to_string(),
                    structured_data: BTreeMap::new(),
                    links: vec![],
                    highlights: vec!["diet".to_string()],
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

        let resp = engine.execute_action(ToolAction::SearchByKeyword {
            query: "fatigue telemetry".to_string(),
            limit: Some(3),
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
}
