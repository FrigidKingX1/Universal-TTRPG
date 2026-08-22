//! C2+C3+C4 — Session model: per-session isolation, player-identity
//! tokens, materialized resync, and turn concurrency policy.
//!
//! The turn gate switches between free-form (exploration) and queued
//! (combat) modes.  In combat, only the current turn-holder can act;
//! others wait in a FIFO queue.  The gate is checked inside the
//! session lock so the check + act + advance sequence is atomic.

use auto_dm_engine::GameState;
use serde::{Deserialize, Serialize};
use sqlx::sqlite::{SqlitePool, SqlitePoolOptions};
use std::collections::{HashMap, VecDeque};
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

// ── Turn concurrency (C4) ────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "mode", rename_all = "snake_case")]
pub enum GameMode {
    Exploration,
    Combat,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum TurnCheck {
    Allowed,
    Waiting { position: usize },
    NotInQueue,
}

struct TurnState {
    mode: GameMode,
    /// Player whose turn it is right now.
    current_turn: Option<String>,
    /// FIFO queue of player IDs waiting to act.
    queue: VecDeque<String>,
}

/// Gates player actions based on game mode.  In exploration anyone can
/// act; in combat only the current turn-holder can.
pub struct TurnGate {
    inner: tokio::sync::Mutex<TurnState>,
}

impl TurnGate {
    pub fn new() -> Self {
        Self {
            inner: tokio::sync::Mutex::new(TurnState {
                mode: GameMode::Exploration,
                current_turn: None,
                queue: VecDeque::new(),
            }),
        }
    }

    /// Check if a player is allowed to act right now.
    pub async fn can_act(&self, player_id: &str) -> TurnCheck {
        let state = self.inner.lock().await;
        match state.mode {
            GameMode::Exploration => TurnCheck::Allowed,
            GameMode::Combat => {
                if state.current_turn.as_deref() == Some(player_id) {
                    TurnCheck::Allowed
                } else if let Some(pos) =
                    state.queue.iter().position(|id| id == player_id)
                {
                    TurnCheck::Waiting { position: pos + 1 }
                } else {
                    TurnCheck::NotInQueue
                }
            }
        }
    }

    /// After a player acts, advance to the next in the queue.
    /// No-op in exploration mode (no turns to advance).
    /// Returns the new mode + current turn holder.
    pub async fn advance_turn(&self) -> (GameMode, Option<String>) {
        let mut state = self.inner.lock().await;
        // In exploration mode, there's nothing to advance.
        if state.mode == GameMode::Exploration {
            return (GameMode::Exploration, None);
        }
        if let Some(next) = state.queue.pop_front() {
            state.current_turn = Some(next.clone());
            (state.mode, Some(next))
        } else {
            // Queue empty → combat ends automatically.
            state.mode = GameMode::Exploration;
            state.current_turn = None;
            (GameMode::Exploration, None)
        }
    }

    /// Enter combat mode.  `first_player` acts first; others join
    /// via `join_queue` (or are added manually by the host).
    pub async fn start_combat(&self, first_player: String) {
        let mut state = self.inner.lock().await;
        state.mode = GameMode::Combat;
        state.current_turn = Some(first_player.clone());
        // Remove first player from queue — they're acting now, not waiting.
        state.queue.retain(|id| id != &first_player);
    }

    /// Exit combat mode, returning to free-form exploration.
    pub async fn end_combat(&self) {
        let mut state = self.inner.lock().await;
        state.mode = GameMode::Exploration;
        state.current_turn = None;
        state.queue.clear();
    }

    /// Add a player to the back of the combat queue.
    /// No-op if the player is already in the queue or is the current
    /// turn holder (they shouldn't wait for themselves).
    pub async fn join_queue(&self, player_id: &str) {
        let mut state = self.inner.lock().await;
        if state.current_turn.as_deref() == Some(player_id) {
            return; // Already acting — don't queue them.
        }
        if !state.queue.contains(&player_id.to_string()) {
            state.queue.push_back(player_id.to_string());
        }
    }

