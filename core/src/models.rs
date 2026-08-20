use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// System-agnostic character profile covering d20, dice-pool, and classless systems.
/// Mirrors the UniversalCharacterProfile JSON schema (Deliverable 2a).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CharacterProfile {
    pub id: String,
    pub system_id: String,
    pub identity: Identity,
    pub attributes: HashMap<String, AttributeState>,
    pub resource_pools: HashMap<String, ResourcePool>,
    pub inventory: Vec<InventoryItem>,
    /// References to ActionDefinition IDs.
    pub abilities: Vec<String>,
}

/// Character identity block (name, ancestry, class, background).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Identity {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ancestry: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub archetype: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub background: Option<String>,
    #[serde(default = "default_level")]
    pub level_or_rank: i32,
}

fn default_level() -> i32 {
    1
}

/// A single ability score and its derived modifier.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AttributeState {
    pub base_value: i32,
    pub current_value: i32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub derived_modifier: Option<i32>,
}

/// A tracked resource pool (HP, spell slots, etc.).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ResourcePool {
    pub current: i32,
    pub maximum: i32,
    #[serde(default)]
    pub temporary: i32,
    #[serde(default = "default_reset")]
    pub reset_condition: ResetCondition,
}

fn default_reset() -> ResetCondition {
    ResetCondition::Manual
}

/// When a resource pool resets (short rest, long rest, etc.).
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ResetCondition {
    ShortRest,
    LongRest,
    TurnStart,
    SceneEnd,
    Manual,
}

/// An item in a character's inventory.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct InventoryItem {
    pub id: String,
    pub name: String,
    pub quantity: i32,
    #[serde(default)]
    pub is_equipped: bool,
    #[serde(default)]
    pub weight: f64,
    #[serde(default)]
    pub tags: Vec<String>,
}

/// Universal action / spell definition. Mirrors the UniversalActionDefinition
/// JSON schema (Deliverable 2b).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ActionDefinition {
    pub id: String,
    pub name: String,
    #[serde(rename = "action_cost")]
    pub action_cost: ActionCost,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub targeting: Option<Targeting>,
    pub resolution: Resolution,
}

/// Action cost (action, bonus action, reaction, etc.).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ActionCost {
    #[serde(rename = "type")]
    pub cost_type: CostType,
    #[serde(default = "default_amount")]
    pub amount: i32,
}

fn default_amount() -> i32 {
    1
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CostType {
    Action,
    BonusAction,
    Reaction,
    ActionPoint,
    Free,
}

/// Targeting parameters for an action (range, shape, etc.).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Targeting {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub range_feet: Option<i32>,
    pub target_type: TargetType,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shape: Option<Shape>,
    #[serde(default)]
    pub size_feet: i32,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TargetType {
    SingleEntity,
    AreaOfEffect,
    #[serde(rename = "self")]
    TargetsSelf,
    Ally,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Shape {
    Sphere,
    Cone,
    Cube,
    Line,
    Single,
}

/// Action resolution mechanics (how the action is resolved).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Resolution {
    #[serde(rename = "type")]
    pub resolution_type: ResolutionType,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub primary_attribute: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub roll_formula: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vs_defense: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub outcomes: Option<Outcomes>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ResolutionType {
    ContestedCheck,
    TargetDc,
    GuaranteedEffect,
    OpposedRoll,
}

/// Outcomes for success and failure on an action resolution.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Outcomes {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub on_success: Option<SuccessOutcome>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub on_failure: Option<FailureOutcome>,
}

/// Outcome when an action succeeds.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SuccessOutcome {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub formula: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub damage_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub applied_status: Option<String>,
}

/// Outcome when an action fails.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FailureOutcome {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub formula: Option<String>,
    #[serde(default)]
    pub half_damage: bool,
}

/// NPC / monster stat block. Mirrors the EncounterStatBlock JSON schema
/// (Deliverable 2c).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EncounterStatBlock {
    pub id: String,
    pub name: String,
    pub challenge_rating: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<Size>,
    #[serde(rename = "type", default, skip_serializing_if = "Option::is_none")]
    pub creature_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub alignment: Option<String>,
    pub armor_class: i32,
    pub hit_points: HitPoints,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub speed_feet: Option<i32>,
    pub attributes: HashMap<String, i32>,
    /// References to ActionDefinition IDs.
    pub actions: Vec<String>,
    /// Loot table: items this creature drops on defeat. Each entry is
    /// `(name, quantity_formula, chance_0_100)`. The formula is rolled via
    /// the dice engine; chance is a percentage (0-100) the item drops at all.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub loot_table: Vec<LootTableEntry>,
    /// Damage types this creature is resistant to (takes half damage).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub resistances: Vec<String>,
    /// Damage types this creature is vulnerable to (takes double damage).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub vulnerabilities: Vec<String>,
    /// Damage types this creature is immune to (takes no damage).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub immunities: Vec<String>,
}

