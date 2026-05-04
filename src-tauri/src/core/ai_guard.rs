//! Global AI-mode guard.
//!
//! When the user enables "AI mode" in the UI, the client flips this flag
//! on. Destructive commands consult the guard on every call — if the
//! flag is on, they reject the call regardless of who issued it (user
//! click, AI tool call, plugin, …). This is our last line of defence
//! against a hallucinating LLM: the protection lives in Rust, below the
//! JS agent loop, so it cannot be silently bypassed.

use parking_lot::RwLock;

use crate::core::error::{FsError, FsResult};

pub struct AiGuard {
    readonly: RwLock<bool>,
}

impl AiGuard {
    pub fn new() -> Self {
        Self {
            readonly: RwLock::new(false),
        }
    }

    pub fn readonly(&self) -> bool {
        *self.readonly.read()
    }

    pub fn set_readonly(&self, v: bool) {
        *self.readonly.write() = v;
    }

    /// Returns `Err(PermissionDenied)` when the guard is active.
    pub fn check_destructive(&self, op: &str) -> FsResult<()> {
        if self.readonly() {
            Err(FsError::PermissionDenied(format!(
                "AI mode is active, '{op}' is disabled for safety. Turn AI mode off in the AI panel to proceed."
            )))
        } else {
            Ok(())
        }
    }
}
