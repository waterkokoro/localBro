//! Tauri command handlers that expose the Rust core to the webview.

use std::sync::Arc;

use tauri::{AppHandle, State};

use crate::core::error::FsResult;
use crate::core::fs_ops::{self, FsEntry, ListOptions};
use crate::core::paths::{self, Shortcut};
use crate::core::size_index::{self, SizeIndex, SizeInfo};
use crate::core::archive::{self, ArchiveEntry, ExtractResult};
use crate::core::ai_guard::AiGuard;
use crate::core::collections::{Collection, CollectionStore};
use crate::core::pack::{self, PackInfo, PackKind};
use crate::core::settings::SettingsStore;

#[tauri::command]
pub fn list_dir(path: String, options: Option<ListOptions>) -> FsResult<Vec<FsEntry>> {
    fs_ops::list_dir(&path, options.unwrap_or_default())
}

#[tauri::command]
pub fn stat(path: String) -> FsResult<FsEntry> {
    fs_ops::stat(&path)
}

#[tauri::command]
pub fn parent_of(path: String) -> FsResult<String> {
    fs_ops::parent_of(&path)
}

#[tauri::command]
pub fn home_path() -> String {
    paths::home_path()
}

#[tauri::command]
pub fn default_shortcuts() -> Vec<Shortcut> {
    paths::default_shortcuts()
}

#[tauri::command]
pub fn list_volumes() -> FsResult<Vec<Shortcut>> {
    paths::list_volumes()
}

#[tauri::command]
pub fn create_directory(path: String) -> FsResult<()> {
    fs_ops::create_directory(&path)
}

#[tauri::command]
pub fn create_file(path: String) -> FsResult<()> {
    fs_ops::create_file(&path)
}

#[tauri::command]
pub fn write_text_file(
    path: String,
    content: String,
    overwrite: Option<bool>,
    create_parents: Option<bool>,
) -> FsResult<u64> {
    fs_ops::write_text_file(
        &path,
        &content,
        overwrite.unwrap_or(false),
        create_parents.unwrap_or(false),
    )
}

#[tauri::command]
pub fn rename(path: String, new_name: String) -> FsResult<String> {
    fs_ops::rename(&path, &new_name)
}

#[tauri::command]
pub fn move_to_trash(path: String, guard: State<'_, Arc<AiGuard>>) -> FsResult<()> {
    guard.check_destructive("move_to_trash")?;
    fs_ops::move_to_trash(&path)
}

#[tauri::command]
pub fn delete_forever(path: String, guard: State<'_, Arc<AiGuard>>) -> FsResult<()> {
    guard.check_destructive("delete_forever")?;
    fs_ops::delete_forever(&path)
}

#[tauri::command]
pub fn copy_path(src: String, dst: String) -> FsResult<()> {
    fs_ops::copy(&src, &dst)
}

#[tauri::command]
pub fn move_path(src: String, dst: String) -> FsResult<()> {
    fs_ops::move_path(&src, &dst)
}

#[tauri::command]
pub fn reveal_in_native(path: String) -> FsResult<()> {
    fs_ops::reveal_in_native(&path)
}

#[tauri::command]
pub fn open_with_default(path: String) -> FsResult<()> {
    fs_ops::open_with_default(&path)
}

#[derive(serde::Serialize)]
pub struct TextFilePayload {
    pub content: String,
    pub truncated: bool,
    pub total_bytes: u64,
}

/// Read a text file for preview. `max_bytes` defaults to 1 MiB when omitted.
#[tauri::command]
pub fn read_text_file(path: String, max_bytes: Option<u64>) -> FsResult<TextFilePayload> {
    let limit = max_bytes.unwrap_or(1024 * 1024);
    let (content, truncated, total_bytes) = fs_ops::read_text_file(&path, limit)?;
    Ok(TextFilePayload {
        content,
        truncated,
        total_bytes,
    })
}

#[tauri::command]
pub fn dir_size_cached(path: String, index: State<'_, Arc<SizeIndex>>) -> Option<SizeInfo> {
    index.get(&path)
}

/// Request a background scan of the given directory's total size. If the
/// result is cached it is returned synchronously; otherwise a background
/// thread computes it and emits a `size-updated` event when done.
#[tauri::command]
pub fn request_dir_size(
    path: String,
    app: AppHandle,
    index: State<'_, Arc<SizeIndex>>,
) -> Option<SizeInfo> {
    if let Some(info) = index.get(&path) {
        return Some(info);
    }
    size_index::spawn_scan(app, index.inner().clone(), path);
    None
}

#[tauri::command]
pub fn invalidate_dir_size(path: String, index: State<'_, Arc<SizeIndex>>) {
    index.invalidate(&path);
}

// --- Collections ---------------------------------------------------------

#[tauri::command]
pub fn list_collections(store: State<'_, Arc<CollectionStore>>) -> Vec<Collection> {
    store.list()
}

