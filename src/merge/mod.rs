use std::collections::BTreeMap;

use crate::core::{MergeConflict, NodeContent, NodeVersion};

pub fn merge_content(left: &NodeVersion, right: &NodeVersion) -> (NodeContent, Vec<MergeConflict>) {
    let mut conflicts = Vec::new();
    let pick_right = right.timestamp > left.timestamp
        || (right.timestamp == left.timestamp && right.importance >= left.importance);

    let mut structured = BTreeMap::new();
    for (k, v) in &left.content.structured_data {
        structured.insert(k.clone(), v.clone());
    }
    for (k, rv) in &right.content.structured_data {
        if let Some(lv) = structured.get(k)
            && lv != rv
        {
            conflicts.push(MergeConflict::FieldConflict(k.clone()));
        }
        if pick_right || !structured.contains_key(k) {
            structured.insert(k.clone(), rv.clone());
        }
    }

    let title = if pick_right {
        right.content.title.clone()
    } else {
        left.content.title.clone()
    };
    let summary = if pick_right {
        right.content.summary.clone()
    } else {
        left.content.summary.clone()
    };

    let body = if pick_right {
        right.content.body.clone()
    } else {
        left.content.body.clone()
    };

    let mut links = left.content.links.clone();
    links.extend(right.content.links.clone());

    let mut highlights = left.content.highlights.clone();
    highlights.extend(right.content.highlights.clone());

    // For project-hierarchy fields, prefer the newer side.
    let project = if pick_right {
        right.content.project.clone().or_else(|| left.content.project.clone())
    } else {
        left.content.project.clone().or_else(|| right.content.project.clone())
    };
    let parent_node = if pick_right {
        right.content.parent_node.clone().or_else(|| left.content.parent_node.clone())
    } else {
        left.content.parent_node.clone().or_else(|| right.content.parent_node.clone())
    };
    let node_type = if pick_right {
        right.content.node_type.clone().or_else(|| left.content.node_type.clone())
    } else {
        left.content.node_type.clone().or_else(|| right.content.node_type.clone())
    };

    (
        NodeContent {
            title,
            summary,
            body,
            structured_data: structured,
            links,
            highlights,
            project,
            parent_node,
            node_type,
        },
        conflicts,
    )
}
