use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::core::{
    AccessLog, AccessStats, AgentActionLog, BehaviorPatternRecord, EpisodicMemoryRecord,
    MemoryError, MemoryResult, Node, NodeVersion, SkillRecord, UserHabitEnv,
};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct EmbeddingCache {
    pub vectors: HashMap<String, CachedVector>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CachedVector {
    pub version: String,
    pub dim: usize,
    pub vector: Vec<f32>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct IndexSnapshot {
    pub heads: HashMap<String, String>,
    pub nodes: HashMap<String, Node>,
}

#[derive(Debug, Clone)]
pub struct FileStorage {
    root: PathBuf,
}

impl FileStorage {
    pub fn new<P: AsRef<Path>>(root: P) -> MemoryResult<Self> {
        let root = root.as_ref().to_path_buf();
        let storage = Self { root };
        storage.ensure_layout()?;
        Ok(storage)
    }

    fn ensure_layout(&self) -> MemoryResult<()> {
        fs::create_dir_all(self.index_dir())?;
        fs::create_dir_all(self.objects_dir())?;
        fs::create_dir_all(self.knowledge_nodes_dir())?;
        fs::create_dir_all(self.episodic_dir())?;
        fs::create_dir_all(self.skills_dir())?;
        Ok(())
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    fn index_dir(&self) -> PathBuf {
        self.root.join("index")
    }

    fn objects_dir(&self) -> PathBuf {
        self.root.join("objects")
    }

    fn knowledge_dir(&self) -> PathBuf {
        self.root.join("knowledge")
    }

    fn knowledge_nodes_dir(&self) -> PathBuf {
        self.knowledge_dir().join("nodes")
    }

    fn nodes_path(&self) -> PathBuf {
        self.index_dir().join("nodes.json")
    }

    fn heads_path(&self) -> PathBuf {
        self.index_dir().join("heads.json")
    }

    fn index_state_path(&self) -> PathBuf {
        self.index_dir().join("state.json")
    }

    fn access_log_path(&self) -> PathBuf {
        self.index_dir().join("access.log")
    }

    fn habits_path(&self) -> PathBuf {
        self.index_dir().join("user_habits.jsonl")
    }

    fn patterns_path(&self) -> PathBuf {
        self.index_dir().join("behavior_patterns.jsonl")
    }

    fn habits_state_path(&self) -> PathBuf {
        self.index_dir().join("user_habits_state.json")
    }

    fn patterns_state_path(&self) -> PathBuf {
        self.index_dir().join("behavior_patterns_state.json")
    }

    fn access_state_path(&self) -> PathBuf {
        self.index_dir().join("access_state.json")
    }

    fn agent_action_log_path(&self) -> PathBuf {
        self.index_dir().join("agent_actions.log")
    }

    fn embeddings_path(&self) -> PathBuf {
        self.index_dir().join("embeddings.json")
    }

    fn markdown_node_path(&self, node_id: &str) -> PathBuf {
        let digest = blake3::hash(node_id.as_bytes()).to_hex();
        let safe_name = sanitize_node_id(node_id);
        self.knowledge_nodes_dir()
            .join(format!("{safe_name}-{}.md", &digest[..8]))
    }

    fn episodic_dir(&self) -> PathBuf {
        self.root.join("episodic")
    }

    fn episodic_memories_path(&self) -> PathBuf {
        self.episodic_dir().join("memories.jsonl")
    }

    fn preferences_path(&self) -> PathBuf {
        self.root.join("preferences.md")
    }

    fn skills_dir(&self) -> PathBuf {
        self.root.join("skills")
    }

    fn skill_path(&self, skill_id: &str) -> PathBuf {
        let safe = sanitize_node_id(skill_id);
        let digest = blake3::hash(skill_id.as_bytes()).to_hex();
        self.skills_dir().join(format!("{safe}-{}.md", &digest[..8]))
    }

    pub fn load_index_snapshot(&self) -> MemoryResult<IndexSnapshot> {
        let state_path = self.index_state_path();
        if state_path.exists() {
            return self.load_json(state_path);
        }

        // Compatibility fallback for older layout.
        Ok(IndexSnapshot {
            heads: self.load_json(self.heads_path())?,
            nodes: self.load_json(self.nodes_path())?,
        })
    }

    pub fn persist_index_snapshot(&self, snapshot: &IndexSnapshot) -> MemoryResult<()> {
        self.atomic_write_json(self.index_state_path(), snapshot)?;

        // Keep legacy files in sync for readability/tools.
        self.atomic_write_json(self.heads_path(), &snapshot.heads)?;
        self.atomic_write_json(self.nodes_path(), &snapshot.nodes)?;
        Ok(())
    }

    pub fn load_access_state(&self) -> MemoryResult<HashMap<String, AccessStats>> {
        self.load_json(self.access_state_path())
    }

    pub fn persist_access_state(
        &self,
        access_state: &HashMap<String, AccessStats>,
    ) -> MemoryResult<()> {
        self.atomic_write_json(self.access_state_path(), access_state)
    }

    pub fn load_embedding_cache(&self) -> MemoryResult<EmbeddingCache> {
        self.load_json(self.embeddings_path())
    }

    pub fn persist_embedding_cache(&self, cache: &EmbeddingCache) -> MemoryResult<()> {
        self.atomic_write_json(self.embeddings_path(), cache)
    }

    fn load_json<T: serde::de::DeserializeOwned + Default>(
        &self,
        path: PathBuf,
    ) -> MemoryResult<T> {
        if !path.exists() {
            return Ok(T::default());
        }
        let bytes = fs::read(path)?;
        Ok(serde_json::from_slice(&bytes)?)
    }

    fn atomic_write_json<T: serde::Serialize>(&self, path: PathBuf, value: &T) -> MemoryResult<()> {
        let tmp = path.with_extension("tmp");
        let bytes = serde_json::to_vec_pretty(value)?;
        self.atomic_write_bytes(path, &tmp, &bytes)
    }

    fn atomic_write_bytes(&self, path: PathBuf, tmp: &Path, bytes: &[u8]) -> MemoryResult<()> {
        {
            let mut file = fs::File::create(tmp)?;
            file.write_all(&bytes)?;
            file.sync_all()?;
        }

        fs::rename(tmp, &path)?;
        sync_parent_dir(&path)?;
        Ok(())
    }

    pub fn write_object(&self, version: &NodeVersion) -> MemoryResult<String> {
        // Hash must be stable and cannot depend on its own id field.
        let mut normalized = version.clone();
        normalized.version.clear();
        let hash_input = serde_json::to_vec(&normalized)?;
        let version_id = blake3::hash(&hash_input).to_hex().to_string();

        normalized.version = version_id.clone();
        let bytes = serde_json::to_vec(&normalized)?;

        let prefix = &version_id[0..2];
        let dir = self.objects_dir().join(prefix);
        fs::create_dir_all(&dir)?;

        let file = dir.join(format!("{version_id}.json"));
        if !file.exists() {
            let tmp = file.with_extension("tmp");
            {
                let mut f = fs::File::create(&tmp)?;
                f.write_all(&bytes)?;
                f.sync_all()?;
            }
            fs::rename(&tmp, &file)?;
            sync_parent_dir(&file)?;
        }

        Ok(version_id)
    }

    pub fn read_object(&self, version_id: &str) -> MemoryResult<NodeVersion> {
        if version_id.len() < 2 {
            return Err(MemoryError::Invalid("version id too short".to_string()));
        }
        let prefix = &version_id[0..2];
        let file = self
            .objects_dir()
            .join(prefix)
            .join(format!("{version_id}.json"));
        if !file.exists() {
            return Err(MemoryError::NotFound(format!(
                "version object {version_id} missing"
            )));
        }

        let bytes = fs::read(file)?;
        Ok(serde_json::from_slice(&bytes)?)
    }

    pub fn append_access_log(&self, log: &AccessLog) -> MemoryResult<()> {
        let line = serde_json::to_string(log)?;
        let mut f = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(self.access_log_path())?;
        writeln!(f, "{line}")?;
        f.sync_all()?;
        Ok(())
    }

    pub fn append_agent_action_log(&self, log: &AgentActionLog) -> MemoryResult<()> {
        let line = serde_json::to_string(log)?;
        let mut f = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(self.agent_action_log_path())?;
        writeln!(f, "{line}")?;
        f.sync_all()?;
        Ok(())
    }

    pub fn append_user_habit(&self, record: &UserHabitEnv) -> MemoryResult<()> {
        let line = serde_json::to_string(record)?;
        let mut f = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(self.habits_path())?;
        writeln!(f, "{line}")?;
        f.sync_all()?;
        let mut state: HashMap<String, UserHabitEnv> = self.load_json(self.habits_state_path())?;
        state.insert(record.topic.clone(), record.clone());
        self.atomic_write_json(self.habits_state_path(), &state)?;
        Ok(())
    }

    pub fn append_behavior_pattern(&self, record: &BehaviorPatternRecord) -> MemoryResult<()> {
        let line = serde_json::to_string(record)?;
        let mut f = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(self.patterns_path())?;
        writeln!(f, "{line}")?;
        f.sync_all()?;
        let mut state: HashMap<String, BehaviorPatternRecord> =
            self.load_json(self.patterns_state_path())?;
        state.insert(record.pattern_key.clone(), record.clone());
        self.atomic_write_json(self.patterns_state_path(), &state)?;
        Ok(())
    }

    pub fn read_user_habits(&self, limit: usize) -> MemoryResult<Vec<UserHabitEnv>> {
        read_json_lines(self.habits_path(), limit)
    }

    pub fn read_behavior_patterns(&self, limit: usize) -> MemoryResult<Vec<BehaviorPatternRecord>> {
        read_json_lines(self.patterns_path(), limit)
    }

    pub fn write_markdown_node(&self, node_id: &str, markdown: &str) -> MemoryResult<PathBuf> {
        let path = self.markdown_node_path(node_id);
        let tmp = path.with_extension("tmp");
        self.atomic_write_bytes(path.clone(), &tmp, markdown.as_bytes())?;
        Ok(path)
    }

    pub fn read_markdown_node(&self, node_id: &str) -> MemoryResult<Option<(PathBuf, String)>> {
        let path = self.markdown_node_path(node_id);
        if !path.exists() {
            return Ok(None);
        }
        let content = fs::read_to_string(&path)?;
        Ok(Some((path, content)))
    }

    // ── Episodic memory ──────────────────────────────────────────────────────

    pub fn append_episodic_memory(&self, record: &EpisodicMemoryRecord) -> MemoryResult<()> {
        let line = serde_json::to_string(record)?;
        let mut f = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(self.episodic_memories_path())?;
        writeln!(f, "{line}")?;
        f.sync_all()?;
        Ok(())
    }

    /// Return up to `limit` episodic memories, newest first.
    /// If `before_ts` is provided, only records with timestamp < before_ts are returned.
    pub fn list_episodic_memories(
        &self,
        limit: usize,
        before_ts: Option<u64>,
    ) -> MemoryResult<Vec<EpisodicMemoryRecord>> {
        let path = self.episodic_memories_path();
        if !path.exists() || limit == 0 {
            return Ok(Vec::new());
        }
        let text = fs::read_to_string(path)?;
        let mut records: Vec<EpisodicMemoryRecord> = Vec::new();
        for line in text.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            if let Ok(rec) = serde_json::from_str::<EpisodicMemoryRecord>(trimmed) {
                if let Some(ts) = before_ts {
                    if rec.timestamp >= ts {
                        continue;
                    }
                }
                records.push(rec);
            }
        }
        // Sort newest first
        records.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
        if records.len() > limit {
            records.truncate(limit);
        }
        Ok(records)
    }

    // ── User preferences ─────────────────────────────────────────────────────

    pub fn read_user_preferences(&self) -> MemoryResult<String> {
        let path = self.preferences_path();
        if !path.exists() {
            return Ok(String::new());
        }
        Ok(fs::read_to_string(path)?)
    }

    pub fn write_user_preferences(&self, content: &str) -> MemoryResult<()> {
        let path = self.preferences_path();
        let tmp = path.with_extension("tmp");
        self.atomic_write_bytes(path, &tmp, content.as_bytes())
    }

    // ── Agent skills ─────────────────────────────────────────────────────────

    pub fn upsert_skill(
        &self,
        skill_id: &str,
        title: &str,
        content: &str,
        tags: &[String],
        updated_at: u64,
    ) -> MemoryResult<PathBuf> {
        let frontmatter = format!(
            "---\nskill_id: \"{}\"\ntitle: \"{}\"\ntags: [{}]\nupdated_at: {}\n---\n\n",
            skill_id.replace('"', "\\\""),
            title.replace('"', "\\\""),
            tags.iter()
                .map(|t| format!("\"{}\"", t.replace('"', "\\\"")))
                .collect::<Vec<_>>()
                .join(", "),
            updated_at,
        );
        let full = format!("{frontmatter}{content}");
        let path = self.skill_path(skill_id);
        let tmp = path.with_extension("tmp");
        self.atomic_write_bytes(path.clone(), &tmp, full.as_bytes())?;
        Ok(path)
    }

    pub fn read_skill(&self, skill_id: &str) -> MemoryResult<Option<SkillRecord>> {
        let path = self.skill_path(skill_id);
        if !path.exists() {
            return Ok(None);
        }
        let text = fs::read_to_string(path)?;
        Ok(Some(parse_skill_file(skill_id, &text)))
    }

    pub fn list_skills(&self) -> MemoryResult<Vec<SkillRecord>> {
        let dir = self.skills_dir();
        if !dir.exists() {
            return Ok(Vec::new());
        }
        let mut skills = Vec::new();
        for entry in fs::read_dir(&dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("md") {
                continue;
            }
            if let Ok(text) = fs::read_to_string(&path) {
                let stem = path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("skill");
                // Derive skill_id: strip the trailing -<hash8> suffix added by skill_path().
                let skill_id = if let Some(pos) = stem.rfind('-') {
                    if stem.len() - pos - 1 == 8 {
                        &stem[..pos]
                    } else {
                        stem
                    }
                } else {
                    stem
                };
                skills.push(parse_skill_file(skill_id, &text));
            }
        }
        skills.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        Ok(skills)
    }
}

fn sync_parent_dir(path: &Path) -> MemoryResult<()> {
    if let Some(parent) = path.parent() {
        let dir = fs::File::open(parent)?;
        dir.sync_all()?;
    }
    Ok(())
}

fn read_json_lines<T: serde::de::DeserializeOwned>(
    path: PathBuf,
    limit: usize,
) -> MemoryResult<Vec<T>> {
    if !path.exists() || limit == 0 {
        return Ok(Vec::new());
    }
    let text = fs::read_to_string(path)?;
    let mut out = Vec::new();
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        match serde_json::from_str::<T>(trimmed) {
            Ok(row) => {
                out.push(row);
                if out.len() >= limit {
                    break;
                }
            }
            Err(_) => continue,
        }
    }
    Ok(out)
}

fn sanitize_node_id(node_id: &str) -> String {
    let mut out = String::with_capacity(node_id.len());
    for ch in node_id.chars() {
        if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
            out.push(ch.to_ascii_lowercase());
        } else {
            out.push('_');
        }
    }

    let trimmed = out.trim_matches('_');
    if trimmed.is_empty() {
        "node".to_string()
    } else {
        trimmed.to_string()
    }
}

