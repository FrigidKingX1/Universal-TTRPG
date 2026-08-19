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