/// A single entry in a monster's loot table.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LootTableEntry {
    pub name: String,
    /// Dice formula for quantity, e.g. "2d6" or "1". Defaults to "1".
    #[serde(default = "default_loot_qty")]
    pub quantity_formula: String,
    /// Percentage chance (0–100) this item drops. Defaults to 100.
    #[serde(default = "default_loot_chance")]
    pub chance: i32,
}

fn default_loot_qty() -> String {
    "1".to_string()
}

fn default_loot_chance() -> i32 {
    100
}

/// Standard damage types for the d20 system.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum DamageType {
    Slashing,
    Piercing,
    Bludgeoning,
    Fire,
    Cold,
    Lightning,
    Poison,
    Psychic,
    Necrotic,
    Radiant,
    Force,
    Thunder,
}

impl DamageType {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Slashing => "slashing",
            Self::Piercing => "piercing",
            Self::Bludgeoning => "bludgeoning",
            Self::Fire => "fire",
            Self::Cold => "cold",
            Self::Lightning => "lightning",
            Self::Poison => "poison",
            Self::Psychic => "psychic",
            Self::Necrotic => "necrotic",
            Self::Radiant => "radiant",
            Self::Force => "force",
            Self::Thunder => "thunder",
        }
    }

    pub fn from_str_opt(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "slashing" => Some(Self::Slashing),
            "piercing" => Some(Self::Piercing),
            "bludgeoning" => Some(Self::Bludgeoning),
            "fire" => Some(Self::Fire),
            "cold" => Some(Self::Cold),
            "lightning" => Some(Self::Lightning),
            "poison" => Some(Self::Poison),
            "psychic" => Some(Self::Psychic),
            "necrotic" => Some(Self::Necrotic),
            "radiant" => Some(Self::Radiant),
            "force" => Some(Self::Force),
            "thunder" => Some(Self::Thunder),
            _ => None,
        }
    }
}

impl std::fmt::Display for DamageType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

/// A rolled loot item ready for distribution.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RolledLoot {
    pub name: String,
    pub quantity: i32,
}

/// A Doom Clock: a countdown tracker. When it reaches 0, something bad happens.
/// Inspired by PbtA / Forged in the Dark doom clocks.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DoomClock {
    pub id: String,
    pub label: String,
    pub current: u32,
    pub max: u32,
    /// What happens when this clock reaches 0.
    pub consequence: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scene_id: Option<String>,
    #[serde(default = "default_clock_active")]
    pub active: bool,
    pub created_at: String,
}

fn default_clock_active() -> bool {
    true
}

impl DoomClock {
    /// Advance the clock by 1 tick. Returns true if the clock reached 0.
    pub fn tick(&mut self) -> bool {
        if self.current > 0 && self.active {
            self.current -= 1;
        }
        self.current == 0
    }

    /// Advance the clock by multiple ticks. Returns true if it reached 0.
    pub fn advance(&mut self, ticks: u32) -> bool {
        self.current = self.current.saturating_sub(ticks);
        self.current == 0
    }

    /// Reset the clock to its maximum value.
    pub fn reset(&mut self) {
        self.current = self.max;
    }

    pub fn is_expired(&self) -> bool {
        self.current == 0 && self.active
    }
}

/// Roll a creature's loot table using the given dice engine. Returns only items
/// that passed their chance check (d100 <= chance).
pub fn roll_loot_table(
    dice: &mut crate::dice::DiceEngine,
    loot_table: &[LootTableEntry],
) -> Vec<RolledLoot> {
    let mut result = Vec::new();
    for entry in loot_table {
        // Roll d100 for drop chance.
        let chance_roll: i32 = dice.evaluate("d100").map(|r| r.total as i32).unwrap_or(101);
        if chance_roll <= entry.chance {
            let qty = dice
                .evaluate(&entry.quantity_formula)
                .map(|r| (r.total as i32).max(1))
                .unwrap_or(1);
            result.push(RolledLoot {
                name: entry.name.clone(),
                quantity: qty,
            });
        }
    }
    result
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Size {
    Tiny,
    Small,
    Medium,
    Large,
    Huge,
    Gargantuan,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct HitPoints {
    pub current: i32,
    pub maximum: i32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub formula: Option<String>,
}

// ── Oracle / Mythic — Thread & NPC Character Lists ────────────────────────

/// Status of a plot thread.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ThreadStatus {
    Open,
    Resolved,
    Abandoned,
}

/// NPC disposition toward the player character.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Disposition {
    Hostile,
    Unfriendly,
    Neutral,
    Friendly,
    Helpful,
}

