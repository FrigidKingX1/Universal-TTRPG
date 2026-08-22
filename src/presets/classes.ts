import type {
  ActionDefinition,
  AttributeState,
  CharacterProfile,
  InventoryItem,
  ResourcePool,
  ResetCondition,
} from "../types";

/** A class feature unlocked at a given level (descriptive text). */
export interface ClassFeature {
  level: number;
  name: string;
  description: string;
}

/**
 * A class template applied at character creation. Clean-room approximations
 * of the classic fantasy archetypes — hit die, suggested attributes, starting
 * resource pools, granted abilities (ActionDefinition IDs), equipment, and
 * features by level.
 */
export interface ClassTemplate {
  id: string;
  name: string;
  description: string;
  /** Hit die size, e.g. 10 for a d10. Level-1 HP = hit_die + CON mod. */
  hit_die: number;
  /** Suggested starting attribute scores (point-buy heroic array). */
  suggested_attributes: Record<string, number>;
  /** Extra resource pools beyond HP (rage uses, spell slots...). */
  starting_pools: { name: string; maximum: number; reset_condition: ResetCondition }[];
  /** Pools unlocked when the character reaches a given level (higher spell tiers). */
  pool_unlocks?: { level: number; pool: string; amount: number }[];
  /** ActionDefinition IDs granted at creation. Must exist in CLASS_ACTIONS or the global action pool. */
  starting_abilities: string[];
  /** Starting equipment. First item marked equipped. */
  starting_items: { name: string; quantity: number; weight: number }[];
  features_by_level: ClassFeature[];
}

const mk = (
  id: string,
  name: string,
  formula: string,
  damageType: string,
  attr: "STR" | "DEX" | "INT" | "WIS",
  rangeFeet = 5,
): ActionDefinition => ({
  id,
  name,
  action_cost: { type: "action", amount: 1 },
  targeting:
    rangeFeet > 5
      ? { range_feet: rangeFeet, target_type: "single_entity", size_feet: 0 }
      : { range_feet: rangeFeet, target_type: "single_entity", shape: undefined, size_feet: 0 },
  resolution: {
    type: "target_dc",
    primary_attribute: attr,
    roll_formula: `1d20 + @attributes.${attr}.derived_modifier`,
    vs_defense: "armor_class",
    outcomes: { on_success: { formula, damage_type: damageType } },
  },
});

/** Class-specific actions (core weapons like longsword/longbow live in presets/actions.ts). */
export const CLASS_ACTIONS: ActionDefinition[] = [
  mk("act_rapier", "Rapier", "1d8 + @attributes.DEX.derived_modifier", "piercing", "DEX"),
  mk("act_mace", "Mace", "1d6 + @attributes.STR.derived_modifier", "bludgeoning", "STR"),
  mk("act_dagger", "Dagger", "1d4 + @attributes.DEX.derived_modifier", "piercing", "DEX"),
  mk("act_fire_bolt", "Fire Bolt", "1d10", "fire", "INT", 120),
  mk("act_sacred_flame", "Sacred Flame", "2d8", "radiant", "WIS", 60),
  mk("act_unarmed_strike", "Unarmed Strike", "1d6 + @attributes.DEX.derived_modifier", "bludgeoning", "DEX"),
];

const PACK_TACTICS_NOTE =
  "Advantage on attack rolls when an ally is within 5 feet of the target.";

