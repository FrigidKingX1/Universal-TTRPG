//! C1 — Broadcast transport: WebSocket fan-out with order guarantee.
//!
//! Design invariants (per spec):
//! 1. Broadcast order matches mutation order — events are sent to the
//!    broadcast channel while still holding the session lock, not after.
//! 2. `RecvError::Lagged` triggers a full resync, not silent continuation.

use axum::{
    extract::{
        ws::{Message, WebSocket},
        Query, State as AxumState, WebSocketUpgrade,
    },
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use auto_dm_core::llm::{DmPipeline, StubLlmBackend};
use auto_dm_engine::{
    apply_session_effects, open_pool, run_migrations, GameEvent, GameState, LogEntry, Repository,
    SqliteRepository,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::broadcast;

// ── Wire protocol ────────────────────────────────────────────────────

/// Envelope sent over WebSocket.  Distinguishes live events from
/// full-state resyncs so the client always knows what it's looking at.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum WsMessage {
    Event {
        event: GameEvent,
    },
    Resync {
        scene_summary: String,
        logs: Vec<LogEntry>,
    },
}

// ── Session state (server-level, wraps engine GameState) ─────────────

struct SessionState {
    game: GameState,
    /// Fan-out: one sender, many receivers (one per WebSocket client).
    event_tx: broadcast::Sender<WsMessage>,
    /// Serializes resolve → broadcast so event order matches mutation order.
    /// Two concurrent player actions acquire this lock; the second waits
    /// until the first has broadcast its events before proceeding.
    session_lock: tokio::sync::Mutex<()>,
}

const BROADCAST_CAPACITY: usize = 256;

// ── Main ─────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();

    // --- Database ---
    let db_path = std::env::args()
        .nth(1)
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("server.db"));
    tracing::info!("Opening database at {}", db_path.display());

    let pool = open_pool(&db_path).await.expect("Failed to open database");
    run_migrations(&pool).await.expect("Failed to run migrations");
    let repo = SqliteRepository::new(pool);

    // --- DM pipeline ---
    let backend: Box<dyn auto_dm_core::llm::LlmBackend> = Box::new(StubLlmBackend);
    let pipeline = DmPipeline::new(backend);

    // --- Shared state ---
    let (event_tx, _rx) = broadcast::channel(BROADCAST_CAPACITY);
    let state = Arc::new(SessionState {
        game: GameState {
            repo,
            dm: tokio::sync::Mutex::new(Some(Arc::new(pipeline))),
            memory: std::sync::Mutex::new(auto_dm_core::memory::CampaignMemory::new()),
            ollama_child: std::sync::Mutex::new(None),
            current_model: std::sync::Mutex::new("stub".into()),
            current_num_predict: std::sync::Mutex::new(512),
        },
        event_tx,
        session_lock: tokio::sync::Mutex::new(()),
    });

    // --- Routes ---
    let app = Router::new()
        .route("/health", get(health))
        .route("/resolve", post(resolve))
        .route("/logs/{scene_id}", get(list_logs))
        .route("/ws", get(ws_handler))
        .with_state(state);

    let addr = std::env::var("ADDR").unwrap_or_else(|_| "0.0.0.0:3000".into());
    tracing::info!("Listening on {addr}");
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

// ── Health ───────────────────────────────────────────────────────────

async fn health() -> Json<Value> {
    Json(json!({ "status": "ok" }))
}

// ── Resolve (POST) — broadcast while holding lock ────────────────────

