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
      { level: 9, name: "Sorcerous Restoration", description: "Regain sorcery points on a short rest equal to half your level." },
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
      { level: 9, name: "Song of Triumph", description: "Allies inspired by you deal bonus damage equal to your CHA modifier." },
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
      { level: 9, name: "Nature's Ward", description: "Immune to poison and disease; elementals and fey treat you as a friend." },
    ],
  },
  {
    id: "warlord",
    name: "Warlord",
    description:
      "A battlefield commander whose orders sharpen allies into weapons. Warlords trade personal glory for tactical dominance.",
    hit_die: 10,
    suggested_attributes: { STR: 15, DEX: 12, CON: 14, INT: 14, WIS: 10, CHA: 13 },
    starting_pools: [{ name: "commanding_presence", maximum: 3, reset_condition: "short_rest" }],
    starting_abilities: ["act_longsword", "act_javelin"],
    starting_items: [
      { name: "Longsword", quantity: 1, weight: 3 },
      { name: "Chain Mail", quantity: 1, weight: 55 },
      { name: "War Banner", quantity: 1, weight: 2 },
    ],
    features_by_level: [
      { level: 1, name: "Commanding Presence", description: "Allies who see you gain morale; spend presence to grant extra movement." },
      { level: 1, name: "Tactical Assessment", description: "Read a battlefield as an action to mark the greatest threat for your allies." },
      { level: 3, name: "On My Mark", description: "Coordinate a simultaneous strike; allies act on your signal without surprise." },
      { level: 5, name: "Rallying Cry", description: "Spend presence to heal allies in a burst when they drop below half HP." },
    
      { level: 9, name: "Grand Strategy", description: "Once per long rest, redraw initiative so your allies strike first." },],
  },
  {
    id: "swashbuckler",
    name: "Swashbuckler",
    description:
      "A flashy duelist living blade-edge to blade-edge. Swashbucklers dart between foes with panache and leave wit and wounds behind.",
    hit_die: 8,
    suggested_attributes: { STR: 10, DEX: 17, CON: 12, INT: 12, WIS: 11, CHA: 15 },
    starting_pools: [{ name: "panache", maximum: 3, reset_condition: "short_rest" }],
    starting_abilities: ["act_rapier", "act_dagger"],
    starting_items: [
      { name: "Rapier", quantity: 1, weight: 2 },
      { name: "Dagger", quantity: 2, weight: 1 },
      { name: "Feathered Hat", quantity: 1, weight: 0.5 },
    ],
    features_by_level: [
      { level: 1, name: "Fancy Footwork", description: "After a melee hit, step away from that foe without provoking." },
      { level: 1, name: "Panache", description: "Taunt a foe into focusing on you alone; spend panache to fuel flourishes." },
      { level: 3, name: "Riposte", description: "When missed in melee, answer immediately with a counterattack roll." },
      { level: 5, name: "Elegant Maneuver", description: "Advantage on Acrobatics and against opportunity attacks while unarmored." },
    
      { level: 9, name: "Swagger", description: "While below half HP, dropping a foe grants temporary HP." },],
  },
  {
    id: "runecarver",
    name: "Runecarver",
    description:
      "A smith-mage who hammers primordial runes into steel. Runecarvers fight like warriors and detonate like spellbooks.",
    hit_die: 10,
    suggested_attributes: { STR: 15, DEX: 10, CON: 14, INT: 15, WIS: 11, CHA: 9 },
    starting_pools: [{ name: "rune_charges", maximum: 3, reset_condition: "long_rest" }],
    starting_abilities: ["act_warhammer", "act_frost_touch", "act_shocking_grasp"],
    starting_items: [
      { name: "Warhammer", quantity: 1, weight: 3 },
      { name: "Scale Mail", quantity: 1, weight: 45 },
      { name: "Rune Chisel", quantity: 1, weight: 0.5 },
    ],
    features_by_level: [
      { level: 1, name: "Rune Magic", description: "Carve elemental runes onto weapons and armor during a rest." },
      { level: 1, name: "Runic Burst", description: "Spend rune charges to unleash stored elemental energy on impact." },
      { level: 3, name: "Ward of the Forge", description: "Etch a protective rune granting resistance to one damage type." },
      { level: 5, name: "Master's Word", description: "Rune effects no longer require charges once per short rest." },
    
      { level: 9, name: "Living Runes", description: "Your skin bears etchings: resistance to two elemental damage types." },],
  },
  {
    id: "necromancer",
    name: "Necromancer",
    description:
      "A scholar of the boundary between life and death. Necromancers drain vigor, curse flesh, and raise what should stay buried.",
    hit_die: 6,
    suggested_attributes: { STR: 8, DEX: 12, CON: 14, INT: 16, WIS: 10, CHA: 13 },
    starting_pools: [
      { name: "corpse_harvest", maximum: 2, reset_condition: "long_rest" },
      { name: "spell_slots_l1", maximum: 2, reset_condition: "long_rest" },
    ],
    pool_unlocks: [{ level: 5, pool: "spell_slots_l2", amount: 2 }],
    starting_abilities: ["act_chill_touch", "act_draining_touch", "act_life_drain"],
    starting_items: [
      { name: "Dagger", quantity: 1, weight: 1 },
      { name: "Bone Focus", quantity: 1, weight: 0.5 },
      { name: "Grave Dirt Satchel", quantity: 1, weight: 2 },
    ],
    features_by_level: [
      { level: 1, name: "Grim Harvest", description: "When a creature dies near you, regain HP or a corpse harvest charge." },
      { level: 1, name: "Necrotic Affinity", description: "Your necrotic spells ignore resistance the first time each turn." },
      { level: 3, name: "Raise Thrall", description: "Spend corpse harvest to animate a temporary skeleton servant." },
      { level: 5, name: "Death Ward Self", description: "Once per long rest, refuse death and stand at 1 HP instead." },
    
      { level: 9, name: "Undying Covenant", description: "Your first death each day animates your corpse as a loyal thrall." },],
  },
  {
    id: "shaman",
    name: "Shaman",
    description:
      "A spirit-walker bargaining with ancestors, storms, and beast-gods. Shamans mend their band and hex its enemies.",
    hit_die: 8,
    suggested_attributes: { STR: 10, DEX: 12, CON: 13, INT: 11, WIS: 16, CHA: 13 },
    starting_pools: [
      { name: "spirit_favor", maximum: 2, reset_condition: "short_rest" },
      { name: "spell_slots_l1", maximum: 2, reset_condition: "long_rest" },
    ],
    starting_abilities: ["act_thorn_whip", "act_wisp_shock", "act_cure_wounds"],
    starting_items: [
      { name: "Spirit Totem", quantity: 1, weight: 1 },
      { name: "Leather Armor", quantity: 1, weight: 10 },
      { name: "Herbalism Kit", quantity: 1, weight: 3 },
    ],
    features_by_level: [
      { level: 1, name: "Spirit Sight", description: "See invisible spirits and sense the recently dead within 60 feet." },
      { level: 1, name: "Ancestral Favor", description: "Spend spirit favor to ask an ancestor for guidance or aid." },
      { level: 3, name: "Totemic Wrath", description: "Channel a beast-spirit: bear's hide, wolf's speed, or eagle's sight." },
      { level: 5, name: "Storm Voice", description: "Call thunder to scatter foes; spirits guard your sleeping camp." },
    
      { level: 9, name: "Spirit Guide", description: "An ancestor accompanies you permanently, scouting unseen ahead." },],
  },
  {
    id: "psion",
    name: "Psion",
    description:
      "A mind unfettered by matter. Psions shatter armor with thought, read intentions like open books, and fold space an inch at a time.",
    hit_die: 6,
    suggested_attributes: { STR: 8, DEX: 12, CON: 13, INT: 17, WIS: 13, CHA: 11 },
    starting_pools: [{ name: "psi_points", maximum: 4, reset_condition: "long_rest" }],
    starting_abilities: ["act_mind_blast", "act_shocking_grasp"],
    starting_items: [
      { name: "Crystal Focus", quantity: 1, weight: 0.2 },
      { name: "Simple Robes", quantity: 1, weight: 3 },
      { name: "Journal of Dreams", quantity: 1, weight: 2 },
    ],
    features_by_level: [
      { level: 1, name: "Psychic Talent", description: "Know the surface intent of any creature you can see within 30 feet." },
      { level: 1, name: "Psi Points", description: "Fuel disciplines — telekinesis, mind blast, thought shield — with psi points." },
      { level: 3, name: "Telekinetic Grip", description: "Hurl objects and grapple foes at range with pure will." },
      { level: 5, name: "Thought Form", description: "Once per day, become incorporeal mist for one minute." },
    
      { level: 9, name: "Mind Fortress", description: "Immune to psychic damage while concentrating on a discipline." },],
  },
  {
    id: "alchemist",
    name: "Alchemist",
    description:
      "A volatile scientist of smoke and solvent. Alchemists solve problems with thrown flasks and survive their own experiments. Mostly.",
    hit_die: 8,
    suggested_attributes: { STR: 10, DEX: 15, CON: 13, INT: 16, WIS: 11, CHA: 9 },
    starting_pools: [{ name: "reagents", maximum: 4, reset_condition: "long_rest" }],
    starting_abilities: ["act_acid_splash", "act_spit_acid", "act_dagger"],
    starting_items: [
      { name: "Alchemist's Supplies", quantity: 1, weight: 8 },
      { name: "Acid Flask", quantity: 3, weight: 1 },
      { name: "Leather Apron", quantity: 1, weight: 3 },
    ],
    features_by_level: [
      { level: 1, name: "Field Alchemy", description: "Brew bombs, elixirs, and antitoxins using reagents gathered on the road." },
      { level: 1, name: "Throw Anything", description: "Add INT modifier to thrown-flask attack rolls and damage." },
      { level: 3, name: "Healing Draught", description: "Distill healing potions from monster parts mid-adventure." },
      { level: 5, name: "Greater Volatiles", description: "Bombs gain splash radius and elemental infusions." },
    
      { level: 9, name: "Philosopher's Draft", description: "Brew a panacea curing any poison, disease, or curse at dawn." },],
  },
  {
    id: "tinkerer",
    name: "Tinkerer",
    description:
      "A gadgeteer whose clockwork companions and spring-loaded contraptions redefine what a toolbox can do to a battlefield.",
    hit_die: 8,
    suggested_attributes: { STR: 8, DEX: 15, CON: 13, INT: 16, WIS: 11, CHA: 11 },
    starting_pools: [{ name: "gadget_charges", maximum: 3, reset_condition: "long_rest" }],
    starting_abilities: ["act_lightcrossbow", "act_dagger"],
    starting_items: [
      { name: "Tinker's Tools", quantity: 1, weight: 10 },
      { name: "Clockwork Scarab", quantity: 1, weight: 1 },
      { name: "Oil Can", quantity: 1, weight: 0.5 },
    ],
    features_by_level: [
      { level: 1, name: "Gadgets", description: "Deploy clockwork helpers: turrets, decoys, grapnel launchers." },
      { level: 1, name: "Jury Rig", description: "Repair constructs and disable mechanisms with improvised parts." },
      { level: 3, name: "Companion Automaton", description: "Assemble a loyal clockwork pet that fights and fetches." },
      { level: 5, name: "Overcharge", description: "Double a gadget's effect at the risk of spectacular malfunction." },
    
      { level: 9, name: "Masterworks", description: "Overcharge misfires no longer destroy the gadget on a roll of 1." },],
  },
  {
    id: "reaver",
    name: "Reaver",
    description:
      "A brutal shock-trooper who grows stronger through violence. Reavers trade safety for savage momentum and stolen vitality.",
    hit_die: 10,
    suggested_attributes: { STR: 17, DEX: 12, CON: 15, INT: 8, WIS: 9, CHA: 11 },
    starting_pools: [{ name: "bloodlust", maximum: 3, reset_condition: "long_rest" }],
    starting_abilities: ["act_greataxe", "act_handaxe"],
    starting_items: [
      { name: "Greataxe", quantity: 1, weight: 7 },
      { name: "Hide Armor", quantity: 1, weight: 12 },
      { name: "Trophy Chain", quantity: 1, weight: 2 },
    ],
    features_by_level: [
      { level: 1, name: "Bloodlust", description: "Dropping a foe builds bloodlust; spend it for extra attacks." },
      { level: 1, name: "Reckless Assault", description: "Trade defense for devastating advantage on every swing." },
      { level: 3, name: "Crimson Vigor", description: "Regain HP equal to your CON modifier when bloodlust peaks." },
      { level: 5, name: "Terrifying Visage", description: "Foes that watch you kill must save or flee your reach." },
    
      { level: 9, name: "Blood Titan", description: "At peak bloodlust your reach extends and foes falter before you." },],
  },
  {
    id: "brawler",
    name: "Brawler",
    description:
      "A tavern-trained grappler and pugilist. Brawlers end fights with headlocks, haymakers, and furniture improvised into legend.",
    hit_die: 10,
    suggested_attributes: { STR: 16, DEX: 14, CON: 15, INT: 10, WIS: 11, CHA: 12 },
    starting_pools: [{ name: "second_wind_brawl", maximum: 2, reset_condition: "short_rest" }],
    starting_abilities: ["act_unarmed_strike", "act_slam_generic"],
    starting_items: [
      { name: "Brass Knuckles", quantity: 1, weight: 0.5 },
      { name: "Padded Vest", quantity: 1, weight: 8 },
      { name: "Waterskin (Ale)", quantity: 1, weight: 5 },
    ],
    features_by_level: [
      { level: 1, name: "Grapple Master", description: "Grab foes as part of your attack; held enemies take bonus damage." },
      { level: 1, name: "Iron Jaw", description: "Resist being knocked prone or stunned by brute force." },
      { level: 3, name: "Haymaker", description: "Charge up a single devastating punch that ignores resistance." },
      { level: 5, name: "Crowd Favorite", description: "Improvise weapons from surroundings without losing effectiveness." },
    
      { level: 9, name: "Unbreakable Hold", description: "Grappled enemies cannot teleport or slip free with assistance." },],
  },
  {
    id: "wildspeaker",
    name: "Wildspeaker",
    description:
      "A beast-friend who walks the border between civilizations. Wildspeakers call animal kin to scout, fight, and carry burdens.",
    hit_die: 8,
    suggested_attributes: { STR: 11, DEX: 14, CON: 13, INT: 10, WIS: 16, CHA: 12 },
    starting_pools: [{ name: "animal_kinship", maximum: 3, reset_condition: "short_rest" }],
    starting_abilities: ["act_claw", "act_thorn_whip", "act_shortbow"],
    starting_items: [
      { name: "Shortbow", quantity: 1, weight: 2 },
      { name: "Leather Armor", quantity: 1, weight: 10 },
      { name: "Animal Whistle", quantity: 1, weight: 0.05 },
    ],
    features_by_level: [
      { level: 1, name: "Beast Speech", description: "Converse simple ideas with any animal; ask favors of the friendly ones." },
      { level: 1, name: "Kin Bond", description: "Attract an animal companion that levels alongside you." },
      { level: 3, name: "Shared Senses", description: "See through your companion's eyes regardless of distance." },
      { level: 5, name: "Call the Pack", description: "Spend kinship to summon temporary beast allies to your side." },
    
      { level: 9, name: "Alpha Voice", description: "Command whole packs as an action; your companion gains Extra Attack." },],
  },
  {
    id: "shadowblade",
    name: "Shadowblade",
    description:
      "An assassin who learned magic only to kill more quietly. Shadowblades step out of darkness, strike once, and are rumor by dawn.",
    hit_die: 8,
    suggested_attributes: { STR: 10, DEX: 17, CON: 12, INT: 14, WIS: 11, CHA: 12 },
    starting_pools: [{ name: "shadow_weave", maximum: 2, reset_condition: "short_rest" }],
    starting_abilities: ["act_shortsword", "act_dagger", "act_corrupting_touch"],
    starting_items: [
      { name: "Shortsword", quantity: 1, weight: 2 },
      { name: "Dark Cloak", quantity: 1, weight: 2 },
      { name: "Thieves' Tools", quantity: 1, weight: 1 },
    ],
    features_by_level: [
      { level: 1, name: "Umbral Step", description: "Melt into shadow and reappear behind a target within 30 feet." },
      { level: 1, name: "Killing Edge", description: "Bonus damage to creatures that haven't acted yet this combat." },
      { level: 3, name: "Smoke Shroud", description: "Spend shadow weave to fill your square with blinding darkness you see through." },
      { level: 5, name: "Deathmark", description: "Marked targets never hear you coming; first strike auto-crits." },
    
      { level: 9, name: "Umbral Twin", description: "A shadow duplicate flanks alongside you, feinting on your cue." },],
  },
  {
    id: "stormcaller",
    name: "Stormcaller",
    description:
      "A tempest-priest who treats weather as scripture. Stormcallers answer blasphemy with thunder and heresy with hail.",
    hit_die: 8,
    suggested_attributes: { STR: 10, DEX: 12, CON: 14, INT: 11, WIS: 15, CHA: 14 },
    starting_pools: [
      { name: "tempest_fury", maximum: 2, reset_condition: "short_rest" },
      { name: "spell_slots_l1", maximum: 2, reset_condition: "long_rest" },
    ],
    starting_abilities: ["act_shocking_grasp", "act_thunderwave"],
    starting_items: [
      { name: "Storm Talisman", quantity: 1, weight: 0.3 },
      { name: "Chain Shirt", quantity: 1, weight: 20 },
      { name: "Lightning-Scarred Shield", quantity: 1, weight: 6 },
    ],
    features_by_level: [
      { level: 1, name: "Thunder's Blessing", description: "You always know the forecast — and can subtly worsen it." },
      { level: 1, name: "Tempest Fury", description: "Spend fury to maximize lightning or thunder damage dice." },
      { level: 3, name: "Static Aura", description: "Attackers within 5 feet spark for retaliation damage." },
      { level: 5, name: "Eye of the Storm", description: "Walk unbothered through high winds, rain, and falling debris." },
    
      { level: 9, name: "Eye of the Maelstrom", description: "Weather within a mile bends toward your emotional forecast." },],
  },
  {
    id: "witch",
    name: "Witch",
    description:
      "A hedge-hexer brewing curses under the old moon. Witches win long before the fight starts — their victims just don't know it yet.",
    hit_die: 6,
    suggested_attributes: { STR: 8, DEX: 13, CON: 13, INT: 14, WIS: 15, CHA: 14 },
    starting_pools: [
      { name: "hexes", maximum: 3, reset_condition: "long_rest" },
      { name: "spell_slots_l1", maximum: 2, reset_condition: "long_rest" },
    ],
    pool_unlocks: [{ level: 5, pool: "spell_slots_l2", amount: 2 }],
    starting_abilities: ["act_poison_spray", "act_vicious_mockery"],
    starting_items: [
      { name: "Broomstick (well-used)", quantity: 1, weight: 3 },
      { name: "Herb Pouch", quantity: 1, weight: 2 },
      { name: "Black Cat Familiar", quantity: 1, weight: 0 },
    ],
    features_by_level: [
      { level: 1, name: "Hexcraft", description: "Lay lingering curses: misfortune, weakness, or unlucky footsteps." },
      { level: 1, name: "Familiar Bond", description: "Your familiar scouts, spies, and delivers touch-spells for you." },
      { level: 3, name: "Cauldron Brew", description: "Cook potent charms and poultions from foraged ingredients." },
      { level: 5, name: "Grand Hex", description: "One target per day simply has the worst day of its life." },
    
      { level: 9, name: "Coven Bond", description: "Coven-cast hexes pierce even curse-immunity with combined will." },],
  },
  {
    id: "summoner",
    name: "Summoner",
    description:
      "A conjurer whose strength is measured in allies. Summoners open doors between worlds and let the right things through.",
    hit_die: 6,
    suggested_attributes: { STR: 8, DEX: 12, CON: 14, INT: 16, WIS: 10, CHA: 15 },
    starting_pools: [
      { name: "conjuration_stability", maximum: 2, reset_condition: "short_rest" },
      { name: "spell_slots_l1", maximum: 2, reset_condition: "long_rest" },
    ],
    starting_abilities: ["act_magic_missile", "act_acid_splash"],
    starting_items: [
      { name: "Summoning Circle Chalk", quantity: 1, weight: 0.2 },
      { name: "Arcane Focus", quantity: 1, weight: 0.5 },
      { name: "Contract Ledger", quantity: 1, weight: 2 },
    ],
    features_by_level: [
      { level: 1, name: "Minor Summons", description: "Call small otherworldly helpers: lantern wisps, stone imps, messenger ravens." },
      { level: 1, name: "Stable Gate", description: "Your summons resist banishment and linger longer than they should." },
      { level: 3, name: "Battle Conjuration", description: "Summon a bonded combat-beast that shares your initiative." },
      { level: 5, name: "Planar Favor", description: "Negotiate with summoned entities for extra services at a price." },
    
      { level: 9, name: "Gate Adept", description: "Summons arrive at maximum HP with doubled durations." },],
  },
  {
    id: "gunslinger",
    name: "Gunslinger",
    description:
      "A powder-and-thunder marksman from the frontier beyond the maps. Gunslingers reload faster than fate can intervene.",
    hit_die: 8,
    suggested_attributes: { STR: 10, DEX: 17, CON: 13, INT: 13, WIS: 12, CHA: 10 },
    starting_pools: [{ name: "trick_shots", maximum: 3, reset_condition: "short_rest" }],
    starting_abilities: ["act_heavycrossbow", "act_dagger"],
    starting_items: [
      { name: "Heavy Crossbow (hand-cannon)", quantity: 1, weight: 18 },
      { name: "Powder Horn", quantity: 1, weight: 1 },
      { name: "Leather Duster", quantity: 1, weight: 4 },
    ],
    features_by_level: [
      { level: 1, name: "Deadeye", description: "Ignore half cover and range penalties on marked targets." },
      { level: 1, name: "Trick Shots", description: "Disarm, trip, or nail limbs to walls with style points." },
      { level: 3, name: "Quick Reload", description: "Fire as bonus action after a kill; misfires clear instantly." },
      { level: 5, name: "Bullet Time", description: "Once per short rest, resolve your attack before anyone else acts." },
    
      { level: 9, name: "Never Miss Twice", description: "After missing a marked target, your next shot crits on 19-20." },],
  },
  {
    id: "dragoon",
    name: "Dragoon",
    description:
      "A dragon-hunting lancer trained to fall like a meteor and rise like one. Dragoons leap impossible heights to skewer wyrms.",
    hit_die: 10,
    suggested_attributes: { STR: 16, DEX: 13, CON: 15, INT: 10, WIS: 11, CHA: 12 },
    starting_pools: [{ name: "skyfall_charges", maximum: 2, reset_condition: "short_rest" }],
    starting_abilities: ["act_spear", "act_longbow", "act_javelin"],
    starting_items: [
      { name: "Longspear", quantity: 1, weight: 6 },
      { name: "Half Plate", quantity: 1, weight: 40 },
      { name: "Dragon-Tooth Charm", quantity: 1, weight: 0.2 },
    ],
    features_by_level: [
      { level: 1, name: "Skyfall Leap", description: "Vault 30 feet and land with devastating lance-force." },
      { level: 1, name: "Wyrm Slayer Arts", description: "Bonus damage and saves vs dragon breath and fear." },
      { level: 3, name: "Impaling Descent", description: "Skyfall onto a Large-or-bigger creature pins it prone." },
      { level: 5, name: "Dragoon's Resolve", description: "Immunity to frightful presence; breath weapons scorch you half." },
    
      { level: 9, name: "Wyrmfall", description: "Skyfall height doubles; landing shock stuns Large creatures." },],
  },
  {
    id: "blackguard",
    name: "Blackguard",
    description:
      "A paladin who broke every vow and kept the power. Blackguards command fear, drink suffering, and lead from the front of the dark.",
    hit_die: 10,
    suggested_attributes: { STR: 16, DEX: 10, CON: 14, INT: 10, WIS: 9, CHA: 16 },
    starting_pools: [
      { name: "sin_eater", maximum: 3, reset_condition: "long_rest" },
      { name: "channel_oath", maximum: 1, reset_condition: "short_rest" },
    ],
    starting_abilities: ["act_greatsword", "act_corrupting_touch"],
    starting_items: [
      { name: "Greatsword", quantity: 1, weight: 6 },
      { name: "Blackened Plate", quantity: 1, weight: 65 },
      { name: "Cracked Holy Symbol", quantity: 1, weight: 0.1 },
    ],
    features_by_level: [
      { level: 1, name: "Oathbreaker's Might", description: "Aura of dread: nearby enemies subtract your CHA from their saves." },
      { level: 1, name: "Sin Eater", description: "Convert suffering around you into dark healing or smites." },
      { level: 3, name: "Hell Knight", description: "Summon a nightmare steed that fears neither fire nor death." },
      { level: 5, name: "Withering Smite", description: "Your strikes scar the soul; healed wounds ache forever." },
    
      { level: 9, name: "Dread Lord", description: "Enemies who see you open combat are frightened until round's end." },],
  },
  {
    id: "banisher",
    name: "Banisher",
    description:
      "A specialist in sending things back where they came from. Banishers carry salt, silver, scripture, and absolutely no fear.",
    hit_die: 8,
    suggested_attributes: { STR: 12, DEX: 12, CON: 14, INT: 13, WIS: 16, CHA: 12 },
    starting_pools: [{ name: "warding_rites", maximum: 3, reset_condition: "long_rest" }],
    starting_abilities: ["act_sacred_flame", "act_mace"],
    starting_items: [
      { name: "Silvered Mace", quantity: 1, weight: 4 },
      { name: "Salt Circle Kit", quantity: 1, weight: 3 },
      { name: "Scripture Ribbons", quantity: 1, weight: 0.3 },
    ],
    features_by_level: [
      { level: 1, name: "Rite of Turning", description: "Undead and fiends flee your consecrated ground." },
      { level: 1, name: "Warding Rites", description: "Draw protective circles that bar possession and planar breach." },
      { level: 3, name: "Consecrated Strikes", description: "Your weapons count as silvered and blessed against outsiders." },
      { level: 5, name: "Expel the Guest", description: "Force a possessing or summoned entity back through the veil." },
    
      { level: 9, name: "Seal Warden", description: "Wards persist overnight and repel planar incursions automatically." },],
  },
  {
    id: "jester",
    name: "Jester",
    description:
      "A court fool weaponized. Jesters mock kings to their faces, juggle daggers and destinies, and always have the last laugh.",
    hit_die: 8,
    suggested_attributes: { STR: 9, DEX: 16, CON: 12, INT: 13, WIS: 11, CHA: 17 },
    starting_pools: [{ name: "punchlines", maximum: 3, reset_condition: "short_rest" }],
    starting_abilities: ["act_whip", "act_vicious_mockery", "act_dagger"],
    starting_items: [
      { name: "Slapstick (hidden blade)", quantity: 1, weight: 1 },
      { name: "Motley", quantity: 1, weight: 2 },
      { name: "Juggling Daggers", quantity: 3, weight: 1 },
    ],
    features_by_level: [
      { level: 1, name: "Cutting Wit", description: "Mockery so precise it deals real damage and real doubt." },
      { level: 1, name: "Slapstick", description: "Comic timing grants advantage when performing for a crowd." },
      { level: 3, name: "Pratfall", description: "Turn a stumble into a trip that drops two enemies instead." },
      { level: 5, name: "Killer Punchline", description: "Deliver a setup earlier in combat; the payoff stuns." },
    
      { level: 9, name: "Standing Ovation", description: "Performing grants allies your proficiency bonus to saves." },],
  },
  {
    id: "spellblade",
    name: "Spellblade",
    description:
      "A gish weaving steel and sorcery into a single motion. Spellblades parry fireballs and answer with enchanted ripostes.",
    hit_die: 8,
    suggested_attributes: { STR: 12, DEX: 15, CON: 13, INT: 15, WIS: 10, CHA: 12 },
    starting_pools: [
      { name: "arcane_edge", maximum: 2, reset_condition: "short_rest" },
      { name: "spell_slots_l1", maximum: 2, reset_condition: "long_rest" },
    ],
    starting_abilities: ["act_rapier", "act_shocking_grasp", "act_magic_missile"],
    starting_items: [
      { name: "Rapier", quantity: 1, weight: 2 },
      { name: "Studded Leather", quantity: 1, weight: 13 },
      { name: "Whetstone of Focusing", quantity: 1, weight: 0.3 },
    ],
    features_by_level: [
      { level: 1, name: "Arcane Edge", description: "Sheath your blade in chosen elements; strikes carry their bite." },
      { level: 1, name: "Battle Casting", description: "Cast without provoking and keep components gripped in off-hand." },
      { level: 3, name: "Counterswing", description: "Destroy a spell effect by striking its caster mid-incantation." },
      { level: 5, name: "Spellstorm", description: "Channel a slot through your blade for an area arcane slash." },
    
      { level: 9, name: "Spellsword Mastery", description: "Opportunity attacks may instead cast a known damaging cantrip." },],
  },
  {
    id: "chirurgeon",
    name: "Chirurgeon",
    description:
      "A field medic with steady hands and stronger stomach. Chirurgeons stitch heroes back together and catalog what took them apart.",
    hit_die: 8,
    suggested_attributes: { STR: 10, DEX: 12, CON: 14, INT: 16, WIS: 14, CHA: 10 },
    starting_pools: [
      { name: "field_kit", maximum: 4, reset_condition: "long_rest" },
      { name: "spell_slots_l1", maximum: 2, reset_condition: "long_rest" },
    ],
    starting_abilities: ["act_cure_wounds", "act_healing_word", "act_mace"],
    starting_items: [
      { name: "Chirurgeon's Kit", quantity: 1, weight: 4 },
      { name: "Bandages & Sutures", quantity: 1, weight: 1 },
      { name: "Specimen Jar", quantity: 1, weight: 1 },
    ],
    features_by_level: [
      { level: 1, name: "Battlefield Triage", description: "Stabilize the dying as a bonus action; healing you cast rolls with expertise." },
      { level: 1, name: "Anatomical Insight", description: "Know a creature's weak points: your attacks crit on natural 19s." },
      { level: 3, name: "Transfusion", description: "Move HP between willing creatures with a touch and a prayer." },
      { level: 5, name: "Adrenal Surge", description: "A treated ally gains temp HP and shakes off paralysis or poison." },
    
      { level: 9, name: "Miracle Worker", description: "Once per day, revive an ally slain this round at half HP." },],
  },
  {
    id: "elementalist",
    name: "Elementalist",
    description:
      "A raw conduit of the four primal forces. Elementalists burn, freeze, shock, and crush — cycling elements faster than defenses adapt.",
    hit_die: 6,
    suggested_attributes: { STR: 8, DEX: 14, CON: 14, INT: 16, WIS: 12, CHA: 11 },
    starting_pools: [
      { name: "elemental_attunement", maximum: 3, reset_condition: "short_rest" },
      { name: "spell_slots_l1", maximum: 2, reset_condition: "long_rest" },
    ],
    pool_unlocks: [{ level: 5, pool: "spell_slots_l2", amount: 2 }],
    starting_abilities: ["act_fire_bolt", "act_ray_of_frost", "act_burning_hands"],
    starting_items: [
      { name: "Four-Chambered Orb", quantity: 1, weight: 0.5 },
      { name: "Fireproof Gloves", quantity: 1, weight: 0.5 },
      { name: "Traveling Robes", quantity: 1, weight: 4 },
    ],
    features_by_level: [
      { level: 1, name: "Elemental Cycle", description: "Switch attunements (fire/water/air/earth) as a free action each turn." },
      { level: 1, name: "Attunement Perks", description: "Each element grants passive boons: warmth, buoyancy, speed, stability." },
      { level: 3, name: "Overload", description: "Spend attunement to empower matching-element spells massively." },
      { level: 5, name: "Primal Conduit", description: "Once per short rest, cast a known spell without expending a slot." },
    
      { level: 9, name: "Avatar of Elements", description: "Assume your attuned element's form for one minute of power." },],
  },
  {
    id: "cavalier",
    name: "Cavalier",
    description:
      "A mounted knight holding the line at full gallop. Cavaliers and their steeds are one weapon with two hearts.",
    hit_die: 10,
    suggested_attributes: { STR: 16, DEX: 11, CON: 15, INT: 9, WIS: 12, CHA: 13 },
    starting_pools: [{ name: "defensive_line", maximum: 3, reset_condition: "short_rest" }],
    starting_abilities: ["act_longsword", "act_spear", "act_hooves"],
    starting_items: [
      { name: "Longsword", quantity: 1, weight: 3 },
      { name: "Chain Mail", quantity: 1, weight: 55 },
      { name: "Warhorse", quantity: 1, weight: 0 },
    ],
    features_by_level: [
      { level: 1, name: "Born to the Saddle", description: "Mount/dismount freely; your steed obeys without checks." },
      { level: 1, name: "Hold the Line", description: "Spend defensive line to intercept attacks aimed at allies." },
      { level: 3, name: "Charging Lance", description: "Mounted charges double STR modifier and knock foes flat." },
      { level: 5, name: "Unstoppable Advance", description: "While mounted, you and your steed shrug off forced movement." },
    
      { level: 9, name: "Legendary Steed", description: "Your mount gains intelligence, HP scaling, and independent attacks." },],
  },
];

