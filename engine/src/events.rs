//! Typed game events emitted by every state mutation.
//!
//! These are the serialization boundary for future multiplayer broadcast
//! (Phase C) and the source records for the audit-log rewind (Phase B).
//! Every handler returns events instead of mutating silently.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Wire-schema version for [`GameEvent`] payloads. Bump on any variant
/// rename/restructure; remote clients key their parsers off this.
pub const GAME_EVENT_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum GameEvent {
    SceneUpdated {
        scene_id: String,
    },
    NpcSpoke {
        speaker: String,
    },
    ItemAdded {
        name: String,
        quantity: i32,
    },
    ClockAdvanced {
        clock_id: String,
        ticks: i32,
    },
    /// Emitted for every combat HP mutation (from core's DamageResult).
    DamageApplied {
        target_id: String,
        target_name: String,
        amount: i32,
        temp_absorbed: i32,
        hp_remaining: i32,
        defeated: bool,
        /// Single hit exceeded 50% max HP — knockdown trauma.
        shock: bool,
    },
    /// HP restored by a heal action or the heal endpoint.
    Healed {
        target_id: String,
        target_name: String,
        amount: i32,
        hp_remaining: i32,
    },
    /// Battle-map tokens/background changed on the shared map.
    MapUpdated {
        /// Array of MapToken JSON objects.
        tokens: Value,
        background: String,
    },
    /// The mutation target was ambiguous; `candidates` are the valid choices
    /// (generic disambiguation shared by clocks, NPCs, monsters).
    AmbiguousTarget {
        kind: String,
        message: String,
        candidates: Vec<String>,
    },
    ConditionApplied {
        target: String,
        condition: String,
    },
    RuleAnswered {
        question: String,
    },
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
            GameEvent::DamageApplied { target_name, amount, hp_remaining, shock, .. } => {
                let mut s = format!("{amount} damage to {target_name} — {hp_remaining} HP remain");
                if *shock {
                    s.push_str(" (SYSTEMIC SHOCK — knocked prone)");
                }
                s
            }
            GameEvent::Healed { target_name, amount, hp_remaining, .. } => {
                format!("{amount} HP restored to {target_name} — {hp_remaining} HP remain")
            }
            GameEvent::MapUpdated { .. } => "Battle map updated.".to_string(),
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

#[cfg(test)]
mod wire_shape_tests {
    use super::*;

    /// Cross-language drift guard. The TypeScript mirror in
    /// `src/multiplayer/types.ts` dispatches on these exact `type` tags and
    /// reads these exact field names; if this test fails, update the TS
    /// union in the same commit or every hosted client silently ignores
    /// the renamed event.
    #[test]
    fn every_variant_serializes_with_the_wire_shape_types_ts_expects() {
        let samples: Vec<(GameEvent, &str, &[&str])> = vec![
            (GameEvent::SceneUpdated { scene_id: "s".into() }, "scene_updated", &["scene_id"]),
            (GameEvent::NpcSpoke { speaker: "n".into() }, "npc_spoke", &["speaker"]),
            (
                GameEvent::ItemAdded { name: "i".into(), quantity: 1 },
                "item_added",
                &["name", "quantity"],
            ),
            (
                GameEvent::ClockAdvanced { clock_id: "c".into(), ticks: 1 },
                "clock_advanced",
                &["clock_id", "ticks"],
            ),
            (
                GameEvent::DamageApplied {
                    target_id: "t".into(),
                    target_name: "T".into(),
                    amount: 1,
                    temp_absorbed: 0,
                    hp_remaining: 9,
                    defeated: false,
                    shock: false,
                },
                "damage_applied",
                &[
                    "target_id",
                    "target_name",
                    "amount",
                    "temp_absorbed",
                    "hp_remaining",
                    "defeated",
                    "shock",
                ],
            ),
            (
                GameEvent::Healed {
                    target_id: "t".into(),
                    target_name: "T".into(),
                    amount: 1,
                    hp_remaining: 9,
                },
                "healed",
                &["target_id", "target_name", "amount", "hp_remaining"],
            ),
            (
                GameEvent::MapUpdated { tokens: Value::Array(vec![]), background: String::new() },
                "map_updated",
                &["tokens", "background"],
            ),
            (
                GameEvent::AmbiguousTarget {
                    kind: "k".into(),
                    message: "m".into(),
                    candidates: vec!["a".into()],
                },
                "ambiguous_target",
                &["kind", "message", "candidates"],
            ),
            (
                GameEvent::ConditionApplied { target: "t".into(), condition: "c".into() },
                "condition_applied",
                &["target", "condition"],
            ),
            (GameEvent::RuleAnswered { question: "q".into() }, "rule_answered", &["question"]),
        ];

        // Every variant of the enum must be covered. `_exhaustive_canary`
        // below fails to COMPILE when a variant is added without appearing
        // here, forcing the TS mirror to be updated in the same commit.
        assert_eq!(
            samples.len(),
            10,
            "uncovered GameEvent variants — add them here AND to src/multiplayer/types.ts"
        );

        for (event, expected_tag, expected_fields) in samples {
            let v = serde_json::to_value(&event).expect("serialize");
            let obj = v.as_object().expect("tagged object");
            assert_eq!(
                obj.get("type").and_then(|t| t.as_str()),
                Some(expected_tag),
                "wrong wire tag for {expected_tag}: {obj:?}"
            );
            let mut actual: Vec<&str> =
                obj.keys().filter(|k| *k != "type").map(|k| k.as_str()).collect();
            let mut expected: Vec<&str> = expected_fields.to_vec();
            actual.sort_unstable();
            expected.sort_unstable();
            assert_eq!(actual, expected, "field drift on {expected_tag}");
        }
    }

    /// Compile-time tripwire: adding a `GameEvent` variant without updating
    /// `every_variant_serializes_with_the_wire_shape_types_ts_expects` (and
    /// the TypeScript mirror) breaks the build right here.
    fn _exhaustive_canary(e: &GameEvent) {
        match e {
            GameEvent::SceneUpdated { .. } => {}
            GameEvent::NpcSpoke { .. } => {}
            GameEvent::ItemAdded { .. } => {}
            GameEvent::ClockAdvanced { .. } => {}
            GameEvent::DamageApplied { .. } => {}
            GameEvent::Healed { .. } => {}
            GameEvent::MapUpdated { .. } => {}
            GameEvent::AmbiguousTarget { .. } => {}
            GameEvent::ConditionApplied { .. } => {}
            GameEvent::RuleAnswered { .. } => {}
        }
    }
}
