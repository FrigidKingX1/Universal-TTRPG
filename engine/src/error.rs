use thiserror::Error;

/// Canonical error type for the engine crate. Both the Tauri client and the
/// future Axum server map this into their transport's error representation
/// without `sqlx::Error` or serde details leaking across the boundary.
#[derive(Debug, Error)]
pub enum EngineError {
    #[error("database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("not found: {0}")]
    NotFound(String),
    #[error("{0}")]
    Invalid(String),
}

/// Back-compat alias during extraction — existing call sites reference
/// `DbError`; new code should prefer `EngineError`.
pub type DbError = EngineError;
