//! C0 — Server skeleton: proves the engine crate boundary holds under Axum.
//!
//! No Tauri imports.  No UI.  Just the engine and a web server.

use axum::{
    extract::State as AxumState,
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use auto_dm_core::llm::{DmPipeline, StubLlmBackend};
use auto_dm_engine::{
    apply_session_effects, open_pool, run_migrations, GameState, LogEntry, Repository,
    SqliteRepository,
};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Arc;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    // --- Database setup ---
    let db_path = std::env::args()
        .nth(1)
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("server.db"));
    tracing::info!("Opening database at {}", db_path.display());

    let pool = open_pool(&db_path).await.expect("Failed to open database");
    run_migrations(&pool).await.expect("Failed to run migrations");
    let repo = SqliteRepository::new(pool);

    // --- DM pipeline (stub backend for C0) ---
    let backend: Box<dyn auto_dm_core::llm::LlmBackend> = Box::new(StubLlmBackend);
    let pipeline = DmPipeline::new(backend);

    // --- Game state (no Tauri types anywhere) ---
    let state = Arc::new(GameState {
        repo,
        dm: tokio::sync::Mutex::new(Some(Arc::new(pipeline))),
        memory: std::sync::Mutex::new(auto_dm_core::memory::CampaignMemory::new()),
        ollama_child: std::sync::Mutex::new(None),
        current_model: std::sync::Mutex::new("stub".into()),
        current_num_predict: std::sync::Mutex::new(512),
    });

    // --- Axum routes ---
    let app = Router::new()
        .route("/health", get(health))
        .route("/resolve", post(resolve))
        .route("/logs/{scene_id}", get(list_logs))
        .with_state(state);

    let addr = std::env::var("ADDR").unwrap_or_else(|_| "0.0.0.0:3000".into());
    tracing::info!("Listening on {addr}");
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

// ── Handlers ─────────────────────────────────────────────────────────

async fn health() -> Json<Value> {
    Json(json!({ "status": "ok" }))
}

async fn resolve(
    AxumState(state): AxumState<Arc<GameState>>,
    Json(mut request): Json<auto_dm_core::llm::DmRequest>,
) -> Result<Json<auto_dm_core::llm::DmResponse>, (StatusCode, String)> {
    // Inject memory context (same pattern as Tauri's dm_resolve).
    {
        let mem = state.memory.lock().map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        if !mem.is_empty() {
            request.memory_context = Some(mem.to_context(20));
        }
    }

    // Clone the pipeline Arc before awaiting (lock-clone-release pattern).
    let pipeline = {
        let dm = state.dm.lock().await;
        dm.as_ref()
            .cloned()
            .ok_or_else(|| (StatusCode::SERVICE_UNAVAILABLE, "DM backend not initialized".into()))?
    };

    // Run through the engine — this is the real boundary test.
    let mut response = pipeline
        .resolve_action(&request)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let events = apply_session_effects(&state, &request, &mut response).await;

    tracing::info!(
        intent = ?response.intent,
        events = events.len(),
        source = %response.source,
        "Request resolved"
    );

    Ok(Json(response))
}

async fn list_logs(
    AxumState(state): AxumState<Arc<GameState>>,
    axum::extract::Path(scene_id): axum::extract::Path<String>,
) -> Result<Json<Vec<LogEntry>>, (StatusCode, String)> {
    let logs = state
        .repo
        .list_logs(&scene_id, 100)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(logs))
}
