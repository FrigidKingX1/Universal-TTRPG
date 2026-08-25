//! C2+C3+C4 â€” Session model: per-session isolation, player-identity
//! tokens, materialized resync, and turn concurrency policy.
//!
//! The turn gate switches between free-form (exploration) and queued
//! (combat) modes.  In combat, only the current turn-holder can act;
//! others wait in a FIFO queue.  The gate is checked inside the
//! session lock so the check + act + advance sequence is atomic.

use auto_dm_engine::GameState;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::sqlite::{SqlitePool, SqlitePoolOptions};
use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::{broadcast, RwLock};

// â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

pub const BROADCAST_CAPACITY: usize = 256;

/// A connected player slot within a session.  The `token` is the
/// player-identity credential â€” it encodes who this player is, not
/// just "allowed into the session."
#[derive(Clone, Debug)]
#[allow(dead_code)]
pub struct PlayerSlot {
    pub id: String,
    pub name: String,
    pub token: String,
    pub connected: bool,
    pub character_id: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[allow(dead_code)]
pub struct PlayerSlotView {
    pub id: String,
    pub name: String,
    pub connected: bool,
    pub character_id: Option<String>,
}

impl From<&PlayerSlot> for PlayerSlotView {
    fn from(p: &PlayerSlot) -> Self {
        Self { id: p.id.clone(), name: p.name.clone(), connected: p.connected, character_id: p.character_id.clone() }
    }
}

// â”€â”€ Turn concurrency (C4) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

impl Default for TurnGate {
    fn default() -> Self {
        Self::new()
    }
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
            // Queue empty â†’ combat ends automatically.
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
        // Remove first player from queue â€” they're acting now, not waiting.
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
            return; // Already acting â€” don't queue them.
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

/// A live game session â€” one database, one broadcast channel, one lock.
pub struct Session {
    pub id: String,
    pub join_code: String,
    pub game: GameState,
    pub event_tx: broadcast::Sender<WsMessage>,
    pub session_lock: tokio::sync::Mutex<()>,
    pub players: RwLock<Vec<PlayerSlot>>,
    pub turn_gate: TurnGate,
    /// Server-authoritative combatant state: full JSON values (CharacterProfile
    /// or EncounterStatBlock) keyed by position.  Synced from the host via
    /// `/combat/sync` and mutated by `/combat/attack`, `/combat/heal`, etc.
    pub combatants: RwLock<Vec<Value>>,
    /// Per-combatant condition tags (e.g. "Poisoned", "Prone").
    pub combatant_conditions: RwLock<std::collections::HashMap<String, Vec<String>>>,

    /// Shared battle-map state (tokens + background), last-write-wins.
    pub map_tokens: RwLock<Vec<Value>>,
    pub map_background: RwLock<String>,
    /// Rolled initiative order (roll_initiative entries as JSON).  Without
    /// this, only the client that rolled ever sees the order and every
    /// reconnect loses it â€” resync carries it back to everyone.
    pub initiative: RwLock<Vec<Value>>,
}

// â”€â”€ WsMessage â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/// Materialized state sent on reconnect â€” the same data `bootstrap()`
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
    pub characters: Vec<auto_dm_core::models::CharacterProfile>,
    /// Player-to-character mapping: player_id â†’ character_id
    pub player_characters: std::collections::HashMap<String, String>,
    /// Shared battle-map state snapshot.
    #[serde(default)]
    pub map_tokens: Vec<serde_json::Value>,
    #[serde(default)]
    pub map_background: String,
    /// Server-authoritative combatant JSON list (CharacterProfile or EncounterStatBlock).
    pub combatants: Vec<Value>,
    /// Per-combatant condition tags.
    pub combatant_conditions: std::collections::HashMap<String, Vec<String>>,
    /// Last 200 log entries for narrative scrollback display only â€”
    /// NOT for state reconstruction.
    pub recent_logs: Vec<auto_dm_engine::LogEntry>,
    /// Turn-gate snapshot so late joiners / reconnectors land with a
    /// correct turn UI without waiting for the next mutation.
    #[serde(default)]
    pub turn: Option<TurnStatePayload>,
    /// Rolled initiative order, so reconnectors and late joiners see the
    /// same turn order as whoever rolled it.
    #[serde(default)]
    pub initiative: Vec<Value>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum WsMessage {
    Event { event: auto_dm_engine::GameEvent },
    Resync(Box<ResyncPayload>),
    /// Pushed after any turn-gate mutation so every peer's turn UI
    /// updates without polling (C4 closeout).
    TurnState(TurnStatePayload),
}

/// Materialized turn-gate state â€” mirrors `/combat/status`.  Wire shape
/// uses `mode` as a plain string (the HTTP endpoints hand-roll JSON the
/// same way), not the internally-tagged serde enum.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct TurnStatePayload {
    pub mode: String,
    pub current_turn: Option<String>,
    pub queue: Vec<String>,
}

impl GameMode {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Exploration => "exploration",
            Self::Combat => "combat",
        }
    }
}

