use auto_dm_engine::{
    apply_session_effects, tick_idle_clocks, CampaignExport, LogEntry, Repository,
};
use axum::{
    extract::{
        ws::{Message, WebSocket},
        Path, Query, State as AxumState, WebSocketUpgrade,
    },
    http::StatusCode,
    response::IntoResponse,
    routing::{delete, get, post, put},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

// Reuse the library's modules â€” one compilation, no dead-code warnings
// for items only the lib's external consumers (mcp-server) exercise.
use auto_dm_server::{presets, session};
use session::{broadcast_turn_state, GameMode, SessionRegistry, TurnCheck, WsMessage};

struct AppState {
    registry: Arc<SessionRegistry>,
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();
    let data_dir =
        std::env::args().nth(1).map(PathBuf::from).unwrap_or_else(|| PathBuf::from("sessions"));
    tracing::info!("Session data dir: {}", data_dir.display());

    let ollama_url =
        std::env::var("OLLAMA_URL").unwrap_or_else(|_| "http://localhost:11434".into());
    let ollama_model = std::env::var("OLLAMA_MODEL").unwrap_or_else(|_| "llama3.2".into());

    let reachable = auto_dm_core::ollama::OllamaLlmBackend::reachable_url(&ollama_url);
    tracing::info!(url = %ollama_url, model = %ollama_model, reachable, "Ollama config");

    let state = Arc::new(AppState {
        registry: Arc::new(
            SessionRegistry::new(data_dir, ollama_url, ollama_model)
                .await
                .expect("Failed to initialize session registry"),
        ),
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
        .route("/sessions/{session_id}/campaign", post(import_campaign))
        .route("/sessions/{session_id}/characters", get(list_characters).post(create_character))
        .route("/sessions/{session_id}/characters/me", get(get_my_character))
        .route("/sessions/{session_id}/characters/me/equip", post(equip_item))
        .route("/sessions/{session_id}/characters/me/use-item", post(use_item))
        .route("/sessions/{session_id}/characters/me/add-item", post(add_item))
        .route("/sessions/{session_id}/characters/me/rest", post(rest_character))
        .route("/sessions/{session_id}/characters/link", post(link_character))
        .route("/sessions/{session_id}/scenes", post(create_scene).get(list_scenes))
        .route("/sessions/{session_id}/scenes/{scene_id}", put(update_scene).delete(delete_scene))
        .route("/sessions/{session_id}/scenes/activate", post(activate_scene))
        .route("/sessions/{session_id}/npcs", post(create_npc).get(list_npcs))
        .route("/sessions/{session_id}/npcs/{npc_id}", put(update_npc).delete(delete_npc))
        .route("/sessions/{session_id}/clocks", post(create_clock).get(list_clocks))
        .route("/sessions/{session_id}/clocks/{clock_id}/advance", post(advance_clock))
        .route("/sessions/{session_id}/clocks/{clock_id}/reset", post(reset_clock))
        .route("/sessions/{session_id}/clocks/{clock_id}", delete(delete_clock))
        .route("/sessions/{session_id}/combat/attack", post(server_combat_attack))
        .route("/sessions/{session_id}/map", post(server_map_update))
        .route("/sessions/{session_id}/combat/heal", post(server_combat_heal))
        .route("/sessions/{session_id}/combat/condition", post(server_combat_condition))
        .route("/sessions/{session_id}/combat/sync", post(server_combat_sync))
        .route("/sessions/{session_id}/combat/initiative", post(server_combat_initiative))
        .route("/ollama/configure", post(configure_ollama).get(get_ollama_config))
        .route("/ollama/models", get(list_ollama_models))
        .with_state(state);

    let addr = std::env::var("ADDR").unwrap_or_else(|_| "0.0.0.0:3000".into());
    tracing::info!("Listening on {addr}");
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}

/// Embedded-library sizes, parsed once â€” /health may be probed often.
fn preset_counts() -> (usize, usize) {
    static COUNTS: std::sync::OnceLock<(usize, usize)> = std::sync::OnceLock::new();
    *COUNTS.get_or_init(|| (presets::preset_actions().len(), presets::preset_stat_blocks().len()))
}

async fn health() -> Json<Value> {
    // Embedded-library counts double as a build fingerprint and give the
    // tunnel/uptime probe something meaningful to compare across restarts.
    let (actions, monsters) = preset_counts();
    Json(json!({
        "status": "ok",
        "preset_actions": actions,
        "preset_monsters": monsters,
    }))
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Ollama configuration Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

#[derive(Deserialize)]
struct ConfigureOllamaRequest {
    #[serde(default)]
    url: Option<String>,
    #[serde(default)]
    model: Option<String>,
}

async fn configure_ollama(
    AxumState(state): AxumState<Arc<AppState>>,
    headers: axum::http::header::HeaderMap,
    Json(req): Json<ConfigureOllamaRequest>,
) -> Result<Json<Value>, (StatusCode, String)> {
    // Host-only, and it must stay that way: this endpoint chooses where the
    // DM's prompts go. Left open, any session member (or anyone reached via
    // the tunnel with a stolen join code) could repoint Ollama at a server
    // they control and harvest every prompt the table sends.
    let token = extract_token(&headers)?;
    let (session, player_id) =
        state.registry.authenticate(&token).await.map_err(|e| (StatusCode::UNAUTHORIZED, e))?;
    require_host(&session, &player_id).await?;

    if let Some(url) = req.url {
        state
            .registry
            .set_ollama_url(url)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
    }
    if let Some(model) = req.model {
        state
            .registry
            .set_model(model)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
    }
    let (url, model, reachable) = state.registry.ollama_config();
    Ok(Json(json!({
        "url": url,
        "model": model,
        "reachable": reachable,
    })))
}

async fn get_ollama_config(
    AxumState(state): AxumState<Arc<AppState>>,
    headers: axum::http::header::HeaderMap,
) -> Result<Json<Value>, (StatusCode, String)> {
    state
        .registry
        .authenticate(&extract_token(&headers)?)
        .await
        .map_err(|e| (StatusCode::UNAUTHORIZED, e))?;
    let (url, model, reachable) = state.registry.ollama_config();
    Ok(Json(json!({
        "url": url,
        "model": model,
        "reachable": reachable,
    })))
}

async fn list_ollama_models(
    AxumState(state): AxumState<Arc<AppState>>,
    headers: axum::http::header::HeaderMap,
) -> Result<Json<Value>, (StatusCode, String)> {
    state
        .registry
        .authenticate(&extract_token(&headers)?)
        .await
        .map_err(|e| (StatusCode::UNAUTHORIZED, e))?;
    let (url, _, _) = state.registry.ollama_config();
    let models = auto_dm_core::ollama::list_models_at(&url)
        .await
        .map_err(|e| (StatusCode::BAD_GATEWAY, e.to_string()))?;
    Ok(Json(json!({ "models": models })))
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Bearer token extraction Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

fn extract_token(headers: &axum::http::header::HeaderMap) -> Result<String, (StatusCode, String)> {
    let auth = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| (StatusCode::UNAUTHORIZED, "Missing Authorization header".into()))?;
    auth.strip_prefix("Bearer ")
        .map(|s| s.to_string())
        .ok_or_else(|| (StatusCode::UNAUTHORIZED, "Invalid Authorization format".into()))
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Session management Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

#[derive(Deserialize)]
struct CreateSessionRequest {
    title: String,
}

async fn create_session(
    AxumState(state): AxumState<Arc<AppState>>,
    Json(req): Json<CreateSessionRequest>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let (session_id, join_code, host_token) = state
        .registry
        .create_session(&req.title)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
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

async fn list_sessions(
    AxumState(state): AxumState<Arc<AppState>>,
    headers: axum::http::header::HeaderMap,
) -> Result<Json<Value>, (StatusCode, String)> {
    // Authenticated, and join codes stay server-side: the code IS the table
    // password â€” handing the full list to anyone scanning the tunnel URL
    // would let them join every session on the host.
    let token = extract_token(&headers)?;
    state.registry.authenticate(&token).await.map_err(|e| (StatusCode::UNAUTHORIZED, e))?;
    let sessions = state.registry.list_sessions().await;
    Ok(Json(json!(sessions)))
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Resolve Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

async fn resolve(
    AxumState(state): AxumState<Arc<AppState>>,
    Path(session_id): Path<String>,
    headers: axum::http::header::HeaderMap,
    Json(mut request): Json<auto_dm_core::llm::DmRequest>,
) -> Result<Json<auto_dm_core::llm::DmResponse>, (StatusCode, String)> {
    let token = extract_token(&headers)?;
    let (session, player_id) =
        state.registry.authenticate(&token).await.map_err(|e| (StatusCode::UNAUTHORIZED, e))?;
    if session.id != session_id {
        return Err((StatusCode::FORBIDDEN, "Token belongs to different session".into()));
    }

    // Prompt-size guard: a runaway client (or hostile one) shouldn't be
    // able to push megabytes of "player action" into a 180 s LLM call.
    if request.player_action.chars().count() > 8_000 {
        return Err((
            StatusCode::BAD_REQUEST,
            "Player action too long (max 8000 characters)".into(),
        ));
    }

    // â”€â”€ Phase A: gate check + context snapshot under the lock, then
    // RELEASE it for the LLM call.  Holding the per-session lock across a
    // generate (up to 180 s) serialized every player's actions behind one
    // request; in exploration mode the table froze on whoever typed last.
    {
        let _lock = session.session_lock.lock().await;
        match session.turn_gate.can_act(&player_id).await {
            TurnCheck::Allowed => {}
            TurnCheck::Waiting { position } => {
                return Err((
                    StatusCode::CONFLICT,
                    format!("Not your turn â€” you are #{position} in the queue"),
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
            let mem = session
                .game
                .memory
                .lock()
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
            if !mem.is_empty() {
                request.memory_context = Some(mem.to_context(20));
            }
        }
    } // lock released â€” LLM runs unlocked

    let pipeline = {
        let dm = session.game.dm.lock().await;
        dm.as_ref()
            .cloned()
            .ok_or_else(|| (StatusCode::SERVICE_UNAVAILABLE, "DM backend not initialized".into()))?
    };

    let mut response = pipeline
        .resolve_action(&request)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // â”€â”€ Phase B: re-validate and apply atomically.  The gate verdict is
    // re-checked because combat may have started/ended (or the holder may
    // have skipped) while we were generating.  Apply + broadcast + advance
    // stay under one lock so event order matches state order.
    let _lock = session.session_lock.lock().await;
    match session.turn_gate.can_act(&player_id).await {
        TurnCheck::Allowed => {}
        _ => {
            return Err((
                StatusCode::CONFLICT,
                "Turn changed while resolving â€” action not applied".into(),
            ));
        }
    }

    let mut events = apply_session_effects(&session.game, &request, &mut response).await;

    // Broadcast WHILE session lock held â€” order guarantee.
    for event in &events {
        session.send_event(event.clone());
    }

    // Advance turn if in combat mode.
    let (mode, next_turn) = session.turn_gate.advance_turn().await;
    state.registry.persist_turn_state(&session).await;
    broadcast_turn_state(&session).await;
    if mode == GameMode::Combat {
        tracing::info!(
            session = %session_id,
            next_turn = ?next_turn,
            "Turn advanced"
        );
    }

    // Idle doom clocks: mirror the desktop resolve path â€” if the log tail
    // shows N consecutive idle entries, advance all active clocks. Without
    // this, doom clocks never move in hosted play.
    if let Some(ref scene_id) = request.scene_id {
        let idle_events = tick_idle_clocks(&session.game, scene_id).await;
        if !idle_events.is_empty() {
            for e in &idle_events {
                response.mechanical_events.push(e.describe());
            }
            events.extend(idle_events);
        }
    }

    tracing::info!(session = %session_id, events = events.len(), "Resolved");
    Ok(Json(response))
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Logs Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

async fn list_logs(
    AxumState(state): AxumState<Arc<AppState>>,
    Path(session_id): Path<String>,
    headers: axum::http::header::HeaderMap,
) -> Result<Json<Vec<LogEntry>>, (StatusCode, String)> {
    let token = extract_token(&headers)?;
    let (session, _) =
        state.registry.authenticate(&token).await.map_err(|e| (StatusCode::UNAUTHORIZED, e))?;
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

// Ã¢â€â‚¬Ã¢â€â‚¬ Campaign import (host uploads campaign data to session DB) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

async fn import_campaign(
    AxumState(state): AxumState<Arc<AppState>>,
    Path(session_id): Path<String>,
    headers: axum::http::header::HeaderMap,
    Json(data): Json<CampaignExport>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let token = extract_token(&headers)?;
    let (session, player_id) =
        state.registry.authenticate(&token).await.map_err(|e| (StatusCode::UNAUTHORIZED, e))?;
    if session.id != session_id {
        return Err((StatusCode::FORBIDDEN, "Token belongs to different session".into()));
    }

    // Only the host can import campaign data.
    let players = session.players.read().await;
    let is_host = players.first().is_some_and(|p| p.id == player_id);
    drop(players);
    if !is_host {
        return Err((StatusCode::FORBIDDEN, "Only the host can import campaign data".into()));
    }

    // Import into the session's database, atomically against live play:
    // import_campaign is multi-statement, and an interleaved resolve could
    // apply effects on top of half-replaced campaign state. The lock also
    // makes the resync's seq bound exact for the replay filter.
    let _lock = session.session_lock.lock().await;
    session
        .game
        .repo
        .import_campaign(&data)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("Import failed: {e}")))?;

    // Broadcast resync so all connected clients pick up the new data.
    let resync = session::build_resync_under_lock(&session).await;
    let _ = session.event_tx.send(WsMessage::Resync(resync));

    tracing::info!(session = %session_id, scenes = data.scenes.len(), "Campaign imported");
    Ok(Json(json!({ "ok": true })))
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Combat management (C4) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

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
    let _lock = session.session_lock.lock().await;
    // Host authority: re-starting combat resets whose turn it is, and
    // ending it wipes everyone's initiative — both are griefing vectors
    // in hostile hands, so only the table's host may invoke them.
    require_host(&session, &player_id).await?;
    session.turn_gate.start_combat(player_id.clone()).await;
    state.registry.persist_turn_state(&session).await;
    broadcast_turn_state(&session).await;
    tracing::info!(session = %session_id, starter = %player_id, "Combat started");
    Ok(Json(json!({ "mode": "combat", "current_turn": player_id })))
}

async fn end_combat(
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
    // Host authority: ending combat wipes everyone's turn state mid-fight.
    require_host(&session, &player_id).await?;
    session.turn_gate.end_combat().await;
    state.registry.persist_turn_state(&session).await;
    broadcast_turn_state(&session).await;
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
    let _lock = session.session_lock.lock().await;
    session.turn_gate.join_queue(&player_id).await;
    state.registry.persist_turn_state(&session).await;
    broadcast_turn_state(&session).await;
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
    let (mode, _, _) = session.turn_gate.status().await;
    if mode != GameMode::Combat {
        return Err((StatusCode::CONFLICT, "Can only skip turns during combat".into()));
    }
    match session.turn_gate.can_act(&player_id).await {
        TurnCheck::Allowed => {
            let (mode, next) = session.turn_gate.advance_turn().await;
            state.registry.persist_turn_state(&session).await;
            broadcast_turn_state(&session).await;
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

// Ã¢â€â‚¬Ã¢â€â‚¬ Character management (player actions) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

async fn list_characters(
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
    let characters = session
        .game
        .repo
        .list_characters()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(json!({ "characters": characters })))
}

async fn get_my_character(
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
    let players = session.players.read().await;
    let player = players
        .iter()
        .find(|p| p.id == player_id)
        .ok_or((StatusCode::NOT_FOUND, "Player not found".to_string()))?;
    let character_id = player.character_id.clone();
    drop(players);

    match character_id {
        Some(cid) => {
            let profile = session
                .game
                .repo
                .load_character(&cid)
                .await
                .map_err(|e| (StatusCode::NOT_FOUND, format!("Character not found: {e}")))?;
            Ok(Json(json!({ "character": profile })))
        }
        None => Ok(Json(json!({ "character": null }))),
    }
}

#[derive(Deserialize)]
struct CreateCharacterRequest {
    profile: auto_dm_core::models::CharacterProfile,
}

async fn create_character(
    AxumState(state): AxumState<Arc<AppState>>,
    Path(session_id): Path<String>,
    headers: axum::http::header::HeaderMap,
    Json(req): Json<CreateCharacterRequest>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let token = extract_token(&headers)?;
    let (session, player_id) =
        state.registry.authenticate(&token).await.map_err(|e| (StatusCode::UNAUTHORIZED, e))?;
    if session.id != session_id {
        return Err((StatusCode::FORBIDDEN, "Token belongs to different session".into()));
    }
    let profile = state
        .registry
        .create_character_for_player(&session, &player_id, req.profile)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    // Broadcast resync so all clients see the new character.
    let resync = session::build_resync(&session).await;
    let _ = session.event_tx.send(session::WsMessage::Resync(resync));

    Ok(Json(json!({ "character": profile })))
}

#[derive(Deserialize)]
struct LinkCharacterRequest {
    player_id: String,
    character_id: String,
}

async fn link_character(
    AxumState(state): AxumState<Arc<AppState>>,
    Path(session_id): Path<String>,
    headers: axum::http::header::HeaderMap,
    Json(req): Json<LinkCharacterRequest>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let token = extract_token(&headers)?;
    let (session, caller_id) =
        state.registry.authenticate(&token).await.map_err(|e| (StatusCode::UNAUTHORIZED, e))?;
    if session.id != session_id {
        return Err((StatusCode::FORBIDDEN, "Token belongs to different session".into()));
    }
    // Only host can link characters to other players.
    let players = session.players.read().await;
    let is_host = players.first().is_some_and(|p| p.id == caller_id);
    drop(players);
    if !is_host {
        return Err((StatusCode::FORBIDDEN, "Only the host can link characters".into()));
    }

    state
        .registry
        .link_character(&session, &req.player_id, &req.character_id)
        .await
        .map_err(|e| (StatusCode::BAD_REQUEST, e))?;

    // Broadcast resync so all clients see the updated mapping.
    let resync = session::build_resync(&session).await;
    let _ = session.event_tx.send(session::WsMessage::Resync(resync));

    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
struct EquipItemRequest {
    item_id: String,
    equipped: bool,
}

async fn equip_item(
    AxumState(state): AxumState<Arc<AppState>>,
    Path(session_id): Path<String>,
    headers: axum::http::header::HeaderMap,
    Json(req): Json<EquipItemRequest>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let token = extract_token(&headers)?;
    let (session, player_id) =
        state.registry.authenticate(&token).await.map_err(|e| (StatusCode::UNAUTHORIZED, e))?;
    if session.id != session_id {
        return Err((StatusCode::FORBIDDEN, "Token belongs to different session".into()));
    }
    let profile = state
        .registry
        .equip_item(&session, &player_id, &req.item_id, req.equipped)
        .await
        .map_err(|e| (StatusCode::BAD_REQUEST, e))?;

    // Mid-combat item changes (e.g. a shield) must reach the server-
    // authoritative combatant list, or the next resync reverts them.
    {
        let _lock = session.session_lock.lock().await;
        if let Ok(value) = serde_json::to_value(&profile) {
            let mut combatants = session.combatants.write().await;
            for c in combatants.iter_mut() {
                if c.get("id").and_then(|v| v.as_str()) == Some(profile.id.as_str()) {
                    *c = value;
                    break;
                }
            }
        }
    }

    let resync = session::build_resync_under_lock(&session).await;
    let _ = session.event_tx.send(session::WsMessage::Resync(resync));

    Ok(Json(json!({ "character": profile })))
}

#[derive(Deserialize)]
struct UseItemRequest {
    item_id: String,
}

async fn use_item(
    AxumState(state): AxumState<Arc<AppState>>,
    Path(session_id): Path<String>,
    headers: axum::http::header::HeaderMap,
    Json(req): Json<UseItemRequest>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let token = extract_token(&headers)?;
    let (session, player_id) =
        state.registry.authenticate(&token).await.map_err(|e| (StatusCode::UNAUTHORIZED, e))?;
    if session.id != session_id {
        return Err((StatusCode::FORBIDDEN, "Token belongs to different session".into()));
    }
    let profile = state
        .registry
        .use_item(&session, &player_id, &req.item_id)
        .await
        .map_err(|e| (StatusCode::BAD_REQUEST, e))?;

    // A potion drunk mid-combat changes HP on the profile; without this
    // patch the next resync's stale combatant snapshot reverts it.
    {
        let _lock = session.session_lock.lock().await;
        if let Ok(value) = serde_json::to_value(&profile) {
            let mut combatants = session.combatants.write().await;
            for c in combatants.iter_mut() {
                if c.get("id").and_then(|v| v.as_str()) == Some(profile.id.as_str()) {
                    *c = value;
                    break;
                }
            }
        }
    }

    let resync = session::build_resync_under_lock(&session).await;
    let _ = session.event_tx.send(session::WsMessage::Resync(resync));

    Ok(Json(json!({ "character": profile })))
}

#[derive(Deserialize)]
struct AddItemRequest {
    name: String,
    #[serde(default = "default_one")]
    quantity: i32,
    #[serde(default)]
    tags: Vec<String>,
}

fn default_one() -> i32 {
    1
}

async fn add_item(
    AxumState(state): AxumState<Arc<AppState>>,
    Path(session_id): Path<String>,
    headers: axum::http::header::HeaderMap,
    Json(req): Json<AddItemRequest>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let token = extract_token(&headers)?;
    let (session, player_id) =
        state.registry.authenticate(&token).await.map_err(|e| (StatusCode::UNAUTHORIZED, e))?;
    if session.id != session_id {
        return Err((StatusCode::FORBIDDEN, "Token belongs to different session".into()));
    }
    let item = auto_dm_core::models::InventoryItem {
        id: uuid::Uuid::new_v4().to_string(),
        name: req.name,
        // Griefing guard: negative/zero quantities corrupt inventory math
        // and absurd counts bloat every resync.
        quantity: req.quantity.clamp(1, 999),
        state: auto_dm_core::models::ItemState::Stowed,
        weight: 0.0,
        tags: req.tags,
    };
    let profile = state
        .registry
        .add_item(&session, &player_id, item)
        .await
        .map_err(|e| (StatusCode::BAD_REQUEST, e))?;

    let resync = session::build_resync(&session).await;
    let _ = session.event_tx.send(session::WsMessage::Resync(resync));

    Ok(Json(json!({ "character": profile })))
}

#[derive(Deserialize)]
struct RestRequest {
    #[serde(default)]
    long: bool,
}

async fn rest_character(
    AxumState(state): AxumState<Arc<AppState>>,
    Path(session_id): Path<String>,
    headers: axum::http::header::HeaderMap,
    Json(req): Json<RestRequest>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let token = extract_token(&headers)?;
    let (session, player_id) =
        state.registry.authenticate(&token).await.map_err(|e| (StatusCode::UNAUTHORIZED, e))?;
    if session.id != session_id {
        return Err((StatusCode::FORBIDDEN, "Token belongs to different session".into()));
    }
    let profile = state
        .registry
        .rest(&session, &player_id, req.long)
        .await
        .map_err(|e| (StatusCode::BAD_REQUEST, e))?;

    let resync = session::build_resync(&session).await;
    let _ = session.event_tx.send(session::WsMessage::Resync(resync));

    Ok(Json(json!({ "character": profile })))
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Scene management (DM world-building) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

#[derive(Deserialize)]
struct CreateSceneRequest {
    title: String,
    #[serde(default = "default_chaos")]
    chaos_factor: i32,
}
fn default_chaos() -> i32 {
    5
}

async fn create_scene(
    AxumState(state): AxumState<Arc<AppState>>,
    Path(session_id): Path<String>,
    headers: axum::http::header::HeaderMap,
    Json(req): Json<CreateSceneRequest>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let token = extract_token(&headers)?;
    let (session, player_id) =
        state.registry.authenticate(&token).await.map_err(|e| (StatusCode::UNAUTHORIZED, e))?;
    if session.id != session_id {
        return Err((StatusCode::FORBIDDEN, "Token belongs to different session".into()));
    }
    require_host(&session, &player_id).await?;

    let scene = session
        .game
        .repo
        .create_scene(&req.title, req.chaos_factor)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let resync = session::build_resync(&session).await;
    let _ = session.event_tx.send(session::WsMessage::Resync(resync));

    Ok(Json(json!({ "scene": scene })))
}

async fn list_scenes(
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
    let scenes = session
        .game
        .repo
        .list_scenes()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(json!({ "scenes": scenes })))
}

#[derive(Deserialize)]
struct UpdateSceneRequest {
    chaos_factor: Option<i32>,
    summary_text: Option<String>,
}

async fn update_scene(
    AxumState(state): AxumState<Arc<AppState>>,
    Path((session_id, scene_id)): Path<(String, String)>,
    headers: axum::http::header::HeaderMap,
    Json(req): Json<UpdateSceneRequest>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let token = extract_token(&headers)?;
    let (session, player_id) =
        state.registry.authenticate(&token).await.map_err(|e| (StatusCode::UNAUTHORIZED, e))?;
    if session.id != session_id {
        return Err((StatusCode::FORBIDDEN, "Token belongs to different session".into()));
    }
    require_host(&session, &player_id).await?;

    if let Some(summary) = req.summary_text {
        session
            .game
            .repo
            .update_scene_summary(&scene_id, Some(&summary))
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }
    if let Some(cf) = req.chaos_factor {
        session
            .game
            .repo
            .update_scene_chaos_factor(&scene_id, cf)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }
    // Note: title update not directly supported by repo Ã¢â‚¬â€ summary + chaos are the main DM controls.

    let resync = session::build_resync(&session).await;
    let _ = session.event_tx.send(session::WsMessage::Resync(resync));

    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
struct ActivateSceneRequest {
    scene_id: String,
}

async fn activate_scene(
    AxumState(state): AxumState<Arc<AppState>>,
    Path(session_id): Path<String>,
    headers: axum::http::header::HeaderMap,
    Json(req): Json<ActivateSceneRequest>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let token = extract_token(&headers)?;
    let (session, player_id) =
        state.registry.authenticate(&token).await.map_err(|e| (StatusCode::UNAUTHORIZED, e))?;
    if session.id != session_id {
        return Err((StatusCode::FORBIDDEN, "Token belongs to different session".into()));
    }
    require_host(&session, &player_id).await?;

    session
        .game
        .repo
        .set_active_scene(&req.scene_id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let resync = session::build_resync(&session).await;
    let _ = session.event_tx.send(session::WsMessage::Resync(resync));

    Ok(Json(json!({ "ok": true })))
}

async fn delete_scene(
    AxumState(state): AxumState<Arc<AppState>>,
    Path((session_id, scene_id)): Path<(String, String)>,
    headers: axum::http::header::HeaderMap,
) -> Result<Json<Value>, (StatusCode, String)> {
    let token = extract_token(&headers)?;
    let (session, player_id) =
        state.registry.authenticate(&token).await.map_err(|e| (StatusCode::UNAUTHORIZED, e))?;
    if session.id != session_id {
        return Err((StatusCode::FORBIDDEN, "Token belongs to different session".into()));
    }
    require_host(&session, &player_id).await?;

    session
        .game
        .repo
        .delete_scene(&scene_id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let resync = session::build_resync(&session).await;
    let _ = session.event_tx.send(session::WsMessage::Resync(resync));

    Ok(Json(json!({ "ok": true })))
}

// Ã¢â€â‚¬Ã¢â€â‚¬ NPC management Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

#[derive(Deserialize)]
struct CreateNpcRequest {
    name: String,
    #[serde(default = "default_neutral")]
    disposition: String,
    #[serde(default)]
    alive: bool,
    location: Option<String>,
    #[serde(default)]
    knows_json: String,
    notes: Option<String>,
    last_seen_scene_id: Option<String>,
    drive: Option<String>,
    leverage: Option<String>,
    flaw: Option<String>,
}
fn default_neutral() -> String {
    "neutral".into()
}

async fn create_npc(
    AxumState(state): AxumState<Arc<AppState>>,
    Path(session_id): Path<String>,
    headers: axum::http::header::HeaderMap,
    Json(req): Json<CreateNpcRequest>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let token = extract_token(&headers)?;
    let (session, player_id) =
        state.registry.authenticate(&token).await.map_err(|e| (StatusCode::UNAUTHORIZED, e))?;
    if session.id != session_id {
        return Err((StatusCode::FORBIDDEN, "Token belongs to different session".into()));
    }
    require_host(&session, &player_id).await?;

    let knows = if req.knows_json.is_empty() { "[]" } else { &req.knows_json };
    let npc = session
        .game
        .repo
        .save_npc_character(
            &req.name,
            &req.disposition,
            req.alive,
            req.location.as_deref(),
            knows,
            req.notes.as_deref(),
            req.last_seen_scene_id.as_deref(),
            req.drive.as_deref(),
            req.leverage.as_deref(),
            req.flaw.as_deref(),
            false,
        )
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let resync = session::build_resync(&session).await;
    let _ = session.event_tx.send(session::WsMessage::Resync(resync));

    Ok(Json(json!({ "npc": npc })))
}

async fn list_npcs(
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
    let npcs = session
        .game
        .repo
        .list_npc_characters()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(json!({ "npcs": npcs })))
}

#[derive(Deserialize)]
struct UpdateNpcRequest {
    disposition: Option<String>,
    alive: Option<bool>,
    location: Option<String>,
    knows_json: Option<String>,
    notes: Option<String>,
    last_seen_scene_id: Option<String>,
    drive: Option<String>,
    leverage: Option<String>,
    flaw: Option<String>,
}

async fn update_npc(
    AxumState(state): AxumState<Arc<AppState>>,
    Path((session_id, npc_id)): Path<(String, String)>,
    headers: axum::http::header::HeaderMap,
    Json(req): Json<UpdateNpcRequest>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let token = extract_token(&headers)?;
    let (session, player_id) =
        state.registry.authenticate(&token).await.map_err(|e| (StatusCode::UNAUTHORIZED, e))?;
    if session.id != session_id {
        return Err((StatusCode::FORBIDDEN, "Token belongs to different session".into()));
    }
    require_host(&session, &player_id).await?;

    session
        .game
        .repo
        .update_npc_character(
            &npc_id,
            req.disposition.as_deref(),
            req.alive,
            req.location.as_deref(),
            req.knows_json.as_deref(),
            req.notes.as_deref(),
            req.last_seen_scene_id.as_deref(),
        )
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    if req.drive.is_some() || req.leverage.is_some() || req.flaw.is_some() {
        session
            .game
            .repo
            .update_npc_pillars(
                &npc_id,
                req.drive.as_deref(),
                req.leverage.as_deref(),
                req.flaw.as_deref(),
            )
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    }

    let resync = session::build_resync(&session).await;
    let _ = session.event_tx.send(session::WsMessage::Resync(resync));

    Ok(Json(json!({ "ok": true })))
}

async fn delete_npc(
    AxumState(state): AxumState<Arc<AppState>>,
    Path((session_id, npc_id)): Path<(String, String)>,
    headers: axum::http::header::HeaderMap,
) -> Result<Json<Value>, (StatusCode, String)> {
    let token = extract_token(&headers)?;
    let (session, player_id) =
        state.registry.authenticate(&token).await.map_err(|e| (StatusCode::UNAUTHORIZED, e))?;
    if session.id != session_id {
        return Err((StatusCode::FORBIDDEN, "Token belongs to different session".into()));
    }
    require_host(&session, &player_id).await?;

    session
        .game
        .repo
        .delete_npc_character(&npc_id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let resync = session::build_resync(&session).await;
    let _ = session.event_tx.send(session::WsMessage::Resync(resync));

    Ok(Json(json!({ "ok": true })))
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Doom clock management Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

#[derive(Deserialize)]
struct CreateClockRequest {
    label: String,
    #[serde(default = "default_clock_max")]
    max: u32,
    consequence: String,
    scene_id: Option<String>,
}
fn default_clock_max() -> u32 {
    6
}

async fn create_clock(
    AxumState(state): AxumState<Arc<AppState>>,
    Path(session_id): Path<String>,
    headers: axum::http::header::HeaderMap,
    Json(req): Json<CreateClockRequest>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let token = extract_token(&headers)?;
    let (session, player_id) =
        state.registry.authenticate(&token).await.map_err(|e| (StatusCode::UNAUTHORIZED, e))?;
    if session.id != session_id {
        return Err((StatusCode::FORBIDDEN, "Token belongs to different session".into()));
    }
    require_host(&session, &player_id).await?;

    let id = uuid::Uuid::new_v4().to_string();
    session
        .game
        .repo
        .save_doom_clock(&id, &req.label, req.max.max(1), &req.consequence, req.scene_id.as_deref())
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let resync = session::build_resync(&session).await;
    let _ = session.event_tx.send(session::WsMessage::Resync(resync));

    Ok(Json(json!({ "clock_id": id })))
}

async fn list_clocks(
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
    let clocks = session
        .game
        .repo
        .list_doom_clocks()
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(json!({ "clocks": clocks })))
}

#[derive(Deserialize)]
struct AdvanceClockRequest {
    #[serde(default = "default_one_u32")]
    ticks: u32,
}
fn default_one_u32() -> u32 {
    1
}

async fn advance_clock(
    AxumState(state): AxumState<Arc<AppState>>,
    Path((session_id, clock_id)): Path<(String, String)>,
    headers: axum::http::header::HeaderMap,
    Json(req): Json<AdvanceClockRequest>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let token = extract_token(&headers)?;
    let (session, player_id) =
        state.registry.authenticate(&token).await.map_err(|e| (StatusCode::UNAUTHORIZED, e))?;
    if session.id != session_id {
        return Err((StatusCode::FORBIDDEN, "Token belongs to different session".into()));
    }
    require_host(&session, &player_id).await?;

    let result = session
        .game
        .repo
        .advance_doom_clock(&clock_id, req.ticks)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let resync = session::build_resync(&session).await;
    let _ = session.event_tx.send(session::WsMessage::Resync(resync));

    match result {
        Some((current, max)) => Ok(Json(json!({ "current": current, "max": max }))),
        None => Err((StatusCode::NOT_FOUND, "Clock not found".into())),
    }
}

async fn reset_clock(
    AxumState(state): AxumState<Arc<AppState>>,
    Path((session_id, clock_id)): Path<(String, String)>,
    headers: axum::http::header::HeaderMap,
) -> Result<Json<Value>, (StatusCode, String)> {
    let token = extract_token(&headers)?;
    let (session, player_id) =
        state.registry.authenticate(&token).await.map_err(|e| (StatusCode::UNAUTHORIZED, e))?;
    if session.id != session_id {
        return Err((StatusCode::FORBIDDEN, "Token belongs to different session".into()));
    }
    require_host(&session, &player_id).await?;

    session
        .game
        .repo
        .reset_doom_clock(&clock_id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let resync = session::build_resync(&session).await;
    let _ = session.event_tx.send(session::WsMessage::Resync(resync));

    Ok(Json(json!({ "ok": true })))
}

async fn delete_clock(
    AxumState(state): AxumState<Arc<AppState>>,
    Path((session_id, clock_id)): Path<(String, String)>,
    headers: axum::http::header::HeaderMap,
) -> Result<Json<Value>, (StatusCode, String)> {
    let token = extract_token(&headers)?;
    let (session, player_id) =
        state.registry.authenticate(&token).await.map_err(|e| (StatusCode::UNAUTHORIZED, e))?;
    if session.id != session_id {
        return Err((StatusCode::FORBIDDEN, "Token belongs to different session".into()));
    }
    require_host(&session, &player_id).await?;

    session
        .game
        .repo
        .delete_doom_clock(&clock_id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    let resync = session::build_resync(&session).await;
    let _ = session.event_tx.send(session::WsMessage::Resync(resync));

    Ok(Json(json!({ "ok": true })))
}

/// Check if the player is the host (first player in session).
/// NOTE: This peeks without locking Ã¢â‚¬â€ safe because callers already authenticated
/// and session.players is only mutated on join/leave (rare).
async fn require_host(
    session: &session::Session,
    player_id: &str,
) -> Result<(), (StatusCode, String)> {
    let players = session.players.read().await;
    let is_host = players.first().is_some_and(|p| p.id == player_id);
    if is_host {
        Ok(())
    } else {
        Err((StatusCode::FORBIDDEN, "Only the host can perform this action".into()))
    }
}

// â”€â”€ Combat actions (server-authoritative) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/// Patch a combatant JSON value in-place with updated HP and status from a
/// resolved `Combatant`.  Handles both `CharacterProfile` (resource_pools.hp.current)
/// and `EncounterStatBlock` (hit_points.current) formats, plus defeated status.
fn patch_combatant_json(entry: &mut Value, hp: i32, status: Option<&str>, conditions: &[String]) {
    // Try CharacterProfile format: resource_pools.hp.current
    if let Some(rp) = entry.get_mut("resource_pools").and_then(|v| v.get_mut("hp")) {
        if let Some(cur) = rp.get_mut("current") {
            *cur = Value::Number(hp.into());
        }
    }
    // Try EncounterStatBlock format: hit_points.current
    if let Some(hp_obj) = entry.get_mut("hit_points") {
        if let Some(cur) = hp_obj.get_mut("current") {
            *cur = Value::Number(hp.into());
        }
    }
    if let Some(s) = status {
        entry["status"] = Value::String(s.to_string());
    } else {
        entry.as_object_mut().map(|o| o.remove("status"));
    }
    // Patch conditions array if present.
    entry["conditions"] = serde_json::to_value(conditions).unwrap_or_default();
}

#[derive(Deserialize)]
struct CombatAttackRequest {
    attacker: Value,
    target: Value,
    action_id: String,
    prereq: Option<auto_dm_core::engine::PrerequisiteCheck>,
    attacker_conditions: Option<Vec<String>>,
    target_conditions: Option<Vec<String>>,
}

async fn server_combat_attack(
    AxumState(state): AxumState<Arc<AppState>>,
    Path(session_id): Path<String>,
    headers: axum::http::header::HeaderMap,
    Json(req): Json<CombatAttackRequest>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let token = extract_token(&headers)?;
    let (session, _player_id) =
        state.registry.authenticate(&token).await.map_err(|e| (StatusCode::UNAUTHORIZED, e))?;
    if session.id != session_id {
        return Err((StatusCode::FORBIDDEN, "Token belongs to different session".into()));
    }
    // Serialize with other combat mutations: this handler does
    // read-compute-patch on the shared combatant list; unlocked, two
    // concurrent hits on one target can interleave and lose damage.
    let _lock = session.session_lock.lock().await;

    let mut dice = auto_dm_core::dice::DiceEngine::new();
    let mut actor = auto_dm_engine::combatant_from_value(&req.attacker)
        .map_err(|e| (StatusCode::BAD_REQUEST, e))?;
    let mut victim = auto_dm_engine::combatant_from_value(&req.target)
        .map_err(|e| (StatusCode::BAD_REQUEST, e))?;

    actor.conditions = req.attacker_conditions.unwrap_or_default();
    victim.conditions = req.target_conditions.unwrap_or_default();

    let action = session
        .game
        .repo
        .load_action(&req.action_id)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .ok_or_else(|| (StatusCode::NOT_FOUND, format!("action `{}` not found", req.action_id)))?;

    let outcome = auto_dm_core::engine::execute_attack(
        &mut dice,
        &actor,
        &mut victim,
        &action,
        req.prereq.as_ref(),
    )
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Update server-authoritative combatant state.
    {
        let mut combatants = session.combatants.write().await;
        for c in combatants.iter_mut() {
            if c.get("id").and_then(|v| v.as_str()) == Some(&victim.id) {
                patch_combatant_json(
                    c,
                    victim.hit_points,
                    victim.status.as_deref(),
                    &victim.conditions,
                );
                break;
            }
        }
    }

    // Broadcast damage event.
    if let Some(ref dr) = outcome.damage_result {
        let event = auto_dm_engine::GameEvent::DamageApplied {
            target_id: victim.id.clone(),
            target_name: victim.name.clone(),
            amount: outcome.damage_dealt,
            temp_absorbed: dr.temp_absorbed,
            hp_remaining: dr.hp_remaining,
            defeated: dr.defeated,
            shock: dr.shock,
        };
        session.send_event(event);
    }

    // Heal actions restore HP instead â€” broadcast the restoration.
    if outcome.heal_amount > 0 {
        let event = auto_dm_engine::GameEvent::Healed {
            target_id: victim.id.clone(),
            target_name: victim.name.clone(),
            amount: outcome.heal_amount,
            hp_remaining: victim.hit_points,
        };
        session.send_event(event);
    }

    // Broadcast resync so all clients get updated combatant state.
    let resync = session::build_resync_under_lock(&session).await;
    let _ = session.event_tx.send(WsMessage::Resync(resync));

    Ok(Json(serde_json::to_value(&outcome).unwrap_or_default()))
}

#[derive(Deserialize)]
struct MapUpdateRequest {
    tokens: Value,
    background: String,
}

/// Replace the shared battle-map state and broadcast it to all clients.
async fn server_map_update(
    AxumState(state): AxumState<Arc<AppState>>,
    Path(session_id): Path<String>,
    headers: axum::http::header::HeaderMap,
    Json(req): Json<MapUpdateRequest>,
) -> Result<StatusCode, (StatusCode, String)> {
    let token = extract_token(&headers)?;
    let (session, _player_id) =
        state.registry.authenticate(&token).await.map_err(|e| (StatusCode::UNAUTHORIZED, e))?;
    if session.id != session_id {
        return Err((StatusCode::FORBIDDEN, "Token belongs to different session".into()));
    }

    {
        let mut tokens = session.map_tokens.write().await;
        *tokens = req.tokens.as_array().cloned().unwrap_or_default();
    }
    {
        let mut bg = session.map_background.write().await;
        *bg = req.background.clone();
    }

    let event =
        auto_dm_engine::GameEvent::MapUpdated { tokens: req.tokens, background: req.background };
    session.send_event(event);

    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct CombatHealRequest {
    target: Value,
    amount: i32,
}

async fn server_combat_heal(
    AxumState(state): AxumState<Arc<AppState>>,
    Path(session_id): Path<String>,
    headers: axum::http::header::HeaderMap,
    Json(req): Json<CombatHealRequest>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let token = extract_token(&headers)?;
    let (session, _player_id) =
        state.registry.authenticate(&token).await.map_err(|e| (StatusCode::UNAUTHORIZED, e))?;
    if session.id != session_id {
        return Err((StatusCode::FORBIDDEN, "Token belongs to different session".into()));
    }
    // Same lost-update rationale as the attack handler.
    let _lock = session.session_lock.lock().await;

    // Clamp early: a hostile/laggy client must not be able to inject
    // negative "healing" (i.e., free damage) through this endpoint.
    let amount = req.amount.max(0);
    let mut victim = auto_dm_engine::combatant_from_value(&req.target)
        .map_err(|e| (StatusCode::BAD_REQUEST, e))?;
    let healed = auto_dm_core::engine::apply_healing(&mut victim, amount);

    // Update server-authoritative combatant state.
    {
        let mut combatants = session.combatants.write().await;
        for c in combatants.iter_mut() {
            if c.get("id").and_then(|v| v.as_str()) == Some(&victim.id) {
                patch_combatant_json(
                    c,
                    victim.hit_points,
                    victim.status.as_deref(),
                    &victim.conditions,
                );
                break;
            }
        }
    }

    // Broadcast resync.
    let resync = session::build_resync_under_lock(&session).await;
    let _ = session.event_tx.send(WsMessage::Resync(resync));

    Ok(Json(json!({
        "healed": healed,
        "hit_points": victim.hit_points,
        "status": victim.status,
    })))
}

#[derive(Deserialize)]
struct CombatConditionRequest {
    target_id: String,
    condition: String,
    add: bool,
}

async fn server_combat_condition(
    AxumState(state): AxumState<Arc<AppState>>,
    Path(session_id): Path<String>,
    headers: axum::http::header::HeaderMap,
    Json(req): Json<CombatConditionRequest>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let token = extract_token(&headers)?;
    let (session, _player_id) =
        state.registry.authenticate(&token).await.map_err(|e| (StatusCode::UNAUTHORIZED, e))?;
    if session.id != session_id {
        return Err((StatusCode::FORBIDDEN, "Token belongs to different session".into()));
    }
    // Read-modify-write on the shared condition map â€” keep it atomic
    // against attacks/heals running under the same lock.
    let _lock = session.session_lock.lock().await;

    // Griefing guard: conditions render as UI chips and flow into every
    // resync; a hostile client must not inject huge or empty tags into
    // everyone's board state.
    let condition = req.condition.trim();
    if condition.is_empty() || condition.len() > 64 {
        return Err((StatusCode::BAD_REQUEST, "Invalid condition".into()));
    }

    {
        let mut conditions = session.combatant_conditions.write().await;
        let entry = conditions.entry(req.target_id.clone()).or_default();
        if req.add {
            if !entry.contains(&condition.to_string()) {
                entry.push(condition.to_string());
            }
        } else {
            entry.retain(|c| c != condition);
        }
    }

    // Broadcast resync.
    let resync = session::build_resync_under_lock(&session).await;
    let _ = session.event_tx.send(WsMessage::Resync(resync));

    let conditions = session.combatant_conditions.read().await;
    let current = conditions.get(&req.target_id).cloned().unwrap_or_default();
    Ok(Json(json!({ "target_id": req.target_id, "conditions": current })))
}

#[derive(Deserialize)]
struct CombatSyncRequest {
    combatants: Vec<Value>,
    conditions: std::collections::HashMap<String, Vec<String>>,
}

async fn server_combat_sync(
    AxumState(state): AxumState<Arc<AppState>>,
    Path(session_id): Path<String>,
    headers: axum::http::header::HeaderMap,
    Json(req): Json<CombatSyncRequest>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let token = extract_token(&headers)?;
    let (session, player_id) =
        state.registry.authenticate(&token).await.map_err(|e| (StatusCode::UNAUTHORIZED, e))?;
    if session.id != session_id {
        return Err((StatusCode::FORBIDDEN, "Token belongs to different session".into()));
    }
    require_host(&session, &player_id).await?;

    // Whole-roster replace under the session lock: without it, a concurrent
    // resolve's combatant patch could be interleaved and lost, and the
    // snapshot below could be torn relative to live state.
    let _lock = session.session_lock.lock().await;
    *session.combatants.write().await = req.combatants;
    *session.combatant_conditions.write().await = req.conditions;

    let resync = session::build_resync_under_lock(&session).await;
    let _ = session.event_tx.send(WsMessage::Resync(resync));

    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
struct CombatInitiativeRequest {
    combatants: Vec<Value>,
    formula: Option<String>,
}

async fn server_combat_initiative(
    AxumState(state): AxumState<Arc<AppState>>,
    Path(session_id): Path<String>,
    headers: axum::http::header::HeaderMap,
    Json(req): Json<CombatInitiativeRequest>,
) -> Result<Json<Value>, (StatusCode, String)> {
    let token = extract_token(&headers)?;
    let (session, _player_id) =
        state.registry.authenticate(&token).await.map_err(|e| (StatusCode::UNAUTHORIZED, e))?;
    if session.id != session_id {
        return Err((StatusCode::FORBIDDEN, "Token belongs to different session".into()));
    }

    let mut dice = auto_dm_core::dice::DiceEngine::new();
    let mut participants = Vec::new();
    for v in &req.combatants {
        participants.push(
            auto_dm_engine::combatant_from_value(v).map_err(|e| (StatusCode::BAD_REQUEST, e))?,
        );
    }

    let formula = req.formula.unwrap_or_default();
    let entries = auto_dm_core::engine::roll_initiative(&mut dice, &participants, &formula)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    // Persist + broadcast: every client needs the order (their Combat tab
    // renders it), reconnectors get it back via resync, and a server
    // restart restores it alongside turn state.
    let entries_json: Vec<Value> =
        serde_json::to_value(&entries).unwrap_or_default().as_array().cloned().unwrap_or_default();
    {
        let _lock = session.session_lock.lock().await;
        *session.initiative.write().await = entries_json.clone();
    }
    state.registry.persist_turn_state(&session).await;
    let resync = session::build_resync_under_lock(&session).await;
    let _ = session.event_tx.send(WsMessage::Resync(resync));

    Ok(Json(serde_json::to_value(&entries).unwrap_or_default()))
}
// Ã¢â€â‚¬Ã¢â€â‚¬ WebSocket Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

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
    // Initial resync — materialized state, not raw logs.  Built under the
    // session lock so the recorded last_event_seq is exactly the bound of
    // what the snapshot reflects; queued frames above that seq are genuinely
    // new and get applied by the client (exactly-once replay).
    let mut rx = session.event_tx.subscribe();
    let resync = {
        let _lock = session.session_lock.lock().await;
        session::build_resync_under_lock(&session).await
    };
    let msg = WsMessage::Resync(resync);
    if socket.send(Message::Text(serde_json::to_string(&msg).unwrap().into())).await.is_err() {
        mark_disconnected(&state, &session, &player_id).await;
        return;
    }
    let mut ping_interval = tokio::time::interval(PING_INTERVAL);
    let mut last_activity = tokio::time::Instant::now();

    loop {
        tokio::select! {
            // Ã¢â€â‚¬Ã¢â€â‚¬ Broadcast events Ã¢â€ â€™ forward to client Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
            result = rx.recv() => {
                last_activity = tokio::time::Instant::now();
                match result {
                    Ok(WsMessage::Event { event, seq }) => {
                        let json = match serde_json::to_string(&WsMessage::Event { event, seq }) {
                            Ok(j) => j,
                            Err(_) => continue,
                        };
                        if socket.send(Message::Text(json.into())).await.is_err() {
                            break;
                        }
                    }
                    Ok(WsMessage::TurnState(payload)) => {
                        let json = match serde_json::to_string(&WsMessage::TurnState(payload)) {
                            Ok(j) => j,
                            Err(_) => continue,
                        };
                        if socket.send(Message::Text(json.into())).await.is_err() {
                            break;
                        }
                    }
                    // Full-state broadcasts (character/NPC/thread edits,
                    // linking, equips, imports) MUST reach peers — dropping
                    // them here left every other client stale until they
                    // reconnected. The client dedupes via last_event_seq.
                    Ok(WsMessage::Resync(resync)) => {
                        let json = match serde_json::to_string(&WsMessage::Resync(resync)) {
                            Ok(j) => j,
                            Err(_) => continue,
                        };
                        if socket.send(Message::Text(json.into())).await.is_err() {
                            break;
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                        tracing::warn!(session = %session.id, player = %player_id, missed = n, "Lagged — resync");
                        // No lock held in this branch — the auto-locking
                        // wrapper is required here.
                        let resync = session::build_resync(&session).await;
                        let msg = WsMessage::Resync(resync);
                        if socket.send(Message::Text(serde_json::to_string(&msg).unwrap().into())).await.is_err() {
                            break;
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
            // Ã¢â€â‚¬Ã¢â€â‚¬ Ping every 30s, check pong timeout Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
            _ = ping_interval.tick() => {
                // Send ping.
                if socket.send(Message::Ping(vec![].into())).await.is_err() {
                    break; // send failed Ã¢â€ â€™ connection dead
                }
                // Check if we've heard nothing in PONG_TIMEOUT.
                if last_activity.elapsed() > PONG_TIMEOUT {
                    tracing::warn!(
                        session = %session.id,
                        player = %player_id,
                        idle = ?last_activity.elapsed(),
                        "No pong within timeout Ã¢â‚¬â€ closing dead connection"
                    );
                    break;
                }
            }
            // Ã¢â€â‚¬Ã¢â€â‚¬ Read from socket (pongs, close frames) Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
            msg = socket.recv() => {
                match msg {
                    Some(Ok(Message::Pong(_))) => {
                        last_activity = tokio::time::Instant::now();
                    }
                    // App-level keepalive from browsers (they cannot send
                    // protocol ping frames, and never see ours). Reply so
                    // the client's idle watchdog sees traffic â€” otherwise
                    // quiet tables get disconnected every ~90s.
                    Some(Ok(Message::Text(text))) => {
                        last_activity = tokio::time::Instant::now();
                        let is_ping = serde_json::from_str::<Value>(&text)
                            .ok()
                            .and_then(|v| {
                                v.get("type").and_then(|t| t.as_str()).map(|s| s == "ping")
                            })
                            .unwrap_or(false);
                        if is_ping {
                            let pong = serde_json::json!({ "type": "pong" }).to_string();
                            if socket.send(Message::Text(pong.into())).await.is_err() {
                                break;
                            }
                        }
                    }
                    Some(Ok(Message::Close(_))) => break,
                    None => break,
                    _ => {} // ignore other binary/text from client
                }
            }
        }
    }

    mark_disconnected(&state, &session, &player_id).await;
    tracing::info!(session = %session.id, player = %player_id, "WebSocket disconnected");
}

async fn mark_disconnected(state: &AppState, session: &session::Session, player_id: &str) {
    // Serialize with resolve/skip: the gate mutation + TurnState broadcast
    // must not interleave with an in-flight resolve's own advance+broadcast,
    // or peers can end on a stale turn snapshot.
    let _lock = session.session_lock.lock().await;
    // Remove from combat queue if present; advance turn if needed.
    let (mode, next_turn) = session.turn_gate.remove_player(player_id).await;
    state.registry.persist_turn_state(session).await;
    if mode == GameMode::Combat {
        tracing::info!(
            session = %session.id,
            disconnected = %player_id,
            next_turn = ?next_turn,
            "Player disconnected during combat â€” turn advanced"
        );
    }
    broadcast_turn_state(session).await;

    // Mark disconnected in player list.
    let sessions = state.registry.sessions.read().await;
    if let Some(s) = sessions.get(&session.id) {
        let mut players = s.players.write().await;
        if let Some(p) = players.iter_mut().find(|p| p.id == player_id) {
            p.connected = false;
        }
    }
}