/** Look up a template by archetype name (case-insensitive). */
export function findClassByArchetype(archetype?: string | null): ClassTemplate | undefined {
  if (!archetype) return undefined;
  const needle = archetype.trim().toLowerCase();
  return PRESET_CLASSES.find((c) => c.name.toLowerCase() === needle);
}

/**
 * Level-up pool progression: every existing pool gains +1 max use, and any
 * unlock whose level is reached grants its new pool (primary first, then a
 * dual class's own unlocks).
 */
export function growPoolsOnLevelUp(
  pools: Record<string, import("../types").ResourcePool>,
  newLevel: number,
  primary: ClassTemplate | undefined,
  secondary?: ClassTemplate,
): Record<string, import("../types").ResourcePool> {
  const next = Object.fromEntries(
    Object.entries(pools).map(([k, p]) => [k, { ...p, maximum: p.maximum + 1 }]),
  );
  for (const template of [primary, secondary]) {
    for (const u of template?.pool_unlocks ?? []) {
      if (u.level === newLevel && !next[u.pool]) {
        next[u.pool] = { current: u.amount, maximum: u.amount, temporary: 0, reset_condition: "long_rest" };
      }
    }
  }
  return next;
}

/**
 * Dual-classing: layer a secondary class onto an already-applied primary.
 * Clean-room rules:
 *   - abilities: union of both classes' granted actions
 *   - HP: +floor(secondary hit die / 2) (the classic "half-die" bump)
 *   - pools: secondary-only pools arrive at half max (min 1); shared pools
 *     (e.g. spell_slots_l1 from both classes) stack by the same half amount
 */