export const PRESET_CLASSES: ClassTemplate[] = [
  {
    id: "fighter",
    name: "Fighter",
    description:
      "A master of weapons and armor. Fighters excel in sustained melee combat and can absorb punishment that would fell lesser heroes.",
    hit_die: 10,
    suggested_attributes: { STR: 16, DEX: 14, CON: 14, INT: 10, WIS: 12, CHA: 8 },
    starting_pools: [
      { name: "second_wind", maximum: 1, reset_condition: "short_rest" },
    ],
    starting_abilities: ["act_longsword", "act_longbow"],
    starting_items: [
      { name: "Longsword", quantity: 1, weight: 3 },
      { name: "Shield", quantity: 1, weight: 6 },
      { name: "Longbow", quantity: 1, weight: 2 },
      { name: "Arrow", quantity: 20, weight: 0.05 },
    ],
    features_by_level: [
      { level: 1, name: "Fighting Style", description: "Adopt a specialized style — e.g. Dueling (+2 damage with one-handed weapons) or Archery (+2 to ranged attacks)." },
      { level: 1, name: "Second Wind", description: "Bonus action to regain 1d10 + fighter level hit points. Once per short rest." },
      { level: 2, name: "Action Surge", description: "Take one additional action on your turn. Once per short rest." },
      { level: 3, name: "Martial Archetype", description: "Choose a subclass: Champion, Battle Master, or Eldritch Knight." },
      { level: 5, name: "Extra Attack", description: "Attack twice whenever you take the Attack action on your turn." },
    ],
  },

  {
    id: "barbarian",
    name: "Barbarian",
    description:
      "A primal warrior who channels fury into devastating blows and shrugs off wounds through sheer toughness.",
    hit_die: 12,
    suggested_attributes: { STR: 16, DEX: 14, CON: 16, INT: 8, WIS: 10, CHA: 8 },
    starting_pools: [
      { name: "rage_uses", maximum: 2, reset_condition: "long_rest" },
    ],
    starting_abilities: ["act_greataxe"],
    starting_items: [
      { name: "Greataxe", quantity: 1, weight: 7 },
      { name: "Handaxe", quantity: 2, weight: 2.5 },
    ],
    features_by_level: [
      { level: 1, name: "Rage", description: "Bonus action: gain +2 melee damage, resistance to bludgeoning/piercing/slashing, and advantage on STR checks. Lasts 1 minute; ends early if you don't attack or take damage." },
      { level: 1, name: "Unarmored Defense", description: "AC = 10 + DEX mod + CON mod when not wearing armor." },
      { level: 2, name: "Reckless Attack", description: "Trade safety for ferocity: advantage on melee Strength attacks, but attacks against you also have advantage this turn." },
      { level: 2, name: "Danger Sense", description: "Advantage on Dexterity saving throws against effects you can see, unless incapacitated." },
      { level: 5, name: "Extra Attack", description: "Attack twice whenever you take the Attack action on your turn." },
    ],
  },

  {
    id: "rogue",
    name: "Rogue",
    description:
      "A cunning opportunist who strikes where it hurts most, slipping through shadows and exploiting every opening.",
    hit_die: 8,
    suggested_attributes: { STR: 8, DEX: 16, CON: 12, INT: 14, WIS: 12, CHA: 10 },
    starting_pools: [],
    starting_abilities: ["act_rapier", "act_shortsword"],
    starting_items: [
      { name: "Rapier", quantity: 1, weight: 2 },
      { name: "Shortsword", quantity: 1, weight: 2 },
      { name: "Thieves' Tools", quantity: 1, weight: 1 },
    ],
    features_by_level: [
      { level: 1, name: "Sneak Attack", description: `Once per turn, deal an extra 1d6 damage (growing with level) when you have advantage, or when an ally is adjacent to your target. ${PACK_TACTICS_NOTE}` },
      { level: 1, name: "Expertise", description: "Double your proficiency bonus on two skills or thieves' tools." },
      { level: 2, name: "Cunning Action", description: "Dash, Disengage, or Hide as a bonus action each turn." },
      { level: 3, name: "Steady Aim / Archetype", description: "Choose a Roguish Archetype; many gain bonus-action aiming for advantage." },
      { level: 5, name: "Uncanny Dodge", description: "Reaction: halve the damage from one attack you can see." },
    ],
  },

  {
    id: "ranger",
    name: "Ranger",
    description:
      "A wilderness hunter attuned to the land, tracking foes across miles and ending threats before they close in.",
    hit_die: 10,
    suggested_attributes: { STR: 12, DEX: 16, CON: 12, INT: 10, WIS: 14, CHA: 8 },
    starting_pools: [
      { name: "spell_slots_l1", maximum: 2, reset_condition: "long_rest" },
    ],
    pool_unlocks: [{ level: 5, pool: "spell_slots_l2", amount: 2 }],
    starting_abilities: ["act_longbow", "act_shortsword"],
    starting_items: [
      { name: "Longbow", quantity: 1, weight: 2 },
      { name: "Arrow", quantity: 20, weight: 0.05 },
      { name: "Shortsword", quantity: 1, weight: 2 },
    ],
    features_by_level: [
      { level: 1, name: "Favored Enemy", description: "Advantage on tracks/hunts against a chosen enemy type (beasts, undead, humanoids...) and learn their language." },
      { level: 1, name: "Natural Explorer", description: "Expertise while traveling through a favored terrain: find food, track, and avoid getting lost." },
      { level: 2, name: "Fighting Style & Spells", description: "Archery or Two-Weapon Fighting style; begin casting ranger spells with spell slots." },
      { level: 3, name: "Primeval Awareness", description: "Spend a spell slot to sense what kinds of creatures dwell within a mile." },
      { level: 5, name: "Extra Attack", description: "Attack twice whenever you take the Attack action on your turn." },
    ],
  },

  {
    id: "cleric",
    name: "Cleric",
    description:
      "A divine conduit whose prayers mend wounds and smite the profane — the party's anchor between life and death.",
    hit_die: 8,
    suggested_attributes: { STR: 12, DEX: 10, CON: 14, INT: 8, WIS: 16, CHA: 12 },
    starting_pools: [
      { name: "spell_slots_l1", maximum: 2, reset_condition: "long_rest" },
    ],
    pool_unlocks: [
      { level: 3, pool: "spell_slots_l2", amount: 2 },
      { level: 5, pool: "spell_slots_l3", amount: 2 },
    ],
    starting_abilities: ["act_mace", "act_sacred_flame", "act_cure_wounds", "act_healing_word"],
    starting_items: [
      { name: "Mace", quantity: 1, weight: 4 },
      { name: "Shield", quantity: 1, weight: 6 },
      { name: "Holy Symbol", quantity: 1, weight: 0.1 },
    ],
    features_by_level: [
      { level: 1, name: "Spellcasting", description: "Prepare spells from the cleric list; spend spell slots to cast them. Cantrips like Sacred Flame never use slots." },
      { level: 1, name: "Divine Domain", description: "Choose a domain (Life, War, Trickery...), gaining domain spells and armor training." },
      { level: 2, name: "Channel Divinity", description: "Harness divine power — Turn Undead and your domain's channel option. Once per short rest." },
      { level: 3, name: "Second Domain Feature", description: "Your domain grants another power — e.g. Preserve Life (heal up to half HP) or Guided Strike." },
      { level: 5, name: "Destroy Undead", description: "When you Turn Undead, CR 1/2 or lower undead are destroyed outright." },
    ],
  },

  {
    id: "wizard",
    name: "Wizard",
    description:
      "A scholar of the arcane whose studied spells reshape battlefields — fragile, but reality-bending.",
    hit_die: 6,
    suggested_attributes: { STR: 8, DEX: 14, CON: 14, INT: 16, WIS: 12, CHA: 8 },
    starting_pools: [
      { name: "spell_slots_l1", maximum: 2, reset_condition: "long_rest" },
    ],
    pool_unlocks: [
      { level: 3, pool: "spell_slots_l2", amount: 2 },
      { level: 5, pool: "spell_slots_l3", amount: 2 },
    ],
    starting_abilities: ["act_fire_bolt", "act_dagger"],
    starting_items: [
      { name: "Spellbook", quantity: 1, weight: 3 },
      { name: "Dagger", quantity: 1, weight: 1 },
      { name: "Arcane Focus", quantity: 1, weight: 0.5 },
    ],
    features_by_level: [
      { level: 1, name: "Spellcasting", description: "Prepare spells from your spellbook; spend spell slots to cast them. Cantrips like Fire Bolt are always ready." },
      { level: 1, name: "Arcane Recovery", description: "Short rest: recover spell slots totalling half your wizard level (rounded up)." },
      { level: 1, name: "Ritual Casting", description: "Cast certain spells as rituals without expending slots — at the cost of 10 extra minutes." },
      { level: 2, name: "Arcane Tradition", description: "Choose a school of mastery: Evocation, Abjuration, Divination..." },
      { level: 5, name: "Third-Level Slots", description: "Access to fireball, fly, counterspell — the tools that make wizards feared." },
    ],
  },
  {
    id: "paladin",
    name: "Paladin",
    description:
      "A sworn warrior whose oaths channel divine power. Paladins anchor the frontline with heavy armor, healing touch, and radiant retribution.",
    hit_die: 10,
    suggested_attributes: { STR: 16, DEX: 10, CON: 14, INT: 8, WIS: 12, CHA: 15 },
    starting_pools: [
      { name: "lay_on_hands", maximum: 5, reset_condition: "long_rest" },
      { name: "channel_oath", maximum: 1, reset_condition: "short_rest" },
    ],
    pool_unlocks: [{ level: 5, pool: "spell_slots_l2", amount: 2 }],
    starting_abilities: ["act_longsword", "act_javelin", "act_sacred_flame"],
    starting_items: [
      { name: "Longsword", quantity: 1, weight: 3 },
      { name: "Shield", quantity: 1, weight: 6 },
      { name: "Chain Mail", quantity: 1, weight: 55 },
      { name: "Holy Symbol", quantity: 1, weight: 0.1 },
    ],
    features_by_level: [
      { level: 1, name: "Divine Sense", description: "Detect celestials, fiends, and undead within 60 feet until the end of your next turn." },
      { level: 1, name: "Lay on Hands", description: "Spend your healing pool to restore HP or cure disease; the pool refills on a long rest." },
      { level: 3, name: "Sacred Oath", description: "Swear an oath (Devotion, Ancients, Vengeance) and gain its tenets and channel abilities." },
      { level: 5, name: "Extra Attack", description: "Attack twice whenever you take the Attack action in a turn." },
      { level: 9, name: "Aura of Protection", description: "You and allies within 10 feet add your CHA modifier to saving throws." },
    ],
  },
  {
    id: "monk",
    name: "Monk",
    description:
      "A disciplined martial artist who turns body and spirit into weaponry. Monks trade armor for speed, mobility, and startling burst damage.",
    hit_die: 8,
    suggested_attributes: { STR: 10, DEX: 16, CON: 14, INT: 10, WIS: 15, CHA: 10 },
    starting_pools: [
      { name: "ki_points", maximum: 2, reset_condition: "short_rest" },
    ],
    starting_abilities: ["act_unarmed_strike", "act_shortsword"],
    starting_items: [
      { name: "Shortsword", quantity: 1, weight: 2 },
      { name: "Dart", quantity: 10, weight: 0.25 },
      { name: "Robes", quantity: 1, weight: 4 },
    ],
    features_by_level: [
      { level: 1, name: "Unarmored Defense", description: "While unarmored, your AC equals 10 + DEX modifier + WIS modifier." },
      { level: 1, name: "Martial Arts", description: "Unarmed strikes scale with your level; attack with bonus action after an unarmed hit." },
      { level: 2, name: "Ki", description: "Spend ki points for Flurry of Blows, Patient Defense, and Step of the Wind." },
      { level: 3, name: "Deflect Missiles", description: "Reduce ranged damage with a reaction; catch and hurl it back at higher levels." },
      { level: 5, name: "Stunning Strike", description: "Spend 1 ki to stun a struck creature until the end of your next turn." },
    ],
  },
  {
    id: "sorcerer",
    name: "Sorcerer",
    description:
      "Raw magic inherited, not studied. Sorcerers bend spells with metamagic and overwhelming force — fragile bodies carrying catastrophic power.",
    hit_die: 6,
    suggested_attributes: { STR: 8, DEX: 14, CON: 14, INT: 10, WIS: 10, CHA: 17 },
    starting_pools: [
      { name: "sorcery_points", maximum: 2, reset_condition: "long_rest" },
      { name: "spell_slots_l1", maximum: 2, reset_condition: "long_rest" },
    ],
    pool_unlocks: [
      { level: 3, pool: "spell_slots_l2", amount: 2 },
      { level: 5, pool: "spell_slots_l3", amount: 1 },
    ],
    starting_abilities: ["act_fire_bolt", "act_dagger", "act_magic_missile"],
    starting_items: [
      { name: "Dagger", quantity: 1, weight: 1 },
      { name: "Arcane Focus", quantity: 1, weight: 0.5 },
      { name: "Adventurer's Clothes", quantity: 1, weight: 4 },
    ],
    features_by_level: [
      { level: 1, name: "Spellcasting", description: "Cast from the sorcerer list using CHA; cantrips like Fire Bolt never run out." },
      { level: 1, name: "Origin Story", description: "Choose a sorcerous origin: Draconic Bloodline, Wild Magic, Storm..." },
      { level: 3, name: "Metamagic", description: "Spend sorcery points to twin, quicken, or extend your spells." },
      { level: 5, name: "Font of Magic", description: "Convert sorcery points into spell slots and back, fueling longer adventuring days." },
    ],
  },
  {
    id: "warlock",
    name: "Warlock",
    description:
      "A mortal empowered by an otherworldly patron. Warlocks wield devastating eldritch magic and pay for it in favors, secrets, and debts.",
    hit_die: 8,
    suggested_attributes: { STR: 10, DEX: 14, CON: 13, INT: 11, WIS: 10, CHA: 16 },
    starting_pools: [
      { name: "pact_slots", maximum: 2, reset_condition: "short_rest" },
    ],
    starting_abilities: ["act_eldritch_blast", "act_dagger", "act_chill_touch"],
    starting_items: [
      { name: "Dagger", quantity: 1, weight: 1 },
      { name: "Leather Armor", quantity: 1, weight: 10 },
      { name: "Grimoire of the Patron", quantity: 1, weight: 3 },
    ],
    features_by_level: [
      { level: 1, name: "Otherworldly Patron", description: "Choose Fiend, Archfey, or Great Old One — each grants unique gifts and obligations." },
      { level: 1, name: "Pact Magic", description: "Your few slots recharge on a short rest; invocations customize everything else." },
      { level: 2, name: "Eldritch Invocations", description: "Permanent magical boons: see in darkness, read all writing, blast harder." },
      { level: 3, name: "Pact Boon", description: "Bind a familiar, a pact weapon, or a book of lost knowledge." },
      { level: 5, name: "Mystic Arcanum", description: "Gain one higher-level spell cast once per long rest without slots." },
    ],
  },
  {
    id: "bard",
    name: "Bard",
    description:
      "A weaver of words, music, and borrowed magic. Bards inspire allies to greatness while unraveling enemies with cutting verse.",
    hit_die: 8,
    suggested_attributes: { STR: 10, DEX: 15, CON: 12, INT: 12, WIS: 11, CHA: 16 },
    starting_pools: [
      { name: "bardic_inspiration", maximum: 3, reset_condition: "short_rest" },
      { name: "spell_slots_l1", maximum: 2, reset_condition: "long_rest" },
    ],
    starting_abilities: ["act_rapier", "act_vicious_mockery", "act_healing_word"],
    starting_items: [
      { name: "Rapier", quantity: 1, weight: 2 },
      { name: "Lute", quantity: 1, weight: 2 },
      { name: "Leather Armor", quantity: 1, weight: 10 },
    ],
    features_by_level: [
      { level: 1, name: "Bardic Inspiration", description: "Grant an ally a bonus die to add to an ability check, attack, or save." },
      { level: 1, name: "Jack of All Trades", description: "Add half your proficiency to every ability check you aren't already good at." },
      { level: 3, name: "College", description: "Join a College (Lore, Valor, Glamour) for specialized Cutting Words or combat arts." },
      { level: 5, name: "Font of Inspiration", description: "Refresh Bardic Inspiration on a short rest instead of a long one." },
    ],
  },
  {
    id: "druid",
    name: "Druid",
    description:
      "A guardian of the old green faith. Druids command storm and thorn, heal with herbs, and wear the shapes of beasts into battle.",
    hit_die: 8,
    suggested_attributes: { STR: 10, DEX: 12, CON: 14, INT: 12, WIS: 16, CHA: 10 },
    starting_pools: [
      { name: "wild_shape", maximum: 2, reset_condition: "short_rest" },
      { name: "spell_slots_l1", maximum: 2, reset_condition: "long_rest" },
    ],
    pool_unlocks: [{ level: 5, pool: "spell_slots_l2", amount: 2 }],
    starting_abilities: ["act_claw", "act_thorn_whip", "act_cure_wounds"],
    starting_items: [
      { name: "Wooden Shield", quantity: 1, weight: 6 },
      { name: "Leather Armor", quantity: 1, weight: 10 },
      { name: "Herbalism Kit", quantity: 1, weight: 3 },
      { name: "Druidic Focus", quantity: 1, weight: 0.5 },
    ],
    features_by_level: [
      { level: 1, name: "Druidcraft", description: "Speak with small beasts, predict weather, and bloom flowers where you walk." },
      { level: 1, name: "Wild Shape", description: "Spend wild shape uses to assume beast forms twice per short rest." },
      { level: 2, name: "Circle of the Land / Moon", description: "Deepen your terrain bond or perfect your beast-shifting at higher levels." },
      { level: 5, name: "Second-Level Spells", description: "Call lightning, entangle battlefields, and moonfire the unworthy." },
    ],
  },
];