    /// Remove a player from the queue (on disconnect or explicit leave).
    /// If the removed player was the current turn holder, advance.
    pub async fn remove_player(&self, player_id: &str) -> (GameMode, Option<String>) {
        let mut state = self.inner.lock().await;
        state.queue.retain(|id| id != player_id);
        if state.current_turn.as_deref() == Some(player_id) {
            if let Some(next) = state.queue.pop_front() {
                state.current_turn = Some(next.clone());
                (state.mode, Some(next))
            } else {
                state.mode = GameMode::Exploration;
                state.current_turn = None;
                (GameMode::Exploration, None)
            }
        } else {
            (state.mode, state.current_turn.clone())
        }
    }

    /// Current game mode and turn holder.
    pub async fn status(&self) -> (GameMode, Option<String>, Vec<String>) {
        let state = self.inner.lock().await;
        (
            state.mode,
            state.current_turn.clone(),
            state.queue.iter().cloned().collect(),
        )
    }

    /// Restore turn state from persisted data (called on startup).
    pub async fn restore_from_persisted(
        &self,
        mode: &str,
        current_turn: Option<&str>,
        queue: &[String],
    ) {
        let mut state = self.inner.lock().await;
        state.mode = match mode {
            "combat" => GameMode::Combat,
            _ => GameMode::Exploration,
        };
        state.current_turn = current_turn.map(|s| s.to_string());
        state.queue = queue.iter().cloned().collect();
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
    pub turn_gate: TurnGate,
}

// ── WsMessage ─────────────────────────────────────────────────────────

/// Materialized state sent on reconnect — the same data `bootstrap()`
/// would fetch.  Client replaces its local store wholesale; no log
/// replay, no duplicated derivation logic.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ResyncPayload {
    pub scene: Option<auto_dm_engine::Scene>,
    pub scene_summary: String,
    pub doom_clocks: Vec<auto_dm_engine::DoomClockRow>,
    pub npcs: Vec<auto_dm_engine::NpcCharacterRow>,
    pub loot: Vec<auto_dm_engine::LootRow>,
    pub threads: Vec<auto_dm_engine::ThreadRow>,
    pub summaries: Vec<auto_dm_engine::EpisodicSummary>,
    pub combat_state: Option<String>,
    /// Last 200 log entries for narrative scrollback display only —
    /// NOT for state reconstruction.
    pub recent_logs: Vec<auto_dm_engine::LogEntry>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum WsMessage {
    Event { event: auto_dm_engine::GameEvent },
    Resync(Box<ResyncPayload>),
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
    /// Persistent registry database (survives restarts).
    registry_pool: SqlitePool,
}

impl SessionRegistry {
    pub async fn new(
        data_dir: PathBuf,
        pipeline: Arc<auto_dm_core::llm::DmPipeline<Box<dyn auto_dm_core::llm::LlmBackend>>>,
    ) -> Result<Self, String> {
        std::fs::create_dir_all(&data_dir).ok();

        // Open (or create) the persistent registry database.
        let registry_path = data_dir.join("registry.db");
        let registry_pool = Self::open_registry(&registry_path).await?;

        let mut registry = Self {
            sessions: RwLock::new(HashMap::new()),
            codes: RwLock::new(HashMap::new()),
            tokens: RwLock::new(HashMap::new()),
            data_dir,
            pipeline,
            registry_pool,
        };

        // Rebuild in-memory state from the persistent registry.
        registry.load_from_registry().await?;

        Ok(registry)
    }

    /// Open or create the registry database and run its schema.
    async fn open_registry(path: &std::path::Path) -> Result<SqlitePool, String> {
        use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode};
        let options = SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(true)
            .journal_mode(SqliteJournalMode::Wal)
            .foreign_keys(true)
            .busy_timeout(std::time::Duration::from_secs(5));
        let pool = SqlitePoolOptions::new()
            .max_connections(2)
            .connect_with(options)
            .await
            .map_err(|e| e.to_string())?;
        sqlx::query("PRAGMA synchronous = NORMAL")
            .execute(&pool)
            .await
            .map_err(|e| e.to_string())?;

