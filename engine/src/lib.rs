//! Auto-DM engine: authoritative game-state layer.
//!
//! Pure Rust — no Tauri, no UI. Both the desktop client (src-tauri) and the
//! future multiplayer server binary depend on this crate as the single
//! source of truth for persistence, session effects, and combat parsing.

pub mod combat;
pub mod error;
pub mod events;
pub mod session;
pub mod state;

pub use combat::combatant_from_value;
pub use error::{DbError, EngineError};
pub use events::{GameEvent, VersionedEvent, GAME_EVENT_SCHEMA_VERSION};
pub use session::{
    apply_session_effects, remember, resolve_entity_descriptor, EntityRef, ResolveResult,
};
pub use state::{
    backup_before_migrate, open_pool, run_migrations, CampaignExport, DoomClockRow, GameState,
    ExplorationNodeRow, ExplorationZoneRow, LootRow, LogEntry, NpcCharacterRow, NpcNoteRow,
    Repository, Scene, SqliteRepository, ThreadRow,
};
