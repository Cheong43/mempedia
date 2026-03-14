use std::collections::BTreeMap;

use crate::core::{NodeContent, NodeVersion};

pub struct ParsedMarkdown {
    pub content: NodeContent,
    pub frontmatter: BTreeMap<String, String>,
}

pub fn parse_markdown(markdown: &str) -> NodeContent {
    parse_markdown_with_meta(markdown).content
}

pub fn parse_markdown_with_meta(markdown: &str) -> ParsedMarkdown {
    let (frontmatter, body) = split_frontmatter(markdown);
    let body = body.trim().to_string();

    let title = extract_title(&body)
        .or_else(|| frontmatter.get("title").cloned())
        .unwrap_or_else(|| "Untitled".to_string());
    let summary_raw = frontmatter
        .get("summary")
        .cloned()
        .unwrap_or_else(|| derive_summary(&title, &body));
    let summary = normalize_summary(&summary_raw, &title, &body);
    let highlights = extract_highlights(&body);

    let mut structured_data = BTreeMap::new();
    structured_data.insert("content_type".to_string(), "markdown".to_string());
    for (k, v) in &frontmatter {
        structured_data.insert(format!("meta.{k}"), v.clone());
    }

    let sections = extract_structured_sections(&body);
    for (key, value) in sections.facts {
        insert_fact(&mut structured_data, &key, &value);
    }
    for evidence in sections.evidence {
        insert_evidence(&mut structured_data, &evidence);
    }

    ParsedMarkdown {
        content: NodeContent {
            title,
            summary,
            body,
            structured_data,
            links: vec![],
            highlights,
        },
        frontmatter,
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
    if let Some(source) = version
        .content
        .structured_data
        .get("meta.source")
        .map(|v| v.trim())
        .filter(|v| !v.is_empty())
    {
        out.push_str(&format!("source: {}\n", yaml_escape(source)));
    }
    if let Some(origin) = version
        .content
        .structured_data
        .get("meta.origin")
        .map(|v| v.trim())
        .filter(|v| !v.is_empty())
    {
        out.push_str(&format!("origin: {}\n", yaml_escape(origin)));
    }

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
            if value.is_empty() {
                continue;
            }
            if is_structure_heading(value) {
                continue;
            }
            if !out.iter().any(|x| x == value) {
                out.push(value.to_string());
            }
        }
        if out.len() >= 8 {
            break;
        }
    }
    out
}

#[derive(Default)]
struct StructuredSections {
    facts: Vec<(String, String)>,
    evidence: Vec<String>,
}

fn extract_structured_sections(body: &str) -> StructuredSections {
    let mut sections = StructuredSections::default();
    let mut current: Option<String> = None;

    for line in body.lines() {
        let trimmed = line.trim();
        if let Some(name) = trimmed.strip_prefix("## ") {
            current = normalize_section(name);
            continue;
        }
        if let Some(name) = trimmed.strip_prefix("### ") {
            current = normalize_section(name);
            continue;
        }
        let section = match current.as_deref() {
            Some(section) => section,
            None => continue,
        };
        if let Some(item) = strip_bullet_prefix(trimmed) {
            match section {
                "facts" => {
                    if let Some((k, v)) = parse_fact_line(item) {
                        sections.facts.push((k, v));
                    }
                }
                "evidence" => {
                    if !item.is_empty() {
                        sections.evidence.push(item.to_string());
                    }
                }
                _ => {}
            }
        }
    }

    sections
}

fn normalize_section(name: &str) -> Option<String> {
    let lower = name.trim().to_lowercase();
    match lower.as_str() {
        "facts" | "fact" | "claims" | "claim" => Some("facts".to_string()),
        "relations" | "relation" | "links" | "link" => Some("relations".to_string()),
        "evidence" | "sources" | "source" => Some("evidence".to_string()),
        _ => None,
    }
}

fn strip_bullet_prefix(line: &str) -> Option<&str> {
    let trimmed = line.trim_start();
    if let Some(rest) = trimmed.strip_prefix("- ") {
        return Some(rest.trim());
    }
    if let Some(rest) = trimmed.strip_prefix("* ") {
        return Some(rest.trim());
    }
    if let Some(rest) = trimmed.strip_prefix("+ ") {
        return Some(rest.trim());
    }
    None
}

fn parse_fact_line(line: &str) -> Option<(String, String)> {
    let (left, right) = if let Some((k, v)) = line.split_once(':') {
        (k, v)
    } else if let Some((k, v)) = line.split_once('=') {
        (k, v)
    } else {
        return None;
    };
    let key = normalize_fact_key(left);
    let value = right.trim();
    if key.is_empty() || value.is_empty() {
        return None;
    }
    Some((key, value.to_string()))
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

fn is_structure_heading(value: &str) -> bool {
    matches!(
        value.trim().to_lowercase().as_str(),
        "facts" | "fact" | "claims" | "relations" | "relation" | "links" | "evidence" | "sources"
    )
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

fn normalize_summary(summary: &str, title: &str, body: &str) -> String {
    let trimmed = summary.trim();
    let length = trimmed.chars().count();
    if (8..=140).contains(&length) {
        return trimmed.to_string();
    }
    derive_summary(title, body)
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
        assert!(parsed.links.is_empty());
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

    #[test]
    fn parse_structured_sections_inserts_facts_and_evidence() {
        let input = r#"---
node_id: note_x
summary: A summary long enough.
---
# Note X

## Facts
- Owner: Team Alpha
- Priority = High

## Relations
- [[Project_Y]] | depends_on | 0.9
- Related_Node(label=related, weight=0.6)

## Evidence
- Meeting notes 2024-03-01
- Ticket ABC-123
"#;
        let parsed = parse_markdown(input);
        assert_eq!(
            parsed
                .structured_data
                .get("fact.owner")
                .map(String::as_str),
            Some("Team Alpha")
        );
        assert_eq!(
            parsed
                .structured_data
                .get("fact.priority")
                .map(String::as_str),
            Some("High")
        );
        assert!(parsed.structured_data.get("evidence.01").is_some());
        assert!(parsed.links.is_empty());
    }
}
