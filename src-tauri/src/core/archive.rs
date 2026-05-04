//! Archive support — MVP covers the two formats that are universal across
//! macOS, Windows and Linux: `.zip` and `.tar[.gz]`. Everything else
//! (rar, 7z, bz2-only tars, …) is delegated to Pack plugins via
//! `contributes.archiveHandlers` — see PACKS.md.
//!
//! We intentionally keep the API narrow:
//!   * list   — read-only, fast, for preview of contents
//!   * extract — unpack to a destination directory
//!   * create_zip — archive a set of files/directories into a new .zip
//!
//! Tar creation is not exposed yet; on desktop OSes users creating an
//! archive for sharing almost always want zip. We can add it later behind
//! a second command without touching existing callers.

use std::fs::{self, File};
use std::io::{self, BufReader, BufWriter, Read, Seek, Write};
use std::path::{Component, Path, PathBuf};

use flate2::read::GzDecoder;
use serde::{Deserialize, Serialize};
use walkdir::WalkDir;
use zip::read::ZipArchive;
use zip::write::{SimpleFileOptions, ZipWriter};
use zip::CompressionMethod;

use crate::core::error::{FsError, FsResult};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ArchiveFormat {
    Zip,
    Tar,
    TarGz,
}

impl ArchiveFormat {
    pub fn detect(path: &Path) -> Option<Self> {
        let name = path.file_name()?.to_string_lossy().to_ascii_lowercase();
        if name.ends_with(".zip") {
            Some(Self::Zip)
        } else if name.ends_with(".tar.gz") || name.ends_with(".tgz") {
            Some(Self::TarGz)
        } else if name.ends_with(".tar") {
            Some(Self::Tar)
        } else {
            None
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArchiveEntry {
    /// Path inside the archive (forward slashes, as stored).
    pub path: String,
    pub size: u64,
    pub is_dir: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct ExtractResult {
    pub dest: String,
    pub entries: usize,
}

// --- Listing -----------------------------------------------------------

pub fn list(path: &str) -> FsResult<Vec<ArchiveEntry>> {
    let p = Path::new(path);
    let fmt = ArchiveFormat::detect(p)
        .ok_or_else(|| FsError::Unsupported(format!("unknown archive format: {path}")))?;
    match fmt {
        ArchiveFormat::Zip => list_zip(p),
        ArchiveFormat::Tar => list_tar(p, false),
        ArchiveFormat::TarGz => list_tar(p, true),
    }
}

fn list_zip(path: &Path) -> FsResult<Vec<ArchiveEntry>> {
    let f = File::open(path).map_err(|e| FsError::from_io(path.to_string_lossy().as_ref(), e))?;
    let mut zip = ZipArchive::new(BufReader::new(f))
        .map_err(|e| FsError::Internal(format!("open zip {path:?}: {e}")))?;
    let mut out = Vec::with_capacity(zip.len());
    for i in 0..zip.len() {
        let entry = zip
            .by_index(i)
            .map_err(|e| FsError::Internal(format!("zip entry {i}: {e}")))?;
        out.push(ArchiveEntry {
            path: entry.name().to_string(),
            size: entry.size(),
            is_dir: entry.is_dir(),
        });
    }
    Ok(out)
}

fn list_tar(path: &Path, gz: bool) -> FsResult<Vec<ArchiveEntry>> {
    let f = File::open(path).map_err(|e| FsError::from_io(path.to_string_lossy().as_ref(), e))?;
    let reader: Box<dyn Read> = if gz {
        Box::new(GzDecoder::new(BufReader::new(f)))
    } else {
        Box::new(BufReader::new(f))
    };
    let mut tar = tar::Archive::new(reader);
    let mut out = Vec::new();
    for entry in tar
        .entries()
        .map_err(|e| FsError::Internal(format!("open tar {path:?}: {e}")))?
    {
        let e = entry.map_err(|e| FsError::Internal(format!("tar entry: {e}")))?;
        let header = e.header();
        let size = header.size().unwrap_or(0);
        let is_dir = header.entry_type().is_dir();
        let path_buf = e
            .path()
            .map_err(|e| FsError::Internal(format!("tar path: {e}")))?
            .into_owned();
        out.push(ArchiveEntry {
            path: path_buf.to_string_lossy().into_owned(),
            size,
            is_dir,
        });
    }
    Ok(out)
}

// --- Extraction --------------------------------------------------------

/// Extract `archive` into `dest_dir`. If `dest_dir` does not exist it is
/// created. Entries that would escape the destination directory via `..`
/// components are skipped (zip-slip protection).
pub fn extract(archive: &str, dest_dir: &str) -> FsResult<ExtractResult> {
    let a = Path::new(archive);
    let fmt = ArchiveFormat::detect(a)
        .ok_or_else(|| FsError::Unsupported(format!("unknown archive format: {archive}")))?;
    let dest = Path::new(dest_dir);
    fs::create_dir_all(dest).map_err(|e| FsError::from_io(dest_dir, e))?;
    let dest_canonical = fs::canonicalize(dest).map_err(|e| FsError::from_io(dest_dir, e))?;

    let count = match fmt {
        ArchiveFormat::Zip => extract_zip(a, &dest_canonical)?,
        ArchiveFormat::Tar => extract_tar(a, &dest_canonical, false)?,
        ArchiveFormat::TarGz => extract_tar(a, &dest_canonical, true)?,
    };
    Ok(ExtractResult {
        dest: dest_canonical.to_string_lossy().into_owned(),
        entries: count,
    })
}

fn extract_zip(archive: &Path, dest: &Path) -> FsResult<usize> {
    let f = File::open(archive)
        .map_err(|e| FsError::from_io(archive.to_string_lossy().as_ref(), e))?;
    let mut zip = ZipArchive::new(BufReader::new(f))
        .map_err(|e| FsError::Internal(format!("open zip {archive:?}: {e}")))?;
    let mut count = 0usize;
    for i in 0..zip.len() {
        let mut entry = zip
            .by_index(i)
            .map_err(|e| FsError::Internal(format!("zip entry {i}: {e}")))?;
        let Some(raw) = entry.enclosed_name() else {
            // zip-slip: skip suspicious paths
            continue;
        };
        let out = dest.join(raw);
        if !is_within(dest, &out) {
            continue;
        }
        if entry.is_dir() {
            fs::create_dir_all(&out)
                .map_err(|e| FsError::from_io(out.to_string_lossy().as_ref(), e))?;
        } else {
            if let Some(parent) = out.parent() {
                fs::create_dir_all(parent)
                    .map_err(|e| FsError::from_io(parent.to_string_lossy().as_ref(), e))?;
            }
            let mut f = File::create(&out)
                .map_err(|e| FsError::from_io(out.to_string_lossy().as_ref(), e))?;
            io::copy(&mut entry, &mut f)
                .map_err(|e| FsError::from_io(out.to_string_lossy().as_ref(), e))?;
        }
        count += 1;
    }
    Ok(count)
}

fn extract_tar(archive: &Path, dest: &Path, gz: bool) -> FsResult<usize> {
    let f = File::open(archive)
        .map_err(|e| FsError::from_io(archive.to_string_lossy().as_ref(), e))?;
    let reader: Box<dyn Read> = if gz {
        Box::new(GzDecoder::new(BufReader::new(f)))
    } else {
        Box::new(BufReader::new(f))
    };
    let mut tar = tar::Archive::new(reader);
    // `set_preserve_permissions(false)` keeps this cross-platform safe on
    // Windows where unix perm bits make no sense.
    tar.set_preserve_permissions(false);
    tar.set_overwrite(true);
    let mut count = 0usize;
    for entry in tar
        .entries()
        .map_err(|e| FsError::Internal(format!("open tar {archive:?}: {e}")))?
    {
        let mut e = entry.map_err(|e| FsError::Internal(format!("tar entry: {e}")))?;
        let raw = e
            .path()
            .map_err(|e| FsError::Internal(format!("tar path: {e}")))?
            .into_owned();
        // Reject absolute paths and `..` components — tar-slip protection.
        if raw
            .components()
            .any(|c| matches!(c, Component::ParentDir | Component::RootDir | Component::Prefix(_)))
        {
            continue;
        }
        let out = dest.join(&raw);
        if !is_within(dest, &out) {
            continue;
        }
        e.unpack(&out)
            .map_err(|e| FsError::from_io(out.to_string_lossy().as_ref(), e))?;
        count += 1;
    }
    Ok(count)
}

fn is_within(root: &Path, candidate: &Path) -> bool {
    // candidate may not exist yet, so walk components manually instead of
    // using canonicalize.
    let mut normalized = root.to_path_buf();
    for c in candidate.strip_prefix(root).unwrap_or(candidate).components() {
        match c {
            Component::ParentDir => return false,
            Component::Normal(x) => normalized.push(x),
            Component::CurDir => {}
            Component::RootDir | Component::Prefix(_) => return false,
        }
    }
    normalized.starts_with(root)
}

// --- Creation ----------------------------------------------------------

/// Create a new `.zip` at `dest_path` containing the given source paths.
/// Directories are walked recursively; their base name becomes the root
/// folder inside the archive (so compressing `/a/b/c` gives `c/…` entries,
/// matching how Finder / Explorer zip their selection).
pub fn create_zip(sources: &[String], dest_path: &str) -> FsResult<u64> {
    if sources.is_empty() {
        return Err(FsError::InvalidPath("no sources to compress".into()));
    }
    let dest = Path::new(dest_path);
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| FsError::from_io(parent.to_string_lossy().as_ref(), e))?;
    }
    let out = File::create(dest).map_err(|e| FsError::from_io(dest_path, e))?;
    let mut zw = ZipWriter::new(BufWriter::new(out));
    let opts = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .unix_permissions(0o644);

    let mut total: u64 = 0;
    for src in sources {
        let src_path = Path::new(src);
        let base_name = src_path
            .file_name()
            .ok_or_else(|| FsError::InvalidPath(format!("source has no file name: {src}")))?
            .to_string_lossy()
            .into_owned();

        if src_path.is_file() {
            add_file_to_zip(&mut zw, src_path, &base_name, opts)?;
            total += src_path.metadata().map(|m| m.len()).unwrap_or(0);
        } else if src_path.is_dir() {
            for entry in WalkDir::new(src_path).into_iter().filter_map(Result::ok) {
                let abs = entry.path();
                let rel = abs.strip_prefix(src_path).unwrap_or(abs);
                let zip_name = if rel.as_os_str().is_empty() {
                    base_name.clone()
                } else {
                    format!("{}/{}", base_name, rel.to_string_lossy().replace('\\', "/"))
                };
                if entry.file_type().is_dir() {
                    let dir_name = if zip_name.ends_with('/') {
                        zip_name
                    } else {
                        format!("{zip_name}/")
                    };
                    zw.add_directory(dir_name, opts)
                        .map_err(|e| FsError::Internal(format!("zip add_directory: {e}")))?;
                } else if entry.file_type().is_file() {
                    add_file_to_zip(&mut zw, abs, &zip_name, opts)?;
                    total += abs.metadata().map(|m| m.len()).unwrap_or(0);
                }
            }
        } else {
            return Err(FsError::NotFound(src.clone()));
        }
    }

    let mut buf = zw
        .finish()
        .map_err(|e| FsError::Internal(format!("zip finish: {e}")))?;
    buf.flush().map_err(|e| FsError::from_io(dest_path, e))?;
    Ok(total)
}

fn add_file_to_zip<W: Write + Seek>(
    zw: &mut ZipWriter<W>,
    src: &Path,
    name: &str,
    opts: SimpleFileOptions,
) -> FsResult<()> {
    zw.start_file(name, opts)
        .map_err(|e| FsError::Internal(format!("zip start_file {name}: {e}")))?;
    let mut f = File::open(src).map_err(|e| FsError::from_io(src.to_string_lossy().as_ref(), e))?;
    io::copy(&mut f, zw).map_err(|e| FsError::from_io(src.to_string_lossy().as_ref(), e))?;
    Ok(())
}

/// Pick a destination directory next to the archive whose name doesn't
/// collide with anything on disk. `archive.zip` prefers `archive/`, then
/// `archive 2/`, `archive 3/`, … — mirroring macOS Finder behaviour.
pub fn default_extract_dir(archive: &str) -> FsResult<String> {
    let a = Path::new(archive);
    let parent = a
        .parent()
        .ok_or_else(|| FsError::InvalidPath(format!("archive has no parent: {archive}")))?;
    let stem = {
        let file = a
            .file_name()
            .ok_or_else(|| FsError::InvalidPath("archive has no filename".into()))?
            .to_string_lossy()
            .to_string();
        let lower = file.to_ascii_lowercase();
        for suffix in [".tar.gz", ".tgz", ".tar", ".zip"] {
            if lower.ends_with(suffix) {
                return Ok(unique_sibling(parent, &file[..file.len() - suffix.len()])
                    .to_string_lossy()
                    .into_owned());
            }
        }
        a.file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_else(|| "extracted".to_string())
    };
    Ok(unique_sibling(parent, &stem).to_string_lossy().into_owned())
}

fn unique_sibling(parent: &Path, stem: &str) -> PathBuf {
    let mut candidate = parent.join(stem);
    let mut n = 2;
    while candidate.exists() {
        candidate = parent.join(format!("{stem} {n}"));
        n += 1;
    }
    candidate
}
