//! Typed game events emitted by every state mutation.
//!
//! These are the serialization boundary for future multiplayer broadcast
//! (Phase C) and the source records for the audit-log rewind (Phase B).
//! Every handler returns events instead of mutating silently.

use serde::{Deserialize, Serialize};

/// Wire-schema version for [`GameEvent`] payloads. Bump on any variant
/// rename/restructure; remote clients key their parsers off this.
pub const GAME_EVENT_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum GameEvent {
    SceneUpdated { scene_id: String },
    NpcSpoke { speaker: String },
    ItemAdded { name: String, quantity: i32 },
    ClockAdvanced { clock_id: String, ticks: i32 },
    /// The mutation target was ambiguous; `candidates` are the valid choices
    /// (generic disambiguation shared by clocks, NPCs, monsters).
    AmbiguousTarget {
        kind: String,
        message: String,
        candidates: Vec<String>,
    },
    ConditionApplied { target: String, condition: String },
    RuleAnswered { question: String },
}

/// Versioned envelope — the actual wire format for broadcasts/audit records.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VersionedEvent {
    pub v: u32,
    #[serde(flatten)]
    pub event: GameEvent,
}

impl VersionedEvent {
    pub fn new(event: GameEvent) -> Self {
        Self { v: GAME_EVENT_SCHEMA_VERSION, event }
    }
}

impl GameEvent {
    /// Human-readable line for the mechanical-events feed.
    pub fn describe(&self) -> String {
        match self {
            GameEvent::SceneUpdated { .. } => "Scene record updated.".to_string(),
            GameEvent::NpcSpoke { speaker } => format!("{speaker} speaks."),
            GameEvent::ItemAdded { name, quantity } => {
                format!("Item added to scene loot: {quantity}x {name}")
            }
            GameEvent::ClockAdvanced { ticks, .. } => {
                format!("Doom clock advanced by {ticks}.")
            }
            GameEvent::AmbiguousTarget { message, candidates, .. } => {
                format!("{message} Options: {}", candidates.join(", "))
            }
            GameEvent::ConditionApplied { target, condition } => {
                format!("Condition '{condition}' marked on {target}.")
            }
            GameEvent::RuleAnswered { question } => {
                format!("Rules lookup: {question}")
            }
        }
    }
}
