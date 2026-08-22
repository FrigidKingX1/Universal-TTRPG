//! C2 — Session model: per-session isolation, player-identity tokens.
//!
//! Each session gets its own GameState, broadcast channel, and lock.
//! The token minted on join carries player identity (session_id +
//! player_id) so C3 (reconnect) can authenticate "this is Alice
//! coming back" without retrofitting.

use auto_dm_engine::GameState;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::{broadcast, RwLock};

// ── Types ────────────────────────────────────────────────────────────

pub const BROADCAST_CAPACITY: usize = 256;

/// A connected player slot within a session.  The `token` is the
/// player-identity credential — it encodes who this player is, not
/// just "allowed into the session."
#[derive(Clone, Debug)]
#[allow(dead_code)]
pub struct PlayerSlot {
    pub id: String,
    pub name: String,
    pub token: String,
    pub connected: bool,
}

#[derive(Serialize, Deserialize)]
#[allow(dead_code)]
pub struct PlayerSlotView {
    pub id: String,
    pub name: String,
    pub connected: bool,
}

impl From<&PlayerSlot> for PlayerSlotView {
    fn from(p: &PlayerSlot) -> Self {
        Self { id: p.id.clone(), name: p.name.clone(), connected: p.connected }
    }
}

/// A live game session — one database, one broadcast channel, one lock.
pub struct Session {
    pub id: String,
    pub join_code: String,
    pub game: GameState,
    pub event_tx: broadcast::Sender<WsMessage>,
    pub session_lock: tokio::sync::Mutex<()>,
    pub players: RwLock<Vec<PlayerSlot>>,
}

// ── WsMessage (same as before, but now per-session) ──────────────────

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum WsMessage {
    Event { event: auto_dm_engine::GameEvent },
    Resync { scene_summary: String, logs: Vec<auto_dm_engine::LogEntry> },
}

// ── Session registry ─────────────────────────────────────────────────

pub struct SessionRegistry {
    /// session_id → Session
    pub(crate) sessions: RwLock<HashMap<String, Arc<Session>>>,
    /// join_code → session_id (short lookup for the join endpoint)
    codes: RwLock<HashMap<String, String>>,
    /// token → (session_id, player_id) — the identity backbone for C3.
    tokens: RwLock<HashMap<String, (String, String)>>,
    /// Base directory for per-session databases.
    data_dir: PathBuf,
    /// Shared DM pipeline (all sessions use the same LLM backend).
    #[allow(dead_code)]
    pipeline: Arc<auto_dm_core::llm::DmPipeline<Box<dyn auto_dm_core::llm::LlmBackend>>>,
}

impl SessionRegistry {
    pub fn new(
        data_dir: PathBuf,
        pipeline: Arc<auto_dm_core::llm::DmPipeline<Box<dyn auto_dm_core::llm::LlmBackend>>>,
    ) -> Self {
        std::fs::create_dir_all(&data_dir).ok();
        Self {
            sessions: RwLock::new(HashMap::new()),
            codes: RwLock::new(HashMap::new()),
            tokens: RwLock::new(HashMap::new()),
            data_dir,
            pipeline,
        }
    }

