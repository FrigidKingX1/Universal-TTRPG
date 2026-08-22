import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Tauri backend module before importing store
vi.mock("../backend", () => ({
  backend: {
    ping: vi.fn().mockResolvedValue(undefined),
    seedDefaults: vi.fn().mockResolvedValue(undefined),
    listCharacters: vi.fn().mockResolvedValue([]),
    listActions: vi.fn().mockResolvedValue([]),
    listStatBlocks: vi.fn().mockResolvedValue([]),
    listScenes: vi.fn().mockResolvedValue([]),
    activeScene: vi.fn().mockResolvedValue(null),
    listLogs: vi.fn().mockResolvedValue([]),
    saveCharacter: vi.fn().mockResolvedValue(undefined),
    deleteCharacter: vi.fn().mockResolvedValue(undefined),
    saveStatBlock: vi.fn().mockResolvedValue(undefined),
    deleteStatBlock: vi.fn().mockResolvedValue(undefined),
    saveAction: vi.fn().mockResolvedValue(undefined),
    deleteAction: vi.fn().mockResolvedValue(undefined),
    createScene: vi.fn().mockResolvedValue({ id: "s1", scene_number: 1, title: "Test", chaos_factor: 5, is_active: true }),
    setActiveScene: vi.fn().mockResolvedValue(undefined),
    deleteScene: vi.fn().mockResolvedValue(undefined),
    updateSceneSummary: vi.fn().mockResolvedValue(undefined),
    updateSceneChaosFactor: vi.fn().mockResolvedValue(undefined),
    appendLog: vi.fn().mockResolvedValue(undefined),
    rollDice: vi.fn().mockResolvedValue({ total: 10, detail: "[1d20] = 10" }),
    fateCheck: vi.fn().mockResolvedValue({ roll: 50, target: 50, chaos_factor: 5, odds: "fifty_fifty", outcome: "Yes" as const, exceptional: false, random_event: false, interpretation: "Yes" }),
    randomEvent: vi.fn().mockResolvedValue(undefined),
    combatAttack: vi.fn().mockResolvedValue({ attack_result: "Hit", attack_roll: 15, target_ac: 12, damage_dealt: 5, target_hp_remaining: 5, target_status: "wounded" }),
    initiative: vi.fn().mockResolvedValue([]),
    ollamaModels: vi.fn().mockResolvedValue([]),
    getOllamaModel: vi.fn().mockResolvedValue("llama3.2"),
    setOllamaModel: vi.fn().mockResolvedValue(undefined),
    ingestMemory: vi.fn().mockResolvedValue(undefined),
    dmResolve: vi.fn().mockResolvedValue({ narrative: "test", mechanical_events: [], fate_interpretation: "Yes", fate_roll: 50, fate_target: 50, chaos_factor: 5, intent: { Narration: { text: "test" } }, source: "stub" }),
    // SQLite persistence mocks
    saveLoot: vi.fn().mockImplementation((_sid: string, name: string, qty: number, src: string) =>
      Promise.resolve({ id: "loot-" + Math.random().toString(36).slice(2), scene_id: "s1", name, quantity: qty, source_entity: src, assigned_to: null, timestamp: new Date().toISOString() })
    ),
    assignLootToCharacter: vi.fn().mockResolvedValue(undefined),
    listLoot: vi.fn().mockResolvedValue([]),
    clearLootInScene: vi.fn().mockResolvedValue(undefined),
    rollMonsterLoot: vi.fn().mockResolvedValue([]),
    saveNpcNote: vi.fn().mockImplementation((_sid: string, name: string, rel: string, note: string) =>
      Promise.resolve({ id: "note-" + Math.random().toString(36).slice(2), scene_id: "s1", npc_name: name, relation: rel, note, timestamp: new Date().toISOString() })
    ),
    listNpcNotes: vi.fn().mockResolvedValue([]),
    deleteNpcNote: vi.fn().mockResolvedValue(true),
    saveCombatState: vi.fn().mockResolvedValue(undefined),
    loadCombatState: vi.fn().mockResolvedValue(null),

    // Plot Threads
    saveThread: vi.fn().mockImplementation((_desc: string, status: string, _sid: string) =>
      Promise.resolve({ id: "thread-" + Math.random().toString(36).slice(2), description: _desc, status, opened_scene_id: _sid, resolved_scene_id: null, created_at: new Date().toISOString() })
    ),
    updateThreadStatus: vi.fn().mockResolvedValue(undefined),
    listThreads: vi.fn().mockResolvedValue([]),
    deleteThread: vi.fn().mockResolvedValue(true),

    // NPC Characters
    saveNpcCharacter: vi.fn().mockImplementation((name: string, disposition: string) =>
      Promise.resolve({ id: "npc-" + Math.random().toString(36).slice(2), name, disposition, alive: true, location: null, knows_json: "[]", notes: null, last_seen_scene_id: null, created_at: new Date().toISOString() })
    ),
    updateNpcCharacter: vi.fn().mockResolvedValue(undefined),
    listNpcCharacters: vi.fn().mockResolvedValue([]),
    deleteNpcCharacter: vi.fn().mockResolvedValue(true),
    getOllamaNumPredict: vi.fn().mockResolvedValue(512),
    setOllamaNumPredict: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock @tauri-apps/api/event
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

// Mock @tauri-apps/plugin-opener
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
}));

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; }),
  };
})();
Object.defineProperty(globalThis, "localStorage", { value: localStorageMock });

