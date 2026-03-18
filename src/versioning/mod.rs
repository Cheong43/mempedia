use std::collections::HashMap;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::core::{MemoryError, MemoryResult, Node, NodeContent, NodePatch, NodeVersion};
use crate::merge::merge_content;
use crate::storage::{FileStorage, IndexSnapshot};

pub struct VersionEngine;

impl VersionEngine {
    pub fn create_node(
        storage: &FileStorage,
        heads: &mut HashMap<String, String>,
        nodes: &mut HashMap<String, Node>,
        node_id: &str,
        content: NodeContent,
        importance: f32,
    ) -> MemoryResult<NodeVersion> {
        validate_importance(importance)?;
        validate_content(&content)?;

        if heads.contains_key(node_id) {
            return Err(MemoryError::Invalid(format!(
                "node {node_id} already exists"
            )));
        }

        let mut version = NodeVersion {
            node_id: node_id.to_string(),
            version: String::new(),
            parents: vec![],
            timestamp: now_ts(),
            content,
            importance,
        };

        version.version = storage.write_object(&version)?;

        heads.insert(node_id.to_string(), version.version.clone());
        nodes.insert(
            node_id.to_string(),
            Node {
                id: node_id.to_string(),
                head: version.version.clone(),
                branches: vec![version.version.clone()],
            },
        );

        persist_index(storage, heads, nodes)?;
        Ok(version)
    }

    pub fn update_node(
        storage: &FileStorage,
        heads: &mut HashMap<String, String>,
        nodes: &mut HashMap<String, Node>,
        node_id: &str,
        patch: NodePatch,
        importance: f32,
    ) -> MemoryResult<NodeVersion> {
        validate_importance(importance)?;

        let head_id = heads
            .get(node_id)
            .ok_or_else(|| MemoryError::NotFound(format!("node {node_id} not found")))?
            .clone();
        let head = storage.read_object(&head_id)?;

        let mut content = head.content;
        apply_patch(&mut content, patch);
        validate_content(&content)?;

        let mut version = NodeVersion {
            node_id: node_id.to_string(),
            version: String::new(),
            parents: vec![head_id],
            timestamp: now_ts(),
            content,
            importance,
        };
        version.version = storage.write_object(&version)?;

        heads.insert(node_id.to_string(), version.version.clone());
        if let Some(node) = nodes.get_mut(node_id) {
            node.head = version.version.clone();
            append_unique(&mut node.branches, version.version.clone());
        }

        persist_index(storage, heads, nodes)?;
        Ok(version)
    }

    pub fn replace_node(
        storage: &FileStorage,
        heads: &mut HashMap<String, String>,
        nodes: &mut HashMap<String, Node>,
        node_id: &str,
        content: NodeContent,
        importance: f32,
    ) -> MemoryResult<NodeVersion> {
        validate_importance(importance)?;
        validate_content(&content)?;

        let head_id = heads
            .get(node_id)
            .ok_or_else(|| MemoryError::NotFound(format!("node {node_id} not found")))?
            .clone();

        let mut version = NodeVersion {
            node_id: node_id.to_string(),
            version: String::new(),
            parents: vec![head_id],
            timestamp: now_ts(),
            content,
            importance,
        };
        version.version = storage.write_object(&version)?;

        heads.insert(node_id.to_string(), version.version.clone());
        if let Some(node) = nodes.get_mut(node_id) {
            node.head = version.version.clone();
            append_unique(&mut node.branches, version.version.clone());
        }

        persist_index(storage, heads, nodes)?;
        Ok(version)
    }

    pub fn fork_node(
        storage: &FileStorage,
        heads: &mut HashMap<String, String>,
        nodes: &mut HashMap<String, Node>,
        node_id: &str,
    ) -> MemoryResult<NodeVersion> {
        let head_id = heads
            .get(node_id)
            .ok_or_else(|| MemoryError::NotFound(format!("node {node_id} not found")))?
            .clone();
        let head = storage.read_object(&head_id)?;

        let mut version = NodeVersion {
            node_id: node_id.to_string(),
            version: String::new(),
            parents: vec![head_id],
            timestamp: now_ts(),
            content: head.content,
            importance: head.importance,
        };
        version.version = storage.write_object(&version)?;

        if let Some(node) = nodes.get_mut(node_id) {
            append_unique(&mut node.branches, version.version.clone());
        }

        persist_index(storage, heads, nodes)?;
        Ok(version)
    }

