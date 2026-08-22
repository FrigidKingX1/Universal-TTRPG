import type { ActionDefinition, EncounterStatBlock } from "../types";

const mkAction = (
  id: string,
  name: string,
  formula: string,
  damageType: string,
  attr: "STR" | "DEX",
  rangeFeet = 5,
  appliedStatus?: string,
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
    outcomes: {
      on_success: { formula, damage_type: damageType, applied_status: appliedStatus },
    },
  },
});

export const PRESET_ACTIONS: ActionDefinition[] = [
  mkAction("act_scimitar", "Scimitar", "1d6 + @attributes.DEX.derived_modifier", "slashing", "DEX"),
  mkAction("act_greataxe", "Greataxe", "1d12 + @attributes.STR.derived_modifier", "slashing", "STR"),
  mkAction("act_claw", "Claw", "2d6 + @attributes.STR.derived_modifier", "slashing", "STR"),
  mkAction("act_greatclub", "Greatclub", "2d8 + @attributes.STR.derived_modifier", "bludgeoning", "STR"),
  mkAction("act_gore", "Gore", "2d8 + @attributes.STR.derived_modifier", "piercing", "STR"),
  mkAction("act_bite_sm", "Bite", "1d6 + @attributes.STR.derived_modifier", "piercing", "STR"),
  mkAction("act_bite_md", "Bite (Large)", "2d6 + @attributes.STR.derived_modifier", "piercing", "STR"),
  mkAction(
    "act_bite_trip",
    "Bite (Trip)",
    "2d6 + @attributes.STR.derived_modifier",
    "piercing",
    "STR",
    5,
    "Prone",
  ),
  mkAction(
    "act_poison_bite",
    "Poison Bite",
    "1d8 + @attributes.DEX.derived_modifier",
    "piercing",
    "DEX",
    5,
    "Poisoned",
  ),
  mkAction("act_longbow", "Longbow", "1d8 + @attributes.DEX.derived_modifier", "piercing", "DEX", 150),
];

type Preset = Omit<EncounterStatBlock, "id"> & { key: string };

const monster = (
  key: string,
  name: string,
  cr: number,
  data: Partial<EncounterStatBlock>,
): Preset => ({
  key,
  name,
  challenge_rating: cr,
  armor_class: 12,
  hit_points: { current: 10, maximum: 10 },
  attributes: { STR: 10, DEX: 10, CON: 10, INT: 10, WIS: 10, CHA: 10 },
  actions: [],
  loot_table: [],
  ...data,
});

