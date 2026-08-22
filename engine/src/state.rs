use auto_dm_core::llm::{DmPipeline, LlmBackend};
use auto_dm_core::memory::CampaignMemory;
use auto_dm_core::models::{ActionDefinition, CharacterProfile, EncounterStatBlock};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePool, SqlitePoolOptions};
use sqlx::{Row, Sqlite};
use std::sync::{Arc, Mutex};
use uuid::Uuid;

/// Error type lives in `crate::error` (thiserror); aliased for back-compat.
pub use crate::error::{DbError, EngineError};


/// A campaign scene (the spec's `campaign_scenes` row).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Scene {
    pub id: String,
    pub scene_number: i32,
    pub title: String,
    pub chaos_factor: i32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary_text: Option<String>,
    pub is_active: bool,
}

/// A narrative log entry (the spec's `log_entries` row).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LogEntry {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scene_id: Option<String>,
    pub speaker: String,
    pub content: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub payload: Option<Value>,
    pub timestamp: String,
}

/// Application state shared with Tauri commands.
pub struct GameState {
    pub repo: SqliteRepository,
    /// The DM loop, swappable at runtime when the model changes.
    /// Wrapped in `Arc` so callers can clone and release the lock before
    /// awaiting the LLM (which may take up to 180 s) without blocking
    /// concurrent DM requests.
    #[allow(clippy::type_complexity)]
    pub dm: tokio::sync::Mutex<Option<Arc<DmPipeline<Box<dyn LlmBackend>>>>>,
    /// In-memory ring buffer of recent campaign events for LLM context.
    pub memory: Mutex<CampaignMemory>,
    /// Handle to the Ollama child process, if we started it.
    pub ollama_child: Mutex<Option<std::process::Child>>,
    /// Currently selected Ollama model name.
    pub current_model: Mutex<String>,
    /// Max tokens for Ollama generation (num_predict), persisted.
    pub current_num_predict: Mutex<u32>,
}

/// Data access contract. Implemented over SQLite for the MVP; a SQLCipher
/// variant can be swapped in behind this trait without touching domain logic.
#[allow(async_fn_in_trait)]
pub trait Repository: Send + Sync {
    async fn save_character(&self, profile: &CharacterProfile) -> Result<(), DbError>;
    async fn load_character(&self, id: &str) -> Result<CharacterProfile, DbError>;
    async fn list_characters(&self) -> Result<Vec<CharacterProfile>, DbError>;
    async fn delete_character(&self, id: &str) -> Result<bool, DbError>;

    async fn save_action(&self, action: &ActionDefinition) -> Result<(), DbError>;
    async fn load_action(&self, id: &str) -> Result<Option<ActionDefinition>, DbError>;
    async fn list_actions(&self) -> Result<Vec<ActionDefinition>, DbError>;
    async fn delete_action(&self, id: &str) -> Result<bool, DbError>;

    async fn save_stat_block(&self, sb: &EncounterStatBlock) -> Result<(), DbError>;
    async fn load_stat_block(&self, id: &str) -> Result<Option<EncounterStatBlock>, DbError>;
    async fn list_stat_blocks(&self) -> Result<Vec<EncounterStatBlock>, DbError>;
    async fn delete_stat_block(&self, id: &str) -> Result<bool, DbError>;

    async fn create_scene(&self, title: &str, chaos_factor: i32) -> Result<Scene, DbError>;
    async fn list_scenes(&self) -> Result<Vec<Scene>, DbError>;
    async fn active_scene(&self) -> Result<Option<Scene>, DbError>;
    async fn set_active_scene(&self, id: &str) -> Result<(), DbError>;
    async fn delete_scene(&self, id: &str) -> Result<bool, DbError>;
    async fn update_scene_summary(&self, id: &str, summary: Option<&str>) -> Result<(), DbError>;
    async fn update_scene_chaos_factor(&self, id: &str, chaos_factor: i32) -> Result<(), DbError>;
    async fn get_scene_summary(&self, id: &str) -> Result<Option<String>, DbError>;

    async fn append_log(
        &self,
        scene_id: &str,
        speaker: &str,
        content: &str,
        payload: Option<Value>,
    ) -> Result<LogEntry, DbError>;
    async fn list_logs(&self, scene_id: &str, limit: i64) -> Result<Vec<LogEntry>, DbError>;

    async fn export_campaign(&self) -> Result<CampaignExport, DbError>;
    async fn import_campaign(&self, data: &CampaignExport) -> Result<(), DbError>;

    // Loot
    async fn save_loot(
        &self,
        scene_id: &str,
        name: &str,
        quantity: i32,
        source_entity: &str,
    ) -> Result<LootRow, DbError>;
    async fn assign_loot(&self, loot_id: &str, character_id: &str) -> Result<(), DbError>;
    async fn list_loot(&self, scene_id: &str) -> Result<Vec<LootRow>, DbError>;
    async fn clear_loot(&self, scene_id: &str) -> Result<(), DbError>;

    // NPC Notes
    async fn save_npc_note(
        &self,
        scene_id: &str,
        npc_name: &str,
        relation: &str,
        note: &str,
    ) -> Result<NpcNoteRow, DbError>;
    async fn list_npc_notes(&self, scene_id: &str) -> Result<Vec<NpcNoteRow>, DbError>;
    async fn delete_npc_note(&self, id: &str) -> Result<bool, DbError>;

    // Combat state persistence
    async fn save_combat_state(&self, scene_id: &str, state_json: &str) -> Result<(), DbError>;
    async fn load_combat_state(&self, scene_id: &str) -> Result<Option<String>, DbError>;

    // DM memory persistence (survives restarts)
    async fn append_memory(&self, speaker: &str, content: &str) -> Result<(), DbError>;
    async fn list_memory(&self, limit: i64) -> Result<Vec<(String, String)>, DbError>;

    // Streaming checkpoints (fault-tolerant intermediate saves)
    async fn save_stream_checkpoint(&self, id: &str, content: &str) -> Result<(), DbError>;
    async fn load_stream_checkpoint(&self, id: &str) -> Result<Option<String>, DbError>;
    async fn clear_stream_checkpoint(&self, id: &str) -> Result<(), DbError>;

    // Episodic summaries (compressed scene recaps)
    async fn save_episodic_summary(
        &self,
        scene_id: &str,
        summary: &str,
        last_log_id: &str,
    ) -> Result<EpisodicSummary, DbError>;
    async fn list_episodic_summaries(&self, scene_id: &str) -> Result<Vec<EpisodicSummary>, DbError>;
    async fn delete_episodic_summary(&self, id: &str) -> Result<bool, DbError>;

    // Plot Threads
    async fn save_thread(
        &self,
        description: &str,
        status: &str,
        opened_scene_id: &str,
        resolved_scene_id: Option<&str>,
    ) -> Result<ThreadRow, DbError>;
    async fn update_thread_status(
        &self,
        id: &str,
        status: &str,
        resolved_scene_id: Option<&str>,
    ) -> Result<(), DbError>;
    async fn list_threads(&self) -> Result<Vec<ThreadRow>, DbError>;
    async fn delete_thread(&self, id: &str) -> Result<bool, DbError>;

    // NPC Characters
    #[allow(clippy::too_many_arguments)]
    async fn save_npc_character(
        &self,
        name: &str,
        disposition: &str,
        alive: bool,
        location: Option<&str>,
        knows_json: &str,
        notes: Option<&str>,
        last_seen_scene_id: Option<&str>,
        drive: Option<&str>,
        leverage: Option<&str>,
        flaw: Option<&str>,
        flaw_revealed: bool,
    ) -> Result<NpcCharacterRow, DbError>;
    #[allow(clippy::too_many_arguments)]
    async fn update_npc_character(
        &self,
        id: &str,
        disposition: Option<&str>,
        alive: Option<bool>,
        location: Option<&str>,
        knows_json: Option<&str>,
        notes: Option<&str>,
        last_seen_scene_id: Option<&str>,
    ) -> Result<(), DbError>;
    async fn update_npc_pillars(
        &self,
        id: &str,
        drive: Option<&str>,
        leverage: Option<&str>,
        flaw: Option<&str>,
    ) -> Result<(), DbError>;
    async fn reveal_flaw(&self, id: &str) -> Result<(), DbError>;
    async fn list_npc_characters(&self) -> Result<Vec<NpcCharacterRow>, DbError>;
    async fn delete_npc_character(&self, id: &str) -> Result<bool, DbError>;

    // Campaign settings (key-value)
    async fn get_setting(&self, key: &str) -> Result<Option<String>, DbError>;
    async fn set_setting(&self, key: &str, value: &str) -> Result<(), DbError>;

    // Doom Clocks
    async fn save_doom_clock(
        &self,
        id: &str,
        label: &str,
        max: u32,
        consequence: &str,
        scene_id: Option<&str>,
    ) -> Result<(), DbError>;
    async fn list_doom_clocks(&self) -> Result<Vec<DoomClockRow>, DbError>;
    async fn tick_doom_clock(&self, id: &str) -> Result<Option<(u32, u32)>, DbError>;
    async fn advance_doom_clock(&self, id: &str, ticks: u32)
        -> Result<Option<(u32, u32)>, DbError>;
    async fn reset_doom_clock(&self, id: &str) -> Result<(), DbError>;
    async fn delete_doom_clock(&self, id: &str) -> Result<bool, DbError>;

    // ── Audit-log rewind ───────────────────────────────────────────

    /// Restore a doom clock to a previous state.
    async fn restore_clock(&self, id: &str, current: u32, max: u32) -> Result<(), DbError>;
    /// Set a scene summary directly (for rewind restoration).
    async fn set_scene_summary(&self, scene_id: &str, summary: &str) -> Result<(), DbError>;
    /// Delete all log entries for a scene with timestamp > target_log's timestamp.
    /// Returns the deleted log IDs (for episodic summary staleness checks).
    async fn delete_logs_after(&self, scene_id: &str, target_log_id: &str) -> Result<Vec<String>, DbError>;
    /// Delete episodic summaries whose last_log_id appears in the given set.
    /// Returns the IDs of deleted summaries.
    async fn invalidate_stale_summaries(&self, scene_id: &str, stale_log_ids: &[String]) -> Result<Vec<String>, DbError>;