    /// Create a new session and mint the host's player token.
    pub async fn create_session(
        &self,
        title: &str,
    ) -> Result<(String, String, String), String> {
        let session_id = uuid::Uuid::new_v4().to_string();
        let join_code = generate_join_code();
        let host_id = uuid::Uuid::new_v4().to_string();
        let host_token = uuid::Uuid::new_v4().to_string();

        // Per-session database.
        let db_path = self.data_dir.join(format!("{session_id}.db"));
        let pool = auto_dm_engine::open_pool(&db_path)
            .await
            .map_err(|e| e.to_string())?;
        auto_dm_engine::run_migrations(&pool)
            .await
            .map_err(|e| e.to_string())?;
        let repo = auto_dm_engine::SqliteRepository::new(pool);

        let backend: Box<dyn auto_dm_core::llm::LlmBackend> =
            Box::new(auto_dm_core::llm::StubLlmBackend);
        let pipeline = auto_dm_core::llm::DmPipeline::new(backend);

        let (event_tx, _rx) = broadcast::channel(BROADCAST_CAPACITY);
        let game = GameState {
            repo,
            dm: tokio::sync::Mutex::new(Some(Arc::new(pipeline))),
            memory: std::sync::Mutex::new(auto_dm_core::memory::CampaignMemory::new()),
            ollama_child: std::sync::Mutex::new(None),
            current_model: std::sync::Mutex::new("stub".into()),
            current_num_predict: std::sync::Mutex::new(512),
        };

        let session = Arc::new(Session {
            id: session_id.clone(),
            join_code: join_code.clone(),
            game,
            event_tx,
            session_lock: tokio::sync::Mutex::new(()),
            players: RwLock::new(vec![PlayerSlot {
                id: host_id.clone(),
                name: title.to_string(),
                token: host_token.clone(),
                connected: false,
            }]),
        });

        // Register session + token.
        {
            let mut sessions = self.sessions.write().await;
            sessions.insert(session_id.clone(), session);
        }
        {
            let mut codes = self.codes.write().await;
            codes.insert(join_code.clone(), session_id.clone());
        }
        {
            let mut tokens = self.tokens.write().await;
            tokens.insert(host_token.clone(), (session_id.clone(), host_id));
        }

        Ok((session_id, join_code, host_token))
    }

    /// Join an existing session by join code.  Returns the player token
    /// (player-identity credential) and player ID.
    pub async fn join_session(
        &self,
        join_code: &str,
        player_name: &str,
    ) -> Result<(String, String, String), String> {
        let session_id = {
            let codes = self.codes.read().await;
            codes.get(join_code).cloned().ok_or("Invalid join code")?
        };
        let player_id = uuid::Uuid::new_v4().to_string();
        let token = uuid::Uuid::new_v4().to_string();

        {
            let sessions = self.sessions.read().await;
            let session =
                sessions.get(&session_id).ok_or("Session not found")?;
            let mut players = session.players.write().await;
            players.push(PlayerSlot {
                id: player_id.clone(),
                name: player_name.to_string(),
                token: token.clone(),
                connected: false,
            });
        }
        {
            let mut tokens = self.tokens.write().await;
            tokens.insert(token.clone(), (session_id.clone(), player_id.clone()));
        }

        Ok((session_id, token, player_id))
    }

    /// Resolve a player token → (session, player_id).
    pub async fn authenticate(
        &self,
        token: &str,
    ) -> Result<(Arc<Session>, String), String> {
        let (session_id, player_id) = {
            let tokens = self.tokens.read().await;
            tokens.get(token).cloned().ok_or("Invalid token")?
        };
        let sessions = self.sessions.read().await;
        let session =
            sessions.get(&session_id).cloned().ok_or("Session not found")?;
        Ok((session, player_id))
    }

    /// Resolve a join code → session_id.
    #[allow(dead_code)]
    pub async fn resolve_code(&self, join_code: &str) -> Option<String> {
        let codes = self.codes.read().await;
        codes.get(join_code).cloned()
    }

    /// List all sessions (for admin/debug).
    pub async fn list_sessions(&self) -> Vec<SessionSummary> {
        let sessions = self.sessions.read().await;
        let mut out = Vec::new();
        for s in sessions.values() {
            let players = s.players.read().await;
            out.push(SessionSummary {
                id: s.id.clone(),
                join_code: s.join_code.clone(),
                player_count: players.len(),
            });
        }
        out
    }
}

#[derive(Serialize)]
pub struct SessionSummary {
    pub id: String,
    pub join_code: String,
    pub player_count: usize,
}

// ── Helpers ──────────────────────────────────────────────────────────

/// Generate a 6-character uppercase alphanumeric join code.
fn generate_join_code() -> String {
    const CHARS: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/0/O/1
    let mut code = String::with_capacity(6);
    for _ in 0..6 {
        let idx = (uuid::Uuid::new_v4().as_bytes()[0] as usize) % CHARS.len();
        code.push(CHARS[idx] as char);
    }
    code
}
