use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::{Arc, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::core::{
    AccessLog, AccessStats, AgentActionLog, ExploreBudgetItem, ExploreCandidate, Link, MemoryError,
    MemoryResult, Node, NodeContent, NodeHistoryItem, NodePatch, NodeVersion, SearchHit,
};
use crate::decay::exponential_decay;
use crate::graph::GraphIndex;
use crate::markdown::{parse_markdown, render_node_markdown};
use crate::promotion::{PromotionSignal, compute_importance};
use crate::storage::{FileStorage, IndexSnapshot};
use crate::versioning::VersionEngine;

pub struct MemoryEngine {
    storage: FileStorage,
    heads: HashMap<String, String>,
    nodes: HashMap<String, Node>,
    graph_index: GraphIndex,
    keyword_index: HashMap<String, HashMap<String, f32>>,
    access_state: HashMap<String, AccessStats>,
    auto_promotion: AutoPromotionConfig,
    agent_governance: AgentGovernanceConfig,
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
    OpenResource {
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
    Error {
        message: String,
    },
}

impl MemoryEngine {
    pub fn open<P: AsRef<Path>>(data_root: P) -> MemoryResult<Self> {
        let storage = FileStorage::new(data_root)?;
        let snapshot = storage.load_index_snapshot()?;
        let access_state = storage.load_access_state()?;
        let mut engine = Self {
            storage,
            heads: snapshot.heads,
            nodes: snapshot.nodes,
            graph_index: GraphIndex::default(),
            keyword_index: HashMap::new(),
            access_state,
            auto_promotion: AutoPromotionConfig::default(),
            agent_governance: AgentGovernanceConfig::default(),
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
    ) -> MemoryResult<NodeVersion> {
        self.validate_agent_markdown_request(markdown, confidence, agent_id, reason, source)?;

        let mut content = parse_markdown(markdown);
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

        let version = if self.head(node_id).is_some() {
            let patch = NodePatch {
                title: Some(content.title.clone()),
                body: Some(content.body.clone()),
                structured_upserts: content.structured_data.clone(),
                add_links: content.links.clone(),
                add_highlights: content.highlights.clone(),
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

    pub fn open_markdown_node(
        &self,
        node_id: &str,
    ) -> MemoryResult<Option<(String, String, Option<String>)>> {
        let (path, markdown) = match self.storage.read_markdown_node(node_id)? {
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
                            body: Some(content.body),
                            structured_upserts: content.structured_data,
                            add_links: content.links,
                            add_highlights: content.highlights,
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
            } => self
                .agent_upsert_markdown(
                    &node_id, &markdown, confidence, importance, &agent_id, &reason, &source,
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
            ToolAction::OpenResource {
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
        Ok(())
    }

    fn sync_markdown_for_version(&self, node_id: &str, version: &NodeVersion) -> MemoryResult<()> {
        let markdown = render_node_markdown(node_id, version);
        let _ = self.storage.write_markdown_node(node_id, &markdown)?;
        Ok(())
    }

    fn ensure_markdown_projection(&self) -> MemoryResult<()> {
        for (node_id, version_id) in &self.heads {
            if self.storage.read_markdown_node(node_id)?.is_some() {
                continue;
            }
            let version = self.storage.read_object(version_id)?;
            self.sync_markdown_for_version(node_id, &version)?;
        }
        Ok(())
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

    fn auto_wikilink_markdown_body(
        &self,
        node_id: &str,
        body: &str,
    ) -> MemoryResult<(String, Vec<Link>)> {
        let mut out = body.to_string();
        let mut links = Vec::new();
        let mut linked_targets: HashSet<String> = HashSet::new();

        let mut candidates: Vec<(String, String)> = Vec::new();
        for (target, version_id) in &self.heads {
            if target == node_id {
                continue;
            }
            candidates.push((target.clone(), target.clone()));
            let version = self.storage.read_object(version_id)?;
            let title = version.content.title.trim();
            if title.chars().count() >= 2 {
                candidates.push((target.clone(), title.to_string()));
            }
        }
        candidates.sort_by(|a, b| {
            b.1.chars()
                .count()
                .cmp(&a.1.chars().count())
                .then_with(|| a.0.cmp(&b.0))
        });

        for (target, keyword) in candidates {
            if linked_targets.contains(&target) {
                continue;
            }
            if out.contains(&format!("[[{target}]]")) {
                linked_targets.insert(target.clone());
                continue;
            }
            if replace_keyword_with_wikilink_once(&mut out, &keyword, &target) {
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
    let mut parts = vec![content.title.clone()];
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
    while let Some(offset) = text[cursor..].find(needle) {
        let start = cursor + offset;
        let end = start + needle.len();
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

        let open_resp = engine.execute_action(ToolAction::OpenResource {
            node_id: "MergedNode".to_string(),
            markdown: Some(false),
            agent_id: Some("agent-main".to_string()),
        });
        match open_resp {
            ToolResponse::OptionalVersion { version } => assert!(version.is_some()),
            other => panic!("unexpected response: {other:?}"),
        }

        let md_resp = engine.execute_action(ToolAction::OpenResource {
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
                    body: "contains graph memory topic".to_string(),
                    structured_data: BTreeMap::new(),
                    links: vec![],
                    highlights: vec!["graph-memory".to_string()],
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
    fn open_resource_action_auto_logs_access() {
        let dir = temp_data_dir("open-access");
        let mut engine = MemoryEngine::open(&dir).expect("open engine");

        engine
            .create_node("OpenNode", sample_content("Open", "Body", "Ref"), 0.8, 1.0)
            .expect("create node");

        let response = engine.execute_action(ToolAction::OpenResource {
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
                    body: "startup accelerator and demo day".to_string(),
                    structured_data: BTreeMap::new(),
                    links: vec![],
                    highlights: vec!["yc".to_string(), "startup".to_string()],
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
                    body: "startup accelerator demo day alumni".to_string(),
                    structured_data: BTreeMap::from([(
                        "category".to_string(),
                        "startup_accelerator".to_string(),
                    )]),
                    links: vec![],
                    highlights: vec!["yc".to_string(), "startup".to_string()],
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
                    body: "covers startup inspiration and yc".to_string(),
                    structured_data: BTreeMap::new(),
                    links: vec![Link {
                        target: "y_combinator_overview".to_string(),
                        label: Some("inspiration".to_string()),
                        weight: 0.8,
                    }],
                    highlights: vec!["learning".to_string()],
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
                    body: "startup accelerator".to_string(),
                    structured_data: BTreeMap::new(),
                    links: vec![],
                    highlights: vec!["yc".to_string()],
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
                    body: "append-only node versioning".to_string(),
                    structured_data: BTreeMap::new(),
                    links: vec![],
                    highlights: vec!["rust".to_string()],
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
                    body: "支持中文关键词检索与版本回溯".to_string(),
                    structured_data: BTreeMap::new(),
                    links: vec![],
                    highlights: vec!["检索".to_string()],
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
}