    async fn save_exploration_zone(
        &self,
        id: &str,
        name: &str,
        zone_type: &str,
        description: Option<&str>,
        danger_level: u32,
        mapped: bool,
    ) -> Result<(), DbError>;
    async fn list_exploration_zones(&self) -> Result<Vec<ExplorationZoneRow>, DbError>;
    async fn delete_exploration_zone(&self, id: &str) -> Result<bool, DbError>;

    async fn save_exploration_node(
        &self,
        id: &str,
        zone_id: &str,
        name: &str,
        description: Option<&str>,
        connections_json: &str,
        contents_json: &str,
    ) -> Result<(), DbError>;
    async fn list_exploration_nodes(
        &self,
        zone_id: &str,
    ) -> Result<Vec<ExplorationNodeRow>, DbError>;
    #[allow(clippy::too_many_arguments)]
    async fn update_exploration_node(
        &self,
        id: &str,
        discovered: Option<bool>,
        safe: Option<bool>,
        description: Option<&str>,
        connections_json: Option<&str>,
        contents_json: Option<&str>,
        notes: Option<&str>,
    ) -> Result<(), DbError>;
    async fn delete_exploration_node(&self, id: &str) -> Result<bool, DbError>;

    // Transaction support for atomic campaign generation
    async fn begin_tx(&self) -> Result<sqlx::Transaction<'_, Sqlite>, DbError>;
    async fn db_create_scene_txn(
        &self,
        tx: &mut sqlx::Transaction<'_, Sqlite>,
        title: &str,
        chaos_factor: i32,
    ) -> Result<crate::state::Scene, DbError>;
    async fn db_save_npc_txn(
        &self,
        tx: &mut sqlx::Transaction<'_, Sqlite>,
        name: &str,
        disposition: &str,
        notes: &str,
    ) -> Result<(), DbError>;
    async fn db_save_doom_clock_txn(
        &self,
        tx: &mut sqlx::Transaction<'_, Sqlite>,
        id: &str,
        label: &str,
        tick_max: u32,
        consequence: &str,
        scene_id: Option<&str>,
    ) -> Result<(), DbError>;
    async fn db_save_thread_txn(
        &self,
        tx: &mut sqlx::Transaction<'_, Sqlite>,
        description: &str,
        status: &str,
        resolved_scene_id: Option<&str>,
    ) -> Result<crate::state::ThreadRow, DbError>;
    async fn db_set_setting_txn(
        &self,
        tx: &mut sqlx::Transaction<'_, Sqlite>,
        key: &str,
        value: &str,
    ) -> Result<(), DbError>;
}

/// A loot entry (items dropped by monsters, assigned to characters).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LootRow {
    pub id: String,
    pub scene_id: String,
    pub name: String,
    pub quantity: i32,
    pub source_entity: String,
    pub assigned_to: Option<String>,
    pub timestamp: String,
}

/// An NPC relationship note.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct NpcNoteRow {
    pub id: String,
    pub scene_id: String,
    pub npc_name: String,
    pub relation: String,
    pub note: String,
    pub timestamp: String,
}

/// Persisted combat state (initiative, HP, conditions, etc.).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CombatStateRow {
    pub scene_id: String,
    pub state_json: String,
    pub updated_at: String,
}

/// A plot thread row in SQLite.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ThreadRow {
    pub id: String,
    pub description: String,
    pub status: String,
    pub opened_scene_id: String,
    pub resolved_scene_id: Option<String>,
    pub created_at: String,
}

/// An NPC character row in SQLite.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct NpcCharacterRow {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub drive: Option<String>,
    #[serde(default)]
    pub leverage: Option<String>,
    #[serde(default)]
    pub flaw: Option<String>,
    #[serde(default)]
    pub flaw_revealed: bool,
    pub disposition: String,
    pub alive: bool,
    pub location: Option<String>,
    pub knows_json: String,
    pub notes: Option<String>,
    pub last_seen_scene_id: Option<String>,
    pub created_at: String,
}

pub struct DoomClockRow {
    pub id: String,
    pub label: String,
    pub current: u32,
    pub max: u32,
    pub consequence: String,
    pub scene_id: Option<String>,
    pub active: bool,
    pub created_at: String,
}

pub struct ExplorationZoneRow {
    pub id: String,
    pub name: String,
    pub zone_type: String,
    pub description: Option<String>,
    pub danger_level: u32,
    pub mapped: bool,
    pub created_at: String,
}

pub struct ExplorationNodeRow {
    pub id: String,
    pub zone_id: String,
    pub name: String,
    pub discovered: bool,
    pub safe: bool,
    pub description: Option<String>,
    pub connections_json: String,
    pub contents_json: String,
    pub notes: Option<String>,
    pub created_at: String,
}

/// CampaignExport now includes loot, notes, threads, and NPC characters for full round-trip.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CampaignExport {
    pub characters: Vec<CharacterProfile>,
    pub actions: Vec<ActionDefinition>,
    pub stat_blocks: Vec<EncounterStatBlock>,
    pub scenes: Vec<Scene>,
    pub logs: Vec<LogEntry>,
    #[serde(default)]
    pub loot: Vec<LootRow>,
    #[serde(default)]
    pub npc_notes: Vec<NpcNoteRow>,
    #[serde(default)]
    pub plot_threads: Vec<ThreadRow>,
    #[serde(default)]
    pub npc_characters: Vec<NpcCharacterRow>,
}

/// A compressed prose recap of a completed scene/episode.
///
/// `last_log_id` records which log entry the summary covers up to.
/// On audit-log rewind, if that entry was deleted, the summary is stale
/// and should be flagged or regenerated — see [`is_summary_stale`].
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EpisodicSummary {
    pub id: String,
    pub scene_id: String,
    pub summary: String,
    /// The ID of the last log entry this summary covers.
    /// If that entry no longer exists in the log, the summary is stale.
    pub last_log_id: String,
    pub created_at: String,
}

/// Pure check: is an episodic summary stale given the current log?
///
/// A summary is stale if its `last_log_id` no longer appears in the
/// scene's log — meaning events were deleted (rewind) or the log was
/// cleared.  This is golden-testable without a database.
pub fn is_summary_stale(last_log_id: &str, current_log_ids: &[String]) -> bool {
    !current_log_ids.iter().any(|id| id == last_log_id)
}

/// SQLite-backed repository using an async connection pool.
#[derive(Clone)]
pub struct SqliteRepository {
    pool: SqlitePool,
}

impl SqliteRepository {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }

    pub fn pool(&self) -> &SqlitePool {
        &self.pool
    }
}

/// Open (or create) the SQLite database at `path` with WAL + foreign keys.
pub async fn open_pool(path: &std::path::Path) -> Result<SqlitePool, sqlx::Error> {
    let options = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .foreign_keys(true)
        .busy_timeout(std::time::Duration::from_secs(5));
    let pool = SqlitePoolOptions::new().max_connections(5).connect_with(options).await?;
    // WAL + NORMAL synchronous is the standard safe-fast pairing.
    sqlx::query("PRAGMA synchronous = NORMAL").execute(&pool).await?;
    Ok(pool)
}

/// Snapshot the database before applying schema changes.
/// `db_path` is the on-disk location so the snapshot lands next to it in
/// `app_data_dir`, not in the process CWD. On failure we log and continue Ã¢â‚¬â€
/// the migration is idempotent (CREATE IF NOT EXISTS), so a missing backup
/// is preferable to blocking startup.
pub async fn backup_before_migrate(pool: &SqlitePool, db_path: &std::path::Path) {
    let backup_path = db_path
        .parent()
        .map(|d| d.join("backup_pre_migrate.db"))
        .unwrap_or_else(|| std::path::PathBuf::from("backup_pre_migrate.db"));
    // SQLite's VACUUM INTO needs a literal path, so we interpolate the
    // already-dir-sanitized backup path (it is derived from app_data_dir,
    // not user input) into the SQL string.
    let escaped = backup_path.display().to_string().replace('\'', "''");
    // query() requires a 'static str; leak the owned string Ã¢â‚¬â€ one allocation
    // on a cold path (startup), never freed by design (the pool lives for the
    // lifetime of the app).
    let sql: &'static str = Box::leak(format!("VACUUM INTO '{escaped}'").into_boxed_str());
    if let Err(e) = sqlx::query(sql).execute(pool).await {
        log::warn!("Pre-migration backup failed: {e}");
    }
}