export const PRESET_MONSTERS: Preset[] = [
  monster("goblin", "Goblin", 0.25, {
    size: "small",
    type: "humanoid",
    alignment: "neutral evil",
    armor_class: 15,
    hit_points: { current: 7, maximum: 7, formula: "2d6" },
    speed_feet: 30,
    attributes: { STR: 8, DEX: 14, CON: 10, INT: 10, WIS: 8, CHA: 8 },
    actions: ["act_scimitar", "act_longbow"],
    senses: ["darkvision 60 ft.", "passive Perception 9"],
    languages: ["Common", "Goblin"],
    traits: [
      {
        name: "Nimble Escape",
        description:
          "The goblin can take the Disengage or Hide action as a bonus action on each of its turns.",
      },
    ],
    loot_table: [{ name: "Gold Coins", quantity_formula: "2d6", chance: 80 }],
    description:
      "Goblins are small, black-hearted humanoids that lair in despoiled dungeons and other dismal settings. Individually weak, they gather in large numbers to torment other creatures.",
  }),

  monster("skeleton", "Skeleton", 0.25, {
    size: "medium",
    type: "undead",
    alignment: "lawful evil",
    armor_class: 13,
    hit_points: { current: 13, maximum: 13, formula: "2d8+4" },
    speed_feet: 30,
    attributes: { STR: 10, DEX: 14, CON: 15, INT: 6, WIS: 8, CHA: 5 },
    actions: ["act_shortsword"],
    vulnerabilities: ["bludgeoning"],
    immunities: ["poison"],
    condition_immunities: ["exhaustion", "poisoned"],
    senses: ["darkvision 60 ft.", "passive Perception 9"],
    languages: ["understands Common"],
    loot_table: [{ name: "Gold Coins", quantity_formula: "1d4", chance: 30 }],
    description:
      "Skeletons arise when animated by dark magic. They follow their creator's orders without question, their hollow eye sockets glowing with pale light.",
  }),

  monster("zombie", "Zombie", 0.25, {
    size: "medium",
    type: "undead",
    alignment: "neutral evil",
    armor_class: 8,
    hit_points: { current: 22, maximum: 22, formula: "3d8+9" },
    speed_feet: 20,
    attributes: { STR: 13, DEX: 6, CON: 16, INT: 3, WIS: 6, CHA: 5 },
    actions: ["act_bite_sm"],
    immunities: ["poison"],
    condition_immunities: ["poisoned"],
    senses: ["darkvision 60 ft.", "passive Perception 8"],
    languages: ["understands Common"],
    traits: [
      {
        name: "Undead Fortitude",
        description:
          "If damage reduces the zombie to 0 hit points, it makes a CON save (DC 5 + the damage taken) unless the damage is radiant or from a critical hit. On a success, it drops to 1 hit point instead.",
      },
    ],
    loot_table: [{ name: "Trinket", quantity_formula: "1", chance: 20 }],
    description:
      "Shambling horrors of reanimated flesh, zombies mindlessly pursue whatever their master commands, heedless of injury or obstacle.",
  }),

  monster("wolf", "Wolf", 0.25, {
    size: "medium",
    type: "beast",
    alignment: "unaligned",
    armor_class: 13,
    hit_points: { current: 11, maximum: 11, formula: "2d8+2" },
    speed_feet: 40,
    attributes: { STR: 12, DEX: 15, CON: 12, INT: 3, WIS: 12, CHA: 6 },
    actions: ["act_bite_trip"],
    senses: ["darkvision 60 ft.", "passive Perception 13"],
    languages: [],
    traits: [
      {
        name: "Pack Tactics",
        description:
          "The wolf has advantage on an attack roll against a creature if at least one of the wolf's allies is within 5 feet of the creature and the ally isn't incapacitated.",
      },
    ],
    loot_table: [{ name: "Wolf Pelt", quantity_formula: "1", chance: 50 }],
    description:
      "Wolves hunt in coordinated packs, using howls to signal one another and wearing down larger prey through persistence.",
  }),

  monster("orc", "Orc", 0.5, {
    size: "medium",
    type: "humanoid",
    alignment: "neutral evil",
    armor_class: 13,
    hit_points: { current: 15, maximum: 15, formula: "2d8+6" },
    speed_feet: 30,
    attributes: { STR: 16, DEX: 12, CON: 16, INT: 7, WIS: 11, CHA: 10 },
    actions: ["act_greataxe", "act_longbow"],
    senses: ["darkvision 60 ft.", "passive Perception 10"],
    languages: ["Common", "Orc"],
    traits: [
      {
        name: "Aggressive",
        description:
          "As a bonus action, the orc can move up to its speed toward a hostile creature that it can see.",
      },
    ],
    loot_table: [
      { name: "Gold Coins", quantity_formula: "1d6", chance: 50 },
      { name: "Crude Jewelry", quantity_formula: "1", chance: 20 },
    ],
    description:
      "Savage raiders of the hills and badlands, orcs worship powers of conquest and slaughter, taking what they wish by force.",
  }),

  monster("giant-spider", "Giant Spider", 1, {
    size: "large",
    type: "beast",
    alignment: "unaligned",
    armor_class: 14,
    hit_points: { current: 26, maximum: 26, formula: "4d10+4" },
    speed_feet: 30,
    attributes: { STR: 14, DEX: 16, CON: 12, INT: 2, WIS: 11, CHA: 4 },
    actions: ["act_poison_bite"],
    immunities: ["poison"],
    condition_immunities: ["poisoned"],
    senses: ["darkvision 60 ft.", "passive Perception 10"],
    languages: [],
    traits: [
      {
        name: "Spider Climb",
        description: "The spider can climb difficult surfaces, including upside down on ceilings.",
      },
      {
        name: "Web Sense",
        description:
          "While in contact with a web, the spider knows the exact location of any other creature in contact with the same web.",
      },
      {
        name: "Web Walker",
        description: "The spider ignores movement restrictions caused by webbing.",
      },
    ],
    loot_table: [{ name: "Silk Sac", quantity_formula: "1", chance: 40 }],
    description:
      "To catch its prey, a giant spider weaves elaborate webs across dungeon corridors, waiting in silence for vibrations of struggling victims.",
  }),

  monster("dire-wolf", "Dire Wolf", 1, {
    size: "large",
    type: "beast",
    alignment: "unaligned",
    armor_class: 14,
    hit_points: { current: 37, maximum: 37, formula: "5d10+10" },
    speed_feet: 50,
    attributes: { STR: 17, DEX: 15, CON: 15, INT: 3, WIS: 12, CHA: 7 },
    actions: ["act_bite_trip"],
    senses: ["darkvision 60 ft.", "passive Perception 13"],
    languages: [],
    traits: [
      {
        name: "Pack Tactics",
        description:
          "The wolf has advantage on an attack roll against a creature if at least one of the wolf's allies is within 5 feet of the creature and the ally isn't incapacitated.",
      },
    ],
    loot_table: [{ name: "Thick Pelt", quantity_formula: "1", chance: 60 }],
    description:
      "Dire wolves are larger, fiercer cousins of common wolves, hunting in packs capable of bringing down horses and even giants.",
  }),

  monster("ghoul", "Ghoul", 1, {
    size: "medium",
    type: "undead",
    alignment: "chaotic evil",
    armor_class: 12,
    hit_points: { current: 22, maximum: 22, formula: "5d8" },
    speed_feet: 30,
    attributes: { STR: 13, DEX: 15, CON: 10, INT: 7, WIS: 10, CHA: 6 },
    actions: ["act_bite_md", "act_claw"],
    multiattack: "The ghoul makes two attacks: one with its bite and one with its claws.",
    immunities: ["poison"],
    condition_immunities: ["poisoned", "exhaustion"],
    senses: ["darkvision 60 ft.", "passive Perception 10"],
    languages: ["Common"],
    description:
      "Ghouls haunt graveyards and ruined battlefields, feasting on the corpses of the dead — and when no corpses remain, they make more.",
  }),

  monster("ogre", "Ogre", 2, {
    size: "large",
    type: "giant",
    alignment: "chaotic evil",
    armor_class: 11,
    hit_points: { current: 59, maximum: 59, formula: "7d10+21" },
    speed_feet: 40,
    attributes: { STR: 19, DEX: 8, CON: 16, INT: 5, WIS: 7, CHA: 7 },
    actions: ["act_greatclub"],
    senses: ["darkvision 60 ft.", "passive Perception 8"],
    languages: ["Common", "Giant"],
    loot_table: [
      { name: "Gold Coins", quantity_formula: "2d6", chance: 70 },
      { name: "Half-Eaten Meal", quantity_formula: "1", chance: 40 },
    ],
    description:
      "Ogres are hulking brutes with little patience for tactics — they prefer simply wading into combat and smashing things until the smashing stops being fun.",
  }),

  monster("owlbear", "Owlbear", 3, {
    size: "large",
    type: "monstrosity",
    alignment: "unaligned",
    armor_class: 13,
    hit_points: { current: 59, maximum: 59, formula: "7d10+21" },
    speed_feet: 40,
    attributes: { STR: 20, DEX: 12, CON: 17, INT: 3, WIS: 12, CHA: 7 },
    actions: ["act_bite_md", "act_claw"],
    multiattack: "The owlbear makes two attacks: one with its beak and one with its claws.",
    senses: ["darkvision 60 ft.", "passive Perception 13"],
    languages: [],
    traits: [
      {
        name: "Keen Sight and Smell",
        description:
          "The owlbear has advantage on Wisdom (Perception) checks that rely on sight or smell.",
      },
    ],
    loot_table: [{ name: "Owlbear Feathers", quantity_formula: "1d4", chance: 50 }],
    description:
      "Monstrous crossbreeds of bear and giant owl, owlbears are notoriously aggressive, attacking anything that wanders near their territory.",
  }),

  monster("troll", "Troll", 5, {
    size: "large",
    type: "giant",
    alignment: "chaotic evil",
    armor_class: 15,
    hit_points: { current: 84, maximum: 84, formula: "8d10+40" },
    speed_feet: 30,
    attributes: { STR: 18, DEX: 13, CON: 20, INT: 7, WIS: 9, CHA: 7 },
    actions: ["act_bite_md", "act_claw"],
    multiattack: "The troll makes three attacks: one with its bite and two with its claws.",
    senses: ["darkvision 60 ft.", "passive Perception 9"],
    languages: ["Common", "Giant"],
    traits: [
      {
        name: "Keen Smell",
        description: "The troll has advantage on Wisdom (Perception) checks that rely on smell.",
      },
      {
        name: "Regeneration",
        description:
          "The troll regains 10 hit points at the start of its turn unless it took acid or fire damage since its last turn. If it dies, it turns to mush unless it was killed by fire or acid.",
      },
    ],
    vulnerabilities: ["fire", "acid"],
    loot_table: [{ name: "Troll Tooth", quantity_formula: "1d4", chance: 40 }],
    description:
      "Trolls are ravenous predators with grotesque, rubbery hides and a horrifying capacity for regeneration. Adventurers know to burn what they cut.",
  }),

  monster("minotaur", "Minotaur", 5, {
    size: "large",
    type: "monstrosity",
    alignment: "chaotic evil",
    armor_class: 14,
    hit_points: { current: 76, maximum: 76, formula: "9d10+27" },
    speed_feet: 40,
    attributes: { STR: 18, DEX: 11, CON: 16, INT: 6, WIS: 16, CHA: 6 },
    actions: ["act_greataxe", "act_gore"],
    senses: ["darkvision 60 ft.", "passive Perception 13"],
    languages: ["Abyssal"],
    traits: [
      {
        name: "Charge",
        description:
          "If the minotaur moves at least 10 feet straight toward a target and then hits it with a gore attack on the same turn, the target takes extra piercing damage and must succeed on a STR save or be knocked prone.",
      },
      {
        name: "Labyrinthine Recall",
        description: "The minotaur can perfectly recall any path it has traveled.",
      },
      {
        name: "Reckless",
        description:
          "At the start of its turn, the minotaur can gain advantage on all melee attack rolls during that turn, but attack rolls against it have advantage until its next turn.",
      },
    ],
    loot_table: [{ name: "Gold Coins", quantity_formula: "3d6", chance: 60 }],
    description:
      "Part bull, part maniacal hunter, the minotaur prowls winding labyrinths and canyon mazes, goring those who lose their way.",
  }),

  // ── Vermin, beasts & common folk (CR 1/8 – 1/4) ────────────────────────

  monster("giant-rat", "Giant Rat", 0.125, {
    size: "small",
    type: "beast",
    alignment: "unaligned",
    armor_class: 12,
    hit_points: { current: 7, maximum: 7, formula: "2d6" },
    speed_feet: 30,
    attributes: { STR: 7, DEX: 15, CON: 11, INT: 2, WIS: 10, CHA: 4 },
    actions: ["act_rat_bite"],
    senses: ["darkvision 30 ft.", "passive Perception 10"],
    languages: [],
    traits: [
      {
        name: "Pack Tactics",
        description:
          "The rat has advantage on attack rolls if an ally is within 5 feet of its target.",
      },
    ],
    description:
      "Slick-furred rodents grown to unnatural size in dungeon warrens and sewer depths.",
  }),

  monster("stirge", "Stirge", 0.125, {
    size: "tiny",
    type: "beast",
    alignment: "unaligned",
    armor_class: 14,
    hit_points: { current: 2, maximum: 2, formula: "1d4" },
    speed_feet: 10,
    attributes: { STR: 4, DEX: 16, CON: 11, INT: 2, WIS: 8, CHA: 6 },
    actions: ["act_stirge_drain"],
    senses: ["darkvision 60 ft.", "passive Perception 9"],
    languages: [],
    description:
      "Mosquito-like horrors the size of a house cat, drawn to warm blood across great distances.",
  }),

  monster("kobold", "Kobold", 0.125, {
    size: "small",
    type: "humanoid",
    alignment: "neutral evil",
    armor_class: 12,
    hit_points: { current: 5, maximum: 5, formula: "2d6 - 2" },
    speed_feet: 30,
    attributes: { STR: 7, DEX: 15, CON: 9, INT: 8, WIS: 7, CHA: 8 },
    actions: ["act_dagger", "act_sling"],
    senses: ["darkvision 60 ft.", "passive Perception 8"],
    languages: ["Common", "Draconic"],
    traits: [
      {
        name: "Pack Tactics",
        description: "Advantage on attacks when an ally is within 5 feet of the target.",
      },
      {
        name: "Sunlight Sensitivity",
        description: "Disadvantage on attacks and Perception while in direct sunlight.",
      },
    ],
    loot_table: [{ name: "Gold Coins", quantity_formula: "1d4", chance: 30 }],
    description:
      "Reptilian scavengers who worship dragons, compensating for their frailty with traps, tunnels, and sheer numbers.",
  }),

  monster("bandit", "Bandit", 0.125, {
    size: "medium",
    type: "humanoid",
    alignment: "any non-lawful",
    armor_class: 12,
    hit_points: { current: 11, maximum: 11, formula: "2d8+2" },
    speed_feet: 30,
    attributes: { STR: 11, DEX: 12, CON: 12, INT: 10, WIS: 10, CHA: 10 },
    actions: ["act_scimitar", "act_lightcrossbow"],
    languages: ["Common"],
    loot_table: [{ name: "Gold Coins", quantity_formula: "1d6", chance: 50 }],
    description:
      "Road agents and highway robbers who ambush travelers for coin — or worse.",
  }),

  monster("cultist", "Cultist", 0.125, {
    size: "medium",
    type: "humanoid",
    alignment: "any non-good",
    armor_class: 12,
    hit_points: { current: 9, maximum: 9, formula: "2d8" },
    speed_feet: 30,
    attributes: { STR: 11, DEX: 12, CON: 10, INT: 10, WIS: 11, CHA: 10 },
    actions: ["act_dagger"],
    resistances: ["necrotic"],
    languages: ["Common"],
    traits: [
      {
        name: "Dark Blessing",
        description: "The cultist's patron shields them from death magic.",
      },
    ],
    loot_table: [
      { name: "Gold Coins", quantity_formula: "1d4", chance: 40 },
      { name: "Sinister Idol", quantity_formula: "1", chance: 15 },
    ],
    description:
      "Fanatics sworn to forgotten powers, their eyes hollow with zealotry and their blades anointed in shadow.",
  }),

  monster("mastiff", "Mastiff", 0.125, {
    size: "large",
    type: "beast",
    alignment: "unaligned",
    armor_class: 12,
    hit_points: { current: 5, maximum: 5, formula: "1d10" },
    speed_feet: 40,
    attributes: { STR: 13, DEX: 14, CON: 12, INT: 3, WIS: 12, CHA: 7 },
    actions: ["act_bite_sm"],
    senses: ["darkvision 60 ft.", "passive Perception 13"],
    languages: [],
    traits: [
      {
        name: "Keen Hearing and Smell",
        description: "Advantage on Perception checks relying on hearing or smell.",
      },
    ],
    description:
      "A loyal hunting hound — brave enough to face wolves, gentle enough to guard children.",
  }),

  monster("guard", "Town Guard", 0.125, {
    size: "medium",
    type: "humanoid",
    alignment: "lawful neutral",
    armor_class: 16,
    hit_points: { current: 11, maximum: 11, formula: "2d8+2" },
    speed_feet: 30,
    attributes: { STR: 13, DEX: 12, CON: 12, INT: 10, WIS: 11, CHA: 10 },
    actions: ["act_spear", "act_lightcrossbow"],
    languages: ["Common"],
    description:
      "A watchman of the local militia — a dependable ally holding the line against trouble.",
  }),

  monster("giant-wolf-spider", "Giant Wolf Spider", 0.25, {
    size: "small",
    type: "beast",
    alignment: "unaligned",
    armor_class: 13,
    hit_points: { current: 7, maximum: 7, formula: "2d6" },
    speed_feet: 40,
    attributes: { STR: 12, DEX: 16, CON: 13, INT: 3, WIS: 12, CHA: 4 },
    actions: ["act_poison_bite"],
    senses: ["darkvision 60 ft.", "passive Perception 11"],
    languages: [],
    traits: [
      {
        name: "Spider Climb",
        description: "Climbs difficult surfaces, including upside down on ceilings.",
      },
      {
        name: "Web Walker",
        description: "Ignores movement restrictions caused by webbing.",
      },
    ],
    loot_table: [{ name: "Silk Sac", quantity_formula: "1", chance: 25 }],
    description:
      "A swift hunter that runs down prey rather than snaring it, venom subduing what jaws cannot hold.",
  }),

  monster("hobgoblin", "Hobgoblin", 0.5, {
    size: "medium",
    type: "humanoid",
    alignment: "lawful evil",
    armor_class: 18,
    hit_points: { current: 11, maximum: 11, formula: "2d8+2" },
    speed_feet: 30,
    attributes: { STR: 16, DEX: 12, CON: 14, INT: 10, WIS: 10, CHA: 9 },
    actions: ["act_longsword", "act_longbow"],
    senses: ["darkvision 60 ft.", "passive Perception 10"],
    languages: ["Common", "Goblin"],
    traits: [
      {
        name: "Martial Advantage",
        description:
          "Once per turn, deal an extra 2d6 damage if an ally is within 5 feet of the target.",
      },
    ],
    loot_table: [{ name: "Gold Coins", quantity_formula: "2d6", chance: 50 }],
    description:
      "Disciplined legionnaires of goblinkind — hobgoblins wage war with drill, standard, and merciless order.",
  }),

  monster("gnoll", "Gnoll", 0.5, {
    size: "medium",
    type: "humanoid",
    alignment: "chaotic evil",
    armor_class: 15,
    hit_points: { current: 22, maximum: 22, formula: "5d8" },
    speed_feet: 30,
    attributes: { STR: 14, DEX: 12, CON: 16, INT: 6, WIS: 10, CHA: 7 },
    actions: ["act_scimitar", "act_bite_sm"],
    senses: ["darkvision 60 ft.", "passive Perception 10"],
    languages: ["Gnoll"],
    traits: [
      {
        name: "Rampage",
        description:
          "When the gnoll reduces a creature to 0 hit points, it can move up to half its speed and make a bite attack.",
      },
    ],
    loot_table: [{ name: "Gold Coins", quantity_formula: "1d6", chance: 40 }],
    description:
      "Cackling marauders of the badlands, gnoll packs leave only bones and laughter behind them.",
  }),

  monster("lizardfolk", "Lizardfolk", 0.5, {
    size: "medium",
    type: "humanoid",
    alignment: "neutral",
    armor_class: 15,
    hit_points: { current: 22, maximum: 22, formula: "4d8+4" },
    speed_feet: 30,
    attributes: { STR: 15, DEX: 10, CON: 14, INT: 7, WIS: 12, CHA: 7 },
    actions: ["act_spear", "act_bite_sm"],
    senses: ["passive Perception 11"],
    languages: ["Draconic"],
    traits: [
      {
        name: "Hold Breath",
        description: "The lizardfolk can hold its breath for 15 minutes.",
      },
    ],
    loot_table: [{ name: "Gold Coins", quantity_formula: "1d6", chance: 30 }],
    description:
      "Cold-blooded swamp dwellers who judge all things by hunger and utility — including friendship.",
  }),

  monster("worg", "Worg", 0.5, {
    size: "large",
    type: "beast",
    alignment: "unaligned",
    armor_class: 13,
    hit_points: { current: 26, maximum: 26, formula: "4d10+4" },
    speed_feet: 50,
    attributes: { STR: 16, DEX: 13, CON: 13, INT: 7, WIS: 12, CHA: 8 },
    actions: ["act_bite_trip"],
    senses: ["darkvision 60 ft.", "passive Perception 13"],
    languages: ["Goblin", "Worg"],
    traits: [
      {
        name: "Keen Hearing and Smell",
        description: "Advantage on Perception checks relying on hearing or smell.",
      },
    ],
    description:
      "Malicious wolf-kin clever enough to bargain and cruel enough to enjoy the hunt.",
  }),

  monster("scout", "Scout", 0.5, {
    size: "medium",
    type: "humanoid",
    alignment: "any",
    armor_class: 13,
    hit_points: { current: 16, maximum: 16, formula: "3d8+3" },
    speed_feet: 30,
    attributes: { STR: 11, DEX: 14, CON: 12, INT: 11, WIS: 13, CHA: 11 },
    actions: ["act_longbow", "act_shortsword"],
    senses: ["passive Perception 15"],
    languages: ["Common"],
    traits: [
      {
        name: "Keen Senses",
        description: "Advantage on Perception checks relying on sight or hearing.",
      },
    ],
    description:
      "A seasoned pathfinder and dependable ally — first to spot trouble, last to panic.",
  }),

  monster("bugbear", "Bugbear", 1, {
    size: "medium",
    type: "humanoid",
    alignment: "chaotic evil",
    armor_class: 16,
    hit_points: { current: 27, maximum: 27, formula: "5d8+5" },
    speed_feet: 30,
    attributes: { STR: 15, DEX: 14, CON: 13, INT: 8, WIS: 11, CHA: 9 },
    actions: ["act_morningstar_sm", "act_spear"],
    senses: ["darkvision 60 ft.", "passive Perception 10"],
    languages: ["Common", "Goblin"],
    traits: [
      {
        name: "Brute",
        description: "Melee weapon hits deal one extra weapon die of damage.",
      },
      {
        name: "Surprise Attack",
        description:
          "If the bugbear surprises a creature in the first round, its hit deals an extra 2d6 damage.",
      },
    ],
    loot_table: [{ name: "Gold Coins", quantity_formula: "1d6", chance: 40 }],
    description:
      "Hulking ambushers with arms too long for their frames, bugbears delight in terror as much as slaughter.",
  }),

  monster("specter", "Specter", 1, {
    size: "medium",
    type: "undead",
    alignment: "chaotic evil",
    armor_class: 12,
    hit_points: { current: 22, maximum: 22, formula: "5d8" },
    speed_feet: 0,
    attributes: { STR: 1, DEX: 15, CON: 11, INT: 10, WIS: 8, CHA: 11 },
    actions: ["act_life_drain"],
    resistances: [
      "acid", "cold", "fire", "lightning", "necrotic",
      "bludgeoning", "piercing", "slashing",
    ],
    immunities: ["poison"],
    condition_immunities: ["exhaustion", "grappled", "paralyzed", "petrified", "poisoned", "unconscious"],
    senses: ["darkvision 60 ft.", "passive Perception 9"],
    languages: ["understands Common"],
    traits: [
      {
        name: "Incorporeal Movement",
        description:
          "Moves through creatures and objects as difficult terrain; takes 1d10 force damage ending its turn inside an object.",
      },
      {
        name: "Sunlight Sensitivity",
        description: "Disadvantage on attacks and Perception while in sunlight.",
      },
    ],
    description:
      "A wisp of spite bound to the world by unfinished rage, drifting through walls toward the living.",
  }),

  monster("animated-armor", "Animated Armor", 1, {
    size: "medium",
    type: "construct",
    alignment: "unaligned",
    armor_class: 18,
    hit_points: { current: 33, maximum: 33, formula: "6d8+6" },
    speed_feet: 25,
    attributes: { STR: 14, DEX: 11, CON: 13, INT: 1, WIS: 3, CHA: 1 },
    actions: ["act_slam_generic"],
    immunities: ["poison", "psychic"],
    condition_immunities: ["blinded", "charmed", "deafened", "frightened", "paralyzed", "petrified", "poisoned"],
    senses: ["blindsight 10 ft. (blind beyond)", "passive Perception 6"],
    languages: [],
    traits: [
      {
        name: "False Appearance",
        description: "While motionless, the armor is indistinguishable from ordinary armor.",
      },
    ],
    loot_table: [{ name: "Suit of Armor", quantity_formula: "1", chance: 50 }],
    description:
      "An empty suit of plate that clanks to life when intruders reach for the treasure behind it.",
  }),

  monster("gargoyle", "Gargoyle", 2, {
    size: "medium",
    type: "elemental",
    alignment: "chaotic evil",
    armor_class: 15,
    hit_points: { current: 52, maximum: 52, formula: "7d8+21" },
    speed_feet: 30,
    attributes: { STR: 15, DEX: 11, CON: 16, INT: 6, WIS: 11, CHA: 7 },
    actions: ["act_claw"],
    multiattack: "The gargoyle makes two claw attacks.",
    resistances: ["bludgeoning", "piercing", "slashing", "poison"],
    immunities: ["poison"],
    condition_immunities: ["exhaustion", "petrified", "poisoned"],
    senses: ["darkvision 60 ft.", "passive Perception 10"],
    languages: ["Common", "Primordial"],
    traits: [
      {
        name: "Flyer",
        description: "The gargoyle can fly up to 60 feet.",
      },
      {
        name: "False Appearance",
        description: "While motionless, the gargoyle is indistinguishable from a statue.",
      },
    ],
    description:
      "Grotesque winged sentinels carved from stone — until they peel off the cathedral wall to feed.",
  }),

  monster("will-o-wisp", "Will-o'-Wisp", 2, {
    size: "tiny",
    type: "undead",
    alignment: "chaotic evil",
    armor_class: 16,
    hit_points: { current: 22, maximum: 22, formula: "9d4" },
    speed_feet: 0,
    attributes: { STR: 1, DEX: 28, CON: 10, INT: 13, WIS: 14, CHA: 11 },
    actions: ["act_wisp_shock"],
    resistances: ["acid", "cold", "fire", "bludgeoning", "piercing", "slashing"],
    immunities: ["lightning", "poison"],
    condition_immunities: ["exhaustion", "grappled", "paralyzed", "prone", "restrained", "unconscious"],
    senses: ["darkvision 120 ft.", "passive Perception 12"],
    languages: ["understands Common and Auran"],
    traits: [
      {
        name: "Variable Illumination",
        description:
          "The wisp sheds bright light in a radius it chooses (up to 20 feet) — or none at all.",
      },
    ],
    loot_table: [{ name: "Lost Trinket", quantity_formula: "1", chance: 20 }],
    description:
      "A dancing mote of grave-light that lures travelers into bogs and ruins, feasting on their final despair.",
  }),

  monster("gelatinous-cube", "Gelatinous Cube", 2, {
    size: "large",
    type: "ooze",
    alignment: "unaligned",
    armor_class: 6,
    hit_points: { current: 84, maximum: 84, formula: "8d10+40" },
    speed_feet: 15,
    attributes: { STR: 14, DEX: 3, CON: 20, INT: 1, WIS: 6, CHA: 1 },
    actions: ["act_engulf"],
    immunities: ["poison"],
    condition_immunities: ["blinded", "charmed", "deafened", "exhaustion", "frightened", "prone"],
    senses: ["blindsight 60 ft. (blind beyond)", "passive Perception 6"],
    languages: [],
    traits: [
      {
        name: "Transparent",
        description: "Even in plain sight, the cube is easily missed (Stealth advantage).",
      },
    ],
    loot_table: [{ name: "Dissolved Gear", quantity_formula: "1", chance: 40 }],
    description:
      "A slow wall of translucent acid gliding dungeon corridors, dissolving everything in its path.",
  }),

  monster("mimic", "Mimic", 2, {
    size: "medium",
    type: "monstrosity",
    alignment: "neutral",
    armor_class: 12,
    hit_points: { current: 58, maximum: 58, formula: "9d8+18" },
    speed_feet: 15,
    attributes: { STR: 17, DEX: 12, CON: 15, INT: 5, WIS: 13, CHA: 8 },
    actions: ["act_grasp", "act_bite_sm"],
    senses: ["darkvision 60 ft.", "passive Perception 11"],
    languages: [],
    traits: [
      {
        name: "Adhesive",
        description: "Grapples anything touching it; escape DC 13.",
      },
      {
        name: "Shapechanger",
        description: "Disguises itself as an object of similar mass — often a treasure chest.",
      },
    ],
    condition_immunities: ["prone"],
    description:
      "That chest in the corner? It just licked its hinges. Mimics hunger most for adventurers who open doors first and think later.",
  }),

  monster("constrictor-snake", "Constrictor Snake", 2, {
    size: "large",
    type: "beast",
    alignment: "unaligned",
    armor_class: 12,
    hit_points: { current: 13, maximum: 13, formula: "2d10+2" },
    speed_feet: 30,
    attributes: { STR: 15, DEX: 14, CON: 10, INT: 2, WIS: 10, CHA: 3 },
    actions: ["act_grasp"],
    senses: ["blindsight 10 ft.", "passive Perception 10"],
    languages: [],
    description:
      "A muscular serpent that swallows its prey whole, coiling tighter with every breath squeezed out.",
  }),

  monster("priest", "Priest", 2, {
    size: "medium",
    type: "humanoid",
    alignment: "any",
    armor_class: 16,
    hit_points: { current: 27, maximum: 27, formula: "5d8+5" },
    speed_feet: 25,
    attributes: { STR: 13, DEX: 10, CON: 14, INT: 11, WIS: 18, CHA: 13 },
    actions: ["act_mace", "act_sacred_flame"],
    languages: ["Common", "Celestial"],
    traits: [
      {
        name: "Divine Eminence",
        description:
          "Bonus action: the priest's next weapon hit deals an extra 2d8 radiant damage.",
      },
    ],
    loot_table: [{ name: "Gold Coins", quantity_formula: "2d4", chance: 50 }],
    description:
      "A devoted healer of the temple — a steadfast ally whose prayers mend wounds and repel darkness.",
  }),

  monster("werewolf", "Werewolf", 3, {
    size: "medium",
    type: "humanoid",
    alignment: "chaotic evil",
    armor_class: 11,
    hit_points: { current: 58, maximum: 58, formula: "9d8+18" },
    speed_feet: 30,
    attributes: { STR: 15, DEX: 13, CON: 14, INT: 10, WIS: 11, CHA: 10 },
    actions: ["act_spear", "act_bite_md"],
    multiattack: "The werewolf makes two attacks: one with its spear and one with its bite.",
    resistances: ["bludgeoning", "piercing", "slashing"],
    senses: ["darkvision 40 ft.", "passive Perception 13"],
    languages: ["Common"],
    traits: [
      {
        name: "Shapechanger",
        description: "Shifts between humanoid, hybrid, and wolf forms.",
      },
      {
        name: "Keen Hearing and Smell",
        description: "Advantage on Perception checks relying on hearing or smell.",
      },
      {
        name: "Lycanthropic Curse",
        description: "A humanoid bitten but not killed risks inheriting the curse.",
      },
    ],
    description:
      "By day a neighbor; by full moon a slavering hunter. Silver is the only language it fears.",
  }),

  monster("shadow", "Shadow", 3, {
    size: "medium",
    type: "undead",
    alignment: "chaotic evil",
    armor_class: 12,
    hit_points: { current: 16, maximum: 16, formula: "3d8+3" },
    speed_feet: 40,
    attributes: { STR: 6, DEX: 14, CON: 13, INT: 6, WIS: 10, CHA: 8 },
    actions: ["act_strength_drain"],
    resistances: ["acid", "cold", "fire", "lightning", "thunder", "bludgeoning", "piercing", "slashing"],
    immunities: ["necrotic", "poison"],
    condition_immunities: ["exhaustion", "frightened", "grappled", "paralyzed", "petrified", "poisoned", "prone", "restrained"],
    senses: ["darkvision 60 ft.", "passive Perception 10"],
    languages: [],
    traits: [
      {
        name: "Amorphous",
        description: "Moves through gaps as narrow as an inch without squeezing.",
      },
      {
        name: "Sunlight Weakness",
        description: "In sunlight the shadow is weakened — radiant light burns it away.",
      },
    ],
    description:
      "Not a cast of light, but its theft — a living dark that drinks strength from muscle and bone.",
  }),

  monster("manticore", "Manticore", 3, {
    size: "large",
    type: "monstrosity",
    alignment: "lawful evil",
    armor_class: 15,
    hit_points: { current: 68, maximum: 68, formula: "8d10+24" },
    speed_feet: 30,
    attributes: { STR: 17, DEX: 13, CON: 17, INT: 7, WIS: 12, CHA: 8 },
    actions: ["act_bite_md", "act_claw", "act_tail_spikes"],
    multiattack: "The manticore makes three attacks: one bite, one claws, or two tail spikes.",
    senses: ["darkvision 60 ft.", "passive Perception 11"],
    languages: [],
    traits: [
      {
        name: "Tail Spikes",
        description: "Ranged volley of iron barbs; regrown after a short rest.",
      },
    ],
    description:
      "Lion's body, bat wings, man's face twisted in mockery — the manticore toys with prey before eating it.",
  }),

  monster("hell-hound", "Hell Hound", 3, {
    size: "medium",
    type: "fiend",
    alignment: "lawful evil",
    armor_class: 15,
    hit_points: { current: 45, maximum: 45, formula: "7d8+14" },
    speed_feet: 50,
    attributes: { STR: 17, DEX: 12, CON: 14, INT: 6, WIS: 13, CHA: 6 },
    actions: ["act_bite_md", "act_fire_breath_sm"],
    immunities: ["fire"],
    senses: ["darkvision 60 ft.", "passive Perception 15"],
    languages: ["understands Infernal"],
    traits: [
      {
        name: "Pack Tactics",
        description: "Advantage when an ally is within 5 feet of the target.",
      },
      {
        name: "Fire Breath (Recharge 5–6)",
        description: "Exhales a cone of flame from the burning forge of its throat.",
      },
    ],
    description:
      "Coal-eyed hounds from the lower planes, their barking like hammer-strikes and their breath like bellows.",
  }),

  monster("basilisk", "Basilisk", 3, {
    size: "medium",
    type: "monstrosity",
    alignment: "unaligned",
    armor_class: 15,
    hit_points: { current: 52, maximum: 52, formula: "7d8+21" },
    speed_feet: 20,
    attributes: { STR: 16, DEX: 8, CON: 15, INT: 2, WIS: 8, CHA: 7 },
    actions: ["act_basilisk_bite"],
    condition_immunities: ["petrified"],
    senses: ["darkvision 60 ft.", "passive Perception 9"],
    languages: [],
    traits: [
      {
        name: "Petrifying Gaze",
        description:
          "Meet its eyes within 30 feet and risk turning to stone — avert your gaze, and fight blind.",
      },
    ],
    description:
      "Around the basilisk's lair stand garden rows of statues, each frozen mid-scream at what they saw.",
  }),

  monster("knight", "Knight", 3, {
    size: "medium",
    type: "humanoid",
    alignment: "any",
    armor_class: 18,
    hit_points: { current: 52, maximum: 52, formula: "8d8+16" },
    speed_feet: 30,
    attributes: { STR: 16, DEX: 11, CON: 14, INT: 11, WIS: 11, CHA: 15 },
    actions: ["act_greatsword", "act_spear"],
    languages: ["Common"],
    traits: [
      {
        name: "Bravery",
        description: "Advantage on saving throws against being frightened.",
      },
    ],
    loot_table: [{ name: "Gold Coins", quantity_formula: "3d6", chance: 70 }],
    description:
      "An armored champion of noble house or holy order — a powerful ally who holds the field so others may flee.",
  }),

  monster("veteran", "Veteran", 3, {
    size: "medium",
    type: "humanoid",
    alignment: "any",
    armor_class: 17,
    hit_points: { current: 65, maximum: 65, formula: "10d8+20" },
    speed_feet: 30,
    attributes: { STR: 16, DEX: 13, CON: 14, INT: 10, WIS: 11, CHA: 10 },
    actions: ["act_longsword", "act_longbow"],
    multiattack: "The veteran makes two longsword attacks, or two longbow shots.",
    languages: ["Common"],
    loot_table: [{ name: "Gold Coins", quantity_formula: "4d6", chance: 80 }],
    description:
      "Scarred professional soldier for hire — loyal to coin, contract, or cause, and worth every copper.",
  }),

  // ── High tier & bosses ─────────────────────────────────────────────────

  monster("ettin", "Ettin", 4, {
    size: "large",
    type: "giant",
    alignment: "chaotic evil",
    armor_class: 12,
    hit_points: { current: 85, maximum: 85, formula: "10d10+30" },
    speed_feet: 40,
    attributes: { STR: 21, DEX: 8, CON: 17, INT: 6, WIS: 10, CHA: 8 },
    actions: ["act_greataxe", "act_morningstar_sm"],
    multiattack: "The ettin makes two attacks: one with its greataxe and one with its morningstar.",
    senses: ["darkvision 60 ft.", "passive Perception 10"],
    languages: ["Giant", "Orc"],
    traits: [
      {
        name: "Two Heads",
        description:
          "Advantage on Perception and saving throws against being blinded, charmed, deafened, frightened, stunned, or knocked unconscious.",
      },
      {
        name: "Wakeful",
        description: "While asleep, at least one of its heads remains awake.",
      },
    ],
    loot_table: [{ name: "Gold Coins", quantity_formula: "3d6", chance: 60 }],
    description:
      "Two squabbling heads share one brutish body — arguing constantly, agreeing only on violence.",
  }),

  monster("banshee", "Banshee", 4, {
    size: "medium",
    type: "undead",
    alignment: "chaotic evil",
    armor_class: 12,
    hit_points: { current: 58, maximum: 58, formula: "13d8" },
    speed_feet: 0,
    attributes: { STR: 1, DEX: 14, CON: 10, INT: 12, WIS: 11, CHA: 17 },
    actions: ["act_corrupting_touch"],
    resistances: ["acid", "fire", "lightning", "thunder", "bludgeoning", "piercing", "slashing"],
    immunities: ["cold", "necrotic", "poison"],
    condition_immunities: ["charmed", "exhaustion", "frightened", "grappled", "paralyzed", "petrified", "poisoned", "restrained", "unconscious"],
    senses: ["darkvision 60 ft.", "passive Perception 10"],
    languages: ["Common", "Elvish"],
    traits: [
      {
        name: "Wail (1/Day)",
        description:
          "A soul-rending shriek: every creature within 30 feet that fails a CON save drops to 0 hit points.",
      },
      {
        name: "Detect Life",
        description: "Senses living creatures up to 5 miles away.",
      },
      {
        name: "Incorporeal Movement",
        description: "Moves through creatures and objects as difficult terrain.",
      },
    ],
    description:
      "The grieving echo of an elven woman who died of sorrow, her wail now a weapon that stops hearts.",
  }),

  monster("air-elemental", "Air Elemental", 5, {
    size: "large",
    type: "elemental",
    alignment: "neutral",
    armor_class: 15,
    hit_points: { current: 90, maximum: 90, formula: "12d10+24" },
    speed_feet: 90,
    attributes: { STR: 14, DEX: 20, CON: 14, INT: 6, WIS: 10, CHA: 6 },
    actions: ["act_wind_slam"],
    resistances: ["lightning", "thunder", "bludgeoning", "piercing", "slashing"],
    immunities: ["poison"],
    condition_immunities: ["exhaustion", "grappled", "paralyzed", "petrified", "poisoned", "prone", "restrained", "unconscious"],
    senses: ["darkvision 60 ft.", "passive Perception 10"],
    languages: ["Auran"],
    traits: [
      {
        name: "Air Form",
        description:
          "Can enter an enemy's space and stop there; moves through spaces as narrow as an inch without squeezing.",
      },
    ],
    description:
      "A howling cyclone given purpose, flinging debris and bodies alike with gleeful turbulence.",
  }),

  monster("fire-elemental", "Fire Elemental", 5, {
    size: "large",
    type: "elemental",
    alignment: "neutral",
    armor_class: 13,
    hit_points: { current: 102, maximum: 102, formula: "13d10+32" },
    speed_feet: 50,
    attributes: { STR: 10, DEX: 17, CON: 16, INT: 6, WIS: 10, CHA: 7 },
    actions: ["act_fire_touch"],
    immunities: ["fire", "poison"],
    condition_immunities: ["exhaustion", "grappled", "paralyzed", "petrified", "poisoned", "restrained", "unconscious"],
    senses: ["darkvision 60 ft.", "passive Perception 10"],
    languages: ["Ignan"],
    traits: [
      {
        name: "Fire Form",
        description:
          "Touches ignite flammable objects; the elemental can move through spaces as narrow as an inch.",
      },
      {
        name: "Illumination",
        description: "Sheds bright light in a 30-foot radius.",
      },
      {
        name: "Water Susceptibility",
        description: "Takes 1 cold damage for every gallon of water splashed on it.",
      },
    ],
    description:
      "A living inferno that leaves footprints of ash — curious, hungry, and utterly without mercy.",
  }),

  monster("wraith", "Wraith", 5, {
    size: "medium",
    type: "undead",
    alignment: "neutral evil",
    armor_class: 13,
    hit_points: { current: 67, maximum: 67, formula: "9d8+27" },
    speed_feet: 0,
    attributes: { STR: 6, DEX: 16, CON: 16, INT: 12, WIS: 14, CHA: 15 },
    actions: ["act_draining_touch"],
    resistances: ["acid", "cold", "necrotic", "bludgeoning", "piercing", "slashing"],
    immunities: ["poison"],
    condition_immunities: ["charmed", "exhaustion", "frightened", "grappled", "paralyzed", "petrified", "poisoned", "prone", "restrained", "unconscious"],
    senses: ["darkvision 60 ft.", "passive Perception 12"],
    languages: ["Common"],
    traits: [
      {
        name: "Create Specter",
        description:
          "Humanoids slain by the wraith rise as specters under its control within moments.",
      },
      {
        name: "Sunlight Sensitivity",
        description: "Disadvantage on attacks and Perception while in sunlight.",
      },
    ],
    description:
      "Where the wraith passes, life drains like water through open fingers — and the dead do not stay down.",
  }),

  monster("wyvern", "Wyvern", 6, {
    size: "large",
    type: "dragon",
    alignment: "unaligned",
    armor_class: 13,
    hit_points: { current: 110, maximum: 110, formula: "13d10+39" },
    speed_feet: 20,
    attributes: { STR: 19, DEX: 10, CON: 16, INT: 5, WIS: 12, CHA: 6 },
    actions: ["act_talons", "act_wyvern_sting"],
    multiattack: "The wyvern makes two attacks: one with its talons and one with its sting.",
    condition_immunities: ["poisoned"],
    senses: ["darkvision 60 ft.", "passive Perception 14"],
    languages: [],
    traits: [
      {
        name: "Dive Hunter",
        description: "Strikes from above with venomous sting before carrying off smaller prey.",
      },
    ],
    loot_table: [{ name: "Wyven Talon", quantity_formula: "1", chance: 40 }],
    description:
      "A mindless engine of appetite on leathery wings — less clever than a dragon, no less deadly.",
  }),

  monster("mage", "Mage", 6, {
    size: "medium",
    type: "humanoid",
    alignment: "any",
    armor_class: 12,
    hit_points: { current: 40, maximum: 40, formula: "9d8" },
    speed_feet: 30,
    attributes: { STR: 9, DEX: 14, CON: 11, INT: 17, WIS: 12, CHA: 11 },
    actions: ["act_fire_bolt", "act_shocking_grasp", "act_magic_missile"],
    languages: ["Common", "Draconic"],
    traits: [
      {
        name: "Spellcasting",
        description:
          "A practiced arcanist commanding shield, misty step, and fireball when pressed.",
      },
    ],
    loot_table: [{ name: "Spellbook", quantity_formula: "1", chance: 50 }],
    description:
      "A robed scholar of the arcane — ally or enemy depending entirely on how you knock.",
  }),

  monster("stone-golem", "Stone Golem", 7, {
    size: "large",
    type: "construct",
    alignment: "unaligned",
    armor_class: 17,
    hit_points: { current: 178, maximum: 178, formula: "17d10+85" },
    speed_feet: 30,
    attributes: { STR: 22, DEX: 9, CON: 18, INT: 3, WIS: 11, CHA: 1 },
    actions: ["act_golem_slam"],
    resistances: ["bludgeoning", "piercing", "slashing"],
    immunities: ["poison", "psychic"],
    condition_immunities: ["charmed", "exhaustion", "frightened", "paralyzed", "petrified", "poisoned"],
    senses: ["darkvision 120 ft.", "passive Perception 12"],
    languages: [],
    traits: [
      {
        name: "Immutable Form",
        description: "Immune to any effect that would alter its form.",
      },
      {
        name: "Magic Resistance",
        description: "Advantage on saving throws against spells and magical effects.",
      },
    ],
    loot_table: [{ name: "Ancient Rune Stone", quantity_formula: "1", chance: 30 }],
    description:
      "Ancient masonry animated by forgotten commands, guarding halls whose builders turned to dust millennia ago.",
  }),

  monster("oni", "Oni", 7, {
    size: "large",
    type: "giant",
    alignment: "lawful evil",
    armor_class: 16,
    hit_points: { current: 110, maximum: 110, formula: "13d10+39" },
    speed_feet: 30,
    attributes: { STR: 19, DEX: 11, CON: 16, INT: 14, WIS: 12, CHA: 15 },
    actions: ["act_oni_bite", "act_claw"],
    multiattack: "The oni makes two attacks: one bite and one claws.",
    senses: ["darkvision 60 ft.", "passive Perception 11"],
    languages: ["Common", "Giant"],
    traits: [
      {
        name: "Regeneration",
        description: "Regains 10 hit points at the start of its turn if it has at least 1 HP.",
      },
      {
        name: "Magic Weapons",
        description: "Its weapon attacks are magical.",
      },
      {
        name: "Innate Spellcasting",
        description: "Commands darkness, invisibility, and charm person at will.",
      },
    ],
    loot_table: [{ name: "Gold Coins", quantity_formula: "5d6", chance: 80 }],
    description:
      "An ogre-shaped demon wearing a stolen face, savoring fear almost as much as flesh.",
  }),

  monster("frost-giant", "Frost Giant", 8, {
    size: "huge",
    type: "giant",
    alignment: "neutral evil",
    armor_class: 15,
    hit_points: { current: 138, maximum: 138, formula: "12d12+60" },
    speed_feet: 40,
    attributes: { STR: 21, DEX: 9, CON: 18, INT: 9, WIS: 10, CHA: 12 },
    actions: ["act_giant_axe", "act_rock_throw"],
    multiattack: "The giant makes two attacks: one with its greataxe and one thrown rock.",
    immunities: ["cold"],
    senses: ["passive Perception 10"],
    languages: ["Giant"],
    traits: [
      {
        name: "Keen Smell",
        description: "Advantage on Wisdom (Perception) checks that rely on smell.",
      },
    ],
    loot_table: [
      { name: "Gold Coins", quantity_formula: "5d6", chance: 70 },
      { name: "Frost-Bound Relic", quantity_formula: "1", chance: 25 },
    ],
    description:
      "Raiders from the glacier-halls, judging strength the only virtue worth carving into saga-stone.",
  }),

  monster("young-green-dragon", "Young Green Dragon", 8, {
    size: "huge",
    type: "dragon",
    alignment: "lawful evil",
    armor_class: 18,
    hit_points: { current: 136, maximum: 136, formula: "16d10+48" },
    speed_feet: 40,
    attributes: { STR: 19, DEX: 10, CON: 17, INT: 12, WIS: 11, CHA: 13 },
    actions: ["act_dragon_bite", "act_claw", "act_poison_breath"],
    multiattack: "The dragon makes three attacks: one bite and two claws.",
    immunities: ["poison"],
    senses: ["blindsight 30 ft.", "darkvision 120 ft.", "passive Perception 18"],
    languages: ["Common", "Draconic"],
    traits: [
      {
        name: "Amphibious",
        description: "Breathes air and water equally well.",
      },
      {
        name: "Poison Breath (Recharge 5–6)",
        description: "Exhales poisonous gas in a 30-foot cone.",
      },
    ],
    loot_table: [{ name: "Dragon Hoard Coins", quantity_formula: "6d6", chance: 100 }],
    description:
      "Master of forest shadow and whispered deceit, the green dragon corrupts before it conquers.",
  }),

  monster("young-red-dragon", "Young Red Dragon", 10, {
    size: "huge",
    type: "dragon",
    alignment: "chaotic evil",
    armor_class: 18,
    hit_points: { current: 178, maximum: 178, formula: "17d10+85" },
    speed_feet: 40,
    attributes: { STR: 23, DEX: 10, CON: 21, INT: 14, WIS: 11, CHA: 19 },
    actions: ["act_dragon_bite", "act_claw", "act_fire_breath_lg"],
    multiattack: "The dragon makes three attacks: one bite and two claws.",
    immunities: ["fire"],
    senses: ["blindsight 30 ft.", "darkvision 120 ft.", "passive Perception 18"],
    languages: ["Common", "Draconic"],
    traits: [
      {
        name: "Legendary Resistance (3/Day)",
        description: "On a failed save, the dragon may choose to succeed instead.",
      },
      {
        name: "Fire Breath (Recharge 5–6)",
        description: "Exhales roaring flame in a 30-foot cone.",
      },
    ],
    loot_table: [
      { name: "Dragon Hoard Coins", quantity_formula: "10d6", chance: 100 },
      { name: "Molten Gemstone", quantity_formula: "2d4", chance: 60 },
    ],
    description:
      "Arrogant heir of the oldest blood, the red dragon burns first and negotiates with ashes.",
  }),

  monster("archmage", "Archmage", 12, {
    size: "medium",
    type: "humanoid",
    alignment: "any",
    armor_class: 12,
    hit_points: { current: 99, maximum: 99, formula: "18d8+18" },
    speed_feet: 30,
    attributes: { STR: 10, DEX: 14, CON: 12, INT: 20, WIS: 15, CHA: 17 },
    actions: ["act_fire_bolt", "act_cone_of_cold", "act_magic_missile"],
    languages: ["Common", "Draconic", "Celestial"],
    traits: [
      {
        name: "Magic Resistance",
        description: "Advantage on saving throws against spells and magical effects.",
      },
      {
        name: "Spell Mastery",
        description: "Shield, detect magic, and other cantrips are always prepared.",
      },
    ],
    loot_table: [{ name: "Archmage's Grimoire", quantity_formula: "1", chance: 40 }],
    description:
      "Peak of mortal arcane power — court advisor, doom of nations, and terrible enemy or invaluable ally.",
  }),
];
