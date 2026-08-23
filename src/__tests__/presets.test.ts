import { describe, it, expect } from "vitest";
import { PRESET_MONSTERS, PRESET_ACTIONS } from "../presets/bestiary";
import { PRESET_CLASSES, CLASS_ACTIONS, applyClassTemplate, mergeSecondaryClass } from "../presets/classes";
import {
  ALL_PRESET_ACTIONS,
  findPresetAction,
  WEAPON_ACTIONS,
  SPELL_ACTIONS,
  MONSTER_ATTACK_ACTIONS,
} from "../presets/actions";
import { EQUIPMENT_CATALOG } from "../presets/equipment";

describe("Bestiary presets", () => {
  it("has a large library of monsters", () => {
    expect(PRESET_MONSTERS.length).toBeGreaterThanOrEqual(50);
  });

  it("monster keys and names are unique", () => {
    const keys = PRESET_MONSTERS.map((m) => m.key);
    const names = PRESET_MONSTERS.map((m) => m.name);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(names).size).toBe(names.length);
  });

  it("every monster has required combat stats", () => {
    for (const m of PRESET_MONSTERS) {
      expect(m.armor_class, `${m.name} AC`).toBeGreaterThan(0);
      expect(m.hit_points.maximum, `${m.name} max HP`).toBeGreaterThan(0);
      expect(m.attributes.STR, `${m.name} STR`).toBeDefined();
      expect(m.attributes.DEX, `${m.name} DEX`).toBeDefined();
      expect(m.attributes.CON, `${m.name} CON`).toBeDefined();
      expect(m.description, `${m.name} description`).toBeTruthy();
    }
  });

  it("CR values are valid ascending tiers", () => {
    const crs = PRESET_MONSTERS.map((m) => m.challenge_rating).sort((a, b) => a - b);
    expect(crs[0]).toBeLessThanOrEqual(0.25);
    expect(crs[crs.length - 1]).toBeGreaterThanOrEqual(10); // bosses exist
  });

  it("QA audit: loot tables are well-formed and broadly populated", () => {
    const standard = new Set(["slashing", "piercing", "bludgeoning", "fire", "cold", "lightning", "poison", "psychic", "necrotic", "radiant", "force", "thunder", "acid"]);
    void standard;
    let populated = 0;
    for (const m of PRESET_MONSTERS) {
      for (const l of m.loot_table) {
        expect(l.name.length, `${m.name} loot name`).toBeGreaterThan(0);
        expect(l.quantity_formula, `${m.name} formula`).toMatch(/^[\dd+\-\s]+$/);
        expect(l.chance, `${m.name} chance`).toBeGreaterThanOrEqual(0);
        expect(l.chance, `${m.name} chance`).toBeLessThanOrEqual(100);
      }
      if (m.loot_table.length > 0) populated++;
    }
    // Compact builder auto-assigns coin hoards; original batches were
    // back-filled with thematic drops. ~35 stay intentionally empty
    // (swarms, incorporeal spirits, banished fiends, oozes, whimsical fey).
    expect(populated, "monsters with loot").toBeGreaterThanOrEqual(335);
    // And the canonical no-treasure creatures must remain untouched.
    for (const key of ["shrieker", "ghost", "swarm_rats", "quasit", "black_pudding"]) {
      const m = PRESET_MONSTERS.find((x) => x.key === key);
      expect(m?.loot_table.length ?? 0, `${key} stays empty`).toBe(0);
    }
  });

  it("includes ally stat blocks", () => {
    const names = PRESET_MONSTERS.map((m) => m.name);
    expect(names).toContain("Town Guard");
    expect(names).toContain("Knight");
    expect(names).toContain("Priest");
    expect(names).toContain("Scout");
  });

  it("includes boss-tier monsters with legendary traits", () => {
    const youngRed = PRESET_MONSTERS.find((m) => m.name === "Young Red Dragon")!;
    expect(youngRed.challenge_rating).toBeGreaterThanOrEqual(10);
    expect(youngRed.traits?.some((t) => t.name.includes("Legendary"))).toBe(true);

    const green = PRESET_MONSTERS.find((m) => m.name === "Young Green Dragon")!;
    expect(green.actions).toContain("act_poison_breath");
  });
});