    pub fn merge_node(
        storage: &FileStorage,
        heads: &mut HashMap<String, String>,
        nodes: &mut HashMap<String, Node>,
        node_id: &str,
        left_version: &str,
        right_version: &str,
    ) -> MemoryResult<NodeVersion> {
        let left = storage.read_object(left_version)?;
        let right = storage.read_object(right_version)?;
        if left.node_id != node_id || right.node_id != node_id {
            return Err(MemoryError::Invalid(
                "merge versions must belong to same node".to_string(),
            ));
        }

        let (content, _) = merge_content(&left, &right);
        validate_content(&content)?;

        let mut version = NodeVersion {
            node_id: node_id.to_string(),
            version: String::new(),
            parents: vec![left_version.to_string(), right_version.to_string()],
            timestamp: now_ts(),
            content,
            importance: left.importance.max(right.importance),
        };
        version.version = storage.write_object(&version)?;

        heads.insert(node_id.to_string(), version.version.clone());
        if let Some(node) = nodes.get_mut(node_id) {
            node.head = version.version.clone();
            append_unique(&mut node.branches, version.version.clone());
        }

        persist_index(storage, heads, nodes)?;
        Ok(version)
    }

    pub fn rollback_node(
        storage: &FileStorage,
        heads: &mut HashMap<String, String>,
        nodes: &mut HashMap<String, Node>,
        node_id: &str,
        target_version: &str,
        importance: f32,
    ) -> MemoryResult<NodeVersion> {
        validate_importance(importance)?;

        let current_head = heads
            .get(node_id)
            .ok_or_else(|| MemoryError::NotFound(format!("node {node_id} not found")))?
            .clone();
        let target = storage.read_object(target_version)?;
        if target.node_id != node_id {
            return Err(MemoryError::Invalid(format!(
                "version {target_version} does not belong to node {node_id}"
            )));
        }

        let mut parents = vec![current_head];
        append_unique(&mut parents, target_version.to_string());

        let mut version = NodeVersion {
            node_id: node_id.to_string(),
            version: String::new(),
            parents,
            timestamp: now_ts(),
            content: target.content,
            importance,
        };
        validate_content(&version.content)?;
        version.version = storage.write_object(&version)?;

        heads.insert(node_id.to_string(), version.version.clone());
        if let Some(node) = nodes.get_mut(node_id) {
            node.head = version.version.clone();
            append_unique(&mut node.branches, version.version.clone());
        }

        persist_index(storage, heads, nodes)?;
        Ok(version)
    }
}

fn apply_patch(content: &mut NodeContent, patch: NodePatch) {
    if let Some(title) = patch.title {
        content.title = title;
    }
    if let Some(summary) = patch.summary {
        content.summary = summary;
    }
    if let Some(body) = patch.body {
        content.body = body;
    }

    for (k, v) in patch.structured_upserts {
        content.structured_data.insert(k, v);
    }

    for link in patch.add_links {
        let exists = content
            .links
            .iter()
            .any(|existing| existing.target == link.target && existing.label == link.label);
        if !exists {
            content.links.push(link);
        }
    }

    for highlight in patch.add_highlights {
        let normalized = highlight.trim().to_lowercase();
        if normalized.is_empty() {
            continue;
        }
        let exists = content
            .highlights
            .iter()
            .any(|existing| existing.trim().to_lowercase() == normalized);
        if !exists {
            content.highlights.push(highlight);
        }
    }

    if let Some(project) = patch.project {
        content.project = Some(project).filter(|v| !v.trim().is_empty());
    }
    if let Some(parent_node) = patch.parent_node {
        content.parent_node = Some(parent_node).filter(|v| !v.trim().is_empty());
    }
    if let Some(node_type) = patch.node_type {
        content.node_type = Some(node_type).filter(|v| !v.trim().is_empty());
    }
}

fn persist_index(
    storage: &FileStorage,
    heads: &HashMap<String, String>,
    nodes: &HashMap<String, Node>,
) -> MemoryResult<()> {
    storage.persist_index_snapshot(&IndexSnapshot {
        heads: heads.clone(),
        nodes: nodes.clone(),
    })
}

fn validate_importance(importance: f32) -> MemoryResult<()> {
    if !importance.is_finite() || importance < 0.0 {
        return Err(MemoryError::Invalid(
            "importance must be finite and >= 0.0".to_string(),
        ));
    }
    Ok(())
}

fn validate_content(content: &NodeContent) -> MemoryResult<()> {
    let summary = content.summary.trim();
    if summary.is_empty() {
        return Err(MemoryError::Invalid(
            "summary is required and cannot be empty".to_string(),
        ));
    }
    let length = summary.chars().count();
    if !(8..=140).contains(&length) {
        return Err(MemoryError::Invalid(
            "summary length must be within [8, 140] characters".to_string(),
        ));
    }
    Ok(())
}

fn append_unique(items: &mut Vec<String>, value: String) {
    if !items.iter().any(|v| v == &value) {
        items.push(value);
    }
}

fn now_ts() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time before unix epoch")
        .as_secs()
}