        // Schema (idempotent).
        let schema = [
            "CREATE TABLE IF NOT EXISTS registry_sessions (
                id TEXT PRIMARY KEY,
                join_code TEXT NOT NULL UNIQUE
            );",
            "CREATE TABLE IF NOT EXISTS registry_players (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL REFERENCES registry_sessions(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                token TEXT NOT NULL UNIQUE
            );",
            "CREATE TABLE IF NOT EXISTS registry_turn_state (
                session_id TEXT PRIMARY KEY REFERENCES registry_sessions(id) ON DELETE CASCADE,
                mode TEXT NOT NULL DEFAULT 'exploration',
                current_turn TEXT,
                queue_json TEXT NOT NULL DEFAULT '[]'
            );",
        ];
        let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
        for stmt in schema {
            sqlx::query(stmt)
                .execute(&mut *tx)
                .await
                .map_err(|e| e.to_string())?;
        }
        tx.commit().await.map_err(|e| e.to_string())?;
        Ok(pool)
    }

    /// Rebuild in-memory maps from the persistent registry database.
    /// Called once at startup.
    async fn load_from_registry(&mut self) -> Result<(), String> {
        // Load sessions.
        let rows: Vec<(String, String)> =
            sqlx::query_as("SELECT id, join_code FROM registry_sessions")
                .fetch_all(&self.registry_pool)
                .await
                .map_err(|e| e.to_string())?;

        for (session_id, join_code) in rows {
            // Check if the per-session database file exists.
            let db_path = self.data_dir.join(format!("{session_id}.db"));
            if !db_path.exists() {
                tracing::warn!(session = %session_id, "Registry entry missing .db file — skipping");
                continue;
            }

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

            // Load players for this session.
            let player_rows: Vec<(String, String, String)> = sqlx::query_as(
                "SELECT id, name, token FROM registry_players WHERE session_id = ?",
            )
            .bind(&session_id)
            .fetch_all(&self.registry_pool)
            .await
            .map_err(|e| e.to_string())?;

            let players: Vec<PlayerSlot> = player_rows
                .into_iter()
                .map(|(id, name, token)| PlayerSlot {
                    id,
                    name,
                    token,
                    connected: false,
                })
                .collect();

            // Load turn state.
            let turn_row: Option<(String, Option<String>, String)> = sqlx::query_as(
                "SELECT mode, current_turn, queue_json FROM registry_turn_state WHERE session_id = ?",
            )
            .bind(&session_id)
            .fetch_optional(&self.registry_pool)
            .await
            .map_err(|e| e.to_string())?;

            let turn_gate = TurnGate::new();
            if let Some((mode, current, queue_json)) = turn_row {
                let queue: Vec<String> =
                    serde_json::from_str(&queue_json).unwrap_or_default();
                turn_gate.restore_from_persisted(&mode, current.as_deref(), &queue).await;
            }

            // Build token map entries.
            let token_entries: Vec<(String, String)> = sqlx::query_as(
                "SELECT token, id FROM registry_players WHERE session_id = ?",
            )
            .bind(&session_id)
            .fetch_all(&self.registry_pool)
            .await
            .map_err(|e| e.to_string())?;

            let session = Arc::new(Session {
                id: session_id.clone(),
                join_code: join_code.clone(),
                game,
                event_tx,
                session_lock: tokio::sync::Mutex::new(()),
                players: RwLock::new(players),
                turn_gate,
            });

            // Populate in-memory maps.
            self.sessions
                .write()
                .await
                .insert(session_id.clone(), session);
            self.codes.write().await.insert(join_code, session_id.clone());
            for (token, pid) in token_entries {
                self.tokens
                    .write()
                    .await
                    .insert(token, (session_id.clone(), pid));
            }

            tracing::info!(session = %session_id, "Restored from registry");
        }

        let count = self.sessions.read().await.len();
        tracing::info!(sessions = count, "Registry loaded");
        Ok(())
    }

    /// Create a new session and mint the host's player token.
    pub async fn create_session(
        &self,
        title: &str,
    ) -> Result<(String, String, String), String> {
        let session_id = uuid::Uuid::new_v4().to_string();
        let join_code = generate_unique_join_code(&self.codes).await;
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
            turn_gate: TurnGate::new(),
        });

        // Register session + token in memory.
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
            tokens.insert(host_token.clone(), (session_id.clone(), host_id.clone()));
        }

        // Persist to registry database.
        sqlx::query("INSERT INTO registry_sessions (id, join_code) VALUES (?, ?)")
            .bind(&session_id)
            .bind(&join_code)
            .execute(&self.registry_pool)
            .await
            .map_err(|e| e.to_string())?;
        sqlx::query(
            "INSERT INTO registry_players (id, session_id, name, token) VALUES (?, ?, ?, ?)",
        )
        .bind(&host_id)
        .bind(&session_id)
        .bind(title)
        .bind(&host_token)
        .execute(&self.registry_pool)
        .await
        .map_err(|e| e.to_string())?;

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

        // Persist to registry database.
        sqlx::query(
            "INSERT INTO registry_players (id, session_id, name, token) VALUES (?, ?, ?, ?)",
        )
        .bind(&player_id)
        .bind(&session_id)
        .bind(player_name)
        .bind(&token)
        .execute(&self.registry_pool)
        .await
        .map_err(|e| e.to_string())?;

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

    /// Persist turn state for a session to the registry database.
    /// Called after combat start/end, join queue, advance turn, etc.
    pub async fn persist_turn_state(&self, session: &Session) {
        let (mode, current, queue) = session.turn_gate.status().await;
        let mode_str = match mode {
            GameMode::Exploration => "exploration",
            GameMode::Combat => "combat",
        };
        let queue_json = serde_json::to_string(&queue).unwrap_or_else(|_| "[]".into());
        let _ = sqlx::query(
            "INSERT INTO registry_turn_state (session_id, mode, current_turn, queue_json)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(session_id) DO UPDATE SET
               mode = excluded.mode,
               current_turn = excluded.current_turn,
               queue_json = excluded.queue_json",
        )
        .bind(&session.id)
        .bind(mode_str)
        .bind(&current)
        .bind(&queue_json)
        .execute(&self.registry_pool)
        .await;
    }
}

