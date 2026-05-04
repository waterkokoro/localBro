//! LocalBro Pack system — a shared format for user-installable Skins and
//! Plugins. Every pack is a directory containing a `manifest.json` that
//! conforms to the Pack Manifest v1 schema (see `PACKS.md`).
//!
//! The backend's only job is:
//!   * scan install directories
//!   * parse & validate manifests
//!   * stream pack files to the webview (CSS / JS / images)
//!   * install from folder, uninstall, list
//!
//! The webview is responsible for actually APPLYING packs (injecting CSS
//! for skins, or running plugin JS once Task 9 lands). Keeping the split
//! here means skin/plugin behaviour can evolve without Rust changes.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::core::error::{FsError, FsResult};

pub const MANIFEST_FILE: &str = "manifest.json";
pub const MANIFEST_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PackKind {
    Skin,
    Plugin,
}

impl PackKind {
    pub fn dir_name(self) -> &'static str {
        match self {
            PackKind::Skin => "skins",
            PackKind::Plugin => "plugins",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthorInfo {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub email: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineRequirement {
    /// Semver range the pack declares compatibility with, e.g. "^0.1.0".
    /// Not enforced yet — reported back to the UI for display / warnings.
    #[serde(default)]
    pub localbro: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkinManifest {
    /// "light" | "dark" — hint for which base palette the skin extends.
    #[serde(default)]
    pub base: Option<String>,
    /// Path to the required tokens override CSS, relative to the pack dir.
    pub tokens: String,
    /// Optional non-token CSS (layout tweaks).
    #[serde(default)]
    pub overrides: Option<String>,
    /// Optional preview image.
    #[serde(default)]
    pub preview: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginContributes {
    /// Declarative extension of the preview adapter registry.
    #[serde(default, rename = "previewAdapters")]
    pub preview_adapters: Vec<serde_json::Value>,
    /// Declarative archive format handlers (for Task 8).
    #[serde(default, rename = "archiveHandlers")]
    pub archive_handlers: Vec<serde_json::Value>,
    /// Free-form extension points; plugins may add new keys.
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

impl Default for PluginContributes {
    fn default() -> Self {
        Self {
            preview_adapters: Vec::new(),
            archive_handlers: Vec::new(),
            extra: serde_json::Map::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginManifest {
    /// Path to the entry JS module, relative to the pack dir.
    pub entry: String,
    #[serde(default)]
    pub contributes: PluginContributes,
    /// Capability strings the plugin asks for (documented in PACKS.md).
    #[serde(default)]
    pub permissions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PackManifest {
    #[serde(rename = "manifestVersion")]
    pub manifest_version: u32,
    pub id: String,
    #[serde(rename = "type")]
    pub kind: PackKind,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub author: Option<AuthorInfo>,
    #[serde(default)]
    pub homepage: Option<String>,
    #[serde(default)]
    pub license: Option<String>,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub engine: Option<EngineRequirement>,

    /// Present iff `kind == Skin`.
    #[serde(default)]
    pub skin: Option<SkinManifest>,
    /// Present iff `kind == Plugin`.
    #[serde(default)]
    pub plugin: Option<PluginManifest>,
}

/// Manifest plus resolved filesystem root. Returned by scans so the UI
/// can request `read_pack_asset(id, rel)` against the right base.
#[derive(Debug, Clone, Serialize)]
pub struct PackInfo {
    #[serde(flatten)]
    pub manifest: PackManifest,
    /// Absolute path to the pack's installation directory.
    pub install_path: String,
}

// --- Helpers ------------------------------------------------------------

pub fn packs_root(app: &AppHandle, kind: PackKind) -> PathBuf {
    let base = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("localbro"));
    base.join(kind.dir_name())
}

fn read_manifest(pack_dir: &Path) -> FsResult<PackManifest> {
    let mpath = pack_dir.join(MANIFEST_FILE);
    let bytes = fs::read(&mpath).map_err(|e| FsError::from_io(mpath.to_string_lossy().as_ref(), e))?;
    let m: PackManifest = serde_json::from_slice(&bytes)
        .map_err(|e| FsError::Internal(format!("parse manifest {mpath:?}: {e}")))?;
    validate(&m)?;
    Ok(m)
}

fn validate(m: &PackManifest) -> FsResult<()> {
    if m.manifest_version != MANIFEST_VERSION {
        return Err(FsError::Unsupported(format!(
            "unsupported manifestVersion {}, expected {}",
            m.manifest_version, MANIFEST_VERSION
        )));
    }
    if m.id.trim().is_empty() {
        return Err(FsError::InvalidPath("pack id is empty".into()));
    }
    // Require id to look like a reverse-dns-ish identifier (letters, digits,
    // '.', '-', '_'). This keeps directories safe and registry lookups sane.
    if !m
        .id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_')
    {
        return Err(FsError::InvalidPath(format!(
            "pack id contains illegal characters: {}",
            m.id
        )));
    }
    match m.kind {
        PackKind::Skin => {
            if m.skin.is_none() {
                return Err(FsError::InvalidPath("skin manifest missing 'skin' block".into()));
            }
        }
        PackKind::Plugin => {
            if m.plugin.is_none() {
                return Err(FsError::InvalidPath("plugin manifest missing 'plugin' block".into()));
            }
        }
    }
    Ok(())
}

/// Scan every subdirectory of `<app_data>/{skins|plugins}/` for a valid
/// `manifest.json`. Invalid or unreadable packs are skipped silently and
/// logged to stderr — they should never break the rest of the UI.
pub fn scan(app: &AppHandle, kind: PackKind) -> Vec<PackInfo> {
    let root = packs_root(app, kind);
    let mut out = Vec::new();
    let Ok(rd) = fs::read_dir(&root) else { return out };
    for entry in rd.flatten() {
        let p = entry.path();
        if !p.is_dir() { continue; }
        match read_manifest(&p) {
            Ok(manifest) => {
                if manifest.kind != kind {
                    eprintln!("pack {:?} kind mismatch, skipping", p);
                    continue;
                }
                out.push(PackInfo {
                    manifest,
                    install_path: p.to_string_lossy().into_owned(),
                });
            }
            Err(e) => eprintln!("pack {:?} invalid: {:?}", p, e),
        }
    }
    out.sort_by(|a, b| a.manifest.name.to_lowercase().cmp(&b.manifest.name.to_lowercase()));
    out
}

/// Read an asset file inside an installed pack. The asset path is resolved
/// against the pack directory and MUST NOT escape it (defence against
/// `../../..` traversal attacks).
pub fn read_asset(app: &AppHandle, kind: PackKind, id: &str, rel: &str) -> FsResult<Vec<u8>> {
    let root = packs_root(app, kind);
    let pack_dir = root.join(id);
    let canonical_root = fs::canonicalize(&pack_dir)
        .map_err(|e| FsError::from_io(pack_dir.to_string_lossy().as_ref(), e))?;
    let target = pack_dir.join(rel);
    let canonical_target = fs::canonicalize(&target)
        .map_err(|e| FsError::from_io(target.to_string_lossy().as_ref(), e))?;
    if !canonical_target.starts_with(&canonical_root) {
        return Err(FsError::PermissionDenied(format!(
            "asset {rel} escapes pack root"
        )));
    }
    fs::read(&canonical_target)
        .map_err(|e| FsError::from_io(canonical_target.to_string_lossy().as_ref(), e))
}

/// Install a pack by copying a source directory (that must contain a valid
/// manifest) into `<app_data>/{skins|plugins}/<id>/`. If a pack with the
/// same id exists it is replaced.
pub fn install_from_folder(app: &AppHandle, src: &Path) -> FsResult<PackInfo> {
    let manifest = read_manifest(src)?;
    let root = packs_root(app, manifest.kind);
    fs::create_dir_all(&root)
        .map_err(|e| FsError::from_io(root.to_string_lossy().as_ref(), e))?;
    let dest = root.join(&manifest.id);
    if dest.exists() {
        fs::remove_dir_all(&dest)
            .map_err(|e| FsError::from_io(dest.to_string_lossy().as_ref(), e))?;
    }
    copy_dir_recursive(src, &dest)?;
    Ok(PackInfo {
        manifest,
        install_path: dest.to_string_lossy().into_owned(),
    })
}

pub fn uninstall(app: &AppHandle, kind: PackKind, id: &str) -> FsResult<()> {
    let root = packs_root(app, kind);
    let dest = root.join(id);
    if !dest.exists() {
        return Err(FsError::NotFound(format!("pack {id}")));
    }
    // Safety: make sure we're actually inside the packs root.
    let canonical_root = fs::canonicalize(&root)
        .map_err(|e| FsError::from_io(root.to_string_lossy().as_ref(), e))?;
    let canonical_dest = fs::canonicalize(&dest)
        .map_err(|e| FsError::from_io(dest.to_string_lossy().as_ref(), e))?;
    if !canonical_dest.starts_with(&canonical_root) {
        return Err(FsError::PermissionDenied("pack path escapes root".into()));
    }
    fs::remove_dir_all(&canonical_dest)
        .map_err(|e| FsError::from_io(canonical_dest.to_string_lossy().as_ref(), e))
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> FsResult<()> {
    fs::create_dir_all(dst)
        .map_err(|e| FsError::from_io(dst.to_string_lossy().as_ref(), e))?;
    for entry in fs::read_dir(src)
        .map_err(|e| FsError::from_io(src.to_string_lossy().as_ref(), e))?
        .flatten()
    {
        let ft = entry.file_type().map_err(|e| {
            FsError::from_io(entry.path().to_string_lossy().as_ref(), e)
        })?;
        let sp = entry.path();
        let dp = dst.join(entry.file_name());
        if ft.is_dir() {
            copy_dir_recursive(&sp, &dp)?;
        } else if ft.is_file() {
            fs::copy(&sp, &dp).map_err(|e| FsError::from_io(sp.to_string_lossy().as_ref(), e))?;
        }
    }
    Ok(())
}
