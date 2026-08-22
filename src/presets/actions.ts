import type { ActionDefinition } from "../types";
import { CLASS_ACTIONS } from "./classes";
import { PRESET_ACTIONS as MONSTER_ACTIONS } from "./bestiary";

const mk = (
  id: string,
  name: string,
  formula: string,
  damageType: string,
  attr: "STR" | "DEX" | "CON" | "INT" | "WIS" | "CHA",
  rangeFeet = 5,
  appliedStatus?: string,
  shape?: { type: "sphere" | "cone" | "cube" | "line"; sizeFeet: number },
  autoHit?: boolean,
): ActionDefinition => ({
  id,
  name,
  action_cost: { type: "action", amount: 1 },
  targeting:
    shape || rangeFeet > 5
      ? {
          range_feet: rangeFeet,
          target_type: shape ? "area_of_effect" : "single_entity",
          shape: shape?.type,
          size_feet: shape?.sizeFeet ?? 0,
        }
      : { range_feet: rangeFeet, target_type: "single_entity", shape: undefined, size_feet: 0 },
  resolution: {
    // autoHit = guaranteed_effect (no attack roll, e.g. Magic Missile);
    // everything else is an attack roll vs AC using the caster's attribute.
    type: autoHit ? "guaranteed_effect" : "target_dc",
    primary_attribute: attr,
    roll_formula: autoHit ? undefined : `1d20 + @attributes.${attr}.derived_modifier`,
    vs_defense: autoHit ? undefined : "armor_class",
    outcomes: {
      on_success: { formula, damage_type: damageType, applied_status: appliedStatus },
    },
  },
});

/** Weapon attacks (martial + simple). */
export const WEAPON_ACTIONS: ActionDefinition[] = [
  mk("act_longsword", "Longsword", "1d8 + @attributes.STR.derived_modifier", "slashing", "STR"),
  mk("act_shortsword", "Shortsword", "1d6 + @attributes.DEX.derived_modifier", "piercing", "DEX"),
  mk("act_greatsword", "Greatsword", "2d6 + @attributes.STR.derived_modifier", "slashing", "STR"),
  mk("act_javelin", "Javelin", "1d6 + @attributes.STR.derived_modifier", "piercing", "STR", 30),
  mk("act_battleaxe", "Battleaxe", "1d8 + @attributes.STR.derived_modifier", "slashing", "STR"),
  mk("act_warhammer", "Warhammer", "1d8 + @attributes.STR.derived_modifier", "bludgeoning", "STR"),
  mk("act_spear", "Spear", "1d6 + @attributes.STR.derived_modifier", "piercing", "STR"),
  mk("act_halberd", "Halberd", "1d10 + @attributes.STR.derived_modifier", "slashing", "STR"),
  mk("act_whip", "Whip", "1d4 + @attributes.DEX.derived_modifier", "slashing", "DEX", 10),
  mk("act_morningstar_sm", "Morningstar", "1d8 + @attributes.STR.derived_modifier", "piercing", "STR"),
  mk("act_handaxe", "Handaxe", "1d4 + @attributes.STR.derived_modifier", "slashing", "STR"),
  mk("act_lightcrossbow", "Light Crossbow", "1d8 + @attributes.DEX.derived_modifier", "piercing", "DEX", 80),
  mk("act_heavycrossbow", "Heavy Crossbow", "1d10 + @attributes.DEX.derived_modifier", "piercing", "DEX", 100),
  mk("act_shortbow", "Shortbow", "1d6 + @attributes.DEX.derived_modifier", "piercing", "DEX", 80),
  mk("act_sling", "Sling", "1d4 + @attributes.DEX.derived_modifier", "bludgeoning", "DEX", 30),
];

/** Restorative actions — guaranteed effect, formula is the HP restored. */
const mkHeal = (
  id: string,
  name: string,
  formula: string,
  attr: "STR" | "DEX" | "CON" | "INT" | "WIS" | "CHA",
  rangeFeet = 5,
  costType: "action" | "bonus_action" = "action",
  slotPool = "spell_slots_l1",
): ActionDefinition => ({
  id,
  name,
  action_cost: { type: costType, amount: 1 },
  targeting: { range_feet: rangeFeet, target_type: "single_entity", shape: undefined, size_feet: 0 },
  resolution: {
    // Healing never misses; the caster simply channels the restoration.
    type: "guaranteed_effect",
    primary_attribute: attr,
    outcomes: {
      on_success: { formula, damage_type: undefined, applied_status: undefined, heal: true },
    },
  },
  // Healing spells draw from the caster's spell-slot pool for their tier.
  slot_cost: { pool: slotPool, amount: 1 },
});

