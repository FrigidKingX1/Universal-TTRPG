//! Combatant parsing and random-encounter tables. Pure logic — no Tauri.

use auto_dm_core::engine::Combatant;
use auto_dm_core::models::{CharacterProfile, EncounterStatBlock};
use serde_json::Value;

/// Error type for combatant parsing (kept stringly for command-layer compat).
pub type CombatantParseError = String;

/// Build a `Combatant` from a JSON value that is either a CharacterProfile or
/// an EncounterStatBlock (as serialized by the frontend store).
pub fn combatant_from_value(v: &Value) -> Result<Combatant, CombatantParseError> {
    if let Ok(profile) = serde_json::from_value::<CharacterProfile>(v.clone()) {
        return Ok(Combatant::from(&profile));
    }
    if let Ok(block) = serde_json::from_value::<EncounterStatBlock>(v.clone()) {
        return Ok(Combatant::from(&block));
    }
    Err("combatant payload must be a CharacterProfile or EncounterStatBlock".to_string())
}

pub const STANDARD_ENCOUNTERS: [&str; 20] = [
    "A lone wolf",
    "Two wolves",
    "Three wolves",
    "A wounded wolf",
    "Wolf pack leader (Dire Wolf)",
    "Four wolves",
    "A hungry bear",
    "A territorial eagle",
    "Swarm of bats",
    "A giant spider",
    "Two giant spiders",
    "A hungry owlbear",
    "A band of 3 goblins",
    "A goblin scout",
    "Two goblins with wolf riders",
    "A lone orc",
    "Two orcs",
    "An ogre",
    "A troll",
    "A young green dragon (CR adjusted)",
];

pub const EASY_ENCOUNTERS: [&str; 20] = [
    "A curious squirrel",
    "An injured rabbit",
    "A lost traveler",
    "A friendly dog",
    "A flock of birds",
    "A gentle rain",
    "A helpful sprite",
    "An old hermit",
    "A wandering merchant",
    "A sign of recent travel",
    "A broken wagon wheel",
    "A campsite remains",
    "A strange footprint",
    "A glint of metal in the grass",
    "A distant howl",
    "A weathered monument",
    "An abandoned shrine",
    "A natural spring",
    "A patch of berry bushes",
    "A smooth river stone",
];

pub const HARD_ENCOUNTERS: [&str; 20] = [
    "A veteran orc warrior",
    "Two ogres",
    "A wight rises from a grave",
    "A pack of worgs",
    "A stone troll guarding a bridge",
    "A will-o'-wisp lures",
    "A nest of stirges",
    "A chuul in a pond",
    "A manticore on a cliff",
    "A bone naga emerges",
    "A deathlock wight",
    "A shadow mastema",
    "A drider patrol",
    "A hezrou demon (minor gate)",
    "A young copper dragon",
    "A frost giant patrol",
    "An ettin in the hills",
    "Two minotaurs",
    "A wyrmscale bounty hunter",
    "The campaign's primary antagonist appears",
];