#[derive(Serialize)]
pub struct SessionSummary {
    pub id: String,
    pub join_code: String,
    pub player_count: usize,
}

// ── Helpers ──────────────────────────────────────────────────────────

/// Generate a 6-character uppercase alphanumeric join code, retrying
/// on collision (astronomically unlikely but free to check).
async fn generate_unique_join_code(codes: &RwLock<HashMap<String, String>>) -> String {
    const MAX_RETRIES: usize = 5;
    for _ in 0..MAX_RETRIES {
        let code = generate_join_code_raw();
        let exists = { codes.read().await.contains_key(&code) };
        if !exists {
            return code;
        }
    }
    // Fallback: use UUID-based code (guaranteed unique).
    format!("{:.6}", uuid::Uuid::new_v4().to_string().to_uppercase())
}

fn generate_join_code_raw() -> String {
    const CHARS: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/0/O/1
    let mut code = String::with_capacity(6);
    for _ in 0..6 {
        let idx = (uuid::Uuid::new_v4().as_bytes()[0] as usize) % CHARS.len();
        code.push(CHARS[idx] as char);
    }
    code
}

// ── Resync payload builder ───────────────────────────────────────────

use auto_dm_engine::Repository;

/// Build a full materialized-state resync.  This is the server-side
/// equivalent of `bootstrap()` — same data, different transport.
pub async fn build_resync(session: &Session) -> Box<ResyncPayload> {
    let repo = &session.game.repo;

    let scene = repo.active_scene().await.ok().flatten();
    let scene_id = scene.as_ref().map(|s| s.id.as_str()).unwrap_or("");

    let (summary, clocks, npcs, loot, threads, summaries, combat, logs) = tokio::join!(
        repo.get_scene_summary(scene_id),
        repo.list_doom_clocks(),
        repo.list_npc_characters(),
        repo.list_loot(scene_id),
        repo.list_threads(),
        repo.list_episodic_summaries(scene_id),
        repo.load_combat_state(scene_id),
        repo.list_logs(scene_id, 200),
    );

    Box::new(ResyncPayload {
        scene,
        scene_summary: summary.ok().flatten().unwrap_or_default(),
        doom_clocks: clocks.unwrap_or_default(),
        npcs: npcs.unwrap_or_default(),
        loot: loot.unwrap_or_default(),
        threads: threads.unwrap_or_default(),
        summaries: summaries.unwrap_or_default(),
        combat_state: combat.ok().flatten(),
        recent_logs: logs.unwrap_or_default(),
    })
}
