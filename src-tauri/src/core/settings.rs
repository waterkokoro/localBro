//! Simple user-settings store backed by `<app_data>/settings.json`.
//!
//! Intentionally schema-free on disk: unknown keys are preserved on
//! round-trip so migrations and forward-compat are painless.

use std::fs;
use std::path::PathBuf;

use parking_lot::Mutex;
use serde_json::{Map, Value};
use tauri::{AppHandle, Manager};

use crate::core::error::{FsError, FsResult};

pub struct SettingsStore {
    path: PathBuf,
    inner: Mutex<Map<String, Value>>,
}

impl SettingsStore {
    pub fn load(app: &AppHandle) -> Self {
        let path = store_path(app);
        let map = fs::read(&path)
            .ok()
            .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
            .and_then(|v| if let Value::Object(m) = v { Some(m) } else { None })
            .unwrap_or_default();
        Self {
            path,
            inner: Mutex::new(map),
        }
    }

    pub fn all(&self) -> Value {
        Value::Object(self.inner.lock().clone())
    }

    pub fn get(&self, key: &str) -> Option<Value> {
        self.inner.lock().get(key).cloned()
    }

    pub fn set(&self, key: String, value: Value) -> FsResult<()> {
        let mut m = self.inner.lock();
        if value.is_null() {
            m.remove(&key);
        } else {
            m.insert(key, value);
        }
        self.persist(&m)
    }

    fn persist(&self, map: &Map<String, Value>) -> FsResult<()> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| FsError::from_io(parent.to_string_lossy().as_ref(), e))?;
        }
        let json = serde_json::to_vec_pretty(map)
            .map_err(|e| FsError::Internal(format!("serialize settings: {e}")))?;
        fs::write(&self.path, json)
            .map_err(|e| FsError::from_io(self.path.to_string_lossy().as_ref(), e))
    }
}

fn store_path(app: &AppHandle) -> PathBuf {
    let base = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("localbro"));
    base.join("settings.json")
}