/** Spell-like abilities for casters (attack-roll approximation of save spells). */
export const SPELL_ACTIONS: ActionDefinition[] = [
  mk("act_magic_missile", "Magic Missile", "3d4 + 3", "force", "INT", 120, undefined, undefined, true),
  mk("act_eldritch_blast", "Eldritch Blast", "1d10", "force", "CHA", 120),
  mk("act_ray_of_frost", "Ray of Frost", "1d8", "cold", "INT", 60),
  mk("act_chill_touch", "Chill Touch", "1d8", "necrotic", "INT", 120),
  mk("act_acid_splash", "Acid Splash", "1d6", "acid", "INT", 60),
  mk("act_poison_spray", "Poison Spray", "1d12", "poison", "CON", 10),
  mk("act_vicious_mockery", "Vicious Mockery", "1d4", "psychic", "CHA", 60),
  mk("act_burning_hands", "Burning Hands", "3d6", "fire", "INT", 15, undefined, { type: "cone", sizeFeet: 15 }),
  mk("act_thunderwave", "Thunderwave", "2d8", "thunder", "INT", 15, "Prone", { type: "cube", sizeFeet: 15 }),
  mk("act_shatter", "Shatter", "3d8", "thunder", "INT", 60),
  mk("act_guiding_bolt", "Guiding Bolt", "4d6", "radiant", "WIS", 120),
  mk("act_inflict_wounds", "Inflict Wounds", "3d10", "necrotic", "WIS"),
  mk("act_shocking_grasp", "Shocking Grasp", "2d8", "lightning", "INT"),
  mk("act_ray_of_sickness", "Ray of Sickness", "2d8", "poison", "INT", 60, "Poisoned"),
  mk("act_cone_of_cold", "Cone of Cold", "8d8", "cold", "INT", 30, undefined, { type: "cone", sizeFeet: 30 }),
  mk("act_thorn_whip", "Thorn Whip", "1d6", "piercing", "WIS", 30),
  mk("act_scorching_ray", "Scorching Ray", "2d6 + 2d6 + 2d6", "fire", "INT", 120),
  mk("act_fireball", "Fireball", "8d6", "fire", "INT", 150, undefined, { type: "sphere", sizeFeet: 20 }),
  mk("act_lightning_bolt", "Lightning Bolt", "8d6", "lightning", "INT", 100, undefined, { type: "line", sizeFeet: 100 }),
  mk("act_ice_storm", "Ice Storm", "2d8 + 2d8", "bludgeoning", "INT", 300),
  mk("act_chain_lightning", "Chain Lightning", "10d8", "lightning", "INT", 150),
  mk("act_flame_strike", "Flame Strike", "4d6 + 4d6", "fire", "WIS", 60),
  mk("act_meteor_swarm", "Meteor Swarm", "20d6", "fire", "INT", 1000),
  mk("act_spiritual_weapon", "Spiritual Weapon", "1d8", "force", "WIS"),

  // Healing spells (heal-outcome path — restore HP on the target).
  mkHeal("act_cure_wounds", "Cure Wounds", "2d8 + @attributes.WIS.derived_modifier", "WIS"),
  mkHeal("act_healing_word", "Healing Word", "1d4 + @attributes.WIS.derived_modifier", "WIS", 60, "bonus_action"),
  mkHeal("act_mass_cure_wounds", "Mass Cure Wounds", "3d8 + @attributes.WIS.derived_modifier", "WIS", 60, "action", "spell_slots_l3"),
];