import { useStore, newCharacter, newStatBlock } from "../store";
import { PRESET_CLASSES, findClassByArchetype, applyClassTemplate } from "../presets/classes";
import { findPresetAction } from "../presets/actions";

describe("Store pure logic", () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
    // Reset store to initial state
    useStore.setState({
      loading: false,
      error: null,
      toast: null,
      characters: [],
      actions: [],
      statBlocks: [],
      scenes: [],
      activeSceneId: null,
      logs: [],
      lastRoll: null,
      rollHistory: [],
      lastFate: null,
      fateHistory: [],
      lastEvent: null,
      eventHistory: [],
      lastCombat: null,
      combatHistory: [],
      lastDm: null,
      dmHistory: [],
      initiativeOrder: [],
      combatantStates: {},
      combatantConditions: {},
      currentRound: 0,
      currentTurnIndex: 0,
      deathSaves: {},
      lastHpChange: null,
      ollama: { reachable: false, models: [], currentModel: "llama3.2", numPredict: 512 },
      loot: [],
      npcNotes: [],
    });
  });

  describe("nextTurn", () => {
    it("does nothing when no initiative order", () => {
      useStore.getState().nextTurn();
      const s = useStore.getState();
      expect(s.currentTurnIndex).toBe(0);
      expect(s.currentRound).toBe(0);
    });

    it("advances to next combatant", () => {
      useStore.setState({
        initiativeOrder: [
          { combatant_id: "a", name: "Alice", roll: 18, modifier: 4 },
          { combatant_id: "b", name: "Bob", roll: 12, modifier: 2 },
        ],
        currentRound: 1,
        currentTurnIndex: 0,
      });
      useStore.getState().nextTurn();
      expect(useStore.getState().currentTurnIndex).toBe(1);
      expect(useStore.getState().currentRound).toBe(1);
    });

    it("wraps around and increments round", () => {
      useStore.setState({
        initiativeOrder: [
          { combatant_id: "a", name: "Alice", roll: 18, modifier: 4 },
          { combatant_id: "b", name: "Bob", roll: 12, modifier: 2 },
        ],
        currentRound: 1,
        currentTurnIndex: 1,
      });
      useStore.getState().nextTurn();
      expect(useStore.getState().currentTurnIndex).toBe(0);
      expect(useStore.getState().currentRound).toBe(2);
    });
  });

  describe("endCombat", () => {
    it("clears all combat state", () => {
      useStore.setState({
        initiativeOrder: [{ combatant_id: "a", name: "Alice", roll: 18, modifier: 4 }],
        currentRound: 3,
        currentTurnIndex: 1,
        combatantStates: { a: { id: "a", name: "Alice", hit_points: 5 } },
        combatantConditions: { a: ["Poisoned"] },
        lastCombat: { attack_result: "Hit", damage_dealt: 5, target_hp_remaining: 5, target_status: "wounded" },
      });
      useStore.getState().endCombat();
      const s = useStore.getState();
      expect(s.initiativeOrder).toEqual([]);
      expect(s.currentRound).toBe(0);
      expect(s.currentTurnIndex).toBe(0);
      expect(s.combatantStates).toEqual({});
      expect(s.combatantConditions).toEqual({});
      expect(s.lastCombat).toBeNull();
    });
  });

  describe("removeCombatant", () => {
    it("removes from all combat maps", () => {
      useStore.setState({
        initiativeOrder: [
          { combatant_id: "a", name: "Alice", roll: 18, modifier: 4 },
          { combatant_id: "b", name: "Bob", roll: 12, modifier: 2 },
        ],
        combatantStates: {
          a: { id: "a", name: "Alice", hit_points: 10 },
          b: { id: "b", name: "Bob", hit_points: 8 },
        },
        combatantConditions: { a: ["Poisoned"], b: ["Stunned"] },
      });
      useStore.getState().removeCombatant("a");
      const s = useStore.getState();
      expect(s.initiativeOrder).toHaveLength(1);
      expect(s.initiativeOrder[0].combatant_id).toBe("b");
      expect(s.combatantStates.a).toBeUndefined();
      expect(s.combatantStates.b).toBeDefined();
      expect(s.combatantConditions.a).toBeUndefined();
      expect(s.combatantConditions.b).toEqual(["Stunned"]);
    });
  });

  describe("toggleCondition", () => {
    it("adds condition when not present", () => {
      useStore.setState({ combatantConditions: {} });
      useStore.getState().toggleCondition("a", "Poisoned");
      expect(useStore.getState().combatantConditions.a).toEqual(["Poisoned"]);
    });

    it("removes condition when present", () => {
      useStore.setState({ combatantConditions: { a: ["Poisoned", "Stunned"] } });
      useStore.getState().toggleCondition("a", "Poisoned");
      expect(useStore.getState().combatantConditions.a).toEqual(["Stunned"]);
    });

    it("toggles multiple conditions independently", () => {
      useStore.setState({ combatantConditions: {} });
      useStore.getState().toggleCondition("a", "Poisoned");
      useStore.getState().toggleCondition("a", "Stunned");
      expect(useStore.getState().combatantConditions.a).toEqual(["Poisoned", "Stunned"]);
      useStore.getState().toggleCondition("a", "Poisoned");
      expect(useStore.getState().combatantConditions.a).toEqual(["Stunned"]);
    });
  });

  describe("showToast", () => {
    it("sets toast message", () => {
      useStore.getState().showToast("hello");
      expect(useStore.getState().toast).toBe("hello");
    });
  });

  describe("recordRoll", () => {
    it("adds to history and sets lastRoll", () => {
      useStore.getState().recordRoll({ expression: "1d20", total: 15, detail: "[1d20] = 15" });
      const s = useStore.getState();
      expect(s.lastRoll?.total).toBe(15);
      expect(s.rollHistory).toHaveLength(1);
    });
  });

  describe("recordFate", () => {
    it("adds to history and sets lastFate", () => {
      useStore.getState().recordFate({ roll: 50, target: 50, chaos_factor: 5, odds: "fifty_fifty", outcome: "Yes", exceptional: false, random_event: false, interpretation: "Yes" });
      const s = useStore.getState();
      expect(s.lastFate?.interpretation).toBe("Yes");
      expect(s.fateHistory).toHaveLength(1);
    });
  });

  describe("cloneCharacter", () => {
    it("creates a copy with new id and (copy) suffix", async () => {
      const c = newCharacter("Alice");
      useStore.setState({ characters: [c] });
      // Mock listCharacters to return the cloned character on second call
      const { backend } = await import("../backend");
      vi.mocked(backend.listCharacters).mockResolvedValueOnce([
        c,
        { ...c, id: "clone-id", identity: { ...c.identity, name: "Alice (copy)" } },
      ]);
      await useStore.getState().cloneCharacter(c.id);
      const chars = useStore.getState().characters;
      expect(chars).toHaveLength(2);
      expect(chars.some((ch) => ch.identity.name === "Alice (copy)")).toBe(true);
    });
  });

  describe("Loot", () => {
    it("adds loot entry", async () => {
      useStore.setState({ activeSceneId: "s1" });
      await useStore.getState().addLoot("Gold Coins", 100, "");
      expect(useStore.getState().loot).toHaveLength(1);
      expect(useStore.getState().loot[0].name).toBe("Gold Coins");
      expect(useStore.getState().loot[0].quantity).toBe(100);
    });

    it("assigns loot to character", async () => {
      useStore.setState({ activeSceneId: "s1", loot: [{ id: "l1", name: "Magic Sword", quantity: 1, assignedTo: null, sourceEntity: "", timestamp: "" }] });
      await useStore.getState().assignLoot("l1", "char_1");
      expect(useStore.getState().loot[0].assignedTo).toBe("char_1");
    });

    it("clears all loot", async () => {
      useStore.setState({ activeSceneId: "s1", loot: [{ id: "l1", name: "Potion", quantity: 3, assignedTo: null, sourceEntity: "", timestamp: "" }] });
      await useStore.getState().clearLoot();
      expect(useStore.getState().loot).toEqual([]);
    });
  });

  describe("NPC Notes", () => {
    it("adds and retrieves notes", async () => {
      useStore.setState({ activeSceneId: "s1" });
      await useStore.getState().addNpcNote("Bartender", "Ally", "Knows the underground");
      expect(useStore.getState().npcNotes).toHaveLength(1);
      expect(useStore.getState().npcNotes[0].npcName).toBe("Bartender");
      expect(useStore.getState().npcNotes[0].relation).toBe("Ally");
    });

    it("deletes notes by id", async () => {
      useStore.setState({ activeSceneId: "s1", npcNotes: [{ id: "n1", npcName: "Guard", relation: "Enemy", note: "Watches the gate", timestamp: "" }] });
      await useStore.getState().deleteNpcNote("n1");
      expect(useStore.getState().npcNotes).toHaveLength(0);
    });
  });

  describe("Plot Threads", () => {
    it("adds a thread", async () => {
      useStore.setState({ activeSceneId: "s1" });
      await useStore.getState().addThread("Who is the assassin?");
      expect(useStore.getState().plotThreads).toHaveLength(1);
      expect(useStore.getState().plotThreads[0].description).toBe("Who is the assassin?");
      expect(useStore.getState().plotThreads[0].status).toBe("open");
    });

    it("resolves a thread", async () => {
      useStore.setState({ activeSceneId: "s1", plotThreads: [{ id: "t1", description: "Find the sword", status: "open", opened_scene_id: "s1", created_at: "" }] });
      await useStore.getState().resolveThread("t1");
      expect(useStore.getState().plotThreads[0].status).toBe("resolved");
    });

    it("abandons a thread", async () => {
      useStore.setState({ activeSceneId: "s1", plotThreads: [{ id: "t1", description: "Rescue the captive", status: "open", opened_scene_id: "s1", created_at: "" }] });
      await useStore.getState().abandonThread("t1");
      expect(useStore.getState().plotThreads[0].status).toBe("abandoned");
    });

    it("deletes a thread", async () => {
      useStore.setState({ activeSceneId: "s1", plotThreads: [{ id: "t1", description: "Old thread", status: "open", opened_scene_id: "s1", created_at: "" }] });
      await useStore.getState().deleteThread("t1");
      expect(useStore.getState().plotThreads).toHaveLength(0);
    });
  });

  describe("NPC Characters", () => {
    it("adds an NPC character", async () => {
      await useStore.getState().addNpcCharacter("Bartender", "friendly");
      expect(useStore.getState().npcCharacters).toHaveLength(1);
      expect(useStore.getState().npcCharacters[0].name).toBe("Bartender");
      expect(useStore.getState().npcCharacters[0].disposition).toBe("friendly");
      expect(useStore.getState().npcCharacters[0].alive).toBe(true);
    });

    it("updates disposition", async () => {
      useStore.setState({ npcCharacters: [{ id: "n1", name: "Guard", disposition: "neutral", alive: true, knows: [], created_at: "" }] });
      await useStore.getState().updateNpcDisposition("n1", "hostile");
      expect(useStore.getState().npcCharacters[0].disposition).toBe("hostile");
    });

    it("marks NPC dead", async () => {
      useStore.setState({ npcCharacters: [{ id: "n1", name: "Guard", disposition: "neutral", alive: true, knows: [], created_at: "" }] });
      await useStore.getState().markNpcDead("n1");
      expect(useStore.getState().npcCharacters[0].alive).toBe(false);
    });

    it("adds knowledge to NPC", async () => {
      useStore.setState({ npcCharacters: [{ id: "n1", name: "Bartender", disposition: "friendly", alive: true, knows: [{ text: "secret tunnel" }], created_at: "" }] });
      await useStore.getState().addNpcKnowledge("n1", "guard rotation");
      expect(useStore.getState().npcCharacters[0].knows).toHaveLength(2);
      expect(useStore.getState().npcCharacters[0].knows[0].text).toBe("secret tunnel");
      expect(useStore.getState().npcCharacters[0].knows[1].text).toBe("guard rotation");
      expect(useStore.getState().npcCharacters[0].knows[1].scene_id).toBeNull();
      expect(useStore.getState().npcCharacters[0].knows[1].timestamp).toBeTruthy();
    });

    it("removes knowledge from NPC", async () => {
      useStore.setState({ npcCharacters: [{ id: "n1", name: "Bartender", disposition: "friendly", alive: true, knows: [{ text: "secret tunnel" }, { text: "guard rotation" }], created_at: "" }] });
      await useStore.getState().removeNpcKnowledge("n1", 0);
      expect(useStore.getState().npcCharacters[0].knows).toHaveLength(1);
      expect(useStore.getState().npcCharacters[0].knows[0].text).toBe("guard rotation");
    });

    it("deletes NPC character", async () => {
      useStore.setState({ npcCharacters: [{ id: "n1", name: "Guard", disposition: "neutral", alive: true, knows: [], created_at: "" }] });
      await useStore.getState().deleteNpcCharacter("n1");
      expect(useStore.getState().npcCharacters).toHaveLength(0);
    });
  });

  describe("numPredict", () => {
    it("clamps numPredict to valid range", () => {
      useStore.getState().setNumPredict(100);
      expect(useStore.getState().ollama.numPredict).toBe(100);
      useStore.getState().setNumPredict(10);
      expect(useStore.getState().ollama.numPredict).toBe(64);
      useStore.getState().setNumPredict(9999);
      expect(useStore.getState().ollama.numPredict).toBe(2048);
    });
  });
});

