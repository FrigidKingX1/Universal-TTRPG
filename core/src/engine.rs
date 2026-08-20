use super::dice::{DiceEngine, DiceError, RollResult};
use super::models::{ActionDefinition, CharacterProfile, EncounterStatBlock, ResolutionType};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Derive the standard d20-style ability modifier from a raw score.
pub fn attribute_modifier(raw: i32) -> i32 {
    (raw - 10).div_euclid(2)
}

/// Unified combat participant. Converted from either a `CharacterProfile`
/// (player character) or an `EncounterStatBlock` (NPC / monster), keeping the
/// engine system-agnostic.
#[derive(Debug, Clone)]
pub struct Combatant {
    pub id: String,
    pub name: String,
    pub hit_points: i32,
    pub max_hit_points: i32,
    pub armor_class: i32,
    /// Raw attribute scores, e.g. `{"STR": 16, "DEX": 14}`.
    pub attributes: HashMap<String, i32>,
    /// Numeric bonuses addressable via `@bonus.<name>`, e.g. proficiency.
    pub bonuses: HashMap<String, i32>,
    pub actions: Vec<String>,
    pub status: Option<String>,
    /// Damage types this creature is resistant to (half damage).
    pub resistances: Vec<String>,
    /// Damage types this creature is vulnerable to (double damage).
    pub vulnerabilities: Vec<String>,
    /// Damage types this creature is immune to (zero damage).
    pub immunities: Vec<String>,
}

impl Combatant {
    pub fn resolve_ref(&self, path: &str) -> Option<i64> {
        let path = path.trim();
        if let Some(rest) = path.strip_prefix("attributes.") {
            let (attr, field) = rest.split_once('.')?;
            let raw = self.attributes.get(attr)?;
            let v = match field {
                "derived_modifier" => attribute_modifier(*raw),
                "current_value" | "base_value" => *raw,
                _ => return None,
            };
            return Some(v as i64);
        }
        if let Some(rest) = path.strip_prefix("bonus.") {
            return self.bonuses.get(rest).copied().map(|v| v as i64);
        }
        if path == "armor_class" || path == "ac" {
            return Some(self.armor_class as i64);
        }
        if path == "hit_points" || path == "hp" {
            return Some(self.hit_points as i64);
        }
        None
    }
}

impl From<&CharacterProfile> for Combatant {
    fn from(p: &CharacterProfile) -> Self {
        let attributes: HashMap<String, i32> = p
            .attributes
            .iter()
            .map(|(k, v)| (k.clone(), v.current_value))
            .collect();
        let hp = p.resource_pools.get("hp").map(|r| r.current).unwrap_or(10);
        let ac = p
            .attributes
            .get("DEX")
            .map(|d| 10 + attribute_modifier(d.current_value))
            .unwrap_or(10);
        Combatant {
            id: p.id.clone(),
            name: p.identity.name.clone(),
            hit_points: hp,
            max_hit_points: p.resource_pools.get("hp").map(|r| r.maximum).unwrap_or(hp),
            armor_class: ac,
            attributes,
            bonuses: HashMap::new(),
            actions: p.abilities.clone(),
            status: None,
            resistances: Vec::new(),
            vulnerabilities: Vec::new(),
            immunities: Vec::new(),
        }
    }
}

impl From<&EncounterStatBlock> for Combatant {
    fn from(s: &EncounterStatBlock) -> Self {
        Combatant {
            id: s.id.clone(),
            name: s.name.clone(),
            hit_points: s.hit_points.current,
            max_hit_points: s.hit_points.maximum,
            armor_class: s.armor_class,
            attributes: s.attributes.clone(),
            bonuses: HashMap::new(),
            actions: s.actions.clone(),
            status: None,
            resistances: s.resistances.clone(),
            vulnerabilities: s.vulnerabilities.clone(),
            immunities: s.immunities.clone(),
        }
    }
}

/// Optional skill check required before an action resolves (Deliverable 3).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrerequisiteCheck {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attribute: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub skill: Option<String>,
    pub dc: i32,
    #[serde(default)]
    pub reason: String,
}