/** Look up a template by archetype name (case-insensitive). */
export function findClassByArchetype(archetype?: string | null): ClassTemplate | undefined {
  if (!archetype) return undefined;
  const needle = archetype.trim().toLowerCase();
  return PRESET_CLASSES.find((c) => c.name.toLowerCase() === needle);
}

const mkAttrState = (base: number): AttributeState => ({
  base_value: base,
  current_value: base,
  derived_modifier: Math.floor((base - 10) / 2),
});

/**
 * Apply a class template to a fresh profile: sets archetype, suggested
 * attributes, level-1 HP (hit die max + CON mod), resource pools, starting
 * gear, and granted abilities.
 */
export function applyClassTemplate(profile: CharacterProfile, template: ClassTemplate): CharacterProfile {
  const attributes: Record<string, AttributeState> = {};
  for (const key of Object.keys(profile.attributes)) {
    const suggested = template.suggested_attributes[key] ?? profile.attributes[key]?.base_value ?? 10;
    attributes[key] = mkAttrState(suggested);
  }
  const conMod = Math.floor(((template.suggested_attributes.CON ?? 10) - 10) / 2);
  const hpMax = Math.max(1, template.hit_die + conMod);
  const pools: Record<string, ResourcePool> = {
    hp: { current: hpMax, maximum: hpMax, temporary: 0, reset_condition: "long_rest" },
    ...Object.fromEntries(
      template.starting_pools.map((p) => [
        p.name,
        { current: p.maximum, maximum: p.maximum, temporary: 0, reset_condition: p.reset_condition } satisfies ResourcePool,
      ]),
    ),
  };
  const items: InventoryItem[] = template.starting_items.map((it, i) => ({
    id: crypto.randomUUID(),
    name: it.name,
    quantity: it.quantity,
    state: i === 0 ? ("equipped" as const) : ("stowed" as const),
    weight: it.weight,
    tags: [],
  }));
  return {
    ...profile,
    identity: { ...profile.identity, archetype: template.name },
    attributes,
    resource_pools: pools,
    inventory: [...items, ...profile.inventory],
    abilities: [...new Set([...template.starting_abilities, ...profile.abilities])],
  };
}