describe("Factory functions", () => {
  it("newCharacter creates valid profile with 6 attributes", () => {
    const c = newCharacter("Test Hero");
    expect(c.identity.name).toBe("Test Hero");
    expect(c.identity.level_or_rank).toBe(1);
    expect(Object.keys(c.attributes)).toEqual(["STR", "DEX", "CON", "INT", "WIS", "CHA"]);
    expect(c.resource_pools.hp?.current).toBe(10);
    expect(c.resource_pools.hp?.maximum).toBe(10);
    expect(c.id).toBeTruthy();
  });

  it("newStatBlock creates valid block with defaults", () => {
    const b = newStatBlock("Goblin");
    expect(b.name).toBe("Goblin");
    expect(b.challenge_rating).toBe(1);
    expect(b.armor_class).toBe(12);
    expect(b.hit_points.current).toBe(10);
    expect(b.hit_points.maximum).toBe(10);
    expect(b.id).toBeTruthy();
  });

  it("newCharacter attribute modifiers are correct", () => {
    const c = newCharacter("Hero");
    expect(c.attributes.STR.derived_modifier).toBe(0); // 10 -> +0
    expect(c.attributes.STR.base_value).toBe(10);
  });
});

describe("Class templates", () => {
  it("findClassByArchetype matches case-insensitively", () => {
    expect(findClassByArchetype("fighter")?.id).toBe("fighter");
    expect(findClassByArchetype("WIZARD")?.hit_die).toBe(6);
    expect(findClassByArchetype("Bard")).toBeUndefined();
    expect(findClassByArchetype(undefined)).toBeUndefined();
  });

  it("applyClassTemplate sets archetype, attributes, and level-1 HP", () => {
    const base = newCharacter("Conan");
    const fighter = PRESET_CLASSES.find((c) => c.id === "fighter")!;
    const applied = applyClassTemplate(base, fighter);
    expect(applied.identity.archetype).toBe("Fighter");
    // STR 16 -> +3, CON 14 -> +2
    expect(applied.attributes.STR.base_value).toBe(16);
    expect(applied.attributes.STR.derived_modifier).toBe(3);
    // Level-1 HP = hit die max (10) + CON mod (+2)
    expect(applied.resource_pools.hp?.maximum).toBe(12);
    expect(applied.resource_pools.hp?.current).toBe(12);
  });

  it("applyClassTemplate grants pools, abilities, and starting gear", () => {
    const base = newCharacter("Gimble");
    const wizard = PRESET_CLASSES.find((c) => c.id === "wizard")!;
    const applied = applyClassTemplate(base, wizard);
    expect(applied.resource_pools.spell_slots_l1?.current).toBe(2);
    expect(applied.resource_pools.spell_slots_l1?.reset_condition).toBe("long_rest");
    expect(applied.abilities).toContain("act_fire_bolt");
    expect(applied.inventory.map((i) => i.name)).toContain("Spellbook");
    expect(applied.inventory[0].state).toBe("equipped");
  });

  it("applyClassTemplate does not duplicate existing abilities", () => {
    const base = newCharacter("Dupe");
    base.abilities = ["act_longsword"];
    const fighter = PRESET_CLASSES.find((c) => c.id === "fighter")!;
    const applied = applyClassTemplate(base, fighter);
    expect(applied.abilities.filter((a) => a === "act_longsword")).toHaveLength(1);
  });

  it("createCharacter applies the selected class template end-to-end", async () => {
    const { backend } = await import("../backend");
    const localActions: { id: string }[] = [];
    const savedChars: unknown[] = [];
    const mocks = {
      saveAction: vi.mocked(backend.saveAction),
      listActions: vi.mocked(backend.listActions),
      saveCharacter: vi.mocked(backend.saveCharacter),
      listCharacters: vi.mocked(backend.listCharacters),
    };
    mocks.saveAction.mockImplementation(async (a) => { localActions.push(a); return a; });
    mocks.listActions.mockImplementation(async () => localActions as never);
    mocks.saveCharacter.mockImplementation(async (c) => { savedChars.push(c); return c; });
    mocks.listCharacters.mockImplementation(async () => savedChars as never);
    try {
      useStore.setState({ actions: [] });
      await useStore.getState().createCharacter("Test Fighter", "fighter");
      const created = savedChars[savedChars.length - 1] as { identity: { archetype?: string }; resource_pools: Record<string, { maximum?: number }> };
      expect(created.identity.archetype).toBe("Fighter");
      expect(created.resource_pools.hp?.maximum).toBe(12);
      // Class-granted actions were installed into the vault.
      const actionIds = localActions.map((a) => a.id);
      expect(actionIds).toContain("act_longsword");
      expect(actionIds).toContain("act_longbow");
    } finally {
      mocks.saveAction.mockImplementation((a) => Promise.resolve(a));
      mocks.listActions.mockImplementation(() => Promise.resolve([]));
      mocks.saveCharacter.mockImplementation((c) => Promise.resolve(c));
      mocks.listCharacters.mockImplementation(() => Promise.resolve([]));
    }
  });
});

