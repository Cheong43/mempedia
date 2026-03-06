use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::core::{AccessLog, AccessStats, MemoryError, MemoryResult, Node, NodeVersion};

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

    fn access_state_path(&self) -> PathBuf {
        self.index_dir().join("access_state.json")
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

        {
            let mut file = fs::File::create(&tmp)?;
            file.write_all(&bytes)?;
            file.sync_all()?;
        }

        fs::rename(&tmp, &path)?;
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
}

fn sync_parent_dir(path: &Path) -> MemoryResult<()> {
    if let Some(parent) = path.parent() {
        let dir = fs::File::open(parent)?;
        dir.sync_all()?;
    }
    Ok(())
}