/** Monster-specific attacks shared across creatures. */
export const MONSTER_ATTACK_ACTIONS: ActionDefinition[] = [
  mk("act_rat_bite", "Rat Bite", "1d4 + @attributes.DEX.derived_modifier", "piercing", "DEX"),
  mk("act_stirge_drain", "Blood Drain", "1d4 + @attributes.DEX.derived_modifier", "piercing", "DEX"),
  mk("act_talons", "Talons", "2d6 + @attributes.STR.derived_modifier", "slashing", "STR"),
  mk("act_grasp", "Grasp", "1d8 + @attributes.STR.derived_modifier", "bludgeoning", "STR", 5, "Restrained"),
  mk("act_engulf", "Engulf", "3d6", "acid", "STR", 5, "Restrained"),
  mk("act_slam_generic", "Slam", "1d6 + @attributes.STR.derived_modifier", "bludgeoning", "STR"),
  mk("act_golem_slam", "Golem Slam", "2d10 + @attributes.STR.derived_modifier", "bludgeoning", "STR"),
  mk("act_corrupting_touch", "Corrupting Touch", "3d12", "necrotic", "CHA"),
  mk("act_life_drain", "Life Drain", "2d8", "necrotic", "WIS"),
  mk("act_strength_drain", "Strength Drain", "2d6", "necrotic", "WIS"),
  mk("act_draining_touch", "Withering Touch", "4d8", "necrotic", "WIS"),
  mk("act_wisp_shock", "Shock", "2d8", "lightning", "CHA"),
  mk("act_hooves", "Hooves", "2d4 + @attributes.STR.derived_modifier", "bludgeoning", "STR"),
  mk("act_tail_spikes", "Tail Spikes", "1d8 + @attributes.DEX.derived_modifier", "piercing", "DEX", 100),
  mk("act_wind_slam", "Wind Slam", "2d8 + @attributes.STR.derived_modifier", "bludgeoning", "STR"),
  mk("act_fire_touch", "Fire Touch", "2d6 + @attributes.STR.derived_modifier", "fire", "STR"),
  mk("act_rock_throw", "Rock Throw", "2d8 + @attributes.STR.derived_modifier", "bludgeoning", "STR", 60),
  mk("act_giant_axe", "Greataxe (Giant)", "3d8 + @attributes.STR.derived_modifier", "slashing", "STR"),
  mk("act_oni_bite", "Bite (Oni)", "1d8 + @attributes.STR.derived_modifier", "piercing", "STR"),
  mk("act_basilisk_bite", "Bite (Basilisk)", "2d8 + @attributes.STR.derived_modifier", "piercing", "STR"),
  mk("act_wyvern_sting", "Sting", "1d8 + @attributes.STR.derived_modifier", "piercing", "STR", 5, "Poisoned"),
  mk("act_dragon_bite", "Bite (Dragon)", "2d10 + @attributes.STR.derived_modifier", "piercing", "STR"),
  mk("act_wyrm_bite", "Wyrm Bite", "3d10 + @attributes.STR.derived_modifier", "piercing", "STR"),
  mk("act_wyrm_tail", "Wyrm Tail", "3d6 + @attributes.STR.derived_modifier", "bludgeoning", "STR"),

  // Breath weapons & elemental bursts.
  mk("act_fire_breath_sm", "Fire Breath", "6d6", "fire", "CON", 15, undefined, { type: "cone", sizeFeet: 15 }),
  mk("act_fire_breath_lg", "Fire Breath (Dragon)", "16d8", "fire", "CON", 30, undefined, { type: "cone", sizeFeet: 30 }),
  mk("act_poison_breath", "Poison Breath", "12d6", "poison", "CON", 30, undefined, { type: "cone", sizeFeet: 30 }),
  mk("act_cold_breath", "Cold Breath", "10d8", "cold", "CON", 30, undefined, { type: "cone", sizeFeet: 30 }),
  mk("act_acid_breath_line", "Acid Breath", "12d6", "acid", "CON", 60, undefined, { type: "line", sizeFeet: 60 }),

  // Extra monster attacks / auras.
  mk("act_tail_sweep", "Tail Sweep", "2d6 + @attributes.STR.derived_modifier", "bludgeoning", "STR", 5, "Prone"),
  mk("act_horn", "Horn", "2d10 + @attributes.STR.derived_modifier", "piercing", "STR"),
  mk("act_wing_buffet", "Wing Buffet", "1d6 + @attributes.STR.derived_modifier", "bludgeoning", "STR", 5, "Prone"),
  mk("act_eye_ray", "Eye Ray", "2d8", "force", "INT", 60),
  mk("act_mind_blast", "Mind Blast", "4d8", "psychic", "INT", 60),
  mk("act_pseudopod", "Pseudopod", "2d6 + @attributes.STR.derived_modifier", "bludgeoning", "STR", 5, "Restrained"),
  mk("act_ochre_slam", "Slam", "2d6 + @attributes.STR.derived_modifier", "bludgeoning", "STR"),
  mk("act_constrict", "Constrict", "2d8 + @attributes.STR.derived_modifier", "bludgeoning", "STR", 5, "Restrained"),
  mk("act_breath_lightning", "Lightning Breath", "8d10", "lightning", "CON", 60, undefined, { type: "line", sizeFeet: 60 }),
  mk("act_breath_acid_brass", "Fire Breath", "10d8", "fire", "CON", 30, undefined, { type: "line", sizeFeet: 60 }),
  mk("act_breath_poison_bronze", "Lightning Breath", "11d8", "lightning", "CON", 30, undefined, { type: "line", sizeFeet: 30 }),
  mk("act_breath_cold_white", "Cold Breath", "8d8", "cold", "CON", 30, undefined, { type: "cone", sizeFeet: 30 }),
  mk("act_breath_fire_black", "Acid Breath", "10d8", "acid", "CON", 30, undefined, { type: "line", sizeFeet: 60 }),
  mk("act_breath_fire_blue", "Lightning Breath", "12d10", "lightning", "CON", 30, undefined, { type: "line", sizeFeet: 30 }),
];

/** Every preset action in one registry — used by all installers. Deduped by id. */
export const ALL_PRESET_ACTIONS: ActionDefinition[] = Array.from(
  new Map(
    [
      ...MONSTER_ACTIONS,
      ...CLASS_ACTIONS,
      ...WEAPON_ACTIONS,
      ...SPELL_ACTIONS,
      ...MONSTER_ATTACK_ACTIONS,
    ].map((a) => [a.id, a]),
  ).values(),
);

export function findPresetAction(id: string): ActionDefinition | undefined {
  return ALL_PRESET_ACTIONS.find((a) => a.id === id);
}