describe("Spell slot consumption", () => {
  const makeCleric = () =>
    applyClassTemplate(newCharacter("Mira"), PRESET_CLASSES.find((c) => c.id === "cleric")!);

  const setUp = (cleric: ReturnType<typeof makeCleric>) => {
    const cure = findPresetAction("act_cure_wounds")!;
    const goblin = newStatBlock("Goblin Snarl");
    goblin.armor_class = 10;
    useStore.setState({ characters: [cleric], actions: [cure], statBlocks: [goblin] });
    return { cure, goblin };
  };

  it("casting Cure Wounds expends one level-1 spell slot", async () => {
    const { backend } = await import("../backend");
    const saved: { resource_pools?: Record<string, { current?: number }> }[] = [];
    vi.mocked(backend.saveCharacter).mockImplementation(async (c) => {
      saved.push(c as never);
      return c;
    });
    const cleric = makeCleric();
    expect(cleric.resource_pools.spell_slots_l1?.current).toBe(2);
    const { goblin } = setUp(cleric);

    await useStore.getState().runAttack(cleric, goblin, "act_cure_wounds");

    expect(vi.mocked(backend.combatAttack)).toHaveBeenCalledTimes(1);
    const last = saved[saved.length - 1];
    expect(last?.resource_pools?.spell_slots_l1?.current).toBe(1);
  });

  it("casting with an empty pool is blocked before the attack fires", async () => {
    const { backend } = await import("../backend");
    vi.mocked(backend.combatAttack).mockClear();
    const cleric = makeCleric();
    cleric.resource_pools.spell_slots_l1!.current = 0;
    setUp(cleric);

    await useStore.getState().runAttack(cleric, cleric, "act_cure_wounds");

    expect(vi.mocked(backend.combatAttack)).not.toHaveBeenCalled();
  });

  it("monsters and cantrips ignore slot costs", async () => {
    const { backend } = await import("../backend");
    vi.mocked(backend.combatAttack).mockClear();
    const { goblin } = setUp(makeCleric());
    // A monster casting a slot-costed action has no profile pool to spend.
    const lurker = newStatBlock("Healing Lurker");
    lurker.actions = ["act_cure_wounds"];
    useStore.setState({ statBlocks: [goblin, lurker] });

    await useStore.getState().runAttack(lurker, goblin, "act_cure_wounds");
    expect(vi.mocked(backend.combatAttack)).toHaveBeenCalledTimes(1);
  });
});
