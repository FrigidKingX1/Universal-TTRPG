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
use std::time::Duration;

mod session;
use session::{GameMode, SessionRegistry, TurnCheck, WsMessage};

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
        .route("/sessions/{session_id}/combat/start", post(start_combat))
        .route("/sessions/{session_id}/combat/end", post(end_combat))
        .route("/sessions/{session_id}/combat/join", post(join_combat_queue))
        .route("/sessions/{session_id}/combat/skip", post(skip_turn))
        .route("/sessions/{session_id}/combat/status", get(combat_status))
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
    let (session, player_id) =
        state.registry.authenticate(&token).await.map_err(|e| {
            (StatusCode::UNAUTHORIZED, e)
        })?;
    if session.id != session_id {
        return Err((StatusCode::FORBIDDEN, "Token belongs to different session".into()));
    }

    // Per-session lock — check turn gate INSIDE the lock for atomicity.
    // In exploration: anyone can act.  In combat: only the current turn-holder.
    let _lock = session.session_lock.lock().await;

    match session.turn_gate.can_act(&player_id).await {
        TurnCheck::Allowed => {}
        TurnCheck::Waiting { position } => {
            return Err((
                StatusCode::CONFLICT,
                format!("Not your turn — you are #{position} in the queue"),
            ));
        }
        TurnCheck::NotInQueue => {
            return Err((
                StatusCode::CONFLICT,
                "Combat is active but you are not in the turn queue".into(),
            ));
        }
    }

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

    // Advance turn if in combat mode.
    let (mode, next_turn) = session.turn_gate.advance_turn().await;
    if mode == GameMode::Combat {
        tracing::info!(
            session = %session_id,
            next_turn = ?next_turn,
            "Turn advanced"
        );
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

// ── Combat management (C4) ───────────────────────────────────────────

async fn start_combat(
    AxumState(state): AxumState<Arc<AppState>>,
    Path(session_id): Path<String>,
    headers: axum::http::header::HeaderMap,
) -> Result<Json<Value>, (StatusCode, String)> {
    let token = extract_token(&headers)?;
    let (session, player_id) =
        state.registry.authenticate(&token).await.map_err(|e| (StatusCode::UNAUTHORIZED, e))?;
    if session.id != session_id {
        return Err((StatusCode::FORBIDDEN, "Token belongs to different session".into()));
    }
    session.turn_gate.start_combat(player_id.clone()).await;
    tracing::info!(session = %session_id, starter = %player_id, "Combat started");
    Ok(Json(json!({ "mode": "combat", "current_turn": player_id })))
}

async fn end_combat(
    AxumState(state): AxumState<Arc<AppState>>,
    Path(session_id): Path<String>,
    headers: axum::http::header::HeaderMap,
) -> Result<Json<Value>, (StatusCode, String)> {
    let token = extract_token(&headers)?;
    let (session, _) =
        state.registry.authenticate(&token).await.map_err(|e| (StatusCode::UNAUTHORIZED, e))?;
    if session.id != session_id {
        return Err((StatusCode::FORBIDDEN, "Token belongs to different session".into()));
    }
    session.turn_gate.end_combat().await;
    tracing::info!(session = %session_id, "Combat ended");
    Ok(Json(json!({ "mode": "exploration" })))
}

async fn join_combat_queue(
    AxumState(state): AxumState<Arc<AppState>>,
    Path(session_id): Path<String>,
    headers: axum::http::header::HeaderMap,
) -> Result<Json<Value>, (StatusCode, String)> {
    let token = extract_token(&headers)?;
    let (session, player_id) =
        state.registry.authenticate(&token).await.map_err(|e| (StatusCode::UNAUTHORIZED, e))?;
    if session.id != session_id {
        return Err((StatusCode::FORBIDDEN, "Token belongs to different session".into()));
    }
    session.turn_gate.join_queue(&player_id).await;
    let (mode, current, queue) = session.turn_gate.status().await;
    Ok(Json(json!({
        "mode": mode,
        "current_turn": current,
        "queue": queue,
    })))
}

async fn skip_turn(
    AxumState(state): AxumState<Arc<AppState>>,
    Path(session_id): Path<String>,
    headers: axum::http::header::HeaderMap,
) -> Result<Json<Value>, (StatusCode, String)> {
    let token = extract_token(&headers)?;
    let (session, player_id) =
        state.registry.authenticate(&token).await.map_err(|e| (StatusCode::UNAUTHORIZED, e))?;
    if session.id != session_id {
        return Err((StatusCode::FORBIDDEN, "Token belongs to different session".into()));
    }
    let _lock = session.session_lock.lock().await;
    match session.turn_gate.can_act(&player_id).await {
        TurnCheck::Allowed => {
            let (mode, next) = session.turn_gate.advance_turn().await;
            Ok(Json(json!({ "mode": mode, "skipped": player_id, "current_turn": next })))
        }
        other => Err((StatusCode::CONFLICT, format!("Cannot skip: {other:?}"))),
    }
}

async fn combat_status(
    AxumState(state): AxumState<Arc<AppState>>,
    Path(session_id): Path<String>,
    headers: axum::http::header::HeaderMap,
) -> Result<Json<Value>, (StatusCode, String)> {
    let token = extract_token(&headers)?;
    let (session, _) =
        state.registry.authenticate(&token).await.map_err(|e| (StatusCode::UNAUTHORIZED, e))?;
    if session.id != session_id {
        return Err((StatusCode::FORBIDDEN, "Token belongs to different session".into()));
    }
    let (mode, current, queue) = session.turn_gate.status().await;
    Ok(Json(json!({ "mode": mode, "current_turn": current, "queue": queue })))
}

// ── WebSocket ────────────────────────────────────────────────────────

const PING_INTERVAL: Duration = Duration::from_secs(30);
const PONG_TIMEOUT: Duration = Duration::from_secs(90);

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

/// WebSocket connection handler with ping/pong heartbeat.
///
/// Dead connection detection: the server sends pings every 30s.  If no
/// pong (or any activity) arrives within 90s, the connection is closed
/// and the player slot is cleaned up.  This catches backgrounded mobile
/// browsers and flaky networks that never send a clean close frame.
async fn handle_socket(
    state: Arc<AppState>,
    session: Arc<session::Session>,
    player_id: String,
    mut socket: WebSocket,
) {
    let mut rx = session.event_tx.subscribe();
    let mut ping_interval = tokio::time::interval(PING_INTERVAL);
    let mut last_activity = tokio::time::Instant::now();

    // Initial resync — materialized state, not raw logs.
    let resync = session::build_resync(&session).await;
    let msg = WsMessage::Resync(resync);
    if socket.send(Message::Text(serde_json::to_string(&msg).unwrap().into())).await.is_err() {
        mark_disconnected(&state, &session, &player_id).await;
        return;
    }

    loop {
        tokio::select! {
            // ── Broadcast events → forward to client ──────────────
            result = rx.recv() => {
                last_activity = tokio::time::Instant::now();
                match result {
                    Ok(WsMessage::Event { event }) => {
                        let json = match serde_json::to_string(&WsMessage::Event { event }) {
                            Ok(j) => j,
                            Err(_) => continue,
                        };
                        if socket.send(Message::Text(json.into())).await.is_err() {
                            break;
                        }
                    }
                    Ok(WsMessage::Resync(_)) => {}
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                        tracing::warn!(session = %session.id, player = %player_id, missed = n, "Lagged — resync");
                        let resync = session::build_resync(&session).await;
                        let msg = WsMessage::Resync(resync);
                        if socket.send(Message::Text(serde_json::to_string(&msg).unwrap().into())).await.is_err() {
                            break;
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
            // ── Ping every 30s, check pong timeout ───────────────
            _ = ping_interval.tick() => {
                // Send ping.
                if socket.send(Message::Ping(vec![].into())).await.is_err() {
                    break; // send failed → connection dead
                }
                // Check if we've heard nothing in PONG_TIMEOUT.
                if last_activity.elapsed() > PONG_TIMEOUT {
                    tracing::warn!(
                        session = %session.id,
                        player = %player_id,
                        idle = ?last_activity.elapsed(),
                        "No pong within timeout — closing dead connection"
                    );
                    break;
                }
            }
            // ── Read from socket (pongs, close frames) ───────────
            msg = socket.recv() => {
                match msg {
                    Some(Ok(Message::Pong(_))) => {
                        last_activity = tokio::time::Instant::now();
                    }
                    Some(Ok(Message::Close(_))) => break,
                    None => break,
                    _ => {} // ignore text/binary from client
                }
            }
        }
    }

    mark_disconnected(&state, &session, &player_id).await;
    tracing::info!(session = %session.id, player = %player_id, "WebSocket disconnected");
}

async fn mark_disconnected(state: &AppState, session: &session::Session, player_id: &str) {
    // Remove from combat queue if present; advance turn if needed.
    let (mode, next_turn) = session.turn_gate.remove_player(player_id).await;
    if mode == GameMode::Combat {
        tracing::info!(
            session = %session.id,
            disconnected = %player_id,
            next_turn = ?next_turn,
            "Player disconnected during combat — turn advanced"
        );
    }

    // Mark disconnected in player list.
    let sessions = state.registry.sessions.read().await;
    if let Some(s) = sessions.get(&session.id) {
        let mut players = s.players.write().await;
        if let Some(p) = players.iter_mut().find(|p| p.id == player_id) {
            p.connected = false;
        }
    }
}