/// Schema DDL executed on startup (idempotent).
pub async fn run_migrations(pool: &SqlitePool) -> Result<(), DbError> {
    let schema = [
        "CREATE TABLE IF NOT EXISTS characters (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            system_id TEXT NOT NULL,
            profile_json TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );",
        "CREATE TABLE IF NOT EXISTS action_definitions (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            system_id TEXT NOT NULL DEFAULT '',
            definition_json TEXT NOT NULL
        );",
        "CREATE TABLE IF NOT EXISTS stat_blocks (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            system_id TEXT NOT NULL DEFAULT '',
            block_json TEXT NOT NULL
        );",
        "CREATE TABLE IF NOT EXISTS campaign_scenes (
            id TEXT PRIMARY KEY,
            scene_number INTEGER NOT NULL,
            title TEXT NOT NULL,
            chaos_factor INTEGER DEFAULT 5,
            summary_text TEXT,
            is_active BOOLEAN DEFAULT FALSE
        );",
        "CREATE TABLE IF NOT EXISTS log_entries (
            id TEXT PRIMARY KEY,
            scene_id TEXT REFERENCES campaign_scenes(id) ON DELETE CASCADE,
            speaker TEXT NOT NULL,
            content TEXT NOT NULL,
            payload_json TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        );",
        "CREATE TABLE IF NOT EXISTS loot_entries (
            id TEXT PRIMARY KEY,
            scene_id TEXT REFERENCES campaign_scenes(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            quantity INTEGER NOT NULL DEFAULT 1,
            source_entity TEXT NOT NULL DEFAULT '',
            assigned_to TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        );",
        "CREATE TABLE IF NOT EXISTS npc_notes (
            id TEXT PRIMARY KEY,
            scene_id TEXT REFERENCES campaign_scenes(id) ON DELETE CASCADE,
            npc_name TEXT NOT NULL,
            relation TEXT NOT NULL DEFAULT 'Unknown',
            note TEXT NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        );",
        "CREATE TABLE IF NOT EXISTS combat_state (
            scene_id TEXT PRIMARY KEY REFERENCES campaign_scenes(id) ON DELETE CASCADE,
            state_json TEXT NOT NULL,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );",
        "CREATE TABLE IF NOT EXISTS plot_threads (
            id TEXT PRIMARY KEY,
            description TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'open',
            opened_scene_id TEXT NOT NULL,
            resolved_scene_id TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );",
        "CREATE TABLE IF NOT EXISTS npc_characters (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            drive TEXT,
            leverage TEXT,
            flaw TEXT,
            flaw_revealed BOOLEAN NOT NULL DEFAULT FALSE,
            disposition TEXT NOT NULL DEFAULT 'neutral',
            alive BOOLEAN NOT NULL DEFAULT TRUE,
            location TEXT,
            knows_json TEXT NOT NULL DEFAULT '[]',
            notes TEXT,
            last_seen_scene_id TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );",
        "CREATE TABLE IF NOT EXISTS campaign_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );",
        "CREATE TABLE IF NOT EXISTS doom_clocks (
            id TEXT PRIMARY KEY,
            label TEXT NOT NULL,
            tick_current INTEGER NOT NULL,
            tick_max INTEGER NOT NULL,
            consequence TEXT NOT NULL,
            scene_id TEXT,
            active BOOLEAN NOT NULL DEFAULT TRUE,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );",
        "CREATE TABLE IF NOT EXISTS exploration_zones (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            zone_type TEXT NOT NULL,
            description TEXT,
            danger_level INTEGER NOT NULL DEFAULT 0,
            mapped BOOLEAN NOT NULL DEFAULT FALSE,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );",
        "CREATE TABLE IF NOT EXISTS exploration_nodes (
            id TEXT PRIMARY KEY,
            zone_id TEXT NOT NULL REFERENCES exploration_zones(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            discovered BOOLEAN NOT NULL DEFAULT FALSE,
            safe BOOLEAN NOT NULL DEFAULT FALSE,
            description TEXT,
            connections_json TEXT NOT NULL DEFAULT '[]',
            contents_json TEXT NOT NULL DEFAULT '[]',
            notes TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );",
        "CREATE TABLE IF NOT EXISTS memory_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            speaker TEXT NOT NULL,
            content TEXT NOT NULL,
            seq INTEGER
        );",
        "CREATE TABLE IF NOT EXISTS stream_checkpoints (
            id TEXT PRIMARY KEY,
            content TEXT NOT NULL,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );",
        "CREATE TABLE IF NOT EXISTS episodic_summaries (
            id TEXT PRIMARY KEY,
            scene_id TEXT NOT NULL REFERENCES campaign_scenes(id) ON DELETE CASCADE,
            summary TEXT NOT NULL,
            last_log_id TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );",
        // Indexes for hot query paths (idempotent).
        "CREATE INDEX IF NOT EXISTS idx_log_entries_scene_ts ON log_entries(scene_id, timestamp);",
        "CREATE INDEX IF NOT EXISTS idx_loot_entries_scene ON loot_entries(scene_id);",
        "CREATE INDEX IF NOT EXISTS idx_npc_notes_scene ON npc_notes(scene_id);",
        "CREATE INDEX IF NOT EXISTS idx_exploration_nodes_zone ON exploration_nodes(zone_id);",
        "CREATE INDEX IF NOT EXISTS idx_plot_threads_status ON plot_threads(status);",
        "CREATE INDEX IF NOT EXISTS idx_scenes_active ON campaign_scenes(is_active);",
        "CREATE INDEX IF NOT EXISTS idx_episodic_summaries_scene ON episodic_summaries(scene_id);",
    ];
    let mut tx = pool.begin().await?;
    for stmt in schema {
        sqlx::query(stmt).execute(&mut *tx).await?;
    }
    tx.commit().await?;
    Ok(())
}

