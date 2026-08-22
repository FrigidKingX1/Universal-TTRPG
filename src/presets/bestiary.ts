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
];