describe("Preset actions", () => {
  it("registry is deduped by id", () => {
    const ids = ALL_PRESET_ACTIONS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("display names are unique (dropdown/log clarity)", () => {
    const names = ALL_PRESET_ACTIONS.map((a) => a.name);
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    expect([...new Set(dupes)], "duplicate action labels").toEqual([]);
  });

  it("contains a broad action library", () => {
    expect(WEAPON_ACTIONS.length + SPELL_ACTIONS.length + MONSTER_ATTACK_ACTIONS.length).toBeGreaterThanOrEqual(35);
    expect(ALL_PRESET_ACTIONS.length).toBeGreaterThanOrEqual(45);
  });

  it("every monster action reference resolves to a definition", () => {
    const missing: string[] = [];
    for (const m of PRESET_MONSTERS) {
      for (const actionId of m.actions ?? []) {
        if (!findPresetAction(actionId)) missing.push(`${m.name}: ${actionId}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("every class ability reference resolves to a definition", () => {
    const missing: string[] = [];
    for (const c of PRESET_CLASSES) {
      for (const abilityId of c.starting_abilities) {
        if (!findPresetAction(abilityId)) missing.push(`${c.name}: ${abilityId}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("attack formulas use valid attribute paths", () => {
    const validAttrs = ["STR", "DEX", "CON", "INT", "WIS", "CHA"];
    for (const a of [...PRESET_ACTIONS, ...CLASS_ACTIONS, ...SPELL_ACTIONS]) {
      const roll = a.resolution.roll_formula;
      if (!roll) continue; // guaranteed_effect actions skip rolls
      expect(roll.startsWith("1d20"), `${a.id} roll`).toBe(true);
      if (roll.includes("@attributes.")) {
        const attr = roll.split("@attributes.")[1]?.split(".")[0];
        expect(validAttrs, `${a.id} attr ${attr}`).toContain(attr);
      }
    }
  });

  it("damage types are from the standard list", () => {
    const standard = new Set([
      "slashing", "piercing", "bludgeoning", "fire", "cold", "lightning", "poison",
      "psychic", "necrotic", "radiant", "force", "thunder", "acid",
    ]);
    for (const a of ALL_PRESET_ACTIONS) {
      const dt = a.resolution.outcomes?.on_success?.damage_type;
      if (dt) expect(standard.has(dt), `${a.id} type ${dt}`).toBe(true);
    }
  });

  it("magic missile is a guaranteed-effect auto-hit", () => {
    const mm = findPresetAction("act_magic_missile")!;
    expect(mm.resolution.type).toBe("guaranteed_effect");
    expect(mm.resolution.outcomes?.on_success?.formula).toBe("3d4 + 3");
  });

  it("heal actions restore HP instead of dealing damage", () => {
    const cure = findPresetAction("act_cure_wounds")!;
    const word = findPresetAction("act_healing_word")!;
    const mass = findPresetAction("act_mass_cure_wounds")!;
    for (const [name, a] of [["cure", cure], ["word", word], ["mass", mass]] as const) {
      expect(a.resolution.type, name).toBe("guaranteed_effect");
      expect(a.resolution.outcomes?.on_success?.heal, name).toBe(true);
      expect(a.resolution.outcomes?.on_success?.damage_type, name).toBeUndefined();
      expect(a.resolution.outcomes?.on_success?.formula, name).toBeTruthy();
    }
    // Healing Word is the classic quick bonus-action pick-me-up.
    expect(word.action_cost.type).toBe("bonus_action");
    // Tiered slots: basic heals draw l1, Mass Cure Wounds draws l3.
    expect(cure.slot_cost?.pool).toBe("spell_slots_l1");
    expect(word.slot_cost?.pool).toBe("spell_slots_l1");
    expect(mass.slot_cost?.pool).toBe("spell_slots_l3");
  });

  it("caster classes unlock higher slot tiers as they level", () => {
    const cleric = PRESET_CLASSES.find((c) => c.id === "cleric")!;
    const wizard = PRESET_CLASSES.find((c) => c.id === "wizard")!;
    const ranger = PRESET_CLASSES.find((c) => c.id === "ranger")!;
    expect(cleric.pool_unlocks).toContainEqual({ level: 3, pool: "spell_slots_l2", amount: 2 });
    expect(cleric.pool_unlocks).toContainEqual({ level: 5, pool: "spell_slots_l3", amount: 2 });
    expect(wizard.pool_unlocks).toContainEqual({ level: 3, pool: "spell_slots_l2", amount: 2 });
    expect(ranger.pool_unlocks).toContainEqual({ level: 5, pool: "spell_slots_l2", amount: 2 });
    // Martials never unlock spell tiers.
    expect(PRESET_CLASSES.find((c) => c.id === "fighter")!.pool_unlocks ?? []).toEqual([]);
  });

  it("offensive spells draw slots by tier; cantrips stay free", () => {
    const tierOf = (id: string) => findPresetAction(id)?.slot_cost?.pool;
    expect(tierOf("act_magic_missile")).toBe("spell_slots_l1");
    expect(tierOf("act_burning_hands")).toBe("spell_slots_l1");
    expect(tierOf("act_shatter")).toBe("spell_slots_l2");
    expect(tierOf("act_scorching_ray")).toBe("spell_slots_l2");
    expect(tierOf("act_fireball")).toBe("spell_slots_l3");
    expect(tierOf("act_cone_of_cold")).toBe("spell_slots_l3");
    expect(tierOf("act_meteor_swarm")).toBe("spell_slots_l3");
    // Cantrips are at-will.
    for (const cantrip of ["act_fire_bolt", "act_sacred_flame", "act_eldritch_blast", "act_ray_of_frost", "act_vicious_mockery"]) {
      expect(findPresetAction(cantrip)?.slot_cost, cantrip).toBeUndefined();
    }
  });

  it("cleric starts with healing options", () => {
    const cleric = PRESET_CLASSES.find((c) => c.id === "cleric")!;
    expect(cleric.starting_abilities).toContain("act_cure_wounds");
    expect(cleric.starting_abilities).toContain("act_healing_word");
  });
});

describe("Class templates", () => {
  it("covers thirty-six classes", () => {
    expect(PRESET_CLASSES.map((c) => c.id)).toEqual([
      "fighter", "barbarian", "rogue", "ranger", "cleric", "wizard",
      "paladin", "monk", "sorcerer", "warlock", "bard", "druid",
      "warlord", "swashbuckler", "runecarver", "necromancer", "shaman",
      "psion", "alchemist", "tinkerer", "reaver", "brawler", "wildspeaker",
      "shadowblade", "stormcaller", "witch", "summoner", "gunslinger",
      "dragoon", "blackguard", "banisher", "jester", "spellblade",
      "chirurgeon", "elementalist", "cavalier",
    ]);
  });

  it("hit dice span d6 to d12", () => {
    const dice = PRESET_CLASSES.map((c) => c.hit_die).sort((a, b) => a - b);
    expect(dice[0]).toBe(6);
    expect(dice[dice.length - 1]).toBe(12);
  });

  it("features are level-gated sensibly", () => {
    for (const c of PRESET_CLASSES) {
      for (const f of c.features_by_level) {
        expect(f.level, `${c.name}: ${f.name}`).toBeGreaterThanOrEqual(1);
        expect(f.level, `${c.name}: ${f.name}`).toBeLessThanOrEqual(20);
        expect(f.description.length, `${c.name}: ${f.name}`).toBeGreaterThan(10);
      }
    }
  });

  it("class actions registry is non-empty and referenced", () => {
    expect(CLASS_ACTIONS.length).toBeGreaterThanOrEqual(5);
    for (const def of CLASS_ACTIONS) {
      expect(findPresetAction(def.id)).toBeDefined();
    }
  });

  it("dual-classing unions abilities, halves the second hit die, and stacks shared pools", () => {
    const fighter = PRESET_CLASSES.find((c) => c.id === "fighter")!;
    const wizard = PRESET_CLASSES.find((c) => c.id === "wizard")!;
    const fresh: import("../types").CharacterProfile = {
      id: crypto.randomUUID(),
      system_id: "universal",
      identity: { name: "Test", level_or_rank: 1 },
      attributes: {},
      resource_pools: { hp: { current: 12, maximum: 12, temporary: 0, reset_condition: "long_rest" } },
      inventory: [],
      abilities: [],
    };
    const dual = mergeSecondaryClass(applyClassTemplate(fresh, fighter), wizard);
    // Abilities unioned.
    expect(dual.abilities).toContain("act_longsword");
    expect(dual.abilities).toContain("act_fire_bolt");
    // Half of d6 = +3 HP over the fighter's 12.
    expect(dual.resource_pools.hp?.maximum).toBe(15);
    // Wizard-only pool arrives at half max (2 -> 1); no duplicates.
    expect(dual.resource_pools.spell_slots_l1?.maximum).toBe(1);
    expect(dual.identity.archetype_secondary).toBe("Wizard");
  });

  it("dual-classing stacks shared pools from both classes", () => {
    const cleric = PRESET_CLASSES.find((c) => c.id === "cleric")!;
    const bard = PRESET_CLASSES.find((c) => c.id === "bard")!;
    const fresh: import("../types").CharacterProfile = {
      id: crypto.randomUUID(),
      system_id: "universal",
      identity: { name: "Test", level_or_rank: 1 },
      attributes: {},
      resource_pools: { hp: { current: 10, maximum: 10, temporary: 0, reset_condition: "long_rest" } },
      inventory: [],
      abilities: [],
    };
    // Cleric primary grants spell_slots_l1 x2; bard adds ceil(2/2)=1 more.
    const dual = mergeSecondaryClass(applyClassTemplate(fresh, cleric), bard);
    expect(dual.resource_pools.spell_slots_l1?.maximum).toBe(3);
    expect(dual.resource_pools.spell_slots_l1?.current).toBe(3);
  });

  it("dual-classing never mutates the input profile (purity)", () => {
    const fighter = PRESET_CLASSES.find((c) => c.id === "fighter")!;
    const wizard = PRESET_CLASSES.find((c) => c.id === "wizard")!;
    const fresh: import("../types").CharacterProfile = {
      id: crypto.randomUUID(),
      system_id: "universal",
      identity: { name: "Test", level_or_rank: 1 },
      attributes: {},
      resource_pools: { hp: { current: 12, maximum: 12, temporary: 0, reset_condition: "long_rest" } },
      inventory: [],
      abilities: [],
    };
    const applied = applyClassTemplate(fresh, fighter);
    const hpBefore = { ...applied.resource_pools.hp! };
    mergeSecondaryClass(applied, wizard);
    expect(applied.resource_pools.hp).toEqual(hpBefore);
    expect(fresh.abilities).toEqual([]);
  });

  it("QA audit: no class grants a slot-costed ability it cannot cast at level 1", () => {
    for (const c of PRESET_CLASSES) {
      const pools = new Set(c.starting_pools.map((p) => p.name));
      for (const abilityId of c.starting_abilities) {
        const def = findPresetAction(abilityId);
        expect(def, `${c.name} grants unknown action ${abilityId}`).toBeDefined();
        const cost = def?.slot_cost;
        if (!cost) continue;
        const pool = c.starting_pools.find((p) => p.name === cost.pool);
        // Pool must exist from level 1 with enough charges to cast at least once.
        expect(
          pool && pool.maximum >= cost.amount,
          `${c.name}: ability ${abilityId} needs ${cost.pool} but has none at level 1`,
        ).toBe(true);
        void pools;
      }
    }
  });

  it("QA audit: every class has identity fields, gear, and sane features", () => {
    for (const c of PRESET_CLASSES) {
      expect(c.name.length, c.id).toBeGreaterThan(2);
      expect(Object.keys(c.suggested_attributes), c.id).toContain("CON");
      expect(c.starting_items.length, `${c.name} gear`).toBeGreaterThanOrEqual(2);
      const levels = c.features_by_level.map((f) => f.level);
      expect(Math.min(...levels), `${c.name} first feature`).toBe(1);
    }
  });
});

describe("Equipment catalog", () => {
  it("has a broad library across categories", () => {
    expect(EQUIPMENT_CATALOG.length).toBeGreaterThanOrEqual(60);
    const cats = new Set(EQUIPMENT_CATALOG.map((e) => e.category));
    for (const expected of ["weapon", "armor", "gear", "tool", "potion", "magic"] as const) {
      expect(cats.has(expected), `category ${expected}`).toBe(true);
    }
  });

  it("item names are unique", () => {
    const names = EQUIPMENT_CATALOG.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("weights are non-negative", () => {
    for (const e of EQUIPMENT_CATALOG) {
      expect(e.weight, e.name).toBeGreaterThanOrEqual(0);
    }
  });

  it("QA audit: every class starting item exists in the equipment catalog", () => {
    const catalog = new Set(EQUIPMENT_CATALOG.map((e) => e.name));
    const missing: string[] = [];
    for (const c of PRESET_CLASSES) {
      for (const item of c.starting_items) {
        if (!catalog.has(item.name)) missing.push(`${c.name}: ${item.name}`);
      }
    }
    expect(missing, "class gear missing from EQUIPMENT_CATALOG").toEqual([]);
  });
});