impl Repository for SqliteRepository {
    async fn save_character(&self, profile: &CharacterProfile) -> Result<(), DbError> {
        let profile_json = serde_json::to_string(profile)?;
        sqlx::query(
            "INSERT INTO characters (id, name, system_id, profile_json)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               name = excluded.name,
               system_id = excluded.system_id,
               profile_json = excluded.profile_json",
        )
        .bind(&profile.id)
        .bind(&profile.identity.name)
        .bind(&profile.system_id)
        .bind(&profile_json)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn load_character(&self, id: &str) -> Result<CharacterProfile, DbError> {
        let row =
            sqlx::query_as::<Sqlite, (String,)>("SELECT profile_json FROM characters WHERE id = ?")
                .bind(id)
                .fetch_optional(&self.pool)
                .await?;
        match row {
            Some((json,)) => Ok(serde_json::from_str(&json)?),
            None => Err(DbError::NotFound(format!("character `{id}`"))),
        }
    }

    async fn list_characters(&self) -> Result<Vec<CharacterProfile>, DbError> {
        let rows: Vec<(String,)> =
            sqlx::query_as("SELECT profile_json FROM characters ORDER BY created_at")
                .fetch_all(&self.pool)
                .await?;
        rows.into_iter().map(|(json,)| serde_json::from_str(&json).map_err(DbError::Json)).collect()
    }

    async fn delete_character(&self, id: &str) -> Result<bool, DbError> {
        let res =
            sqlx::query("DELETE FROM characters WHERE id = ?").bind(id).execute(&self.pool).await?;
        Ok(res.rows_affected() > 0)
    }

    async fn save_action(&self, action: &ActionDefinition) -> Result<(), DbError> {
        let json = serde_json::to_string(action)?;
        sqlx::query(
            "INSERT INTO action_definitions (id, name, system_id, definition_json)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               name = excluded.name,
               definition_json = excluded.definition_json",
        )
        .bind(&action.id)
        .bind(&action.name)
        .bind("")
        .bind(&json)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn load_action(&self, id: &str) -> Result<Option<ActionDefinition>, DbError> {
        let row = sqlx::query_as::<Sqlite, (String,)>(
            "SELECT definition_json FROM action_definitions WHERE id = ?",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?;
        match row {
            Some((json,)) => Ok(Some(serde_json::from_str(&json)?)),
            None => Ok(None),
        }
    }

    async fn list_actions(&self) -> Result<Vec<ActionDefinition>, DbError> {
        let rows: Vec<(String,)> =
            sqlx::query_as("SELECT definition_json FROM action_definitions ORDER BY name")
                .fetch_all(&self.pool)
                .await?;
        rows.into_iter().map(|(json,)| serde_json::from_str(&json).map_err(DbError::Json)).collect()
    }

    async fn delete_action(&self, id: &str) -> Result<bool, DbError> {
        let res = sqlx::query("DELETE FROM action_definitions WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(res.rows_affected() > 0)
    }

    async fn save_stat_block(&self, sb: &EncounterStatBlock) -> Result<(), DbError> {
        let json = serde_json::to_string(sb)?;
        sqlx::query(
            "INSERT INTO stat_blocks (id, name, system_id, block_json)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               name = excluded.name,
               block_json = excluded.block_json",
        )
        .bind(&sb.id)
        .bind(&sb.name)
        .bind("")
        .bind(&json)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn load_stat_block(&self, id: &str) -> Result<Option<EncounterStatBlock>, DbError> {
        let row =
            sqlx::query_as::<Sqlite, (String,)>("SELECT block_json FROM stat_blocks WHERE id = ?")
                .bind(id)
                .fetch_optional(&self.pool)
                .await?;
        match row {
            Some((json,)) => Ok(Some(serde_json::from_str(&json)?)),
            None => Ok(None),
        }
    }

    async fn list_stat_blocks(&self) -> Result<Vec<EncounterStatBlock>, DbError> {
        let rows: Vec<(String,)> =
            sqlx::query_as("SELECT block_json FROM stat_blocks ORDER BY name")
                .fetch_all(&self.pool)
                .await?;
        rows.into_iter().map(|(json,)| serde_json::from_str(&json).map_err(DbError::Json)).collect()
    }

    async fn delete_stat_block(&self, id: &str) -> Result<bool, DbError> {
        let res = sqlx::query("DELETE FROM stat_blocks WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(res.rows_affected() > 0)
    }

    async fn create_scene(&self, title: &str, chaos_factor: i32) -> Result<Scene, DbError> {
        let id = Uuid::new_v4().to_string();
        let scene_number: i32 =
            sqlx::query_scalar("SELECT COALESCE(MAX(scene_number), 0) + 1 FROM campaign_scenes")
                .fetch_one(&self.pool)
                .await?;
        sqlx::query(
            "INSERT INTO campaign_scenes (id, scene_number, title, chaos_factor, summary_text, is_active)
             VALUES (?, ?, ?, ?, NULL, ?)",
        )
        .bind(&id)
        .bind(scene_number)
        .bind(title)
        .bind(chaos_factor.clamp(1, 9))
        .bind(false)
        .execute(&self.pool)
        .await?;
        Ok(Scene {
            id,
            scene_number,
            title: title.to_string(),
            chaos_factor: chaos_factor.clamp(1, 9),
            summary_text: None,
            is_active: false,
        })
    }

    async fn list_scenes(&self) -> Result<Vec<Scene>, DbError> {
        let rows: Vec<(String, i32, String, i32, Option<String>, i32)> = sqlx::query_as(
            "SELECT id, scene_number, title, chaos_factor, summary_text, is_active
             FROM campaign_scenes ORDER BY scene_number",
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|(id, scene_number, title, chaos_factor, summary_text, is_active)| Scene {
                id,
                scene_number,
                title,
                chaos_factor,
                summary_text,
                is_active: is_active != 0,
            })
            .collect())
    }

    async fn active_scene(&self) -> Result<Option<Scene>, DbError> {
        let row = sqlx::query_as::<Sqlite, (String, i32, String, i32, Option<String>)>(
            "SELECT id, scene_number, title, chaos_factor, summary_text
             FROM campaign_scenes WHERE is_active = 1 LIMIT 1",
        )
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(|(id, scene_number, title, chaos_factor, summary_text)| Scene {
            id,
            scene_number,
            title,
            chaos_factor,
            summary_text,
            is_active: true,
        }))
    }

    async fn set_active_scene(&self, id: &str) -> Result<(), DbError> {
        let exists: bool =
            sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM campaign_scenes WHERE id = ?)")
                .bind(id)
                .fetch_one(&self.pool)
                .await?;
        if !exists {
            return Err(DbError::NotFound(format!("scene `{id}`")));
        }
        let mut tx = self.pool.begin().await?;
        sqlx::query("UPDATE campaign_scenes SET is_active = 0").execute(&mut *tx).await?;
        sqlx::query("UPDATE campaign_scenes SET is_active = 1 WHERE id = ?")
            .bind(id)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        Ok(())
    }

    async fn delete_scene(&self, id: &str) -> Result<bool, DbError> {
        let res = sqlx::query("DELETE FROM campaign_scenes WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(res.rows_affected() > 0)
    }

    async fn update_scene_summary(&self, id: &str, summary: Option<&str>) -> Result<(), DbError> {
        sqlx::query("UPDATE campaign_scenes SET summary_text = ? WHERE id = ?")
            .bind(summary)
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn update_scene_chaos_factor(&self, id: &str, chaos_factor: i32) -> Result<(), DbError> {
        sqlx::query("UPDATE campaign_scenes SET chaos_factor = ? WHERE id = ?")
            .bind(chaos_factor)
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn get_scene_summary(&self, id: &str) -> Result<Option<String>, DbError> {
        let row: Option<(Option<String>,)> =
            sqlx::query_as("SELECT summary_text FROM campaign_scenes WHERE id = ?")
                .bind(id)
                .fetch_optional(&self.pool)
                .await?;
        Ok(row.and_then(|(s,)| s))
    }

    async fn append_log(
        &self,
        scene_id: &str,
        speaker: &str,
        content: &str,
        payload: Option<Value>,
    ) -> Result<LogEntry, DbError> {
        let id = Uuid::new_v4().to_string();
        let payload_json = payload.as_ref().map(|v| v.to_string());
        let timestamp = Utc::now().to_rfc3339();
        sqlx::query(
            "INSERT INTO log_entries (id, scene_id, speaker, content, payload_json, timestamp)
             VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(scene_id)
        .bind(speaker)
        .bind(content)
        .bind(&payload_json)
        .bind(&timestamp)
        .execute(&self.pool)
        .await?;
        Ok(LogEntry {
            id,
            scene_id: Some(scene_id.to_string()),
            speaker: speaker.to_string(),
            content: content.to_string(),
            payload,
            timestamp,
        })
    }

    async fn list_logs(&self, scene_id: &str, limit: i64) -> Result<Vec<LogEntry>, DbError> {
        let rows: Vec<(String, String, String, Option<String>, String)> = sqlx::query_as(
            "SELECT id, speaker, content, payload_json, timestamp
             FROM log_entries WHERE scene_id = ? ORDER BY timestamp ASC LIMIT ?",
        )
        .bind(scene_id)
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter()
            .map(|(id, speaker, content, payload_json, timestamp)| {
                let payload = match payload_json {
                    Some(j) => Some(serde_json::from_str(&j).map_err(DbError::Json)?),
                    None => None,
                };
                Ok(LogEntry {
                    id,
                    scene_id: Some(scene_id.to_string()),
                    speaker,
                    content,
                    payload,
                    timestamp,
                })
            })
            .collect()
    }

    async fn export_campaign(&self) -> Result<CampaignExport, DbError> {
        let characters = self.list_characters().await?;
        let actions = self.list_actions().await?;
        let stat_blocks = self.list_stat_blocks().await?;
        let scenes = self.list_scenes().await?;
        // Bulk fetches instead of per-scene loops (avoids N+1 round-trips).
        let log_rows: Vec<(String, String, String, String, Option<String>, String)> =
            sqlx::query_as(
                "SELECT id, COALESCE(scene_id, ''), speaker, content, payload_json, timestamp
             FROM log_entries ORDER BY timestamp ASC",
            )
            .fetch_all(&self.pool)
            .await?;
        let logs: Vec<LogEntry> = log_rows
            .into_iter()
            .map(|(id, scene_id, speaker, content, payload_json, timestamp)| {
                let payload = match payload_json {
                    Some(j) => Some(serde_json::from_str(&j).map_err(DbError::Json)?),
                    None => None,
                };
                Ok(LogEntry {
                    id,
                    scene_id: Some(scene_id).filter(|s| !s.is_empty()),
                    speaker,
                    content,
                    payload,
                    timestamp,
                })
            })
            .collect::<Result<_, DbError>>()?;
        let all_loot: Vec<LootRow> = sqlx::query_as(
            "SELECT id, COALESCE(scene_id, ''), name, quantity, source_entity, assigned_to, timestamp
             FROM loot_entries ORDER BY timestamp ASC",
        )
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .map(
            |(id, scene_id, name, quantity, source_entity, assigned_to, timestamp)| LootRow {
                id,
                scene_id,
                name,
                quantity,
                source_entity,
                assigned_to,
                timestamp,
            },
        )
        .collect();
        let all_notes: Vec<NpcNoteRow> = sqlx::query_as(
            "SELECT id, COALESCE(scene_id, ''), npc_name, relation, note, timestamp
             FROM npc_notes ORDER BY timestamp ASC",
        )
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .map(|(id, scene_id, npc_name, relation, note, timestamp)| NpcNoteRow {
            id,
            scene_id,
            npc_name,
            relation,
            note,
            timestamp,
        })
        .collect();
        let plot_threads = self.list_threads().await.unwrap_or_default();
        let npc_characters = self.list_npc_characters().await.unwrap_or_default();
        Ok(CampaignExport {
            characters,
            actions,
            stat_blocks,
            scenes,
            logs,
            loot: all_loot,
            npc_notes: all_notes,
            plot_threads,
            npc_characters,
        })
    }

    async fn import_campaign(&self, data: &CampaignExport) -> Result<(), DbError> {
        // Single transaction: an import either fully lands or fully rolls back.
        let mut tx = self.pool.begin().await?;

        for c in &data.characters {
            let profile_json = serde_json::to_string(c)?;
            sqlx::query(
                "INSERT INTO characters (id, name, system_id, profile_json)
                 VALUES (?, ?, ?, ?)
                 ON CONFLICT(id) DO UPDATE SET
                   name = excluded.name,
                   system_id = excluded.system_id,
                   profile_json = excluded.profile_json",
            )
            .bind(&c.id)
            .bind(&c.identity.name)
            .bind(&c.system_id)
            .bind(&profile_json)
            .execute(&mut *tx)
            .await?;
        }
        for a in &data.actions {
            let definition_json = serde_json::to_string(a)?;
            sqlx::query(
                "INSERT INTO action_definitions (id, name, system_id, definition_json)
                 VALUES (?, ?, ?, ?)
                 ON CONFLICT(id) DO UPDATE SET
                   name = excluded.name,
                   system_id = excluded.system_id,
                   definition_json = excluded.definition_json",
            )
            .bind(&a.id)
            .bind(&a.name)
            .bind("")
            .bind(&definition_json)
            .execute(&mut *tx)
            .await?;
        }
        for b in &data.stat_blocks {
            let block_json = serde_json::to_string(b)?;
            sqlx::query(
                "INSERT INTO stat_blocks (id, name, system_id, block_json)
                 VALUES (?, ?, ?, ?)
                 ON CONFLICT(id) DO UPDATE SET
                   name = excluded.name,
                   system_id = excluded.system_id,
                   block_json = excluded.block_json",
            )
            .bind(&b.id)
            .bind(&b.name)
            .bind("")
            .bind(&block_json)
            .execute(&mut *tx)
            .await?;
        }
        for s in &data.scenes {
            sqlx::query(
                "INSERT INTO campaign_scenes (id, scene_number, title, chaos_factor, summary_text, is_active)
                 VALUES (?, ?, ?, ?, ?, ?)
                 ON CONFLICT(id) DO UPDATE SET
                   title = excluded.title,
                   chaos_factor = excluded.chaos_factor,
                   summary_text = excluded.summary_text,
                   is_active = excluded.is_active",
            )
            .bind(&s.id)
            .bind(s.scene_number)
            .bind(&s.title)
            .bind(s.chaos_factor)
            .bind(&s.summary_text)
            .bind(s.is_active)
            .execute(&mut *tx)
            .await?;
        }
        // Re-insert logs with their original IDs and timestamps so replayed
        // history keeps its ordering and identity.
        for l in &data.logs {
            let sid = l.scene_id.as_deref().unwrap_or("");
            sqlx::query(
                "INSERT INTO log_entries (id, scene_id, speaker, content, payload_json, timestamp)
                 VALUES (?, ?, ?, ?, ?, ?)
                 ON CONFLICT(id) DO UPDATE SET
                   speaker = excluded.speaker,
                   content = excluded.content,
                   payload_json = excluded.payload_json,
                   timestamp = excluded.timestamp",
            )
            .bind(&l.id)
            .bind(sid)
            .bind(&l.speaker)
            .bind(&l.content)
            .bind(l.payload.as_ref().map(|v| v.to_string()))
            .bind(&l.timestamp)
            .execute(&mut *tx)
            .await?;
        }
        // Import loot
        for loot in &data.loot {
            sqlx::query(
                "INSERT INTO loot_entries (id, scene_id, name, quantity, source_entity, assigned_to, timestamp)
                 VALUES (?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(id) DO UPDATE SET
                   name = excluded.name,
                   quantity = excluded.quantity,
                   source_entity = excluded.source_entity,
                   assigned_to = excluded.assigned_to",
            )
            .bind(&loot.id)
            .bind(&loot.scene_id)
            .bind(&loot.name)
            .bind(loot.quantity)
            .bind(&loot.source_entity)
            .bind(&loot.assigned_to)
            .bind(&loot.timestamp)
            .execute(&mut *tx)
            .await?;
        }
        // Import NPC notes
        for note in &data.npc_notes {
            sqlx::query(
                "INSERT INTO npc_notes (id, scene_id, npc_name, relation, note, timestamp)
                 VALUES (?, ?, ?, ?, ?, ?)
                 ON CONFLICT(id) DO UPDATE SET
                   npc_name = excluded.npc_name,
                   relation = excluded.relation,
                   note = excluded.note,
                   timestamp = excluded.timestamp",
            )
            .bind(&note.id)
            .bind(&note.scene_id)
            .bind(&note.npc_name)
            .bind(&note.relation)
            .bind(&note.note)
            .bind(&note.timestamp)
            .execute(&mut *tx)
            .await?;
        }
        // Import plot threads
        for thread in &data.plot_threads {
            sqlx::query(
                "INSERT INTO plot_threads (id, description, status, opened_scene_id, resolved_scene_id, created_at)
                 VALUES (?, ?, ?, ?, ?, ?)
                 ON CONFLICT(id) DO UPDATE SET
                   description = excluded.description,
                   status = excluded.status,
                   resolved_scene_id = excluded.resolved_scene_id",
            )
            .bind(&thread.id)
            .bind(&thread.description)
            .bind(&thread.status)
            .bind(&thread.opened_scene_id)
            .bind(&thread.resolved_scene_id)
            .bind(&thread.created_at)
            .execute(&mut *tx)
            .await?;
        }
        // Import NPC characters
        for npc in &data.npc_characters {
            sqlx::query(
                "INSERT INTO npc_characters (id, name, disposition, alive, location, knows_json, notes, last_seen_scene_id, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(id) DO UPDATE SET
                   name = excluded.name,
                   disposition = excluded.disposition,
                   alive = excluded.alive,
                   location = excluded.location,
                   knows_json = excluded.knows_json,
                   notes = excluded.notes,
                   last_seen_scene_id = excluded.last_seen_scene_id,
                   drive = excluded.drive,
                   leverage = excluded.leverage,
                   flaw = excluded.flaw,
                   flaw_revealed = excluded.flaw_revealed",
            )
            .bind(&npc.id)
            .bind(&npc.name)
            .bind(&npc.disposition)
            .bind(npc.alive)
            .bind(&npc.location)
            .bind(&npc.knows_json)
            .bind(&npc.notes)
            .bind(&npc.last_seen_scene_id)
            .bind(&npc.drive)
            .bind(&npc.leverage)
            .bind(&npc.flaw)
            .bind(npc.flaw_revealed)
            .bind(&npc.created_at)
            .execute(&mut *tx)
            .await?;
        }

        tx.commit().await?;
        Ok(())
    }

    // ---- Loot ----

    async fn save_loot(
        &self,
        scene_id: &str,
        name: &str,
        quantity: i32,
        source_entity: &str,
    ) -> Result<LootRow, DbError> {
        let id = Uuid::new_v4().to_string();
        let timestamp = Utc::now().to_rfc3339();
        sqlx::query(
            "INSERT INTO loot_entries (id, scene_id, name, quantity, source_entity, assigned_to, timestamp)
             VALUES (?, ?, ?, ?, ?, NULL, ?)",
        )
        .bind(&id)
        .bind(scene_id)
        .bind(name)
        .bind(quantity)
        .bind(source_entity)
        .bind(&timestamp)
        .execute(&self.pool)
        .await?;
        Ok(LootRow {
            id,
            scene_id: scene_id.to_string(),
            name: name.to_string(),
            quantity,
            source_entity: source_entity.to_string(),
            assigned_to: None,
            timestamp,
        })
    }

    async fn assign_loot(&self, loot_id: &str, character_id: &str) -> Result<(), DbError> {
        sqlx::query("UPDATE loot_entries SET assigned_to = ? WHERE id = ?")
            .bind(character_id)
            .bind(loot_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn list_loot(&self, scene_id: &str) -> Result<Vec<LootRow>, DbError> {
        let rows: Vec<(String, String, i32, String, Option<String>, String)> = sqlx::query_as(
            "SELECT id, name, quantity, source_entity, assigned_to, timestamp
             FROM loot_entries WHERE scene_id = ? ORDER BY timestamp ASC",
        )
        .bind(scene_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|(id, name, quantity, source_entity, assigned_to, timestamp)| LootRow {
                id,
                scene_id: scene_id.to_string(),
                name,
                quantity,
                source_entity,
                assigned_to,
                timestamp,
            })
            .collect())
    }

    async fn clear_loot(&self, scene_id: &str) -> Result<(), DbError> {
        sqlx::query("DELETE FROM loot_entries WHERE scene_id = ?")
            .bind(scene_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    // ---- NPC Notes ----

    async fn save_npc_note(
        &self,
        scene_id: &str,
        npc_name: &str,
        relation: &str,
        note: &str,
    ) -> Result<NpcNoteRow, DbError> {
        let id = Uuid::new_v4().to_string();
        let timestamp = Utc::now().to_rfc3339();
        sqlx::query(
            "INSERT INTO npc_notes (id, scene_id, npc_name, relation, note, timestamp)
             VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(scene_id)
        .bind(npc_name)
        .bind(relation)
        .bind(note)
        .bind(&timestamp)
        .execute(&self.pool)
        .await?;
        Ok(NpcNoteRow {
            id,
            scene_id: scene_id.to_string(),
            npc_name: npc_name.to_string(),
            relation: relation.to_string(),
            note: note.to_string(),
            timestamp,
        })
    }

    async fn list_npc_notes(&self, scene_id: &str) -> Result<Vec<NpcNoteRow>, DbError> {
        let rows: Vec<(String, String, String, String, String)> = sqlx::query_as(
            "SELECT id, npc_name, relation, note, timestamp
             FROM npc_notes WHERE scene_id = ? ORDER BY timestamp ASC",
        )
        .bind(scene_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|(id, npc_name, relation, note, timestamp)| NpcNoteRow {
                id,
                scene_id: scene_id.to_string(),
                npc_name,
                relation,
                note,
                timestamp,
            })
            .collect())
    }

    async fn delete_npc_note(&self, id: &str) -> Result<bool, DbError> {
        let res =
            sqlx::query("DELETE FROM npc_notes WHERE id = ?").bind(id).execute(&self.pool).await?;
        Ok(res.rows_affected() > 0)
    }

    // ---- Combat State ----

    async fn save_combat_state(&self, scene_id: &str, state_json: &str) -> Result<(), DbError> {
        let timestamp = Utc::now().to_rfc3339();
        sqlx::query(
            "INSERT INTO combat_state (scene_id, state_json, updated_at)
             VALUES (?, ?, ?)
             ON CONFLICT(scene_id) DO UPDATE SET
               state_json = excluded.state_json,
               updated_at = excluded.updated_at",
        )
        .bind(scene_id)
        .bind(state_json)
        .bind(&timestamp)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn load_combat_state(&self, scene_id: &str) -> Result<Option<String>, DbError> {
        let row: Option<(String,)> =
            sqlx::query_as("SELECT state_json FROM combat_state WHERE scene_id = ?")
                .bind(scene_id)
                .fetch_optional(&self.pool)
                .await?;
        Ok(row.map(|(json,)| json))
    }

    // Ã¢â€â‚¬Ã¢â€â‚¬ DM Memory Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

    async fn append_memory(&self, speaker: &str, content: &str) -> Result<(), DbError> {
        sqlx::query("INSERT INTO memory_events (speaker, content) VALUES (?, ?)")
            .bind(speaker)
            .bind(content)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn list_memory(&self, limit: i64) -> Result<Vec<(String, String)>, DbError> {
        let rows: Vec<(String, String)> = sqlx::query_as(
            "SELECT speaker, content FROM (
                 SELECT id, speaker, content FROM memory_events ORDER BY id DESC LIMIT ?
             ) ORDER BY id ASC",
        )
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows)
    }

    // Ã¢â€â‚¬Ã¢â€â‚¬ Streaming checkpoints Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

    async fn save_stream_checkpoint(&self, id: &str, content: &str) -> Result<(), DbError> {
        sqlx::query(
            "INSERT INTO stream_checkpoints (id, content, updated_at)
             VALUES (?, ?, CURRENT_TIMESTAMP)
             ON CONFLICT(id) DO UPDATE SET content = excluded.content, updated_at = CURRENT_TIMESTAMP",
        )
        .bind(id)
        .bind(content)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn load_stream_checkpoint(&self, id: &str) -> Result<Option<String>, DbError> {
        let row: Option<(String,)> =
            sqlx::query_as("SELECT content FROM stream_checkpoints WHERE id = ?")
                .bind(id)
                .fetch_optional(&self.pool)
                .await?;
        Ok(row.map(|(c,)| c))
    }

    async fn clear_stream_checkpoint(&self, id: &str) -> Result<(), DbError> {
        sqlx::query("DELETE FROM stream_checkpoints WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    // ── Episodic summaries ─────────────────────────────────────────

    async fn save_episodic_summary(
        &self,
        scene_id: &str,
        summary: &str,
        last_log_id: &str,
    ) -> Result<EpisodicSummary, DbError> {
        let id = uuid::Uuid::new_v4().to_string();
        let created_at = chrono::Utc::now().to_rfc3339();
        sqlx::query(
            "INSERT INTO episodic_summaries (id, scene_id, summary, last_log_id, created_at)
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(scene_id)
        .bind(summary)
        .bind(last_log_id)
        .bind(&created_at)
        .execute(&self.pool)
        .await?;
        Ok(EpisodicSummary { id, scene_id: scene_id.to_string(), summary: summary.to_string(), last_log_id: last_log_id.to_string(), created_at })
    }

    async fn list_episodic_summaries(&self, scene_id: &str) -> Result<Vec<EpisodicSummary>, DbError> {
        let rows: Vec<(String, String, String, String, String)> = sqlx::query_as(
            "SELECT id, scene_id, summary, last_log_id, created_at FROM episodic_summaries WHERE scene_id = ? ORDER BY created_at ASC",
        )
        .bind(scene_id)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().map(|(id, scene_id, summary, last_log_id, created_at)| EpisodicSummary { id, scene_id, summary, last_log_id, created_at }).collect())
    }

    async fn delete_episodic_summary(&self, id: &str) -> Result<bool, DbError> {
        let r = sqlx::query("DELETE FROM episodic_summaries WHERE id = ?").bind(id).execute(&self.pool).await?;
        Ok(r.rows_affected() > 0)
    }

    // Ã¢â€â‚¬Ã¢â€â‚¬ Plot Threads Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

    async fn save_thread(
        &self,
        description: &str,
        status: &str,
        opened_scene_id: &str,
        resolved_scene_id: Option<&str>,
    ) -> Result<ThreadRow, DbError> {
        let id = uuid::Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO plot_threads (id, description, status, opened_scene_id, resolved_scene_id)
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(description)
        .bind(status)
        .bind(opened_scene_id)
        .bind(resolved_scene_id)
        .execute(&self.pool)
        .await?;
        Ok(ThreadRow {
            id,
            description: description.to_string(),
            status: status.to_string(),
            opened_scene_id: opened_scene_id.to_string(),
            resolved_scene_id: resolved_scene_id.map(|s| s.to_string()),
            created_at: chrono::Utc::now().to_rfc3339(),
        })
    }

    async fn update_thread_status(
        &self,
        id: &str,
        status: &str,
        resolved_scene_id: Option<&str>,
    ) -> Result<(), DbError> {
        sqlx::query("UPDATE plot_threads SET status = ?, resolved_scene_id = ? WHERE id = ?")
            .bind(status)
            .bind(resolved_scene_id)
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn list_threads(&self) -> Result<Vec<ThreadRow>, DbError> {
        let rows: Vec<(String, String, String, String, Option<String>, String)> = sqlx::query_as(
            "SELECT id, description, status, opened_scene_id, resolved_scene_id, created_at
             FROM plot_threads ORDER BY created_at ASC",
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|(id, description, status, opened_scene_id, resolved_scene_id, created_at)| {
                ThreadRow {
                    id,
                    description,
                    status,
                    opened_scene_id,
                    resolved_scene_id,
                    created_at,
                }
            })
            .collect())
    }

    async fn delete_thread(&self, id: &str) -> Result<bool, DbError> {
        let r = sqlx::query("DELETE FROM plot_threads WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(r.rows_affected() > 0)
    }

    // Ã¢â€â‚¬Ã¢â€â‚¬ NPC Characters Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

    #[allow(clippy::too_many_arguments)]
    async fn save_npc_character(
        &self,
        name: &str,
        disposition: &str,
        alive: bool,
        location: Option<&str>,
        knows_json: &str,
        notes: Option<&str>,
        last_seen_scene_id: Option<&str>,
        drive: Option<&str>,
        leverage: Option<&str>,
        flaw: Option<&str>,
        flaw_revealed: bool,
    ) -> Result<NpcCharacterRow, DbError> {
        let id = uuid::Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO npc_characters (id, name, disposition, alive, location, knows_json, notes, last_seen_scene_id, drive, leverage, flaw, flaw_revealed)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(name)
        .bind(disposition)
        .bind(alive)
        .bind(location)
        .bind(knows_json)
        .bind(notes)
        .bind(last_seen_scene_id)
        .bind(drive)
        .bind(leverage)
        .bind(flaw)
        .bind(flaw_revealed)
        .execute(&self.pool)
        .await?;
        Ok(NpcCharacterRow {
            id,
            name: name.to_string(),
            drive: drive.map(|s| s.to_string()),
            leverage: leverage.map(|s| s.to_string()),
            flaw: flaw.map(|s| s.to_string()),
            flaw_revealed,
            disposition: disposition.to_string(),
            alive,
            location: location.map(|s| s.to_string()),
            knows_json: knows_json.to_string(),
            notes: notes.map(|s| s.to_string()),
            last_seen_scene_id: last_seen_scene_id.map(|s| s.to_string()),
            created_at: chrono::Utc::now().to_rfc3339(),
        })
    }

    #[allow(clippy::too_many_arguments)]
    async fn update_npc_character(
        &self,
        id: &str,
        disposition: Option<&str>,
        alive: Option<bool>,
        location: Option<&str>,
        knows_json: Option<&str>,
        notes: Option<&str>,
        last_seen_scene_id: Option<&str>,
    ) -> Result<(), DbError> {
        sqlx::query(
            "UPDATE npc_characters SET
                disposition = COALESCE(?, disposition),
                alive = COALESCE(?, alive),
                location = COALESCE(?, location),
                knows_json = COALESCE(?, knows_json),
                notes = COALESCE(?, notes),
                last_seen_scene_id = COALESCE(?, last_seen_scene_id)
             WHERE id = ?",
        )
        .bind(disposition)
        .bind(alive)
        .bind(location)
        .bind(knows_json)
        .bind(notes)
        .bind(last_seen_scene_id)
        .bind(id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn update_npc_pillars(
        &self,
        id: &str,
        drive: Option<&str>,
        leverage: Option<&str>,
        flaw: Option<&str>,
    ) -> Result<(), DbError> {
        sqlx::query(
            "UPDATE npc_characters SET
                drive = COALESCE(?, drive),
                leverage = COALESCE(?, leverage),
                flaw = COALESCE(?, flaw)
             WHERE id = ?",
        )
        .bind(drive)
        .bind(leverage)
        .bind(flaw)
        .bind(id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn reveal_flaw(&self, id: &str) -> Result<(), DbError> {
        sqlx::query("UPDATE npc_characters SET flaw_revealed = TRUE WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn list_npc_characters(&self) -> Result<Vec<NpcCharacterRow>, DbError> {
        type NpcRow = (
            String,
            String,
            String,
            bool,
            Option<String>,
            String,
            Option<String>,
            Option<String>,
            String,
            String,
            String,
            String,
            bool,
        );
        let rows: Vec<NpcRow> = sqlx::query_as(
            "SELECT id, name, disposition, alive, location, knows_json, notes, last_seen_scene_id, created_at,
                    COALESCE(drive, ''), COALESCE(leverage, ''), COALESCE(flaw, ''), COALESCE(flaw_revealed, FALSE)
             FROM npc_characters ORDER BY created_at ASC",
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(
                |(
                    id,
                    name,
                    disposition,
                    alive,
                    location,
                    knows_json,
                    notes,
                    last_seen_scene_id,
                    created_at,
                    drive,
                    leverage,
                    flaw,
                    flaw_revealed,
                )| {
                    NpcCharacterRow {
                        id,
                        name,
                        drive: if drive.is_empty() { None } else { Some(drive) },
                        leverage: if leverage.is_empty() { None } else { Some(leverage) },
                        flaw: if flaw.is_empty() { None } else { Some(flaw) },
                        flaw_revealed,
                        disposition,
                        alive,
                        location,
                        knows_json,
                        notes,
                        last_seen_scene_id,
                        created_at,
                    }
                },
            )
            .collect())
    }

    async fn delete_npc_character(&self, id: &str) -> Result<bool, DbError> {
        let r = sqlx::query("DELETE FROM npc_characters WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(r.rows_affected() > 0)
    }

    // Ã¢â€â‚¬Ã¢â€â‚¬ Campaign Settings Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

    async fn get_setting(&self, key: &str) -> Result<Option<String>, DbError> {
        let row: Option<(String,)> =
            sqlx::query_as("SELECT value FROM campaign_settings WHERE key = ?")
                .bind(key)
                .fetch_optional(&self.pool)
                .await?;
        Ok(row.map(|(v,)| v))
    }

    async fn set_setting(&self, key: &str, value: &str) -> Result<(), DbError> {
        sqlx::query(
            "INSERT INTO campaign_settings (key, value) VALUES (?, ?)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        )
        .bind(key)
        .bind(value)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    // Ã¢â€â‚¬Ã¢â€â‚¬ Doom Clocks Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

    async fn save_doom_clock(
        &self,
        id: &str,
        label: &str,
        max: u32,
        consequence: &str,
        scene_id: Option<&str>,
    ) -> Result<(), DbError> {
        sqlx::query(
            "INSERT INTO doom_clocks (id, label, tick_current, tick_max, consequence, scene_id, active)
             VALUES (?, ?, ?, ?, ?, ?, TRUE)",
        )
        .bind(id)
        .bind(label)
        .bind(max as i64)
        .bind(max as i64)
        .bind(consequence)
        .bind(scene_id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn list_doom_clocks(&self) -> Result<Vec<DoomClockRow>, DbError> {
        let rows = sqlx::query("SELECT id, label, tick_current, tick_max, consequence, scene_id, active, created_at FROM doom_clocks ORDER BY created_at")
            .fetch_all(&self.pool)
            .await?;
        Ok(rows
            .into_iter()
            .map(|row| {
                let raw_tick_current: i32 = row.try_get("tick_current").unwrap_or(0);
                let raw_max: i32 = row.try_get("tick_max").unwrap_or(0);
                DoomClockRow {
                    id: row.try_get("id").unwrap_or_default(),
                    label: row.try_get("label").unwrap_or_default(),
                    current: raw_tick_current as u32,
                    max: raw_max as u32,
                    consequence: row.try_get("consequence").unwrap_or_default(),
                    scene_id: row.try_get("scene_id").ok().flatten(),
                    active: row.try_get("active").unwrap_or(true),
                    created_at: row.try_get("created_at").unwrap_or_default(),
                }
            })
            .collect())
    }

    async fn tick_doom_clock(&self, id: &str) -> Result<Option<(u32, u32)>, DbError> {
        sqlx::query("UPDATE doom_clocks SET tick_current = MAX(0, tick_current - 1) WHERE id = ? AND active = TRUE AND tick_current > 0")
            .bind(id)
            .execute(&self.pool)
            .await?;
        let row = sqlx::query("SELECT tick_current, tick_max FROM doom_clocks WHERE id = ?")
            .bind(id)
            .fetch_optional(&self.pool)
            .await?;
        Ok(row.map(|r| {
            let c: i64 = r.try_get("tick_current").unwrap_or(0);
            let m: i64 = r.try_get("tick_max").unwrap_or(0);
            (c as u32, m as u32)
        }))
    }

    async fn advance_doom_clock(
        &self,
        id: &str,
        ticks: u32,
    ) -> Result<Option<(u32, u32)>, DbError> {
        sqlx::query("UPDATE doom_clocks SET tick_current = MAX(0, tick_current - ?) WHERE id = ? AND active = TRUE")
            .bind(ticks as i64)
            .bind(id)
            .execute(&self.pool)
            .await?;
        let row = sqlx::query("SELECT tick_current, tick_max FROM doom_clocks WHERE id = ?")
            .bind(id)
            .fetch_optional(&self.pool)
            .await?;
        Ok(row.map(|r| {
            let c: i64 = r.try_get("tick_current").unwrap_or(0);
            let m: i64 = r.try_get("tick_max").unwrap_or(0);
            (c as u32, m as u32)
        }))
    }

    async fn reset_doom_clock(&self, id: &str) -> Result<(), DbError> {
        sqlx::query("UPDATE doom_clocks SET tick_current = tick_max WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn delete_doom_clock(&self, id: &str) -> Result<bool, DbError> {
        let r = sqlx::query("DELETE FROM doom_clocks WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(r.rows_affected() > 0)
    }

    // ── Audit-log rewind ───────────────────────────────────────────

    async fn restore_clock(&self, id: &str, current: u32, max: u32) -> Result<(), DbError> {
        sqlx::query("UPDATE doom_clocks SET tick_current = ?, tick_max = ? WHERE id = ?")
            .bind(current as i64)
            .bind(max as i64)
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn set_scene_summary(&self, scene_id: &str, summary: &str) -> Result<(), DbError> {
        sqlx::query("UPDATE campaign_scenes SET summary_text = ? WHERE id = ?")
            .bind(summary)
            .bind(scene_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn delete_logs_after(&self, scene_id: &str, target_log_id: &str) -> Result<Vec<String>, DbError> {
        // Find the timestamp of the target log entry, then delete everything after it.
        let target = sqlx::query("SELECT timestamp FROM log_entries WHERE id = ? AND scene_id = ?")
            .bind(target_log_id)
            .bind(scene_id)
            .fetch_optional(&self.pool)
            .await?;
        let Some(target_row) = target else {
            return Ok(vec![]);
        };
        let target_ts: String = target_row.try_get("timestamp")?;
        // Collect IDs of entries that will be deleted (for staleness checks).
        let stale: Vec<(String,)> = sqlx::query_as(
            "SELECT id FROM log_entries WHERE scene_id = ? AND timestamp >= ? AND id != ? ORDER BY timestamp DESC",
        )
        .bind(scene_id)
        .bind(&target_ts)
        .bind(target_log_id)
        .fetch_all(&self.pool)
        .await?;
        let stale_ids: Vec<String> = stale.into_iter().map(|(id,)| id).collect();
        if !stale_ids.is_empty() {
            sqlx::query("DELETE FROM log_entries WHERE scene_id = ? AND timestamp >= ? AND id != ?")
                .bind(scene_id)
                .bind(&target_ts)
                .bind(target_log_id)
                .execute(&self.pool)
                .await?;
        }
        Ok(stale_ids)
    }

    async fn invalidate_stale_summaries(&self, scene_id: &str, stale_log_ids: &[String]) -> Result<Vec<String>, DbError> {
        let mut deleted = Vec::new();
        for log_id in stale_log_ids {
            let r = sqlx::query("DELETE FROM episodic_summaries WHERE scene_id = ? AND last_log_id = ?")
                .bind(scene_id)
                .bind(log_id)
                .execute(&self.pool)
                .await?;
            if r.rows_affected() > 0 {
                deleted.push(log_id.clone());
            }
        }
        Ok(deleted)
    }

    async fn save_exploration_zone(
        &self,
        id: &str,
        name: &str,
        zone_type: &str,
        description: Option<&str>,
        danger_level: u32,
        mapped: bool,
    ) -> Result<(), DbError> {
        sqlx::query(
            "INSERT INTO exploration_zones (id, name, zone_type, description, danger_level, mapped)
             VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(id)
        .bind(name)
        .bind(zone_type)
        .bind(description)
        .bind(danger_level as i64)
        .bind(mapped)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn list_exploration_zones(&self) -> Result<Vec<ExplorationZoneRow>, DbError> {
        let rows = sqlx::query("SELECT id, name, zone_type, description, danger_level, mapped, created_at FROM exploration_zones ORDER BY created_at")
            .fetch_all(&self.pool)
            .await?;
        Ok(rows
            .into_iter()
            .map(|row| {
                let dl: i64 = row.try_get("danger_level").unwrap_or(0);
                ExplorationZoneRow {
                    id: row.try_get("id").unwrap_or_default(),
                    name: row.try_get("name").unwrap_or_default(),
                    zone_type: row.try_get("zone_type").unwrap_or_default(),
                    description: row.try_get("description").ok().flatten(),
                    danger_level: dl as u32,
                    mapped: row.try_get("mapped").unwrap_or(true),
                    created_at: row.try_get("created_at").unwrap_or_default(),
                }
            })
            .collect())
    }

    async fn delete_exploration_zone(&self, id: &str) -> Result<bool, DbError> {
        let mut tx = self.pool.begin().await?;
        sqlx::query("DELETE FROM exploration_nodes WHERE zone_id = ?")
            .bind(id)
            .execute(&mut *tx)
            .await?;
        let r = sqlx::query("DELETE FROM exploration_zones WHERE id = ?")
            .bind(id)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        Ok(r.rows_affected() > 0)
    }

    async fn save_exploration_node(
        &self,
        id: &str,
        zone_id: &str,
        name: &str,
        description: Option<&str>,
        connections_json: &str,
        contents_json: &str,
    ) -> Result<(), DbError> {
        sqlx::query(
            "INSERT INTO exploration_nodes (id, zone_id, name, description, connections_json, contents_json)
             VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(id).bind(zone_id).bind(name).bind(description)
        .bind(connections_json).bind(contents_json)
        .execute(&self.pool).await?;
        Ok(())
    }

    async fn list_exploration_nodes(
        &self,
        zone_id: &str,
    ) -> Result<Vec<ExplorationNodeRow>, DbError> {
        let rows = sqlx::query("SELECT id, zone_id, name, discovered, safe, description, connections_json, contents_json, notes, created_at FROM exploration_nodes WHERE zone_id = ? ORDER BY created_at")
            .bind(zone_id).fetch_all(&self.pool).await?;
        Ok(rows
            .into_iter()
            .map(|row| ExplorationNodeRow {
                id: row.try_get("id").unwrap_or_default(),
                zone_id: row.try_get("zone_id").unwrap_or_default(),
                name: row.try_get("name").unwrap_or_default(),
                discovered: row.try_get("discovered").unwrap_or(true),
                safe: row.try_get("safe").unwrap_or(true),
                description: row.try_get("description").ok().flatten(),
                connections_json: row
                    .try_get("connections_json")
                    .unwrap_or_else(|_| "[]".to_string()),
                contents_json: row.try_get("contents_json").unwrap_or_else(|_| "[]".to_string()),
                notes: row.try_get("notes").ok().flatten(),
                created_at: row.try_get("created_at").unwrap_or_default(),
            })
            .collect())
    }

    #[allow(clippy::too_many_arguments)]
    async fn update_exploration_node(
        &self,
        id: &str,
        discovered: Option<bool>,
        safe: Option<bool>,
        description: Option<&str>,
        connections_json: Option<&str>,
        contents_json: Option<&str>,
        notes: Option<&str>,
    ) -> Result<(), DbError> {
        sqlx::query(
            "UPDATE exploration_nodes SET
                discovered = COALESCE(?, discovered),
                safe = COALESCE(?, safe),
                description = COALESCE(?, description),
                connections_json = COALESCE(?, connections_json),
                contents_json = COALESCE(?, contents_json),
                notes = COALESCE(?, notes)
             WHERE id = ?",
        )
        .bind(discovered)
        .bind(safe)
        .bind(description)
        .bind(connections_json)
        .bind(contents_json)
        .bind(notes)
        .bind(id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn delete_exploration_node(&self, id: &str) -> Result<bool, DbError> {
        let r = sqlx::query("DELETE FROM exploration_nodes WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(r.rows_affected() > 0)
    }

    async fn begin_tx(&self) -> Result<sqlx::Transaction<'_, Sqlite>, DbError> {
        self.pool.begin().await.map_err(DbError::Database)
    }

    async fn db_create_scene_txn(
        &self,
        tx: &mut sqlx::Transaction<'_, Sqlite>,
        title: &str,
        chaos_factor: i32,
    ) -> Result<Scene, DbError> {
        let id = Uuid::new_v4().to_string();
        let scene_number = {
            let row: (i64,) =
                sqlx::query_as("SELECT COALESCE(MAX(scene_number), 0) + 1 FROM campaign_scenes")
                    .fetch_one(&mut **tx)
                    .await?;
            row.0 as i32
        };
        sqlx::query(
            "INSERT INTO campaign_scenes (id, scene_number, title, chaos_factor, is_active) VALUES (?, ?, ?, ?, 0)",
        )
        .bind(&id)
        .bind(scene_number)
        .bind(title)
        .bind(chaos_factor)
        .execute(&mut **tx)
        .await?;
        Ok(Scene {
            id,
            scene_number,
            title: title.to_string(),
            chaos_factor,
            summary_text: None,
            is_active: false,
        })
    }

    async fn db_save_npc_txn(
        &self,
        tx: &mut sqlx::Transaction<'_, Sqlite>,
        name: &str,
        disposition: &str,
        notes: &str,
    ) -> Result<(), DbError> {
        let id = Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO npc_characters (id, name, disposition, alive, knows_json, notes) VALUES (?, ?, ?, 1, '[]', ?)",
        )
        .bind(&id)
        .bind(name)
        .bind(disposition)
        .bind(notes)
        .execute(&mut **tx)
        .await?;
        Ok(())
    }

    async fn db_save_doom_clock_txn(
        &self,
        tx: &mut sqlx::Transaction<'_, Sqlite>,
        id: &str,
        label: &str,
        tick_max: u32,
        consequence: &str,
        scene_id: Option<&str>,
    ) -> Result<(), DbError> {
        sqlx::query(
            "INSERT OR REPLACE INTO doom_clocks (id, label, tick_current, tick_max, consequence, scene_id, active) VALUES (?, ?, 0, ?, ?, ?, 1)",
        )
        .bind(id)
        .bind(label)
        .bind(tick_max as i32)
        .bind(consequence)
        .bind(scene_id)
        .execute(&mut **tx)
        .await?;
        Ok(())
    }

    async fn db_save_thread_txn(
        &self,
        tx: &mut sqlx::Transaction<'_, Sqlite>,
        description: &str,
        status: &str,
        opened_scene_id: Option<&str>,
    ) -> Result<ThreadRow, DbError> {
        let id = Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO plot_threads (id, description, status, opened_scene_id) VALUES (?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(description)
        .bind(status)
        .bind(opened_scene_id)
        .execute(&mut **tx)
        .await?;
        Ok(ThreadRow {
            id,
            description: description.to_string(),
            status: status.to_string(),
            opened_scene_id: opened_scene_id.unwrap_or_default().to_string(),
            resolved_scene_id: None,
            created_at: chrono::Utc::now().to_rfc3339(),
        })
    }

    async fn db_set_setting_txn(
        &self,
        tx: &mut sqlx::Transaction<'_, Sqlite>,
        key: &str,
        value: &str,
    ) -> Result<(), DbError> {
        sqlx::query("INSERT OR REPLACE INTO campaign_settings (key, value) VALUES (?, ?)")
            .bind(key)
            .bind(value)
            .execute(&mut **tx)
            .await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use auto_dm_core::models::{AttributeState, Identity};

    #[tokio::test]
    async fn migrations_and_character_crud() {
        let pool = SqlitePoolOptions::new()
            .max_connections(2)
            .connect("sqlite::memory:")
            .await
            .expect("in-memory pool");
        run_migrations(&pool).await.expect("migrations");
        let repo = SqliteRepository::new(pool);

        let profile = CharacterProfile {
            id: "pc_hero_01".to_string(),
            system_id: "dnd5e_srd".to_string(),
            identity: Identity {
                name: "Hero".to_string(),
                ancestry: None,
                archetype: None,
                background: None,
                level_or_rank: 1,
            },
            attributes: std::collections::HashMap::from([(
                "STR".to_string(),
                AttributeState { base_value: 16, current_value: 16, derived_modifier: Some(3) },
            )]),
            resource_pools: std::collections::HashMap::new(),
            inventory: vec![],
            abilities: vec![],
        };

        repo.save_character(&profile).await.expect("save");
        let loaded = repo.load_character("pc_hero_01").await.expect("load");
        assert_eq!(loaded.id, "pc_hero_01");
        assert_eq!(loaded.identity.name, "Hero");
        assert_eq!(loaded.attributes["STR"].derived_modifier, Some(3));

        let list = repo.list_characters().await.expect("list");
        assert_eq!(list.len(), 1);

        assert!(repo.delete_character("pc_hero_01").await.expect("delete"));
        assert!(!repo.delete_character("pc_hero_01").await.expect("delete2"));
    }

    #[tokio::test]
    async fn scene_and_log_crud() {
        let pool = SqlitePoolOptions::new()
            .max_connections(2)
            .connect("sqlite::memory:")
            .await
            .expect("in-memory pool");
        run_migrations(&pool).await.expect("migrations");
        let repo = SqliteRepository::new(pool);

        let s1 = repo.create_scene("The Keep", 5).await.expect("scene1");
        let s2 = repo.create_scene("The Crypts", 6).await.expect("scene2");
        assert_eq!(s1.scene_number, 1);
        assert_eq!(s2.scene_number, 2);

        repo.set_active_scene(&s1.id).await.expect("activate");
        let active = repo.active_scene().await.expect("active");
        assert_eq!(active.as_ref().map(|s| s.id.as_str()), Some(s1.id.as_str()));

        let entry =
            repo.append_log(&s1.id, "Narrator", "The gates groan open.", None).await.expect("log");
        assert_eq!(entry.speaker, "Narrator");

        let logs = repo.list_logs(&s1.id, 10).await.expect("logs");
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].content, "The gates groan open.");
    }

    #[tokio::test]
    async fn thread_and_npc_character_crud() {
        let pool = SqlitePoolOptions::new()
            .max_connections(2)
            .connect("sqlite::memory:")
            .await
            .expect("pool");
        run_migrations(&pool).await.expect("migrations");
        let repo = SqliteRepository { pool };

        // Create a scene to reference
        let s = repo.create_scene("Test", 5).await.expect("scene");

        // Thread CRUD
        let thread = repo
            .save_thread("Who is the assassin?", "open", &s.id, None)
            .await
            .expect("save thread");
        assert_eq!(thread.description, "Who is the assassin?");
        assert_eq!(thread.status, "open");

        let threads = repo.list_threads().await.expect("list threads");
        assert_eq!(threads.len(), 1);

        repo.update_thread_status(&thread.id, "resolved", Some(&s.id))
            .await
            .expect("update thread");
        let threads = repo.list_threads().await.expect("list threads");
        assert_eq!(threads[0].status, "resolved");
        assert_eq!(threads[0].resolved_scene_id.as_deref(), Some(s.id.as_str()));

        repo.delete_thread(&thread.id).await.expect("delete thread");
        let threads = repo.list_threads().await.expect("list threads");
        assert!(threads.is_empty());

        // NPC Character CRUD
        let npc = repo
            .save_npc_character(
                "Bartender",
                "friendly",
                true,
                Some("Tavern"),
                "[]",
                Some("Knows the underground"),
                None,
                None,
                None,
                None,
                false,
            )
            .await
            .expect("save npc");
        assert_eq!(npc.name, "Bartender");
        assert_eq!(npc.disposition, "friendly");

        let npcs = repo.list_npc_characters().await.expect("list npcs");
        assert_eq!(npcs.len(), 1);

        repo.update_npc_character(
            &npc.id,
            Some("neutral"),
            Some(true),
            None,
            None,
            Some("Knows everything"),
            Some(&s.id),
        )
        .await
        .expect("update npc");
        let npcs = repo.list_npc_characters().await.expect("list npcs");
        assert_eq!(npcs[0].disposition, "neutral");
        assert_eq!(npcs[0].notes.as_deref(), Some("Knows everything"));
        assert_eq!(npcs[0].last_seen_scene_id.as_deref(), Some(s.id.as_str()));

        repo.delete_npc_character(&npc.id).await.expect("delete npc");
        let npcs = repo.list_npc_characters().await.expect("list npcs");
        assert!(npcs.is_empty());
    }

    #[tokio::test]
    async fn settings_crud() {
        let pool = SqlitePoolOptions::new().connect("sqlite::memory:").await.expect("connect");
        run_migrations(&pool).await.expect("migrate");
        let repo = SqliteRepository::new(pool);

        // Initially empty.
        assert!(repo.get_setting("lines").await.expect("get").is_none());
        assert!(repo.get_setting("veils").await.expect("get").is_none());

        // Set and retrieve.
        let lines = vec!["torture".to_string(), "child harm".to_string()];
        let veils = vec!["sex".to_string()];
        repo.set_setting("lines", &serde_json::to_string(&lines).unwrap())
            .await
            .expect("set lines");
        repo.set_setting("veils", &serde_json::to_string(&veils).unwrap())
            .await
            .expect("set veils");

        let got_lines: Vec<String> =
            serde_json::from_str(&repo.get_setting("lines").await.expect("get lines").unwrap())
                .unwrap();
        assert_eq!(got_lines, lines);

        let got_veils: Vec<String> =
            serde_json::from_str(&repo.get_setting("veils").await.expect("get veils").unwrap())
                .unwrap();
        assert_eq!(got_veils, veils);

        // Update (upsert).
        let new_lines = vec!["gore".to_string()];
        repo.set_setting("lines", &serde_json::to_string(&new_lines).unwrap())
            .await
            .expect("update lines");
        let got_lines: Vec<String> =
            serde_json::from_str(&repo.get_setting("lines").await.expect("get lines").unwrap())
                .unwrap();
        assert_eq!(got_lines, new_lines);
    }

    #[tokio::test]
    async fn doom_clock_crud() {
        let pool = SqlitePoolOptions::new().connect("sqlite::memory:").await.expect("connect");
        run_migrations(&pool).await.expect("migrate");
        let repo = SqliteRepository::new(pool);

        // Create.
        repo.save_doom_clock("dc1", "Guard Alert", 4, "Guards arrive", Some("s1"))
            .await
            .expect("save clock");
        let clocks = repo.list_doom_clocks().await.expect("list");
        assert_eq!(clocks.len(), 1);
        assert_eq!(clocks[0].current, 4);
        assert_eq!(clocks[0].label, "Guard Alert");

        // Tick.
        let result = repo.tick_doom_clock("dc1").await.expect("tick");
        assert_eq!(result, Some((3, 4)));
        let result = repo.tick_doom_clock("dc1").await.expect("tick");
        assert_eq!(result, Some((2, 4)));

        // Advance.
        let result = repo.advance_doom_clock("dc1", 2).await.expect("advance");
        assert_eq!(result, Some((0, 4)));

        // Reset.
        repo.reset_doom_clock("dc1").await.expect("reset");
        let clocks = repo.list_doom_clocks().await.expect("list");
        assert_eq!(clocks[0].current, 4);

        // Delete.
        assert!(repo.delete_doom_clock("dc1").await.expect("delete"));
        let clocks = repo.list_doom_clocks().await.expect("list");
        assert!(clocks.is_empty());
    }

    #[tokio::test]
    async fn exploration_zone_and_node_crud() {
        let pool = SqlitePoolOptions::new().connect("sqlite::memory:").await.expect("connect");
        run_migrations(&pool).await.expect("migrate");
        let repo = SqliteRepository::new(pool);

        // Create zone
        repo.save_exploration_zone("z1", "Darkwood", "hex", Some("Dense forest"), 3, false)
            .await
            .expect("save zone");
        let zones = repo.list_exploration_zones().await.expect("list zones");
        assert_eq!(zones.len(), 1);
        assert_eq!(zones[0].name, "Darkwood");
        assert_eq!(zones[0].zone_type, "hex");
        assert_eq!(zones[0].danger_level, 3);

        // Create nodes
        repo.save_exploration_node("n1", "z1", "Ruined Tower", Some("Crumbling stone"), "[]", "[]")
            .await
            .expect("save node");
        repo.save_exploration_node("n2", "z1", "Ancient Bridge", None, "[]", "[]")
            .await
            .expect("save node");
        let nodes = repo.list_exploration_nodes("z1").await.expect("list nodes");
        assert_eq!(nodes.len(), 2);
        assert!(!nodes[0].discovered);

        // Update node
        repo.update_exploration_node(
            "n1",
            Some(true),
            Some(false),
            None,
            Some("[]"),
            None,
            Some("Has traps"),
        )
        .await
        .expect("update node");
        let nodes = repo.list_exploration_nodes("z1").await.expect("list nodes after update");
        let n1 = nodes.iter().find(|n| n.id == "n1").unwrap();
        assert!(n1.discovered);
        assert!(!n1.safe);
        assert_eq!(n1.notes.as_deref(), Some("Has traps"));

        // Delete node
        assert!(repo.delete_exploration_node("n2").await.expect("delete node"));
        let nodes = repo.list_exploration_nodes("z1").await.expect("list nodes after delete");
        assert_eq!(nodes.len(), 1);

        // Delete zone cascades
        assert!(repo.delete_exploration_zone("z1").await.expect("delete zone"));
        assert!(repo.list_exploration_nodes("z1").await.expect("list").is_empty());
        assert!(repo.list_exploration_zones().await.expect("list zones").is_empty());
    }

    // ── Golden tests: is_summary_stale ─────────────────────────────

    #[test]
    fn stale_when_log_id_absent() {
        assert!(is_summary_stale("log-42", &["log-1".into(), "log-2".into()]));
    }

    #[test]
    fn fresh_when_log_id_present() {
        assert!(!is_summary_stale("log-2", &["log-1".into(), "log-2".into(), "log-3".into()]));
    }

    #[test]
    fn stale_when_log_is_empty() {
        assert!(is_summary_stale("log-1", &[]));
    }
}
