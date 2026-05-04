use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};

use crate::core::error::{FsError, FsResult};

#[derive(Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum EntryKind {
    File,
    Directory,
    Symlink,
    Other,
}

#[derive(Debug, Serialize)]
pub struct FsEntry {
    pub name: String,
    pub path: String,
    pub kind: EntryKind,
    /// Size in bytes. For directories we return `None` here and compute
    /// lazily via the size index (Task 3).
    pub size: Option<u64>,
    /// Modified time as a unix timestamp in milliseconds.
    pub modified_ms: Option<i64>,
    /// Created time as a unix timestamp in milliseconds (best effort).
    pub created_ms: Option<i64>,
    /// Whether the entry is hidden at the OS level (dot-prefixed on Unix,
    /// HIDDEN attribute on Windows).
    pub hidden: bool,
    /// Whether the file is read-only.
    pub readonly: bool,
    /// Lowercased extension, without the dot; `None` for directories or files without ext.
    pub extension: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
pub struct ListOptions {
    /// If true, include entries that are hidden at the OS level.
    #[serde(default)]
    pub show_hidden: bool,
    /// If true, follow symlinks when stat-ing entries.
    #[serde(default)]
    pub follow_symlinks: bool,
}

fn normalize(path: &str) -> FsResult<PathBuf> {
    if path.is_empty() {
        return Err(FsError::InvalidPath("<empty>".into()));
    }
    Ok(PathBuf::from(path))
}

fn systime_to_ms(t: std::time::SystemTime) -> Option<i64> {
    t.duration_since(UNIX_EPOCH)
        .ok()
        .map(|d| d.as_millis() as i64)
}

fn is_os_hidden(path: &Path, name: &str) -> bool {
    // Unix-style dotfiles (also applies on macOS in addition to the uf_hidden flag).
    if name.starts_with('.') {
        return true;
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
        if let Ok(meta) = fs::metadata(path) {
            if meta.file_attributes() & FILE_ATTRIBUTE_HIDDEN != 0 {
                return true;
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = path;
    }

    false
}

fn entry_from(path: &Path, follow: bool) -> FsResult<FsEntry> {
    let name = path
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string_lossy().into_owned());

    let meta_res = if follow {
        fs::metadata(path)
    } else {
        fs::symlink_metadata(path)
    };
    let meta = meta_res.map_err(|e| FsError::from_io(path.to_string_lossy(), e))?;

    let file_type = meta.file_type();
    let kind = if file_type.is_dir() {
        EntryKind::Directory
    } else if file_type.is_symlink() {
        EntryKind::Symlink
    } else if file_type.is_file() {
        EntryKind::File
    } else {
        EntryKind::Other
    };

    let size = match kind {
        EntryKind::File => Some(meta.len()),
        _ => None,
    };

    let modified_ms = meta.modified().ok().and_then(systime_to_ms);
    let created_ms = meta.created().ok().and_then(systime_to_ms);
    let readonly = meta.permissions().readonly();

    let extension = path
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_ascii_lowercase());

    let hidden = is_os_hidden(path, &name);

    Ok(FsEntry {
        name,
        path: path.to_string_lossy().into_owned(),
        kind,
        size,
        modified_ms,
        created_ms,
        hidden,
        readonly,
        extension,
    })
}

/// List the contents of a directory.
pub fn list_dir(path: &str, options: ListOptions) -> FsResult<Vec<FsEntry>> {
    let p = normalize(path)?;
    if !p.exists() {
        return Err(FsError::NotFound(path.to_string()));
    }
    if !p.is_dir() {
        return Err(FsError::InvalidPath(format!("not a directory: {path}")));
    }

    let read = fs::read_dir(&p).map_err(|e| FsError::from_io(path, e))?;

    let mut out = Vec::new();
    for entry in read {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let entry_path = entry.path();
        match entry_from(&entry_path, options.follow_symlinks) {
            Ok(fe) => {
                if !options.show_hidden && fe.hidden {
                    continue;
                }
                out.push(fe);
            }
            Err(_) => continue, // skip unreadable entries rather than failing whole listing
        }
    }
    Ok(out)
}

/// Stat a single path.
pub fn stat(path: &str) -> FsResult<FsEntry> {
    let p = normalize(path)?;
    if !p.exists() {
        return Err(FsError::NotFound(path.to_string()));
    }
    entry_from(&p, false)
}

/// Return the absolute parent path, or an empty string if already at the root.
pub fn parent_of(path: &str) -> FsResult<String> {
    let p = normalize(path)?;
    Ok(p.parent()
        .map(|pp| pp.to_string_lossy().into_owned())
        .unwrap_or_default())
}

pub fn create_directory(path: &str) -> FsResult<()> {
    let p = normalize(path)?;
    if p.exists() {
        return Err(FsError::AlreadyExists(path.to_string()));
    }
    fs::create_dir_all(&p).map_err(|e| FsError::from_io(path, e))
}

pub fn create_file(path: &str) -> FsResult<()> {
    let p = normalize(path)?;
    if p.exists() {
        return Err(FsError::AlreadyExists(path.to_string()));
    }
    fs::File::create(&p).map_err(|e| FsError::from_io(path, e))?;
    Ok(())
}

/// Write `content` (UTF-8) to `path`.
///
/// * `overwrite = false` rejects an existing file with `AlreadyExists`,
///   so callers (the AI agent in particular) can't silently clobber
///   user data.
/// * `create_parents = true` ensures intermediate directories exist
///   before the write — handy for the agent generating `notes/todo.md`
///   in a fresh folder.
pub fn write_text_file(
    path: &str,
    content: &str,
    overwrite: bool,
    create_parents: bool,
) -> FsResult<u64> {
    let p = normalize(path)?;
    if p.exists() && !overwrite {
        return Err(FsError::AlreadyExists(path.to_string()));
    }
    if create_parents {
        if let Some(parent) = p.parent() {
            if !parent.as_os_str().is_empty() && !parent.exists() {
                fs::create_dir_all(parent).map_err(|e| FsError::from_io(path, e))?;
            }
        }
    }
    fs::write(&p, content.as_bytes()).map_err(|e| FsError::from_io(path, e))?;
    Ok(content.as_bytes().len() as u64)
}

pub fn rename(path: &str, new_name: &str) -> FsResult<String> {
    let p = normalize(path)?;
    let parent = p
        .parent()
        .ok_or_else(|| FsError::InvalidPath(path.to_string()))?;
    let target = parent.join(new_name);
    if target.exists() {
        return Err(FsError::AlreadyExists(target.to_string_lossy().into_owned()));
    }
    fs::rename(&p, &target).map_err(|e| FsError::from_io(path, e))?;
    Ok(target.to_string_lossy().into_owned())
}

/// Move `path` into the OS trash / recycle bin.
pub fn move_to_trash(path: &str) -> FsResult<()> {
    trash::delete(path).map_err(|e| FsError::Io(format!("trash: {e}")))
}

/// Permanently delete a file or directory (no recycle bin). Use with caution.
pub fn delete_forever(path: &str) -> FsResult<()> {
    let p = normalize(path)?;
    if !p.exists() {
        return Err(FsError::NotFound(path.to_string()));
    }
    if p.is_dir() {
        fs::remove_dir_all(&p).map_err(|e| FsError::from_io(path, e))
    } else {
        fs::remove_file(&p).map_err(|e| FsError::from_io(path, e))
    }
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> FsResult<()> {
    fs::create_dir_all(dst).map_err(|e| FsError::from_io(dst.to_string_lossy(), e))?;
    let read = fs::read_dir(src).map_err(|e| FsError::from_io(src.to_string_lossy(), e))?;
    for entry in read.flatten() {
        let from = entry.path();
        let to = dst.join(entry.file_name());
        let ft = entry.file_type().map_err(|e| FsError::from_io(from.to_string_lossy(), e))?;
        if ft.is_dir() {
            copy_dir_recursive(&from, &to)?;
        } else if ft.is_symlink() {
            // Copy symlink target contents by following it; portable behaviour is tricky otherwise.
            if from.exists() {
                fs::copy(&from, &to).map_err(|e| FsError::from_io(from.to_string_lossy(), e))?;
            }
        } else {
            fs::copy(&from, &to).map_err(|e| FsError::from_io(from.to_string_lossy(), e))?;
        }
    }
    Ok(())
}

/// Copy a file or directory to `dst`. Fails if destination already exists.
pub fn copy(src: &str, dst: &str) -> FsResult<()> {
    let s = normalize(src)?;
    let d = normalize(dst)?;
    if !s.exists() {
        return Err(FsError::NotFound(src.to_string()));
    }
    if d.exists() {
        return Err(FsError::AlreadyExists(dst.to_string()));
    }
    if s.is_dir() {
        copy_dir_recursive(&s, &d)
    } else {
        fs::copy(&s, &d).map_err(|e| FsError::from_io(src, e))?;
        Ok(())
    }
}

/// Move (rename across filesystems when needed) a file or directory.
pub fn move_path(src: &str, dst: &str) -> FsResult<()> {
    let s = normalize(src)?;
    let d = normalize(dst)?;
    if !s.exists() {
        return Err(FsError::NotFound(src.to_string()));
    }
    if d.exists() {
        return Err(FsError::AlreadyExists(dst.to_string()));
    }
    if fs::rename(&s, &d).is_ok() {
        return Ok(());
    }
    // Fallback: copy + delete (covers cross-device moves).
    copy(src, dst)?;
    delete_forever(src)
}

/// Read up to `max_bytes` from a text file. Returns the decoded string
/// plus a flag indicating whether the file was truncated. Invalid UTF-8
/// is replaced with the Unicode replacement character (U+FFFD).
pub fn read_text_file(path: &str, max_bytes: u64) -> FsResult<(String, bool, u64)> {
    use std::io::Read;

    let p = normalize(path)?;
    if !p.exists() {
        return Err(FsError::NotFound(path.to_string()));
    }
    let total = fs::metadata(&p)
        .map_err(|e| FsError::from_io(path, e))?
        .len();

    let mut f = fs::File::open(&p).map_err(|e| FsError::from_io(path, e))?;
    let to_read = std::cmp::min(total, max_bytes) as usize;
    let mut buf = Vec::with_capacity(to_read);
    f.by_ref()
        .take(max_bytes)
        .read_to_end(&mut buf)
        .map_err(|e| FsError::from_io(path, e))?;
    let truncated = total > max_bytes;
    let s = String::from_utf8_lossy(&buf).into_owned();
    Ok((s, truncated, total))
}

/// Reveal a path in the native file manager.
pub fn reveal_in_native(path: &str) -> FsResult<()> {
    let p = normalize(path)?;
    if !p.exists() {
        return Err(FsError::NotFound(path.to_string()));
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(&p)
            .status()
            .map_err(|e| FsError::Io(format!("open -R failed: {e}")))?;
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(format!("/select,{}", p.display()))
            .status()
            .map_err(|e| FsError::Io(format!("explorer /select failed: {e}")))?;
        return Ok(());
    }

    #[cfg(target_os = "linux")]
    {
        // Best effort: open the containing directory.
        let parent = p.parent().unwrap_or(&p);
        std::process::Command::new("xdg-open")
            .arg(parent)
            .status()
            .map_err(|e| FsError::Io(format!("xdg-open failed: {e}")))?;
        return Ok(());
    }

   #[allow(unreachable_code)]
    Err(FsError::Unsupported("reveal_in_native".into()))
}

/// Open `path` with the platform-default application. This mirrors a
/// double-click in Finder / Explorer: the OS picks the right handler
/// based on file extension / URL scheme. Directories open in the OS
/// file manager.
pub fn open_with_default(path: &str) -> FsResult<()> {
    let p = normalize(path)?;
    if !p.exists() {
        return Err(FsError::NotFound(path.to_string()));
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&p)
            .status()
            .map_err(|e| FsError::Io(format!("open failed: {e}")))?;
        return Ok(());
    }

    #[cfg(target_os = "windows")]
    {
        // `start` is a shell builtin, so go through cmd. An empty title
        // argument prevents paths with spaces from being interpreted as
        // one.
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &p.to_string_lossy()])
            .status()
            .map_err(|e| FsError::Io(format!("cmd start failed: {e}")))?;
        return Ok(());
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&p)
            .status()
            .map_err(|e| FsError::Io(format!("xdg-open failed: {e}")))?;
        return Ok(());
    }

    #[allow(unreachable_code)]
    Err(FsError::Unsupported("open_with_default".into()))
}
