//! Directory size index with in-memory cache. For Task 3 in the plan we
//! ship a pragmatic v1: an on-demand recursive scan that reports progress
//! via Tauri events. A full `notify` crate watcher for incremental updates
//! will land in a later iteration (see plan milestone v0.2).

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::thread;

use parking_lot::Mutex;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::core::error::{FsError, FsResult};

#[derive(Debug, Clone, Copy, Serialize)]
pub struct SizeInfo {
    pub bytes: u64,
    pub file_count: u64,
    /// Unix millis of when the scan finished.
    pub computed_ms: i64,
}

/// Event payload emitted when a directory size scan completes.
#[derive(Debug, Clone, Serialize)]
pub struct SizeUpdatedEvent {
    pub path: String,
    pub bytes: u64,
    pub file_count: u64,
}

/// Shared cache of computed directory sizes, keyed by absolute path string.
#[derive(Default)]
pub struct SizeIndex {
    cache: Mutex<HashMap<String, SizeInfo>>,
    /// Paths currently being scanned. Used to coalesce duplicate requests.
    inflight: Mutex<HashMap<String, ()>>,
}

impl SizeIndex {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn get(&self, path: &str) -> Option<SizeInfo> {
        self.cache.lock().get(path).copied()
    }

    pub fn invalidate(&self, path: &str) {
        self.cache.lock().remove(path);
    }
}

/// Spawn a background scan for `path`. Updates the shared `index` and emits
/// a `size-updated` event on the app handle when complete.
///
/// Returns `true` if a new scan was started, `false` if one was already in
/// flight or the path is already cached.
pub fn spawn_scan(app: AppHandle, index: Arc<SizeIndex>, path: String) -> bool {
    if index.get(&path).is_some() {
        return false;
    }

    {
        let mut inflight = index.inflight.lock();
        if inflight.contains_key(&path) {
            return false;
        }
        inflight.insert(path.clone(), ());
    }

    thread::spawn(move || {
        let result = scan(&path);
        let now_ms = chrono::Utc::now().timestamp_millis();

        match result {
            Ok((bytes, file_count)) => {
                let info = SizeInfo {
                    bytes,
                    file_count,
                    computed_ms: now_ms,
                };
                index.cache.lock().insert(path.clone(), info);

                let _ = app.emit(
                    "size-updated",
                    SizeUpdatedEvent {
                        path: path.clone(),
                        bytes,
                        file_count,
                    },
                );
            }
            Err(_) => {
                // Leave the cache empty; the frontend simply won't receive an update.
            }
        }

        index.inflight.lock().remove(&path);
    });

    true
}

fn scan(path: &str) -> FsResult<(u64, u64)> {
    let p = PathBuf::from(path);
    if !p.exists() {
        return Err(FsError::NotFound(path.to_string()));
    }
    if !p.is_dir() {
        return Err(FsError::InvalidPath(format!("not a directory: {path}")));
    }

    let mut bytes: u64 = 0;
    let mut file_count: u64 = 0;

    let walker = walkdir::WalkDir::new(&p)
        .follow_links(false)
        .same_file_system(false)
        .into_iter();

    for entry in walker.filter_map(|e| e.ok()) {
        let ft = entry.file_type();
        if ft.is_file() {
            if let Ok(meta) = entry.metadata() {
                bytes = bytes.saturating_add(meta.len());
                file_count += 1;
            }
        }
    }

    Ok((bytes, file_count))
}