impl PrerequisiteCheck {
    fn roll_formula(&self) -> String {
        match &self.attribute {
            Some(a) => format!("1d20 + @attributes.{a}.derived_modifier"),
            None => "1d20".to_string(),
        }
    }
}

/// Structured outcome emitted after the engine resolves an action.
#[derive(Debug, Clone, Serialize)]
pub struct EngineOutcome {
    pub check_result: Option<String>,
    pub check_roll: Option<i32>,
    pub check_detail: Option<String>,
    pub attack_result: String,
    pub attack_roll: Option<i32>,
    pub attack_detail: Option<String>,
    pub target_ac: Option<i32>,
    pub damage_dealt: i32,
    pub target_hp_remaining: i32,
    pub target_status: String,
    pub applied_status: Option<String>,
    /// The damage type of the attack (if any).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub damage_type: Option<String>,
    /// Modifier note: "resisted", "vulnerable", or "immune".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub damage_modifier: Option<String>,
}

/// Error type for the combat engine.
#[derive(Debug)]
pub enum EngineError {
    Dice(DiceError),
    MissingAction(String),
    NoDefense(String),
    InvalidTargetDc(String),
}

impl std::fmt::Display for EngineError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            EngineError::Dice(e) => write!(f, "{e}"),
            EngineError::MissingAction(id) => write!(f, "action `{id}` not found"),
            EngineError::NoDefense(id) => write!(f, "action `{id}` has no resolvable defense"),
            EngineError::InvalidTargetDc(v) => write!(f, "invalid target DC `{v}`"),
        }
    }
}

impl std::error::Error for EngineError {}

impl From<DiceError> for EngineError {
    fn from(e: DiceError) -> Self {
        EngineError::Dice(e)
    }
}

/// Apply damage to a combatant, returning the resulting status.
pub fn apply_damage(target: &mut Combatant, amount: i32) -> String {
    let amount = amount.max(0);
    target.hit_points = target.hit_points.saturating_sub(amount);
    if target.hit_points <= 0 {
        target.status = Some("DEFEATED".to_string());
        "DEFEATED".to_string()
    } else {
        target.status = None;
        "ALIVE".to_string()
    }
}

/// Modify raw damage based on the target's resistances, vulnerabilities, and immunities.
/// Returns the adjusted damage (immune → 0, resistant → half, vulnerable → double).
pub fn modify_damage_for_type(raw: i32, damage_type: &str, target: &Combatant) -> i32 {
    let dt = damage_type.to_lowercase();
    if target
        .resistances
        .iter()
        .any(|r| r.eq_ignore_ascii_case(&dt))
    {
        raw / 2
    } else if target
        .vulnerabilities
        .iter()
        .any(|v| v.eq_ignore_ascii_case(&dt))
    {
        raw * 2
    } else if target
        .immunities
        .iter()
        .any(|i| i.eq_ignore_ascii_case(&dt))
    {
        0
    } else {
        raw
    }
}

/// Heal a combatant, clamped to its maximum.
pub fn apply_healing(target: &mut Combatant, amount: i32) -> i32 {
    let before = target.hit_points;
    target.hit_points = (target.hit_points + amount).min(target.max_hit_points);
    if target.hit_points > 0 {
        target.status = None;
    }
    target.hit_points - before
}

/// Resolve the defense value an action rolls against, from the target combatant.
fn resolve_defense(action: &ActionDefinition, target: &Combatant) -> Result<i32, EngineError> {
    let vs = action
        .resolution
        .vs_defense
        .as_deref()
        .unwrap_or("armor_class");
    if vs == "armor_class" || vs == "ac" {
        return Ok(target.armor_class);
    }
    if let Ok(n) = vs.parse::<i32>() {
        return Ok(n);
    }
    if let Some(raw) = target.attributes.get(vs) {
        return Ok(*raw);
    }
    Err(EngineError::NoDefense(action.id.clone()))
}