impl TurnStatePayload {
    /// Snapshot the gate's current state.
    pub async fn from_gate(gate: &TurnGate) -> Self {
        let (mode, current_turn, queue) = gate.status().await;
        Self {
            mode: mode.as_str().to_string(),
            current_turn,
            queue,
        }
    }
}

/// Read the gate and push a `TurnState` to every connected peer.
/// Fire-and-forget: lagged receivers resync on their own.
pub async fn broadcast_turn_state(session: &Session) {
    let payload = TurnStatePayload::from_gate(&session.turn_gate).await;
    let _ = session.event_tx.send(WsMessage::TurnState(payload));
}

// â”€â”€ Session registry â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

pub struct SessionRegistry {
    /// session_id â†’ Session.  Pub for the binary's disconnect handler;
    /// treat as internal â€” prefer registry methods when available.
    pub sessions: RwLock<HashMap<String, Arc<Session>>>,
    /// join_code â†’ session_id (short lookup for the join endpoint)
    codes: RwLock<HashMap<String, String>>,
    /// token â†’ (session_id, player_id) â€” the identity backbone for C3.
    tokens: RwLock<HashMap<String, (String, String)>>,
    /// Base directory for per-session databases.
    data_dir: PathBuf,
    /// Ollama base URL (configurable via env or runtime endpoint).
    ollama_url: std::sync::RwLock<String>,
    /// Current Ollama model name.
    ollama_model: std::sync::RwLock<String>,
    /// Persistent registry database (survives restarts).
    registry_pool: SqlitePool,
}

impl SessionRegistry {
    pub async fn new(
        data_dir: PathBuf,
        ollama_url: String,
        ollama_model: String,
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
            ollama_url: std::sync::RwLock::new(ollama_url),
            ollama_model: std::sync::RwLock::new(ollama_model),
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
                token TEXT NOT NULL UNIQUE,
                character_id TEXT
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
        // Migration: add character_id to existing registry_players tables.
        let _ = sqlx::query("ALTER TABLE registry_players ADD COLUMN character_id TEXT")
            .execute(&mut *tx).await;
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
                tracing::warn!(session = %session_id, "Registry entry missing .db file â€” skipping");
                continue;
            }

            let pool = auto_dm_engine::open_pool(&db_path)
                .await
                .map_err(|e| e.to_string())?;
            auto_dm_engine::run_migrations(&pool)
                .await
                .map_err(|e| e.to_string())?;
            let repo = auto_dm_engine::SqliteRepository::new(pool);

            // Idempotent: tops up content added to the preset library since
            // this session's database was first created.
            match crate::presets::seed_content(&repo).await {
                Ok((actions, monsters)) => {
                    tracing::info!(session = %session_id, actions, monsters, "preset content topped up");
                }
                Err(e) => tracing::warn!(session = %session_id, "preset seeding failed: {e}"),
            }

