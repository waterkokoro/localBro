use serde::{Serialize, Serializer};
use thiserror::Error;

/// Errors surfaced from Rust commands to the webview. `serde` is derived
/// manually so the Tauri IPC layer can return a plain string to JS while
/// we keep the rich variants for internal logging.
#[derive(Debug, Error)]
pub enum FsError {
    #[error("path not found: {0}")]
    NotFound(String),

    #[error("permission denied: {0}")]
    PermissionDenied(String),

    #[error("path already exists: {0}")]
    AlreadyExists(String),

    #[error("invalid path: {0}")]
    InvalidPath(String),

    #[error("io error: {0}")]
    Io(String),

    #[error("unsupported operation: {0}")]
    Unsupported(String),

    #[error("internal error: {0}")]
    Internal(String),
}

impl FsError {
    pub fn from_io(path: impl AsRef<str>, err: std::io::Error) -> Self {
        let p = path.as_ref().to_string();
        match err.kind() {
            std::io::ErrorKind::NotFound => FsError::NotFound(p),
            std::io::ErrorKind::PermissionDenied => FsError::PermissionDenied(p),
            std::io::ErrorKind::AlreadyExists => FsError::AlreadyExists(p),
            _ => FsError::Io(format!("{p}: {err}")),
        }
    }
}

impl Serialize for FsError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

pub type FsResult<T> = Result<T, FsError>;
