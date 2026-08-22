use axum::{
    extract::{
        ws::{Message, WebSocket},
        Path, Query, State as AxumState, WebSocketUpgrade,
    },
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use auto_dm_engine::{apply_session_effects, LogEntry, Repository};
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Arc;

mod session;
use session::{SessionRegistry, WsMessage};

struct AppState {
    registry: Arc<SessionRegistry>,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();
    let data_dir = std::env::args()
        .nth(1)
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("sessions"));
    tracing::info!("Session data dir: {}", data_dir.display());

    let backend: Box<dyn auto_dm_core::llm::LlmBackend> =
        Box::new(auto_dm_core::llm::StubLlmBackend);
    let pipeline = Arc::new(auto_dm_core::llm::DmPipeline::new(backend));

    let state = Arc::new(AppState {
        registry: Arc::new(SessionRegistry::new(data_dir, pipeline)),
    });

    let app = Router::new()
        .route("/health", get(health))
        .route("/sessions", post(create_session).get(list_sessions))
        .route("/sessions/{join_code}/join", post(join_session))
        .route("/sessions/{session_id}/resolve", post(resolve))
        .route("/sessions/{session_id}/ws", get(ws_handler))
        .route("/sessions/{session_id}/logs", get(list_logs))
        .with_state(state);

    let addr = std::env::var("ADDR").unwrap_or_else(|_| "0.0.0.0:3000".into());
    tracing::info!("Listening on {addr}");
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

async fn health() -> Json<Value> {
    Json(json!({ "status": "ok" }))
}

// ── Bearer token extraction ──────────────────────────────────────────

fn extract_token(
    headers: &axum::http::header::HeaderMap,
) -> Result<String, (StatusCode, String)> {
    let auth = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| (StatusCode::UNAUTHORIZED, "Missing Authorization header".into()))?;
    auth.strip_prefix("Bearer ")
        .map(|s| s.to_string())
        .ok_or_else(|| (StatusCode::UNAUTHORIZED, "Invalid Authorization format".into()))
}

// ── Session management ───────────────────────────────────────────────

#[derive(Deserialize)]
struct CreateSessionRequest {
    title: String,
}

async fn create_session(
    AxumState(state): AxumState<Arc<AppState>>,
    Json(req): Json<CreateSessionRequest>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let (session_id, join_code, host_token) =
        state.registry.create_session(&req.title).await.map_err(|e| {
            (StatusCode::INTERNAL_SERVER_ERROR, e)
        })?;
    Ok(Json(json!({
        "session_id": session_id,
        "join_code": join_code,
        "host_token": host_token,
    })))
}

#[derive(Deserialize)]
struct JoinSessionRequest {
    player_name: String,
}

async fn join_session(
    AxumState(state): AxumState<Arc<AppState>>,
    Path(join_code): Path<String>,
    Json(req): Json<JoinSessionRequest>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let (session_id, token, player_id) = state
        .registry
        .join_session(&join_code, &req.player_name)
        .await
        .map_err(|e| (StatusCode::BAD_REQUEST, e))?;
    Ok(Json(json!({
        "session_id": session_id,
        "player_token": token,
        "player_id": player_id,
    })))
}

async fn list_sessions(AxumState(state): AxumState<Arc<AppState>>) -> Json<Value> {
    let sessions = state.registry.list_sessions().await;
    Json(json!(sessions))
}

// ── Resolve ──────────────────────────────────────────────────────────

