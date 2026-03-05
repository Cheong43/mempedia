use std::collections::BTreeMap;

use crate::core::{MergeConflict, NodeContent, NodeVersion};

pub fn merge_content(left: &NodeVersion, right: &NodeVersion) -> (NodeContent, Vec<MergeConflict>) {
    let mut conflicts = Vec::new();
    let pick_right = right.confidence > left.confidence;

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

    let body = if pick_right {
        right.content.body.clone()
    } else {
        left.content.body.clone()
    };

    let mut links = left.content.links.clone();
    links.extend(right.content.links.clone());

    let mut highlights = left.content.highlights.clone();
    highlights.extend(right.content.highlights.clone());

    (
        NodeContent {
            title,
            body,
            structured_data: structured,
            links,
            highlights,
        },
        conflicts,
    )
}
