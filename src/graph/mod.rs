use std::collections::{HashMap, HashSet, VecDeque};

use crate::core::{MemoryResult, NodeVersion};
use crate::storage::FileStorage;

#[derive(Debug, Clone, Default)]
pub struct GraphIndex {
    pub adjacency: HashMap<String, Vec<String>>,
    pub reverse_adjacency: HashMap<String, Vec<String>>,
    pub importance_index: HashMap<String, f32>,
}

impl GraphIndex {
    pub fn build(storage: &FileStorage, heads: &HashMap<String, String>) -> MemoryResult<Self> {
        let mut index = Self::default();

        for (node_id, version_id) in heads {
            let version = storage.read_object(version_id)?;
            index
                .importance_index
                .insert(node_id.clone(), version.importance);

            let mut edges = Vec::new();
            for link in &version.content.links {
                edges.push(link.target.clone());
                index
                    .reverse_adjacency
                    .entry(link.target.clone())
                    .or_default()
                    .push(node_id.clone());
            }
            index.adjacency.insert(node_id.clone(), edges);
        }

        Ok(index)
    }

    pub fn bfs(&self, start: &str, depth_limit: Option<usize>) -> Vec<String> {
        let mut visited = HashSet::new();
        let mut queue = VecDeque::new();
        let mut order = Vec::new();

        queue.push_back((start.to_string(), 0usize));
        visited.insert(start.to_string());

        while let Some((node, depth)) = queue.pop_front() {
            order.push(node.clone());
            if depth_limit.is_some_and(|limit| depth >= limit) {
                continue;
            }
            if let Some(neighbors) = self.adjacency.get(&node) {
                for n in neighbors {
                    if visited.insert(n.clone()) {
                        queue.push_back((n.clone(), depth + 1));
                    }
                }
            }
        }

        order
    }

    pub fn dfs(&self, start: &str, depth_limit: Option<usize>) -> Vec<String> {
        let mut visited = HashSet::new();
        let mut order = Vec::new();
        self.dfs_impl(start, 0, depth_limit, &mut visited, &mut order);
        order
    }

    fn dfs_impl(
        &self,
        node: &str,
        depth: usize,
        depth_limit: Option<usize>,
        visited: &mut HashSet<String>,
        order: &mut Vec<String>,
    ) {
        if !visited.insert(node.to_string()) {
            return;
        }
        order.push(node.to_string());

        if depth_limit.is_some_and(|limit| depth >= limit) {
            return;
        }

        if let Some(neighbors) = self.adjacency.get(node) {
            for n in neighbors {
                self.dfs_impl(n, depth + 1, depth_limit, visited, order);
            }
        }
    }

    pub fn importance_first(&self, start: &str, depth_limit: Option<usize>) -> Vec<String> {
        let reachable = self.bfs(start, depth_limit);
        let mut scored: Vec<(String, f32)> = reachable
            .into_iter()
            .map(|n| {
                let score = self.importance_index.get(&n).copied().unwrap_or(0.0);
                (n, score)
            })
            .collect();

        scored.sort_by(|a, b| b.1.total_cmp(&a.1));
        scored.into_iter().map(|(n, _)| n).collect()
    }

    pub fn confidence_filtered(
        &self,
        start: &str,
        depth_limit: Option<usize>,
        min_confidence: f32,
        heads: &HashMap<String, String>,
        storage: &FileStorage,
    ) -> MemoryResult<Vec<String>> {
        let reachable = self.bfs(start, depth_limit);
        let mut out = Vec::new();

        for node_id in reachable {
            if let Some(version_id) = heads.get(&node_id) {
                let NodeVersion { confidence, .. } = storage.read_object(version_id)?;
                if confidence >= min_confidence {
                    out.push(node_id);
                }
            }
        }

        Ok(out)
    }

    pub fn neighbors(&self, node_id: &str) -> Vec<String> {
        self.adjacency.get(node_id).cloned().unwrap_or_default()
    }

    pub fn inbound_neighbors(&self, node_id: &str) -> Vec<String> {
        self.reverse_adjacency
            .get(node_id)
            .cloned()
            .unwrap_or_default()
    }
}
