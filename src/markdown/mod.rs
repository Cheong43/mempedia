use std::collections::BTreeMap;

use crate::core::{Link, NodeContent, NodeVersion};

pub fn parse_markdown(markdown: &str) -> NodeContent {
    let (frontmatter, body) = split_frontmatter(markdown);
    let body = body.trim().to_string();
    let title = extract_title(&body).unwrap_or_else(|| "Untitled".to_string());
    let summary = frontmatter
        .get("summary")
        .cloned()
        .unwrap_or_else(|| derive_summary(&title, &body));
    let highlights = extract_highlights(&body);
    let links = extract_wikilinks(&body)
        .into_iter()
        .map(|target| Link {
            target,
            label: Some("wikilink".to_string()),
            weight: 0.8,
        })
        .collect();

    let mut structured_data = BTreeMap::new();
    structured_data.insert("content_type".to_string(), "markdown".to_string());
    for (k, v) in frontmatter {
        structured_data.insert(format!("meta.{k}"), v);
    }

    NodeContent {
        title,
        summary,
        body,
        structured_data,
        links,
        highlights,
    }
}

pub fn render_node_markdown(node_id: &str, version: &NodeVersion) -> String {
    let mut out = String::new();
    out.push_str("---\n");
    out.push_str(&format!("node_id: {}\n", yaml_escape(node_id)));
    out.push_str(&format!("version: {}\n", yaml_escape(&version.version)));
    out.push_str(&format!("timestamp: {}\n", version.timestamp));
    out.push_str(&format!("confidence: {:.4}\n", version.confidence));
    out.push_str(&format!("importance: {:.4}\n", version.importance));
    out.push_str(&format!("title: {}\n", yaml_escape(&version.content.title)));
    out.push_str(&format!(
        "summary: {}\n",
        yaml_escape(&version.content.summary)
    ));

    if version.parents.is_empty() {
        out.push_str("parents: []\n");
    } else {
        out.push_str("parents:\n");
        for parent in &version.parents {
            out.push_str(&format!("  - {}\n", yaml_escape(parent)));
        }
    }
    out.push_str("---\n\n");

    if version.content.body.trim().is_empty() {
        out.push_str("# ");
        out.push_str(&version.content.title);
        out.push('\n');
    } else {
        out.push_str(version.content.body.trim_end());
        out.push('\n');
    }

    out
}

fn split_frontmatter(markdown: &str) -> (BTreeMap<String, String>, String) {
    let mut meta = BTreeMap::new();
    let trimmed = markdown.trim_start();
    if !trimmed.starts_with("---\n") {
        return (meta, markdown.to_string());
    }

    let mut lines = trimmed.lines();
    let _ = lines.next();

    let mut meta_lines = Vec::new();
    let mut body_lines = Vec::new();
    let mut in_meta = true;
    for line in lines {
        if in_meta && line.trim() == "---" {
            in_meta = false;
            continue;
        }

        if in_meta {
            meta_lines.push(line.to_string());
        } else {
            body_lines.push(line.to_string());
        }
    }

    if in_meta {
        return (BTreeMap::new(), markdown.to_string());
    }

    for line in meta_lines {
        if let Some((k, v)) = line.split_once(':') {
            let key = k.trim();
            if key.is_empty() {
                continue;
            }
            meta.insert(key.to_string(), v.trim().trim_matches('"').to_string());
        }
    }

    (meta, body_lines.join("\n"))
}

fn extract_title(body: &str) -> Option<String> {
    for line in body.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("# ") {
            let title = rest.trim();
            if !title.is_empty() {
                return Some(title.to_string());
            }
        }
    }

    for line in body.lines() {
        let trimmed = line.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.chars().take(120).collect());
        }
    }

    None
}

fn extract_highlights(body: &str) -> Vec<String> {
    let mut out = Vec::new();
    for line in body.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('#') {
            let value = trimmed.trim_start_matches('#').trim();
            if !value.is_empty() && !out.iter().any(|x| x == value) {
                out.push(value.to_string());
            }
        }
        if out.len() >= 8 {
            break;
        }
    }
    out
}

fn extract_wikilinks(body: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cursor = 0usize;
    while let Some(start_rel) = body[cursor..].find("[[") {
        let start = cursor + start_rel + 2;
        if let Some(end_rel) = body[start..].find("]]") {
            let end = start + end_rel;
            let target = body[start..end].trim();
            if !target.is_empty() && !out.iter().any(|x| x == target) {
                out.push(target.to_string());
            }
            cursor = end + 2;
        } else {
            break;
        }
    }
    out
}

fn derive_summary(title: &str, body: &str) -> String {
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

fn yaml_escape(input: &str) -> String {
    format!("\"{}\"", input.replace('\\', "\\\\").replace('\"', "\\\""))
}

#[cfg(test)]
mod tests {
    use super::{parse_markdown, render_node_markdown};
    use crate::core::NodeVersion;

    #[test]
    fn parse_keeps_markdown_body_and_meta() {
        let input = r#"---
source: chat
topic: memory
---
# Memory Design

Link to [[Node_A]].
"#;
        let parsed = parse_markdown(input);
        assert_eq!(parsed.title, "Memory Design");
        assert!(!parsed.summary.trim().is_empty());
        assert!(parsed.body.contains("Link to [[Node_A]]"));
        assert_eq!(
            parsed
                .structured_data
                .get("meta.source")
                .map(String::as_str),
            Some("chat")
        );
        assert_eq!(parsed.links.len(), 1);
    }

    #[test]
    fn render_includes_frontmatter() {
        let version = NodeVersion {
            node_id: "node-a".to_string(),
            version: "v1".to_string(),
            parents: vec![],
            timestamp: 123,
            content: parse_markdown("# Title\n\nbody"),
            confidence: 0.8,
            importance: 1.5,
        };

        let markdown = render_node_markdown("node-a", &version);
        assert!(markdown.contains("node_id: \"node-a\""));
        assert!(markdown.contains("summary: "));
        assert!(markdown.contains("---"));
        assert!(markdown.contains("# Title"));
    }
}