async fn resolve(
    AxumState(state): AxumState<Arc<AppState>>,
    Path(session_id): Path<String>,
    headers: axum::http::header::HeaderMap,
    Json(mut request): Json<auto_dm_core::llm::DmRequest>,
) -> Result<Json<auto_dm_core::llm::DmResponse>, (StatusCode, String)> {
    let token = extract_token(&headers)?;
    let (session, _player_id) =
        state.registry.authenticate(&token).await.map_err(|e| {
            (StatusCode::UNAUTHORIZED, e)
        })?;
    if session.id != session_id {
        return Err((StatusCode::FORBIDDEN, "Token belongs to different session".into()));
    }

    // Per-session lock — only blocks within this session.
    let _lock = session.session_lock.lock().await;

    {
        let mem = session.game.memory.lock().map_err(|e| {
            (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
        })?;
        if !mem.is_empty() {
            request.memory_context = Some(mem.to_context(20));
        }
    }

    let pipeline = {
        let dm = session.game.dm.lock().await;
        dm.as_ref().cloned().ok_or_else(|| {
            (StatusCode::SERVICE_UNAVAILABLE, "DM backend not initialized".into())
        })?
    };

    let mut response = pipeline
        .resolve_action(&request)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let events = apply_session_effects(&session.game, &request, &mut response).await;

    // Broadcast WHILE session lock held — order guarantee.
    for event in &events {
        let _ = session.event_tx.send(WsMessage::Event { event: event.clone() });
    }

    tracing::info!(session = %session_id, events = events.len(), "Resolved");
    Ok(Json(response))
}

// ── Logs ─────────────────────────────────────────────────────────────

async fn list_logs(
    AxumState(state): AxumState<Arc<AppState>>,
    Path(session_id): Path<String>,
    headers: axum::http::header::HeaderMap,
) -> Result<Json<Vec<LogEntry>>, (StatusCode, String)> {
    let token = extract_token(&headers)?;
    let (session, _) = state.registry.authenticate(&token).await.map_err(|e| {
        (StatusCode::UNAUTHORIZED, e)
    })?;
    if session.id != session_id {
        return Err((StatusCode::FORBIDDEN, "Token belongs to different session".into()));
    }
    let scene_id = session
        .game
        .repo
        .active_scene()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .map(|s| s.id)
        .unwrap_or_default();
    let logs = session
        .game
        .repo
        .list_logs(&scene_id, 100)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(logs))
}

// ── WebSocket ────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct WsQuery {
    token: String,
}

async fn ws_handler(
    AxumState(state): AxumState<Arc<AppState>>,
    Path(session_id): Path<String>,
    Query(query): Query<WsQuery>,
    ws: WebSocketUpgrade,
) -> impl IntoResponse {
    let result = state.registry.authenticate(&query.token).await;
    match result {
        Ok((session, player_id)) if session.id == session_id => {
            {
                let mut players = session.players.write().await;
                if let Some(p) = players.iter_mut().find(|p| p.id == player_id) {
                    p.connected = true;
                }
            }
            ws.on_upgrade(move |socket| handle_socket(state, session, player_id, socket))
        }
        _ => (StatusCode::UNAUTHORIZED, "Invalid token or session mismatch").into_response(),
    }
}

async fn handle_socket(
    state: Arc<AppState>,
    session: Arc<session::Session>,
    player_id: String,
    mut socket: WebSocket,
) {
    let mut rx = session.event_tx.subscribe();

    // Initial resync.
    let resync = build_resync(&session).await;
    if socket.send(Message::Text(resync.into())).await.is_err() {
        mark_disconnected(&state, &session, &player_id).await;
        return;
    }

    loop {
        match rx.recv().await {
            Ok(WsMessage::Event { event }) => {
                let json = match serde_json::to_string(&WsMessage::Event { event }) {
                    Ok(j) => j,
                    Err(_) => continue,
                };
                if socket.send(Message::Text(json.into())).await.is_err() {
                    break;
                }
            }
            Ok(WsMessage::Resync { .. }) => {}
            Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                tracing::warn!(session = %session.id, player = %player_id, missed = n, "Lagged — resync");
                let resync = build_resync(&session).await;
                if socket.send(Message::Text(resync.into())).await.is_err() {
                    break;
                }
            }
            Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
        }
    }

    mark_disconnected(&state, &session, &player_id).await;
}

async fn mark_disconnected(state: &AppState, session: &session::Session, player_id: &str) {
    let sessions = state.registry.sessions.read().await;
    if let Some(s) = sessions.get(&session.id) {
        let mut players = s.players.write().await;
        if let Some(p) = players.iter_mut().find(|p| p.id == player_id) {
            p.connected = false;
        }
    }
}

async fn build_resync(session: &session::Session) -> String {
    let scene = session.game.repo.active_scene().await.ok().flatten();
    let scene_id = scene.as_ref().map(|s| s.id.as_str()).unwrap_or("");
    let summary = session
        .game
        .repo
        .get_scene_summary(scene_id)
        .await
        .ok()
        .flatten()
        .unwrap_or_default();
    let logs = session
        .game
        .repo
        .list_logs(scene_id, 100)
        .await
        .unwrap_or_default();
    serde_json::to_string(&WsMessage::Resync { scene_summary: summary, logs })
        .unwrap_or_default()
}
