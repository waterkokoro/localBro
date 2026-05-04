//! Themed "Collections" — user-curated groups of files and folders.
//!
//! Persisted as JSON in `<app_data>/collections.json`. Items are stored as
//! absolute paths; on load the caller is expected to filter out missing
//! entries. This keeps us schema-free for v0.2 and trivially migrates into
//! SQLite later (Task 5.5).

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Arc;

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::core::error::{FsError, FsResult};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Collection {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub icon: Option<String>,
    pub created_ms: i64,
    pub updated_ms: i64,
    /// Ordered list of absolute paths belonging to this collection.
    pub items: Vec<String>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct StoreFile {
    #[serde(default)]
    collections: Vec<Collection>,
}

pub struct CollectionStore {
    path: PathBuf,
    inner: Mutex<HashMap<String, Collection>>,
}

impl CollectionStore {
    pub fn load(app: &AppHandle) -> Arc<Self> {
        let path = store_path(app);
        let mut map = HashMap::new();
        if let Ok(bytes) = fs::read(&path) {
            if let Ok(file) = serde_json::from_slice::<StoreFile>(&bytes) {
                for c in file.collections {
                    map.insert(c.id.clone(), c);
                }
            }
        }
        Arc::new(Self {
            path,
            inner: Mutex::new(map),
        })
    }

    fn persist(&self, inner: &HashMap<String, Collection>) -> FsResult<()> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| FsError::from_io(parent.to_string_lossy().as_ref(), e))?;
        }
        let mut collections: Vec<Collection> = inner.values().cloned().collect();
        collections.sort_by(|a, b| a.created_ms.cmp(&b.created_ms));
        let file = StoreFile { collections };
        let json = serde_json::to_vec_pretty(&file)
            .map_err(|e| FsError::Internal(format!("serialize collections: {e}")))?;
        fs::write(&self.path, json)
            .map_err(|e| FsError::from_io(self.path.to_string_lossy().as_ref(), e))?;
        Ok(())
    }

    pub fn list(&self) -> Vec<Collection> {
        let inner = self.inner.lock();
        let mut out: Vec<Collection> = inner.values().cloned().collect();
        out.sort_by(|a, b| a.created_ms.cmp(&b.created_ms));
        out
    }

    pub fn get(&self, id: &str) -> Option<Collection> {
        self.inner.lock().get(id).cloned()
    }

    pub fn create(&self, name: String, color: Option<String>, icon: Option<String>) -> FsResult<Collection> {
        let now = now_ms();
        let c = Collection {
            id: new_id(),
            name,
            color,
            icon,
            created_ms: now,
            updated_ms: now,
            items: Vec::new(),
        };
        let mut inner = self.inner.lock();
        inner.insert(c.id.clone(), c.clone());
        self.persist(&inner)?;
        Ok(c)
    }

    pub fn update(&self, id: &str, name: Option<String>, color: Option<Option<String>>, icon: Option<Option<String>>) -> FsResult<Collection> {
        let mut inner = self.inner.lock();
        let c = inner
            .get_mut(id)
            .ok_or_else(|| FsError::NotFound(format!("collection {id}")))?;
        if let Some(n) = name { c.name = n; }
        if let Some(col) = color { c.color = col; }
        if let Some(ic) = icon { c.icon = ic; }
        c.updated_ms = now_ms();
        let out = c.clone();
        self.persist(&inner)?;
        Ok(out)
    }

    pub fn delete(&self, id: &str) -> FsResult<()> {
        let mut inner = self.inner.lock();
        if inner.remove(id).is_none() {
            return Err(FsError::NotFound(format!("collection {id}")));
        }
        self.persist(&inner)
    }

    pub fn add_items(&self, id: &str, paths: Vec<String>) -> FsResult<Collection> {
        let mut inner = self.inner.lock();
        let c = inner
            .get_mut(id)
            .ok_or_else(|| FsError::NotFound(format!("collection {id}")))?;
        for p in paths {
            if !c.items.iter().any(|x| x == &p) {
                c.items.push(p);
            }
        }
        c.updated_ms = now_ms();
        let out = c.clone();
        self.persist(&inner)?;
        Ok(out)
    }

    pub fn remove_items(&self, id: &str, paths: Vec<String>) -> FsResult<Collection> {
        let mut inner = self.inner.lock();
        let c = inner
            .get_mut(id)
            .ok_or_else(|| FsError::NotFound(format!("collection {id}")))?;
        c.items.retain(|p| !paths.iter().any(|x| x == p));
        c.updated_ms = now_ms();
        let out = c.clone();
        self.persist(&inner)?;
        Ok(out)
    }

    /// Compute set of collection ids that contain the given path.
    #[allow(dead_code)]
    pub fn membership(&self, path: &str) -> Vec<String> {
        let inner = self.inner.lock();
        inner
            .values()
            .filter(|c| c.items.iter().any(|p| p == path))
            .map(|c| c.id.clone())
            .collect()
    }
}

fn store_path(app: &AppHandle) -> PathBuf {
    let base = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("localbro"));
    base.join("collections.json")
}

fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn new_id() -> String {
    // Simple time-based id; collision probability is negligible at UI scale.
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("col_{nanos:x}")
}