export function mergeSecondaryClass(profile: CharacterProfile, secondary: ClassTemplate): CharacterProfile {
  const next: CharacterProfile = {
    ...profile,
    identity: { ...profile.identity, archetype_secondary: secondary.name },
    abilities: [...new Set([...profile.abilities, ...secondary.starting_abilities])],
    // Deep-copy pools so we never mutate the caller's profile objects.
    resource_pools: Object.fromEntries(
      Object.entries(profile.resource_pools).map(([k, p]) => [k, { ...p }]),
    ),
  };

  const hp = next.resource_pools.hp;
  if (hp) {
    const bonus = Math.max(1, Math.floor(secondary.hit_die / 2));
    hp.maximum += bonus;
    hp.current += bonus;
  }

  for (const p of secondary.starting_pools) {
    const existing = next.resource_pools[p.name];
    const grant = Math.max(1, Math.ceil(p.maximum / 2));
    if (!existing) {
      next.resource_pools[p.name] = {
        current: grant,
        maximum: grant,
        temporary: 0,
        reset_condition: p.reset_condition,
      };
    } else if (p.name !== "hp") {
      existing.maximum += grant;
      existing.current += grant;
    }
  }
  return next;
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
export function applyClassTemplate(profile: CharacterProfile, template: ClassTemplate): CharacterProfile {  const attributes: Record<string, AttributeState> = {};
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
