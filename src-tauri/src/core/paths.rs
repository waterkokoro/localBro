use serde::Serialize;
use std::path::PathBuf;

use crate::core::error::{FsError, FsResult};

#[derive(Debug, Serialize)]
pub struct Shortcut {
    pub id: String,
    pub label: String,
    pub path: String,
    pub kind: ShortcutKind,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ShortcutKind {
    Home,
    Desktop,
    Documents,
    Downloads,
    Pictures,
    Music,
    Videos,
    Volume,
    Recent,
}

fn push_if_exists(out: &mut Vec<Shortcut>, id: &str, label: &str, p: Option<PathBuf>, kind: ShortcutKind) {
    if let Some(path) = p {
        if path.exists() {
            out.push(Shortcut {
                id: id.to_string(),
                label: label.to_string(),
                path: path.to_string_lossy().into_owned(),
                kind,
            });
        }
    }
}

/// Return the quick-access shortcuts shown in the left navigation.
pub fn default_shortcuts() -> Vec<Shortcut> {
    let mut out = Vec::new();
    push_if_exists(&mut out, "home", "Home", dirs::home_dir(), ShortcutKind::Home);
    push_if_exists(&mut out, "desktop", "Desktop", dirs::desktop_dir(), ShortcutKind::Desktop);
    push_if_exists(&mut out, "documents", "Documents", dirs::document_dir(), ShortcutKind::Documents);
    push_if_exists(&mut out, "downloads", "Downloads", dirs::download_dir(), ShortcutKind::Downloads);
    push_if_exists(&mut out, "pictures", "Pictures", dirs::picture_dir(), ShortcutKind::Pictures);
    push_if_exists(&mut out, "music", "Music", dirs::audio_dir(), ShortcutKind::Music);
    push_if_exists(&mut out, "videos", "Videos", dirs::video_dir(), ShortcutKind::Videos);
    out
}

/// Enumerate external volumes / drives for the left navigation.
/// - macOS: entries under `/Volumes`
/// - Windows: logical drives A:..Z:
/// - Linux: entries under `/mnt` and `/media/<user>` (best effort)
pub fn list_volumes() -> FsResult<Vec<Shortcut>> {
    let mut out = Vec::new();

    #[cfg(target_os = "macos")]
    {
        let vols = PathBuf::from("/Volumes");
        if vols.exists() {
            let read = std::fs::read_dir(&vols)
                .map_err(|e| FsError::from_io(vols.to_string_lossy(), e))?;
            for entry in read.flatten() {
                let p = entry.path();
                let name = entry.file_name().to_string_lossy().into_owned();
                out.push(Shortcut {
                    id: format!("vol:{name}"),
                    label: name,
                    path: p.to_string_lossy().into_owned(),
                    kind: ShortcutKind::Volume,
                });
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        for letter in b'A'..=b'Z' {
            let root = format!("{}:\\", letter as char);
            let p = PathBuf::from(&root);
            if p.exists() {
                out.push(Shortcut {
                    id: format!("vol:{}", letter as char),
                    label: root.clone(),
                    path: root,
                    kind: ShortcutKind::Volume,
                });
            }
        }
    }

    #[cfg(target_os = "linux")]
    {
        for base in ["/mnt", "/media"].iter().map(PathBuf::from) {
            if base.exists() {
                if let Ok(read) = std::fs::read_dir(&base) {
                    for entry in read.flatten() {
                        let p = entry.path();
                        if p.is_dir() {
                            let name = entry.file_name().to_string_lossy().into_owned();
                            out.push(Shortcut {
                                id: format!("vol:{name}"),
                                label: name,
                                path: p.to_string_lossy().into_owned(),
                                kind: ShortcutKind::Volume,
                            });
                        }
                    }
                }
            }
        }
    }

    Ok(out)
}

/// Resolve the user's home directory as a string; fall back to root if unavailable.
pub fn home_path() -> String {
    dirs::home_dir()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|| "/".to_string())
}