/// Parse a skill markdown file (with optional YAML frontmatter) into a `SkillRecord`.
fn parse_skill_file(skill_id: &str, text: &str) -> SkillRecord {
    let fm_match = text.match_indices("---").collect::<Vec<_>>();
    if fm_match.len() >= 2 && fm_match[0].0 == 0 {
        let fm_end = fm_match[1].0 + 3;
        let frontmatter = &text[3..fm_match[1].0];
        let body = text[fm_end..].trim_start().to_string();

        let mut title = skill_id.to_string();
        let mut tags: Vec<String> = Vec::new();
        let mut updated_at: u64 = 0;
        let mut parsed_skill_id = skill_id.to_string();

        for line in frontmatter.lines() {
            let line = line.trim();
            if let Some(val) = line.strip_prefix("skill_id:") {
                parsed_skill_id = val.trim().trim_matches('"').to_string();
            } else if let Some(val) = line.strip_prefix("title:") {
                title = val.trim().trim_matches('"').to_string();
            } else if let Some(val) = line.strip_prefix("updated_at:") {
                updated_at = val.trim().parse().unwrap_or(0);
            } else if let Some(val) = line.strip_prefix("tags:") {
                // Parse simple inline array: ["a", "b"]
                let inner = val.trim().trim_start_matches('[').trim_end_matches(']');
                tags = inner
                    .split(',')
                    .map(|s| s.trim().trim_matches('"').to_string())
                    .filter(|s| !s.is_empty())
                    .collect();
            }
        }

        SkillRecord {
            id: if parsed_skill_id.is_empty() { skill_id.to_string() } else { parsed_skill_id },
            title,
            content: body,
            tags,
            updated_at,
        }
    } else {
        // No frontmatter – derive title from first heading
        let title = text
            .lines()
            .find_map(|line| {
                let l = line.trim();
                if l.starts_with("# ") { Some(l[2..].trim().to_string()) } else { None }
            })
            .unwrap_or_else(|| skill_id.to_string());
        SkillRecord {
            id: skill_id.to_string(),
            title,
            content: text.to_string(),
            tags: Vec::new(),
            updated_at: 0,
        }
    }
}