            let pipeline = self.build_pipeline();
            let model_name = self.ollama_model.read().unwrap_or_else(std::sync::PoisonError::into_inner).clone();

            let (event_tx, _rx) = broadcast::channel(BROADCAST_CAPACITY);
            let game = GameState {
                repo,
                dm: tokio::sync::Mutex::new(Some(Arc::new(pipeline))),
                memory: std::sync::Mutex::new(auto_dm_core::memory::CampaignMemory::new()),
                ollama_child: std::sync::Mutex::new(None),
                current_model: std::sync::Mutex::new(model_name),
                current_num_predict: std::sync::Mutex::new(512),
            };

            // Load players for this session.
            let player_rows: Vec<(String, String, String, Option<String>)> = sqlx::query_as(
                "SELECT id, name, token, character_id FROM registry_players WHERE session_id = ?",
            )
            .bind(&session_id)
            .fetch_all(&self.registry_pool)
            .await
            .map_err(|e| e.to_string())?;

            let players: Vec<PlayerSlot> = player_rows
                .into_iter()
                .map(|(id, name, token, character_id)| PlayerSlot {
                    id,
                    name,
                    token,
                    connected: false,
                    character_id,
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
                combatants: RwLock::new(Vec::new()),
                combatant_conditions: RwLock::new(std::collections::HashMap::new()),
            map_tokens: RwLock::new(Vec::new()),
            map_background: RwLock::new(String::new()),
            initiative: RwLock::new(Vec::new()),
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

    /// Build a DmPipeline from current Ollama config (OllamaLlmBackend if reachable, stub otherwise).
    fn build_pipeline(&self) -> auto_dm_core::llm::DmPipeline<Box<dyn auto_dm_core::llm::LlmBackend>> {
        let url = self.ollama_url.read().unwrap_or_else(std::sync::PoisonError::into_inner).clone();
        let model = self.ollama_model.read().unwrap_or_else(std::sync::PoisonError::into_inner).clone();
        let backend: Box<dyn auto_dm_core::llm::LlmBackend> =
            if auto_dm_core::ollama::OllamaLlmBackend::reachable_url(&url) {
                tracing::info!(url = %url, model = %model, "Using Ollama backend");
                Box::new(auto_dm_core::ollama::OllamaLlmBackend::new_with_url(Some(model), Some(url)))
            } else {
                tracing::warn!("Ollama unreachable â€” falling back to stub backend");
                Box::new(auto_dm_core::llm::StubLlmBackend)
            };
        auto_dm_core::llm::DmPipeline::new(backend)
    }

    /// Swap the Ollama model at runtime. Rebuilds pipelines for all active sessions.
    pub async fn set_model(&self, model: String) -> Result<(), String> {
        {
            let mut m = self.ollama_model.write().map_err(|e| e.to_string())?;
            *m = model.clone();
        }
        // Rebuild pipelines in all active sessions.
        let sessions = self.sessions.read().await;
        for (id, session) in sessions.iter() {
            let pipeline = self.build_pipeline();
            let mut dm = session.game.dm.lock().await;
            *dm = Some(Arc::new(pipeline));
            *session.game.current_model.lock().map_err(|e| e.to_string())? = model.clone();
            tracing::info!(session = %id, model = %model, "Rebuilt pipeline for session");
        }
        Ok(())
    }

    /// Swap the Ollama URL at runtime. Rebuilds pipelines for all active sessions.
    pub async fn set_ollama_url(&self, url: String) -> Result<(), String> {
        {
            let mut u = self.ollama_url.write().map_err(|e| e.to_string())?;
            *u = url.clone();
        }
        let sessions = self.sessions.read().await;
        for (id, session) in sessions.iter() {
            let pipeline = self.build_pipeline();
            let mut dm = session.game.dm.lock().await;
            *dm = Some(Arc::new(pipeline));
            tracing::info!(session = %id, url = %url, "Rebuilt pipeline for session");
        }
        Ok(())
    }

    /// Get current Ollama config.
    pub fn ollama_config(&self) -> (String, String, bool) {
        let url = self.ollama_url.read().unwrap_or_else(std::sync::PoisonError::into_inner).clone();
        let model = self.ollama_model.read().unwrap_or_else(std::sync::PoisonError::into_inner).clone();
        let reachable = auto_dm_core::ollama::OllamaLlmBackend::reachable_url(&url);
        (url, model, reachable)
    }

    // â”€â”€ Character management â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    /// Link a player to a character by ID. Host-only operation.
    pub async fn link_character(
        &self,
        session: &Arc<Session>,
        player_id: &str,
        character_id: &str,
    ) -> Result<(), String> {
        // Verify the character exists.
        let _char = session.game.repo.load_character(character_id).await
            .map_err(|_| "Character not found".to_string())?;

        {
            let mut players = session.players.write().await;
            let player = players.iter_mut().find(|p| p.id == player_id)
                .ok_or("Player not found in session")?;
            player.character_id = Some(character_id.to_string());
        }

        // Persist to registry database.
        sqlx::query("UPDATE registry_players SET character_id = ? WHERE id = ?")
            .bind(character_id)
            .bind(player_id)
            .execute(&self.registry_pool)
            .await
            .map_err(|e| e.to_string())?;

        Ok(())
    }

    /// Create a new character and link it to the calling player.
    pub async fn create_character_for_player(
        &self,
        session: &Arc<Session>,
        player_id: &str,
        profile: auto_dm_core::models::CharacterProfile,
    ) -> Result<auto_dm_core::models::CharacterProfile, String> {
        session.game.repo.save_character(&profile).await
            .map_err(|e| format!("Failed to save character: {e}"))?;

        // Link player to the new character.
        self.link_character(session, player_id, &profile.id).await?;
        Ok(profile)
    }

    /// Equip or stow an item in a character's inventory.
    pub async fn equip_item(
        &self,
        session: &Arc<Session>,
        player_id: &str,
        item_id: &str,
        equipped: bool,
    ) -> Result<auto_dm_core::models::CharacterProfile, String> {
        let character_id = self.get_character_id(session, player_id).await?;
        let mut profile = session.game.repo.load_character(&character_id).await
            .map_err(|e| format!("Character load failed: {e}"))?;

        let item = profile.inventory.iter_mut().find(|i| i.id == item_id)
            .ok_or("Item not found in inventory")?;
        item.state = if equipped {
            auto_dm_core::models::ItemState::Equipped
        } else {
            auto_dm_core::models::ItemState::Stowed
        };

        session.game.repo.save_character(&profile).await
            .map_err(|e| format!("Save failed: {e}"))?;
        Ok(profile)
    }

    /// Use/consume an item (decrement quantity, remove if zero).
    pub async fn use_item(
        &self,
        session: &Arc<Session>,
        player_id: &str,
        item_id: &str,
    ) -> Result<auto_dm_core::models::CharacterProfile, String> {
        let character_id = self.get_character_id(session, player_id).await?;
        let mut profile = session.game.repo.load_character(&character_id).await
            .map_err(|e| format!("Character load failed: {e}"))?;

        let idx = profile.inventory.iter().position(|i| i.id == item_id)
            .ok_or("Item not found in inventory")?;

        profile.inventory[idx].quantity -= 1;
        if profile.inventory[idx].quantity <= 0 {
            profile.inventory.remove(idx);
        }

        session.game.repo.save_character(&profile).await
            .map_err(|e| format!("Save failed: {e}"))?;
        Ok(profile)
    }

    /// Add an item to a character's inventory.
    pub async fn add_item(
        &self,
        session: &Arc<Session>,
        player_id: &str,
        item: auto_dm_core::models::InventoryItem,
    ) -> Result<auto_dm_core::models::CharacterProfile, String> {
        let character_id = self.get_character_id(session, player_id).await?;
        let mut profile = session.game.repo.load_character(&character_id).await
            .map_err(|e| format!("Character load failed: {e}"))?;

        // Stack with existing item of same name if found.
        if let Some(existing) = profile.inventory.iter_mut().find(|i| i.name == item.name) {
            existing.quantity += item.quantity;
        } else {
            profile.inventory.push(item);
        }

        session.game.repo.save_character(&profile).await
            .map_err(|e| format!("Save failed: {e}"))?;
        Ok(profile)
    }

    /// Perform a short or long rest for a character.
    pub async fn rest(
        &self,
        session: &Arc<Session>,
        player_id: &str,
        long: bool,
    ) -> Result<auto_dm_core::models::CharacterProfile, String> {
        let character_id = self.get_character_id(session, player_id).await?;
        let mut profile = session.game.repo.load_character(&character_id).await
            .map_err(|e| format!("Character load failed: {e}"))?;

        let condition = if long {
            auto_dm_core::models::ResetCondition::LongRest
        } else {
            auto_dm_core::models::ResetCondition::ShortRest
        };

        for pool in profile.resource_pools.values_mut() {
            if pool.reset_condition == condition {
                pool.current = pool.maximum;
                pool.temporary = 0;
            }
        }

        session.game.repo.save_character(&profile).await
            .map_err(|e| format!("Save failed: {e}"))?;
        Ok(profile)
    }

    /// Helper: resolve player_id â†’ character_id.
    async fn get_character_id(&self, session: &Arc<Session>, player_id: &str) -> Result<String, String> {
        let players = session.players.read().await;
        let player = players.iter().find(|p| p.id == player_id)
            .ok_or("Player not found")?;
        player.character_id.clone().ok_or("No character linked â€” create or link a character first".into())
    }

    /// Create a new session and mint the host's player token.
    pub async fn create_session(
        &self,
        title: &str,
    ) -> Result<(String, String, String), String> {
        let title = title.trim();
        if title.is_empty() {
            return Err("Session title cannot be empty".into());
        }
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

        // Ship every new session with the full preset bestiary + action vault.
        match crate::presets::seed_content(&repo).await {
            Ok((actions, monsters)) => {
                tracing::info!(actions, monsters, "preset content seeded");
            }
            Err(e) => tracing::warn!("preset seeding failed (session continues without): {e}"),
        }

        let pipeline = self.build_pipeline();
        let model_name = self.ollama_model.read().unwrap_or_else(std::sync::PoisonError::into_inner).clone();

        let (event_tx, _rx) = broadcast::channel(BROADCAST_CAPACITY);
        let game = GameState {
            repo,
            dm: tokio::sync::Mutex::new(Some(Arc::new(pipeline))),
            memory: std::sync::Mutex::new(auto_dm_core::memory::CampaignMemory::new()),
            ollama_child: std::sync::Mutex::new(None),
            current_model: std::sync::Mutex::new(model_name),
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
                character_id: None,
            }]),
            turn_gate: TurnGate::new(),
            combatants: RwLock::new(Vec::new()),
            combatant_conditions: RwLock::new(std::collections::HashMap::new()),
            map_tokens: RwLock::new(Vec::new()),
            map_background: RwLock::new(String::new()),
            initiative: RwLock::new(Vec::new()),
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
        // Roster hygiene: no blank or oversized display names.
        let player_name = player_name.trim();
        if player_name.is_empty() {
            return Err("Player name cannot be empty".into());
        }
        if player_name.len() > 32 {
            return Err("Player name too long (max 32 characters)".into());
        }
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
                character_id: None,
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

    /// Resolve a player token â†’ (session, player_id).
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

    /// Resolve a join code â†’ session_id.
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

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€ Resync payload builder â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

use auto_dm_engine::Repository;

/// Build a full materialized-state resync.  This is the server-side
/// equivalent of `bootstrap()` â€” same data, different transport.
pub async fn build_resync(session: &Session) -> Box<ResyncPayload> {
    let repo = &session.game.repo;

    let scene = repo.active_scene().await.ok().flatten();
    let scene_id = scene.as_ref().map(|s| s.id.as_str()).unwrap_or("");

    let (summary, clocks, npcs, loot, threads, summaries, combat, logs, characters) = tokio::join!(
        repo.get_scene_summary(scene_id),
        repo.list_doom_clocks(),
        repo.list_npc_characters(),
        repo.list_loot(scene_id),
        repo.list_threads(),
        repo.list_episodic_summaries(scene_id),
        repo.load_combat_state(scene_id),
        repo.list_logs(scene_id, 200),
        repo.list_characters(),
    );

    // Build player_id â†’ character_id mapping from player slots.
    let players = session.players.read().await;
    let player_characters: std::collections::HashMap<String, String> = players
        .iter()
        .filter_map(|p| p.character_id.as_ref().map(|cid| (p.id.clone(), cid.clone())))
        .collect();
    drop(players);

    Box::new(ResyncPayload {
        scene,
        scene_summary: summary.ok().flatten().unwrap_or_default(),
        doom_clocks: clocks.unwrap_or_default(),
        npcs: npcs.unwrap_or_default(),
        loot: loot.unwrap_or_default(),
        threads: threads.unwrap_or_default(),
        summaries: summaries.unwrap_or_default(),
        combat_state: combat.ok().flatten(),
        characters: characters.unwrap_or_default(),
        player_characters,
        combatants: session.combatants.read().await.clone(),
        combatant_conditions: session.combatant_conditions.read().await.clone(),
        map_tokens: session.map_tokens.read().await.clone(),
        map_background: session.map_background.read().await.clone(),
        recent_logs: logs.unwrap_or_default(),
        turn: Some(TurnStatePayload::from_gate(&session.turn_gate).await),
        initiative: session.initiative.read().await.clone(),
    })
}

#[cfg(test)]
mod turn_state_tests {
    use super::*;

    #[tokio::test]
    async fn join_rejects_blank_and_oversized_names() {
        let dir = std::env::temp_dir()
            .join(format!("auto-dm-join-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let registry =
            SessionRegistry::new(dir.clone(), "http://localhost:11434".into(), "m".into())
                .await
                .unwrap();
        let (_sid, code, _host_token) = registry.create_session("QA Table").await.unwrap();

        assert!(registry.join_session(&code, "   ").await.is_err());
        assert!(registry.join_session(&code, "").await.is_err());
        assert!(registry.join_session(&code, &"x".repeat(33)).await.is_err());

        // Trimmed valid name lands in the roster.
        let (.., player_id) = registry.join_session(&code, "  Gandalf  ").await.unwrap();
        let sessions = registry.sessions.read().await;
        let session = sessions.values().next().unwrap();
        let players = session.players.read().await;
        assert!(
            players.iter().any(|p| p.id == player_id && p.name == "Gandalf"),
            "trimmed name not stored"
        );

        std::fs::remove_dir_all(&dir).ok();
    }

    #[tokio::test]
    async fn create_session_rejects_empty_title() {
        let dir = std::env::temp_dir()
            .join(format!("auto-dm-title-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let registry =
            SessionRegistry::new(dir.clone(), "http://localhost:11434".into(), "m".into())
                .await
                .unwrap();
        assert!(registry.create_session("   ").await.is_err());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[tokio::test]
    async fn payload_mirrors_gate_status_through_combat_lifecycle() {
        let gate = TurnGate::new();

        // Exploration: no current turn, empty queue.
        let p = TurnStatePayload::from_gate(&gate).await;
        assert_eq!(p.mode, "exploration");
        assert_eq!(p.current_turn, None);
        assert!(p.queue.is_empty());

        // Start combat: starter becomes current turn.
        gate.start_combat("alice".into()).await;
        let p = TurnStatePayload::from_gate(&gate).await;
        assert_eq!(p.mode, "combat");
        assert_eq!(p.current_turn.as_deref(), Some("alice"));

        // Join queue: waiting players listed in FIFO order.
        gate.join_queue("bob".into()).await;
        gate.join_queue("carol".into()).await;
        let p = TurnStatePayload::from_gate(&gate).await;
        assert_eq!(p.queue, vec!["bob".to_string(), "carol".to_string()]);

        // Advance: next in queue takes over, predecessor is not re-queued.
        gate.advance_turn().await;
        let p = TurnStatePayload::from_gate(&gate).await;
        assert_eq!(p.current_turn.as_deref(), Some("bob"));
        assert_eq!(p.queue, vec!["carol".to_string()]);

        // End combat: back to exploration with nothing pending.
        gate.end_combat().await;
        let p = TurnStatePayload::from_gate(&gate).await;
        assert_eq!(p.mode, "exploration");
        assert_eq!(p.current_turn, None);
        assert!(p.queue.is_empty());
    }

    #[test]
    fn ws_message_serializes_with_client_contract_shape() {
        // The frontend store dispatches on `msg.type === "turn_state"` and
        // types `mode` as the plain string union "exploration" | "combat"
        // (same shape every /combat/* HTTP response uses). Lock it here.
        let msg = WsMessage::TurnState(TurnStatePayload {
            mode: "combat".into(),
            current_turn: Some("bob".into()),
            queue: vec!["carol".into()],
        });
        let v: Value = serde_json::to_value(&msg).unwrap();
        assert_eq!(v["type"], "turn_state");
        assert_eq!(v["mode"], "combat");
        assert_eq!(v["current_turn"], "bob");
        assert_eq!(v["queue"], serde_json::json!(["carol"]));
    }

    #[tokio::test]
    async fn resync_payload_carries_turn_snapshot() {
        // Late joiners / reconnectors hydrate their turn UI from resync;
        // without this they show exploration/no-turn until someone acts.
        let dir = std::env::temp_dir()
            .join(format!("auto-dm-resync-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let pool =
            auto_dm_engine::open_pool(&dir.join("test.db")).await.unwrap();
        auto_dm_engine::run_migrations(&pool).await.unwrap();

        let (tx, _rx) = tokio::sync::broadcast::channel(16);
        let session = Session {
            id: "sess".into(),
            join_code: "JOIN01".into(),
            game: auto_dm_engine::GameState {
                repo: auto_dm_engine::SqliteRepository::new(pool),
                dm: tokio::sync::Mutex::new(None),
                memory: std::sync::Mutex::new(auto_dm_core::memory::CampaignMemory::new()),
                ollama_child: std::sync::Mutex::new(None),
                current_model: std::sync::Mutex::new("test-model".into()),
                current_num_predict: std::sync::Mutex::new(512),
            },
            event_tx: tx,
            session_lock: tokio::sync::Mutex::new(()),
            players: Default::default(),
            turn_gate: TurnGate::new(),
            combatants: Default::default(),
            combatant_conditions: Default::default(),
            map_tokens: Default::default(),
            map_background: Default::default(),
            initiative: Default::default(),
        };

        session.turn_gate.start_combat("alice".into()).await;
        session.turn_gate.join_queue("bob".into()).await;

        // Initiative rolled by one client must reach everyone via resync.
        *session.initiative.write().await = vec![
            serde_json::json!({ "combatant_id": "gob1", "name": "Goblin", "roll": 17, "modifier": 2 }),
            serde_json::json!({ "combatant_id": "alice-char", "name": "Alice", "roll": 12, "modifier": 1 }),
        ];

        let payload = build_resync(&session).await;
        let turn = payload.turn.expect("resync carries turn snapshot");
        assert_eq!(turn.mode, "combat");
        assert_eq!(turn.current_turn.as_deref(), Some("alice"));
        assert_eq!(turn.queue, vec!["bob".to_string()]);

        // Initiative round-trips to every peer.
        let init = payload.initiative;
        assert_eq!(init.len(), 2, "resync carries initiative order");
        assert_eq!(init[0]["combatant_id"], "gob1");

        std::fs::remove_dir_all(&dir).ok();
    }
}