#[tauri::command]
pub fn create_collection(
    name: String,
    color: Option<String>,
    icon: Option<String>,
    store: State<'_, Arc<CollectionStore>>,
) -> FsResult<Collection> {
    store.create(name, color, icon)
}

#[tauri::command]
pub fn update_collection(
    id: String,
    name: Option<String>,
    color: Option<Option<String>>,
    icon: Option<Option<String>>,
    store: State<'_, Arc<CollectionStore>>,
) -> FsResult<Collection> {
    store.update(&id, name, color, icon)
}

#[tauri::command]
pub fn delete_collection(id: String, store: State<'_, Arc<CollectionStore>>) -> FsResult<()> {
    store.delete(&id)
}

#[tauri::command]
pub fn add_to_collection(
    id: String,
    paths: Vec<String>,
    store: State<'_, Arc<CollectionStore>>,
) -> FsResult<Collection> {
    store.add_items(&id, paths)
}

#[tauri::command]
pub fn remove_from_collection(
    id: String,
    paths: Vec<String>,
    store: State<'_, Arc<CollectionStore>>,
) -> FsResult<Collection> {
    store.remove_items(&id, paths)
}

/// Resolve every item path in a collection via `stat`. Missing paths are
/// silently filtered out (typically because the user deleted/moved the file
/// outside of LocalBro).
#[tauri::command]
pub fn list_collection_entries(
    id: String,
    store: State<'_, Arc<CollectionStore>>,
) -> FsResult<Vec<FsEntry>> {
    let c = store
        .get(&id)
        .ok_or_else(|| crate::core::error::FsError::NotFound(format!("collection {id}")))?;
    let mut out = Vec::with_capacity(c.items.len());
    for p in &c.items {
        if let Ok(entry) = fs_ops::stat(p) {
            out.push(entry);
        }
    }
    Ok(out)
}

// --- Packs (skins & plugins) --------------------------------------------

#[tauri::command]
pub fn list_packs(kind: PackKind, app: AppHandle) -> Vec<PackInfo> {
    pack::scan(&app, kind)
}

#[tauri::command]
pub fn read_pack_asset(
    kind: PackKind,
    id: String,
    path: String,
    app: AppHandle,
) -> FsResult<Vec<u8>> {
    pack::read_asset(&app, kind, &id, &path)
}

#[tauri::command]
pub fn read_pack_text(
    kind: PackKind,
    id: String,
    path: String,
    app: AppHandle,
) -> FsResult<String> {
    let bytes = pack::read_asset(&app, kind, &id, &path)?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

#[tauri::command]
pub fn install_pack_from_folder(src: String, app: AppHandle) -> FsResult<PackInfo> {
    pack::install_from_folder(&app, std::path::Path::new(&src))
}

#[tauri::command]
pub fn uninstall_pack(kind: PackKind, id: String, app: AppHandle) -> FsResult<()> {
    pack::uninstall(&app, kind, &id)
}

#[tauri::command]
pub fn pack_dir(kind: PackKind, app: AppHandle) -> String {
    pack::packs_root(&app, kind)
        .to_string_lossy()
        .into_owned()
}

// --- User settings ------------------------------------------------------

#[tauri::command]
pub fn settings_get_all(store: State<'_, Arc<SettingsStore>>) -> serde_json::Value {
    store.all()
}

#[tauri::command]
pub fn settings_get(key: String, store: State<'_, Arc<SettingsStore>>) -> Option<serde_json::Value> {
    store.get(&key)
}

#[tauri::command]
pub fn settings_set(
    key: String,
    value: serde_json::Value,
    store: State<'_, Arc<SettingsStore>>,
) -> FsResult<()> {
    store.set(key, value)
}

// --- Archives -----------------------------------------------------------

#[tauri::command]
pub fn list_archive(path: String) -> FsResult<Vec<ArchiveEntry>> {
    archive::list(&path)
}

#[tauri::command]
pub fn extract_archive(archive_path: String, dest_dir: String) -> FsResult<ExtractResult> {
    archive::extract(&archive_path, &dest_dir)
}

#[tauri::command]
pub fn default_extract_dir(archive_path: String) -> FsResult<String> {
    archive::default_extract_dir(&archive_path)
}

/// Zip a list of source paths into `dest_path`. Returns total bytes of
/// the uncompressed input (a rough progress/size indicator).
#[tauri::command]
pub fn create_zip(sources: Vec<String>, dest_path: String) -> FsResult<u64> {
    archive::create_zip(&sources, &dest_path)
}

// --- AI guard -----------------------------------------------------------

/// Toggle the global AI-readonly guard. When `on=true`, all destructive
/// commands (`move_to_trash`, `delete_forever`) start returning
/// PermissionDenied. Intended to be flipped by the AI panel when the
/// user enables AI mode.
#[tauri::command]
pub fn ai_set_readonly(on: bool, guard: State<'_, Arc<AiGuard>>) {
    guard.set_readonly(on);
}

#[tauri::command]
pub fn ai_get_readonly(guard: State<'_, Arc<AiGuard>>) -> bool {
    guard.readonly()
}