impl Disposition {
    pub fn label(self) -> &'static str {
        match self {
            Disposition::Hostile => "Hostile",
            Disposition::Unfriendly => "Unfriendly",
            Disposition::Neutral => "Neutral",
            Disposition::Friendly => "Friendly",
            Disposition::Helpful => "Helpful",
        }
    }
}

/// A single open plot thread tracked by the Mythic Oracle.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PlotThread {
    pub id: String,
    pub description: String,
    pub status: ThreadStatus,
    pub opened_scene_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resolved_scene_id: Option<String>,
    pub created_at: String,
}

/// A single knowledge entry held by an NPC, with optional scene context and timestamp.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct NpcKnowledge {
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scene_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<String>,
}

/// An NPC character tracked in the Mythic Characters List.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct NpcCharacter {
    pub id: String,
    pub name: String,
    pub disposition: Disposition,
    #[serde(default)]
    pub alive: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub location: Option<String>,
    /// Facts this NPC is aware of, with optional scene context.
    #[serde(
        default,
        skip_serializing_if = "Vec::is_empty",
        deserialize_with = "deserialize_knows"
    )]
    pub knows: Vec<NpcKnowledge>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_seen_scene_id: Option<String>,
    pub created_at: String,
}

/// Deserialize `knows` from either the old `["string"]` format or the new `[{text, ...}]` format.
fn deserialize_knows<'de, D>(deserializer: D) -> Result<Vec<NpcKnowledge>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum KnowsFormat {
        Legacy(Vec<String>),
        Structured(Vec<NpcKnowledge>),
    }

    let raw: KnowsFormat = Deserialize::deserialize(deserializer)?;
    match raw {
        KnowsFormat::Legacy(strings) => Ok(strings
            .into_iter()
            .map(|s| NpcKnowledge {
                text: s,
                scene_id: None,
                timestamp: None,
            })
            .collect()),
        KnowsFormat::Structured(v) => Ok(v),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn thread_status_roundtrips() {
        let thread = PlotThread {
            id: "t1".into(),
            description: "Who is the assassin?".into(),
            status: ThreadStatus::Open,
            opened_scene_id: "s1".into(),
            resolved_scene_id: None,
            created_at: "2026-01-01T00:00:00Z".into(),
        };
        let json = serde_json::to_string(&thread).unwrap();
        let de: PlotThread = serde_json::from_str(&json).unwrap();
        assert_eq!(thread, de);
    }

    #[test]
    fn thread_status_resolved_serializes() {
        let thread = PlotThread {
            id: "t2".into(),
            description: "Find the treasure".into(),
            status: ThreadStatus::Resolved,
            opened_scene_id: "s1".into(),
            resolved_scene_id: Some("s3".into()),
            created_at: "2026-01-01T00:00:00Z".into(),
        };
        let json = serde_json::to_value(&thread).unwrap();
        assert_eq!(json["status"], "resolved");
        assert_eq!(json["resolved_scene_id"], "s3");
    }

    #[test]
    fn disposition_label() {
        assert_eq!(Disposition::Hostile.label(), "Hostile");
        assert_eq!(Disposition::Friendly.label(), "Friendly");
        assert_eq!(Disposition::Neutral.label(), "Neutral");
    }

    #[test]
    fn npc_character_roundtrips() {
        let npc = NpcCharacter {
            id: "n1".into(),
            name: "Bartender".into(),
            disposition: Disposition::Friendly,
            alive: true,
            location: Some("Tavern".into()),
            knows: vec![NpcKnowledge {
                text: "Secret tunnel".into(),
                scene_id: None,
                timestamp: None,
            }],
            notes: Some("Knows the underground".into()),
            last_seen_scene_id: None,
            created_at: "2026-01-01T00:00:00Z".into(),
        };
        let json = serde_json::to_string(&npc).unwrap();
        let de: NpcCharacter = serde_json::from_str(&json).unwrap();
        assert_eq!(npc, de);
    }

    #[test]
    fn npc_character_defaults() {
        let json = r#"{"id":"n2","name":"Guard","disposition":"unfriendly","alive":true,"created_at":"2026-01-01T00:00:00Z"}"#;
        let npc: NpcCharacter = serde_json::from_str(json).unwrap();
        assert!(npc.knows.is_empty());
        assert!(npc.notes.is_none());
        assert!(npc.location.is_none());
        assert!(npc.last_seen_scene_id.is_none());
    }

    #[test]
    fn doom_clock_tick_counts_down() {
        let mut clock = DoomClock {
            id: "dc1".into(),
            label: "Guard Alert".into(),
            current: 3,
            max: 6,
            consequence: "The guards arrive".into(),
            scene_id: None,
            active: true,
            created_at: "".into(),
        };
        assert!(!clock.tick());
        assert_eq!(clock.current, 2);
        assert!(!clock.tick());
        assert_eq!(clock.current, 1);
        assert!(clock.tick());
        assert_eq!(clock.current, 0);
        assert!(clock.is_expired());
    }

    #[test]
    fn doom_clock_advance_multi_tick() {
        let mut clock = DoomClock {
            id: "dc2".into(),
            label: "Ritual".into(),
            current: 4,
            max: 8,
            consequence: "Demon summoned".into(),
            scene_id: None,
            active: true,
            created_at: "".into(),
        };
        assert!(!clock.advance(3));
        assert_eq!(clock.current, 1);
        assert!(clock.advance(5));
        assert_eq!(clock.current, 0);
    }

    #[test]
    fn doom_clock_reset() {
        let mut clock = DoomClock {
            id: "dc3".into(),
            label: "Pursuit".into(),
            current: 0,
            max: 4,
            consequence: "Caught".into(),
            scene_id: None,
            active: true,
            created_at: "".into(),
        };
        clock.reset();
        assert_eq!(clock.current, 4);
    }

    #[test]
    fn doom_clock_inactive_doesnt_tick() {
        let mut clock = DoomClock {
            id: "dc4".into(),
            label: "Paused".into(),
            current: 3,
            max: 6,
            consequence: "Bad".into(),
            scene_id: None,
            active: false,
            created_at: "".into(),
        };
        assert!(!clock.tick());
        assert_eq!(clock.current, 3);
    }

    #[test]
    fn doom_clock_roundtrips() {
        let clock = DoomClock {
            id: "dc5".into(),
            label: "Invasion".into(),
            current: 2,
            max: 8,
            consequence: "Army arrives".into(),
            scene_id: Some("s1".into()),
            active: true,
            created_at: "2026-01-01T00:00:00Z".into(),
        };
        let json = serde_json::to_string(&clock).unwrap();
        let de: DoomClock = serde_json::from_str(&json).unwrap();
        assert_eq!(clock, de);
    }

    #[test]
    fn npc_knowledge_legacy_format_deserializes() {
        let json = r#"{"id":"n1","name":"Guard","disposition":"neutral","alive":true,"created_at":"2026-01-01T00:00:00Z","knows":["secret tunnel","guard rotation"]}"#;
        let npc: NpcCharacter = serde_json::from_str(json).unwrap();
        assert_eq!(npc.knows.len(), 2);
        assert_eq!(npc.knows[0].text, "secret tunnel");
        assert!(npc.knows[0].scene_id.is_none());
        assert!(npc.knows[0].timestamp.is_none());
        assert_eq!(npc.knows[1].text, "guard rotation");
    }

    #[test]
    fn npc_knowledge_structured_format_roundtrips() {
        let npc = NpcCharacter {
            id: "n2".into(),
            name: "Merchant".into(),
            disposition: Disposition::Friendly,
            alive: true,
            location: None,
            knows: vec![
                NpcKnowledge {
                    text: "Has a secret stash".into(),
                    scene_id: Some("s1".into()),
                    timestamp: Some("2026-03-01T12:00:00Z".into()),
                },
                NpcKnowledge {
                    text: "OWes money to the guild".into(),
                    scene_id: None,
                    timestamp: None,
                },
            ],
            notes: None,
            last_seen_scene_id: None,
            created_at: "2026-01-01T00:00:00Z".into(),
        };
        let json = serde_json::to_string(&npc).unwrap();
        let de: NpcCharacter = serde_json::from_str(&json).unwrap();
        assert_eq!(npc, de);
        assert_eq!(de.knows[0].scene_id.as_deref(), Some("s1"));
        assert_eq!(
            de.knows[0].timestamp.as_deref(),
            Some("2026-03-01T12:00:00Z")
        );
        assert!(de.knows[1].scene_id.is_none());
    }
}
