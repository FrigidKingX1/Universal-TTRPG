use auto_dm_core::llm::{DmPipeline, LlmBackend};
use auto_dm_core::memory::CampaignMemory;
use auto_dm_core::models::{ActionDefinition, CharacterProfile, EncounterStatBlock};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePool, SqlitePoolOptions};
use sqlx::Sqlite;
use std::fmt;
use std::sync::Mutex;
use uuid::Uuid;

/// Error type for the persistence layer.
#[derive(Debug)]
pub enum DbError {
    Database(sqlx::Error),
    Json(serde_json::Error),
    NotFound(String),
}

impl fmt::Display for DbError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            DbError::Database(e) => write!(f, "database error: {e}"),
            DbError::Json(e) => write!(f, "json error: {e}"),
            DbError::NotFound(what) => write!(f, "not found: {what}"),
        }
    }
}

impl std::error::Error for DbError {}

impl From<sqlx::Error> for DbError {
    fn from(e: sqlx::Error) -> Self {
        DbError::Database(e)
    }
}

impl From<serde_json::Error> for DbError {
    fn from(e: serde_json::Error) -> Self {
        DbError::Json(e)
    }
}

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
pub struct AppState {
    pub repo: SqliteRepository,
    /// The DM loop. Backends are swappable; `StubLlmBackend` is used for MVP.
    pub dm: DmPipeline<Box<dyn LlmBackend>>,
    /// In-memory ring buffer of recent campaign events for LLM context.
    pub memory: Mutex<CampaignMemory>,
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

    async fn append_log(
        &self,
        scene_id: &str,
        speaker: &str,
        content: &str,
        payload: Option<Value>,
    ) -> Result<LogEntry, DbError>;
    async fn list_logs(&self, scene_id: &str, limit: i64) -> Result<Vec<LogEntry>, DbError>;
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
    SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(options)
        .await
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
        let row = sqlx::query_as::<Sqlite, (String,)>(
            "SELECT profile_json FROM characters WHERE id = ?",
        )
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
        rows.into_iter()
            .map(|(json,)| serde_json::from_str(&json).map_err(DbError::Json))
            .collect()
    }

    async fn delete_character(&self, id: &str) -> Result<bool, DbError> {
        let res = sqlx::query("DELETE FROM characters WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;
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
        rows.into_iter()
            .map(|(json,)| serde_json::from_str(&json).map_err(DbError::Json))
            .collect()
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
        let row = sqlx::query_as::<Sqlite, (String,)>(
            "SELECT block_json FROM stat_blocks WHERE id = ?",
        )
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
        rows.into_iter()
            .map(|(json,)| serde_json::from_str(&json).map_err(DbError::Json))
            .collect()
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
        let scene_number: i32 = sqlx::query_scalar("SELECT COALESCE(MAX(scene_number), 0) + 1 FROM campaign_scenes")
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
            .map(
                |(id, scene_number, title, chaos_factor, summary_text, is_active)| Scene {
                    id,
                    scene_number,
                    title,
                    chaos_factor,
                    summary_text,
                    is_active: is_active != 0,
                },
            )
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
        let mut tx = self.pool.begin().await?;
        sqlx::query("UPDATE campaign_scenes SET is_active = 0")
            .execute(&mut *tx)
            .await?;
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
            .map(
                |(id, speaker, content, payload_json, timestamp)| {
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
                },
            )
            .collect()
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
                AttributeState {
                    base_value: 16,
                    current_value: 16,
                    derived_modifier: Some(3),
                },
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

        let entry = repo
            .append_log(&s1.id, "Narrator", "The gates groan open.", None)
            .await
            .expect("log");
        assert_eq!(entry.speaker, "Narrator");

        let logs = repo.list_logs(&s1.id, 10).await.expect("logs");
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].content, "The gates groan open.");
    }
}