/// Evaluate a roll formula against a combatant, applying advantage/disadvantage
/// semantics when the expression is a plain `2d20kh1` / `2d20kl1` (pass-through).
fn roll_for(
    dice: &mut DiceEngine,
    actor: &Combatant,
    formula: &str,
) -> Result<RollResult, EngineError> {
    dice.evaluate_with(formula, &|path| actor.resolve_ref(path))
        .map_err(EngineError::from)
}

/// Execute an attack action from `attacker` against `target`.
///
/// Mirrors the Deliverable 3 round-trip:
/// prerequisite check -> attack roll vs defense -> damage -> HP -> status.
pub fn execute_attack(
    dice: &mut DiceEngine,
    attacker: &Combatant,
    target: &mut Combatant,
    action: &ActionDefinition,
    prereq: Option<&PrerequisiteCheck>,
) -> Result<EngineOutcome, EngineError> {
    // 1. Prerequisite skill check (optional).
    let mut check_result: Option<String> = None;
    let mut check_roll: Option<i32> = None;
    let mut check_detail: Option<String> = None;
    if let Some(p) = prereq {
        let formula = p.roll_formula();
        let roll = roll_for(dice, attacker, &formula)?;
        check_roll = Some(roll.total as i32);
        check_detail = Some(roll.detail.clone());
        if roll.total < p.dc as i64 {
            check_result = Some("FAILURE".to_string());
            return Ok(EngineOutcome {
                check_result,
                check_roll,
                check_detail,
                attack_result: "BLOCKED".to_string(),
                attack_roll: None,
                attack_detail: None,
                target_ac: None,
                damage_dealt: 0,
                target_hp_remaining: target.hit_points,
                target_status: current_status(target),
                applied_status: None,
                damage_type: None,
                damage_modifier: None,
            });
        }
        check_result = Some("SUCCESS".to_string());
    }

    let resolution = &action.resolution;

    // 2. Resolve the action.
    let attack_result: String;
    let mut attack_roll: Option<i32> = None;
    let mut attack_detail: Option<String> = None;
    let mut damage_dealt: i32 = 0;
    let mut applied_status: Option<String> = None;

    match resolution.resolution_type {
        ResolutionType::GuaranteedEffect => {
            // No to-hit roll; effect always lands (Draw Steel / Cairn style).
            attack_result = "GUARANTEED".to_string();
            if let Some(out) = &resolution.outcomes {
                if let Some(s) = &out.on_success {
                    if let Some(f) = &s.formula {
                        let dmg = roll_for(dice, attacker, f)?;
                        attack_detail = Some(dmg.detail.clone());
                        damage_dealt = dmg.total as i32;
                    }
                    applied_status = s.applied_status.clone();
                }
            }
        }
        ResolutionType::ContestedCheck | ResolutionType::OpposedRoll => {
            let formula = resolution
                .roll_formula
                .clone()
                .unwrap_or_else(|| "1d20 + @attributes.DEX.derived_modifier".to_string());
            let roll = roll_for(dice, attacker, &formula)?;
            attack_roll = Some(roll.total as i32);
            attack_detail = Some(roll.detail.clone());

            let target_value = if resolution.resolution_type == ResolutionType::OpposedRoll {
                let t_formula = "1d20 + @attributes.DEX.derived_modifier".to_string();
                roll_for(dice, target, &t_formula)?.total as i32
            } else {
                resolve_defense(action, target)?
            };

            if roll.total >= target_value as i64 {
                attack_result = "HIT".to_string();
                if let Some(out) = &resolution.outcomes {
                    if let Some(s) = &out.on_success {
                        if let Some(f) = &s.formula {
                            let dmg = roll_for(dice, attacker, f)?;
                            let prev = attack_detail.as_deref().unwrap_or("");
                            attack_detail = Some(format!("{prev} | {}", dmg.detail));
                            damage_dealt = dmg.total as i32;
                        }
                        applied_status = s.applied_status.clone();
                    }
                }
            } else {
                attack_result = "MISS".to_string();
                if let Some(out) = &resolution.outcomes {
                    if let Some(f) = &out.on_failure {
                        if f.half_damage {
                            if let Some(df) = &f.formula {
                                let dmg = roll_for(dice, attacker, df)?;
                                damage_dealt = dmg.total as i32 / 2;
                            } else if let Some(s) = &out.on_success {
                                if let Some(sf) = &s.formula {
                                    let dmg = roll_for(dice, attacker, sf)?;
                                    damage_dealt = dmg.total as i32 / 2;
                                }
                            }
                        } else if let Some(df) = &f.formula {
                            let dmg = roll_for(dice, attacker, df)?;
                            damage_dealt = dmg.total as i32;
                        }
                    }
                }
            }
        }
        ResolutionType::TargetDc => {
            let formula = resolution
                .roll_formula
                .clone()
                .unwrap_or_else(|| "1d20 + @attributes.DEX.derived_modifier".to_string());
            let roll = roll_for(dice, attacker, &formula)?;
            attack_roll = Some(roll.total as i32);
            attack_detail = Some(roll.detail.clone());
            let dc = resolve_defense(action, target)?;
            if roll.total >= dc as i64 {
                attack_result = "HIT".to_string();
                if let Some(out) = &resolution.outcomes {
                    if let Some(s) = &out.on_success {
                        if let Some(f) = &s.formula {
                            let dmg = roll_for(dice, attacker, f)?;
                            let prev = attack_detail.as_deref().unwrap_or("");
                            attack_detail = Some(format!("{prev} | {}", dmg.detail));
                            damage_dealt = dmg.total as i32;
                        }
                        applied_status = s.applied_status.clone();
                    }
                }
            } else {
                attack_result = "MISS".to_string();
            }
        }
    }

    // 3. Apply damage-type modifiers (resistance/vulnerability/immunity).
    let damage_type_str = resolution
        .outcomes
        .as_ref()
        .and_then(|o| o.on_success.as_ref())
        .and_then(|s| s.damage_type.as_deref())
        .unwrap_or("");
    let mut damage_modifier: Option<String> = None;
    if !damage_type_str.is_empty() {
        let dt = damage_type_str.to_lowercase();
        let pre_modifier = damage_dealt;
        if !target
            .immunities
            .iter()
            .any(|i| i.eq_ignore_ascii_case(&dt))
        {
            damage_dealt = modify_damage_for_type(damage_dealt, damage_type_str, target);
            if damage_dealt < pre_modifier {
                damage_modifier = Some("resisted".to_string());
            } else if damage_dealt > pre_modifier {
                damage_modifier = Some("vulnerable".to_string());
            }
        } else {
            damage_dealt = 0;
            damage_modifier = Some("immune".to_string());
        }
    }

    // 4. Apply damage and compute status.
    let target_status = if damage_dealt > 0 {
        apply_damage(target, damage_dealt)
    } else {
        current_status(target)
    };

    Ok(EngineOutcome {
        check_result,
        check_roll,
        check_detail,
        attack_result,
        attack_roll,
        attack_detail,
        target_ac: resolution
            .vs_defense
            .as_ref()
            .and_then(|_| resolve_defense(action, target).ok()),
        damage_dealt,
        target_hp_remaining: target.hit_points,
        target_status,
        applied_status,
        damage_type: if damage_type_str.is_empty() {
            None
        } else {
            Some(damage_type_str.to_string())
        },
        damage_modifier,
    })
}