async fn resolve(
    AxumState(state): AxumState<Arc<SessionState>>,
    Json(mut request): Json<auto_dm_core::llm::DmRequest>,
) -> Result<Json<auto_dm_core::llm::DmResponse>, (StatusCode, String)> {
    // CRITICAL: acquire the session lock BEFORE any engine work.
    // This serializes resolve + broadcast so event order matches mutation order.
    let _lock = state.session_lock.lock().await;

    // Inject memory context.
    {
        let mem = state
            .game
            .memory
            .lock()
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        if !mem.is_empty() {
            request.memory_context = Some(mem.to_context(20));
        }
    }

    // Clone the pipeline Arc (lock-clone-release pattern).
    let pipeline = {
        let dm = state.game.dm.lock().await;
        dm.as_ref()
            .cloned()
            .ok_or_else(|| {
                (StatusCode::SERVICE_UNAVAILABLE, "DM backend not initialized".into())
            })?
    };

    // Run through the engine.
    let mut response = pipeline
        .resolve_action(&request)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let events = apply_session_effects(&state.game, &request, &mut response).await;

    // Broadcast WHILE the session lock is held — this is the order guarantee.
    // Any concurrent WebSocket receiver sees events in exactly this sequence.
    for event in &events {
        let _ = state.event_tx.send(WsMessage::Event { event: event.clone() });
    }

    tracing::info!(
        intent = ?response.intent,
        events = events.len(),
        source = %response.source,
        "Request resolved"
    );

    // _lock dropped here — next queued request can proceed.
    Ok(Json(response))
}

// ── Logs (GET) ───────────────────────────────────────────────────────

async fn list_logs(
    AxumState(state): AxumState<Arc<SessionState>>,
    axum::extract::Path(scene_id): axum::extract::Path<String>,
) -> Result<Json<Vec<LogEntry>>, (StatusCode, String)> {
    let logs = state
        .game
        .repo
        .list_logs(&scene_id, 100)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(logs))
}

// ── WebSocket (/ws?scene_id=X) ──────────────────────────────────────

#[derive(Deserialize)]
struct WsQuery {
    scene_id: String,
}

async fn ws_handler(
    AxumState(state): AxumState<Arc<SessionState>>,
    Query(query): Query<WsQuery>,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(state, socket, query.scene_id))
}

async fn handle_socket(state: Arc<SessionState>, mut socket: WebSocket, scene_id: String) {
    let mut rx = state.event_tx.subscribe();

    // ── Initial resync: send current state so client starts consistent ──
    let resync = build_resync(&state, &scene_id).await;
    if socket.send(Message::Text(resync.into())).await.is_err() {
        return; // client disconnected during initial sync
    }

    // ── Event loop: forward broadcast events, handle Lagged ─────────────
    loop {
        match rx.recv().await {
            Ok(WsMessage::Event { event }) => {
                let msg = WsMessage::Event { event };
                let json = match serde_json::to_string(&msg) {
                    Ok(j) => j,
                    Err(_) => continue,
                };
                if socket.send(Message::Text(json.into())).await.is_err() {
                    break; // client disconnected
                }
            }
            Ok(WsMessage::Resync { .. }) => {
                // Resync messages are only sent by the server, never
                // received from the broadcast channel.  Ignore.
            }
            Err(broadcast::error::RecvError::Lagged(n)) => {
                tracing::warn!(client = %scene_id, missed = n, "Client lagged — forcing resync");
                let resync = build_resync(&state, &scene_id).await;
                if socket.send(Message::Text(resync.into())).await.is_err() {
                    break;
                }
            }
            Err(broadcast::error::RecvError::Closed) => {
                tracing::info!("Broadcast channel closed");
                break;
            }
        }
    }

    tracing::info!(scene_id, "WebSocket client disconnected");
}

/// Build a full-state resync message: current scene summary + recent logs.
/// Called on initial connection and on Lagged.
async fn build_resync(state: &SessionState, scene_id: &str) -> String {
    let summary = state
        .game
        .repo
        .get_scene_summary(scene_id)
        .await
        .ok()
        .flatten()
        .unwrap_or_default();
    let logs = state
        .game
        .repo
        .list_logs(scene_id, 100)
        .await
        .unwrap_or_default();

    let msg = WsMessage::Resync { scene_summary: summary, logs };
    serde_json::to_string(&msg).unwrap_or_else(|_| {
        serde_json::to_string(&WsMessage::Resync {
            scene_summary: String::new(),
            logs: vec![],
        })
        .unwrap()
    })
}
