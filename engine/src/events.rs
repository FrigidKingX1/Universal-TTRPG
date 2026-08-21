//! Typed game events emitted by every state mutation.
//!
//! These are the serialization boundary for future multiplayer broadcast
//! (Phase C) and the source records for the audit-log rewind (Phase B).
//! Every handler returns events instead of mutating silently.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum GameEvent {
    SceneUpdated { scene_id: String },
    NpcSpoke { speaker: String },
    ItemAdded { name: String, quantity: i32 },
    ClockAdvanced { clock_id: String, ticks: i32 },
    ConditionApplied { target: String, condition: String },
    RuleAnswered { question: String },
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
            GameEvent::ConditionApplied { target, condition } => {
                format!("Condition '{condition}' marked on {target}.")
            }
            GameEvent::RuleAnswered { question } => {
                format!("Rules lookup: {question}")
            }
        }
    }
}