fn current_status(target: &Combatant) -> String {
    if target.hit_points <= 0 {
        "DEFEATED".to_string()
    } else {
        "ALIVE".to_string()
    }
}

/// A single initiative roll entry for the combat round.
#[derive(Debug, Clone, Serialize)]
pub struct InitiativeEntry {
    pub combatant_id: String,
    pub name: String,
    pub roll: i32,
    pub modifier: i32,
}

/// Roll initiative for a group of combatants, sorted descending.
pub fn roll_initiative(
    dice: &mut DiceEngine,
    combatants: &[Combatant],
    formula: &str,
) -> Result<Vec<InitiativeEntry>, EngineError> {
    let formula = if formula.is_empty() {
        "1d20 + @bonus.initiative"
    } else {
        formula
    };
    let mut entries: Vec<InitiativeEntry> = Vec::with_capacity(combatants.len());
    for c in combatants {
        let roll = roll_for(dice, c, formula)?;
        let modifier = c.resolve_ref("bonus.initiative").unwrap_or(0) as i32;
        entries.push(InitiativeEntry {
            combatant_id: c.id.clone(),
            name: c.name.clone(),
            roll: roll.total as i32,
            modifier,
        });
    }
    entries.sort_by(|a, b| {
        b.roll
            .cmp(&a.roll)
            .then(b.modifier.cmp(&a.modifier))
            .then(a.name.cmp(&b.name))
    });
    Ok(entries)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{
        ActionCost, CostType, HitPoints, Identity, LootTableEntry, Outcomes, Resolution,
        ResourcePool, SuccessOutcome, TargetType, Targeting,
    };

    fn profile_with_str(name: &str, str: i32, dex: i32, hp: i32) -> CharacterProfile {
        let mut attributes = HashMap::new();
        let mut rp = HashMap::new();
        rp.insert(
            "hp".to_string(),
            ResourcePool {
                current: hp,
                maximum: hp,
                temporary: 0,
                reset_condition: crate::models::ResetCondition::LongRest,
            },
        );
        for (k, v) in [("STR", str), ("DEX", dex)] {
            attributes.insert(
                k.to_string(),
                crate::models::AttributeState {
                    base_value: v,
                    current_value: v,
                    derived_modifier: Some(attribute_modifier(v)),
                },
            );
        }
        CharacterProfile {
            id: format!("{name}_id"),
            system_id: "dnd5e_srd".to_string(),
            identity: Identity {
                name: name.to_string(),
                ancestry: None,
                archetype: None,
                background: None,
                level_or_rank: 1,
            },
            attributes,
            resource_pools: rp,
            inventory: Vec::new(),
            abilities: vec!["longsword_slash".to_string()],
        }
    }

    fn longsword() -> ActionDefinition {
        ActionDefinition {
            id: "longsword_slash".to_string(),
            name: "Longsword Slash".to_string(),
            action_cost: ActionCost {
                cost_type: CostType::Action,
                amount: 1,
            },
            targeting: Some(Targeting {
                range_feet: Some(5),
                target_type: TargetType::SingleEntity,
                shape: None,
                size_feet: 0,
            }),
            resolution: Resolution {
                resolution_type: ResolutionType::ContestedCheck,
                primary_attribute: Some("STR".to_string()),
                roll_formula: Some("1d20 + @attributes.STR.derived_modifier".to_string()),
                vs_defense: Some("armor_class".to_string()),
                outcomes: Some(Outcomes {
                    on_success: Some(SuccessOutcome {
                        formula: Some("1d8 + @attributes.STR.derived_modifier".to_string()),
                        damage_type: Some("slashing".to_string()),
                        applied_status: None,
                    }),
                    on_failure: None,
                }),
            },
        }
    }

    fn goblin() -> EncounterStatBlock {
        let mut attributes = HashMap::new();
        attributes.insert("DEX".to_string(), 14);
        attributes.insert("CON".to_string(), 10);
        EncounterStatBlock {
            id: "npc_goblin_01".to_string(),
            name: "Goblin Scout".to_string(),
            challenge_rating: 0.25,
            size: Some(crate::models::Size::Small),
            creature_type: None,
            alignment: Some("Neutral Evil".to_string()),
            armor_class: 15,
            hit_points: HitPoints {
                current: 7,
                maximum: 7,
                formula: Some("2d6 - 2".to_string()),
            },
            speed_feet: Some(30),
            attributes,
            actions: vec![],
            loot_table: vec![],
            resistances: Vec::new(),
            vulnerabilities: Vec::new(),
            immunities: Vec::new(),
        }
    }

    #[test]
    fn combatant_from_profile_and_statblock() {
        let p = profile_with_str("Hero", 16, 14, 20);
        let c = Combatant::from(&p);
        assert_eq!(c.armor_class, 12); // 10 + DEX(2)
        assert_eq!(c.hit_points, 20);
        assert_eq!(c.resolve_ref("attributes.STR.derived_modifier"), Some(3));

        let s = goblin();
        let g = Combatant::from(&s);
        assert_eq!(g.armor_class, 15);
        assert_eq!(g.hit_points, 7);
        assert_eq!(g.resolve_ref("attributes.DEX.current_value"), Some(14));
        assert_eq!(g.resolve_ref("armor_class"), Some(15));
    }

    #[test]
    fn successful_attack_hits_and_damages() {
        let mut dice = DiceEngine::with_seed(1);
        let attacker = Combatant::from(&profile_with_str("Hero", 16, 14, 20));
        let mut target = Combatant::from(&goblin());
        // Armor Class 5 makes a +3 attack always hit.
        target.armor_class = 5;
        let action = longsword();
        let outcome = execute_attack(&mut dice, &attacker, &mut target, &action, None).unwrap();
        assert_eq!(outcome.attack_result, "HIT");
        assert!(outcome.damage_dealt > 0);
        assert!(outcome.target_hp_remaining < 7);
        assert!(matches!(
            outcome.target_status.as_str(),
            "ALIVE" | "DEFEATED"
        ));
    }

    #[test]
    fn attack_misses_against_high_ac() {
        let mut dice = DiceEngine::with_seed(1);
        let attacker = Combatant::from(&profile_with_str("Hero", 16, 14, 20));
        let mut target = Combatant::from(&goblin());
        target.armor_class = 100;
        let action = longsword();
        let outcome = execute_attack(&mut dice, &attacker, &mut target, &action, None).unwrap();
        assert_eq!(outcome.attack_result, "MISS");
        assert_eq!(outcome.damage_dealt, 0);
        assert_eq!(outcome.target_hp_remaining, 7);
    }

    #[test]
    fn defeated_at_zero_hp() {
        let mut dice = DiceEngine::with_seed(1);
        let attacker = Combatant::from(&profile_with_str("Hero", 20, 14, 20));
        let mut target = Combatant::from(&goblin());
        let action = longsword();
        let outcome = execute_attack(&mut dice, &attacker, &mut target, &action, None).unwrap();
        if outcome.damage_dealt >= 7 {
            assert_eq!(outcome.target_status, "DEFEATED");
            assert_eq!(outcome.target_hp_remaining, 0);
        } else {
            assert_eq!(outcome.target_status, "ALIVE");
        }
    }

    #[test]
    fn prerequisite_failure_blocks_action() {
        let mut dice = DiceEngine::with_seed(1);
        let attacker = Combatant::from(&profile_with_str("Hero", 16, 14, 20));
        let mut target = Combatant::from(&goblin());
        let action = longsword();
        let prereq = PrerequisiteCheck {
            attribute: Some("DEX".to_string()),
            skill: Some("Acrobatics".to_string()),
            dc: 30,
            reason: "Jump across a 10-foot chasm".to_string(),
        };
        let outcome =
            execute_attack(&mut dice, &attacker, &mut target, &action, Some(&prereq)).unwrap();
        assert_eq!(outcome.check_result.as_deref(), Some("FAILURE"));
        assert_eq!(outcome.attack_result, "BLOCKED");
        assert_eq!(outcome.damage_dealt, 0);
        assert_eq!(target.hit_points, 7);
    }

    #[test]
    fn guaranteed_effect_never_misses() {
        let mut dice = DiceEngine::with_seed(1);
        let attacker = Combatant::from(&profile_with_str("Hero", 16, 14, 20));
        let mut target = Combatant::from(&goblin());
        let action = ActionDefinition {
            id: "cairn_swing".to_string(),
            name: "Cairn Swing".to_string(),
            action_cost: ActionCost {
                cost_type: CostType::Action,
                amount: 1,
            },
            targeting: None,
            resolution: Resolution {
                resolution_type: ResolutionType::GuaranteedEffect,
                primary_attribute: Some("STR".to_string()),
                roll_formula: None,
                vs_defense: None,
                outcomes: Some(Outcomes {
                    on_success: Some(SuccessOutcome {
                        formula: Some("1d6".to_string()),
                        damage_type: Some("physical".to_string()),
                        applied_status: None,
                    }),
                    on_failure: None,
                }),
            },
        };
        let outcome = execute_attack(&mut dice, &attacker, &mut target, &action, None).unwrap();
        assert_eq!(outcome.attack_result, "GUARANTEED");
        assert!(outcome.damage_dealt >= 1);
    }

    #[test]
    fn initiative_sorted_descending() {
        let mut dice = DiceEngine::with_seed(1);
        let mut a = Combatant::from(&profile_with_str("Hero", 16, 14, 20));
        let mut b = Combatant::from(&goblin());
        a.bonuses.insert("initiative".to_string(), 2);
        b.bonuses.insert("initiative".to_string(), 2);
        let entries = roll_initiative(&mut dice, &[a, b], "1d20 + @bonus.initiative").unwrap();
        assert_eq!(entries.len(), 2);
        assert!(entries[0].roll >= entries[1].roll);
    }

    #[test]
    fn healing_clamped_to_max() {
        let mut target = Combatant::from(&goblin());
        target.hit_points = 2;
        let healed = apply_healing(&mut target, 20);
        assert_eq!(target.hit_points, 7);
        assert_eq!(healed, 5);
    }

    #[test]
    fn negative_damage_clamped_to_zero() {
        let mut target = Combatant::from(&goblin());
        let status = apply_damage(&mut target, -5);
        assert_eq!(status, "ALIVE");
        assert_eq!(target.hit_points, 7);
    }

    #[test]
    fn attribute_modifier_div_euclid() {
        assert_eq!(attribute_modifier(10), 0);
        assert_eq!(attribute_modifier(11), 0);
        assert_eq!(attribute_modifier(12), 1);
        assert_eq!(attribute_modifier(9), -1);
        assert_eq!(attribute_modifier(8), -1);
        assert_eq!(attribute_modifier(1), -5);
        assert_eq!(attribute_modifier(30), 10);
    }

    #[test]
    fn combatant_resolve_ref_fallbacks() {
        let mut c = Combatant::from(&goblin());
        c.bonuses.insert("initiative".to_string(), 3);
        assert_eq!(c.resolve_ref("bonus.initiative"), Some(3));
        assert_eq!(c.resolve_ref("bonus.missing"), None);
        assert_eq!(c.resolve_ref("unknown.path"), None);
        assert_eq!(c.resolve_ref("hit_points"), Some(7));
        assert_eq!(c.resolve_ref("hp"), Some(7));
        assert_eq!(c.resolve_ref(" armor_class "), Some(15));
        assert_eq!(c.resolve_ref("ac"), Some(15));
    }

    #[test]
    fn combatant_from_profile_converts_correctly() {
        let p = profile_with_str("Fighter", 16, 12, 25);
        let c = Combatant::from(&p);
        assert_eq!(c.name, "Fighter");
        assert_eq!(c.max_hit_points, 25);
        assert_eq!(c.armor_class, 11); // 10 + DEX(1)
        assert!(c.actions.contains(&"longsword_slash".to_string()));
    }

    #[test]
    fn combatant_from_statblock_converts_correctly() {
        let s = EncounterStatBlock {
            id: "test_id".to_string(),
            name: "Orc".to_string(),
            challenge_rating: 0.5,
            size: Some(crate::models::Size::Medium),
            creature_type: Some("humanoid".to_string()),
            alignment: Some("chaotic evil".to_string()),
            armor_class: 13,
            hit_points: HitPoints {
                current: 15,
                maximum: 15,
                formula: Some("2d8+6".to_string()),
            },
            speed_feet: Some(30),
            attributes: HashMap::from([("STR".to_string(), 16), ("DEX".to_string(), 12)]),
            actions: vec!["greataxe".to_string()],
            loot_table: vec![
                LootTableEntry {
                    name: "Gold Coins".to_string(),
                    quantity_formula: "2d6".to_string(),
                    chance: 100,
                },
                LootTableEntry {
                    name: "Magic Sword".to_string(),
                    quantity_formula: "1".to_string(),
                    chance: 10,
                },
            ],
            resistances: Vec::new(),
            vulnerabilities: Vec::new(),
            immunities: Vec::new(),
        };
        let c = Combatant::from(&s);
        assert_eq!(c.name, "Orc");
        assert_eq!(c.armor_class, 13);
        assert_eq!(c.hit_points, 15);
        assert!(c.actions.contains(&"greataxe".to_string()));
    }

    #[test]
    fn loot_table_rolls_correctly() {
        let mut dice = DiceEngine::with_seed(1);
        let loot_table = vec![
            LootTableEntry {
                name: "Gold".to_string(),
                quantity_formula: "2d6".to_string(),
                chance: 100,
            },
            LootTableEntry {
                name: "Rare Gem".to_string(),
                quantity_formula: "1".to_string(),
                chance: 5,
            },
        ];
        let rolled = crate::models::roll_loot_table(&mut dice, &loot_table);
        assert!(!rolled.is_empty());
        assert!(rolled.iter().any(|l| l.name == "Gold"));
    }

    #[test]
    fn modify_damage_resistance_halves() {
        let mut target = make_combatant("T");
        target.resistances.push("fire".to_string());
        assert_eq!(modify_damage_for_type(20, "fire", &target), 10);
        assert_eq!(modify_damage_for_type(15, "Fire", &target), 7);
    }

    #[test]
    fn modify_damage_vulnerability_doubles() {
        let mut target = make_combatant("T");
        target.vulnerabilities.push("cold".to_string());
        assert_eq!(modify_damage_for_type(5, "cold", &target), 10);
    }

    #[test]
    fn modify_damage_immunity_zeroes() {
        let mut target = make_combatant("T");
        target.immunities.push("psychic".to_string());
        assert_eq!(modify_damage_for_type(50, "psychic", &target), 0);
    }

    #[test]
    fn modify_damage_no_match_passthrough() {
        let target = make_combatant("T");
        assert_eq!(modify_damage_for_type(12, "fire", &target), 12);
    }

    #[test]
    fn damage_type_display_and_parse() {
        assert_eq!(crate::models::DamageType::Slashing.as_str(), "slashing");
        assert_eq!(
            crate::models::DamageType::from_str_opt("Fire"),
            Some(crate::models::DamageType::Fire)
        );
        assert_eq!(crate::models::DamageType::from_str_opt("bogus"), None);
        assert_eq!(format!("{}", crate::models::DamageType::Radiant), "radiant");
    }

    #[test]
    fn statblock_resistances_serialize() {
        let mut attrs = HashMap::new();
        attrs.insert("STR".to_string(), 16);
        let s = EncounterStatBlock {
            id: "t".into(),
            name: "T".into(),
            challenge_rating: 1.0,
            size: None,
            creature_type: None,
            alignment: None,
            armor_class: 14,
            hit_points: HitPoints {
                current: 30,
                maximum: 30,
                formula: None,
            },
            speed_feet: None,
            attributes: attrs,
            actions: vec![],
            loot_table: vec![],
            resistances: vec!["fire".into()],
            vulnerabilities: vec!["cold".into()],
            immunities: vec!["poison".into()],
        };
        let c = Combatant::from(&s);
        assert_eq!(c.resistances, vec!["fire"]);
        assert_eq!(c.vulnerabilities, vec!["cold"]);
        assert_eq!(c.immunities, vec!["poison"]);
    }

    fn make_combatant(name: &str) -> Combatant {
        let mut attrs = HashMap::new();
        attrs.insert("STR".to_string(), 10);
        Combatant {
            id: name.to_string(),
            name: name.to_string(),
            hit_points: 20,
            max_hit_points: 20,
            armor_class: 10,
            attributes: attrs,
            bonuses: HashMap::new(),
            actions: vec![],
            status: None,
            resistances: Vec::new(),
            vulnerabilities: Vec::new(),
            immunities: Vec::new(),
        }
    }
}
