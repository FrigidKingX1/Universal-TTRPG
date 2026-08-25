import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

import { useStore, newCharacter, newStatBlock, rollDiceLocal } from "../store";
import { PRESET_CLASSES, findClassByArchetype, applyClassTemplate, growPoolsOnLevelUp } from "../presets/classes";
import { findPresetAction } from "../presets/actions";

/** Force the next local d20 face(s): getRandomValues sees u32 = value. */
function stubNextU32(value: number) {
  return vi.spyOn(crypto, "getRandomValues").mockImplementation((buf) => {
    if (!buf) return buf;
    new Uint32Array(buf.buffer as ArrayBuffer)[0] = value;
    return buf;
  });
}


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

    it("skips defeated combatants (0 HP)", () => {
      useStore.setState({
        initiativeOrder: [
          { combatant_id: "a", name: "Alice", roll: 18, modifier: 4 },
          { combatant_id: "b", name: "Bob", roll: 12, modifier: 2 },
          { combatant_id: "c", name: "Cultist", roll: 10, modifier: 0 },
        ],
        combatantStates: {
          b: { id: "b", name: "Bob", hit_points: 0, status: "DEFEATED" },
        },
        currentRound: 1,
        currentTurnIndex: 0,
      });
      useStore.getState().nextTurn();
      // Bob is down â€” turn passes to the cultist, same round.
      expect(useStore.getState().currentTurnIndex).toBe(2);
      expect(useStore.getState().currentRound).toBe(1);
    });

    it("skips dead-by-death-save combatants too", () => {
      useStore.setState({
        initiativeOrder: [
          { combatant_id: "a", name: "Alice", roll: 18, modifier: 4 },
          { combatant_id: "b", name: "Bob", roll: 12, modifier: 2 },
        ],
        combatantStates: {
          b: { id: "b", name: "Bob", hit_points: -1, status: "dead" },
        },
        currentRound: 1,
        currentTurnIndex: 0,
      });
      useStore.getState().nextTurn();
      expect(useStore.getState().currentTurnIndex).toBe(0);
      // Wrapped all the way around â†’ new round.
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

    it("keeps the turn pointer on the same combatant when removing earlier entries", () => {
      // Order [a, b, c], turn is on b (idx 1). Removing a shifts b to 0 â€”
      // without the clamp, b would be skipped and c would act in b's place.
      useStore.setState({
        initiativeOrder: [
          { combatant_id: "a", name: "Alice", roll: 18, modifier: 4 },
          { combatant_id: "b", name: "Bob", roll: 12, modifier: 2 },
          { combatant_id: "c", name: "Cultist", roll: 10, modifier: 0 },
        ],
        currentTurnIndex: 1,
      });
      useStore.getState().removeCombatant("a");
      const s = useStore.getState();
      expect(s.initiativeOrder.map((e) => e.combatant_id)).toEqual(["b", "c"]);
      expect(s.currentTurnIndex).toBe(0); // still Bob
    });

    it("clamps the pointer when removing the last entry at the current index", () => {
      useStore.setState({
        initiativeOrder: [
          { combatant_id: "a", name: "Alice", roll: 18, modifier: 4 },
          { combatant_id: "b", name: "Bob", roll: 12, modifier: 2 },
        ],
        currentTurnIndex: 1, // pointing at b, who is removed
      });
      useStore.getState().removeCombatant("b");
      const s = useStore.getState();
      expect(s.currentTurnIndex).toBe(0);
      expect(s.initiativeOrder[0].combatant_id).toBe("a"); // in bounds
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
    expect(findClassByArchetype("paladin")?.id).toBe("paladin");
    expect(findClassByArchetype("Archmage")).toBeUndefined();
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

  it("casting with an empty local vault falls back to bundled presets", async () => {
    const { backend } = await import("../backend");
    const saved: { resource_pools?: Record<string, { current?: number }> }[] = [];
    vi.mocked(backend.saveCharacter).mockImplementation(async (c) => {
      saved.push(c as never);
      return c;
    });
    const cleric = makeCleric();
    // Simulate a hosted client whose local vault is empty (server has the
    // seeded copies); runAttack must resolve via findPresetAction fallback.
    useStore.setState({ characters: [cleric], actions: [], statBlocks: [] });
    const goblin = newStatBlock("Fallback Dummy");

    await useStore.getState().runAttack(cleric, goblin, "act_cure_wounds");

    expect(vi.mocked(backend.combatAttack)).toHaveBeenCalledTimes(1);
    const last = saved[saved.length - 1];
    expect(last?.resource_pools?.spell_slots_l1?.current).toBe(1);

    // And an empty pool must STILL be blocked under the fallback.
    cleric.resource_pools.spell_slots_l1!.current = 0;
    vi.mocked(backend.combatAttack).mockClear();
    await useStore.getState().runAttack(cleric, goblin, "act_cure_wounds");
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

describe("Concentration", () => {
  afterEach(() => vi.restoreAllMocks());
  const setUpCaster = () => {
    const spell = findPresetAction("act_spiritual_weapon")!;
    const cure = findPresetAction("act_cure_wounds")!;
    const caster = newCharacter("Chaplain");
    caster.abilities = ["act_spiritual_weapon", "act_cure_wounds"];
    caster.resource_pools.spell_slots_l1 = { current: 1, maximum: 1, temporary: 0, reset_condition: "long_rest" };
    caster.resource_pools.spell_slots_l2 = { current: 1, maximum: 1, temporary: 0, reset_condition: "long_rest" };
    const target = newStatBlock("Training Dummy");
    useStore.setState({
      characters: [caster],
      actions: [spell, cure],
      statBlocks: [target],
      concentration: {},
      combatantConditions: {},
    });
    return { caster, target, spell, cure };
  };

  it("casting a concentration spell marks the caster as Concentrating", async () => {
    const { backend } = await import("../backend");
    vi.mocked(backend.combatAttack).mockClear();
    const { caster, target, spell } = setUpCaster();

    await useStore.getState().runAttack(caster, target, spell.id);

    const state = useStore.getState();
    expect(state.concentration[caster.id]).toBe(spell.name);
    expect(state.combatantConditions[caster.id]).toContain("Concentrating");
  });

  it("a failed CON save on damage breaks concentration", async () => {
    // CON save rolls locally now — force a natural 1 (total 1 < DC 10).
    stubNextU32(0)
    const { backend } = await import("../backend");
    const { caster, target, spell } = setUpCaster();
    // Concentrate first.
    await useStore.getState().runAttack(caster, target, spell.id);
    vi.mocked(backend.combatAttack).mockClear();

    // Damage the concentrating caster â€” DC is max(10, 5/2) = 10; rolled 2.
    await useStore.getState().runAttack(target, caster, "act_cure_wounds");

    const state = useStore.getState();
    expect(state.concentration[caster.id]).toBeUndefined();
    expect(state.combatantConditions[caster.id] ?? []).not.toContain("Concentrating");
  });

  it("a successful CON save holds concentration", async () => {
    // CON save rolls locally now — force a natural 20 (holds vs any DC).
    stubNextU32(19)
    const { backend } = await import("../backend");
    const { caster, target, spell } = setUpCaster();
    await useStore.getState().runAttack(caster, target, spell.id);
    vi.mocked(backend.combatAttack).mockClear();

    await useStore.getState().runAttack(target, caster, "act_cure_wounds");

    const state = useStore.getState();
    expect(state.concentration[caster.id]).toBe(spell.name);
    expect(state.combatantConditions[caster.id]).toContain("Concentrating");
  });

  it("non-concentration spells never mark the caster", async () => {
    const { cure, caster, target } = setUpCaster();

    await useStore.getState().runAttack(caster, target, cure.id);

    const state = useStore.getState();
    expect(Object.keys(state.concentration)).toHaveLength(0);
  });

  it("being defeated ends concentration outright", async () => {
    const { backend } = await import("../backend");
    // (defeat path bypasses the save; this roll mock is harmless)
    const { caster, target, spell } = setUpCaster();
    await useStore.getState().runAttack(caster, target, spell.id);

    // A killing blow: status DEFEATED bypasses the save path entirely.
    vi.mocked(backend.combatAttack).mockResolvedValue({
      attack_result: "HIT", attack_roll: 20, target_ac: 10,
      damage_dealt: 50, heal_amount: 0,
      target_hp_remaining: 0, target_status: "DEFEATED",
    } as never);
    await useStore.getState().runAttack(target, caster, "act_cure_wounds");

    const state = useStore.getState();
    expect(state.concentration[caster.id]).toBeUndefined();
    expect(state.combatantConditions[caster.id] ?? []).not.toContain("Concentrating");
  });

  it("dropConcentration clears the record and condition voluntarily", async () => {
    const { caster, target, spell } = setUpCaster();
    await useStore.getState().runAttack(caster, target, spell.id);
    expect(useStore.getState().concentration[caster.id]).toBeDefined();

    useStore.getState().dropConcentration(caster.id);

    const state = useStore.getState();
    expect(state.concentration[caster.id]).toBeUndefined();
    expect(state.combatantConditions[caster.id] ?? []).not.toContain("Concentrating");
  });
});

describe("Rests, growth & undo", () => {
  const pool = (current: number, maximum: number, reset_condition: "long_rest" | "short_rest" = "long_rest") =>
    ({ current, maximum, temporary: 0, reset_condition });

  const captureSaves = async () => {
    const { backend } = await import("../backend");
    const saved: Array<{ resource_pools?: Record<string, { current?: number; maximum?: number }> }> = [];
    vi.mocked(backend.saveCharacter).mockImplementation(async (c) => {
      saved.push(c as never);
      return c;
    });
    return saved;
  };

  it("longRest heals HP and recharges long-rest pools only", async () => {
    const saved = await captureSaves();
    const cleric = applyClassTemplate(newCharacter("Mira"), PRESET_CLASSES.find((c) => c.id === "cleric")!);
    cleric.resource_pools.hp!.current = 4;
    cleric.resource_pools.spell_slots_l1!.current = 0;
    cleric.resource_pools.second_wind = pool(0, 1, "short_rest");
    useStore.setState({
      characters: [cleric],
      combatantStates: { [cleric.id]: { id: cleric.id, name: "Mira", hit_points: 4, status: undefined } },
    });

    await useStore.getState().longRest();

    const last = saved[saved.length - 1];
    expect(last?.resource_pools?.hp?.current).toBe(10);
    expect(last?.resource_pools?.spell_slots_l1?.current).toBe(2);
    // short-rest pool is untouched by a long rest's recharge pass
    expect(last?.resource_pools?.second_wind?.current).toBe(0);
    expect(useStore.getState().combatantStates[cleric.id]?.hit_points).toBe(10);
  });

  it("shortRest heals half and recharges short-rest pools only", async () => {
    const saved = await captureSaves();
    const fighter = applyClassTemplate(newCharacter("Bruno"), PRESET_CLASSES.find((c) => c.id === "fighter")!);
    fighter.resource_pools.hp!.maximum = 12;
    fighter.resource_pools.hp!.current = 4;
    fighter.resource_pools.second_wind = pool(0, 1, "short_rest");
    fighter.resource_pools.spell_slots_l1 = pool(1, 2, "long_rest");
    useStore.setState({ characters: [fighter], combatantStates: {} });

    await useStore.getState().shortRest();

    const last = saved[saved.length - 1];
    expect(last?.resource_pools?.second_wind?.current).toBe(1);
    expect(last?.resource_pools?.spell_slots_l1?.current).toBe(1);
    expect(last?.resource_pools?.hp?.current).toBe(10); // 4 + floor(12/2)=6, capped at 12 -> 10
  });

  it("growPoolsOnLevelUp grows pools and applies primary + secondary unlocks once", () => {
    const cleric = PRESET_CLASSES.find((c) => c.id === "cleric")!;
    const wizard = PRESET_CLASSES.find((c) => c.id === "wizard")!;
    const pools = {
      hp: pool(20, 20),
      spell_slots_l1: pool(2, 2),
      ki_points: pool(1, 2, "short_rest"),
    };
    // Cleric unlocks l3 slots at level 5; wizard would add l2 at level 3.
    const grownL3 = growPoolsOnLevelUp(pools, 3, cleric, wizard);
    expect(grownL3.hp.maximum).toBe(21);
    expect(grownL3.ki_points.current).toBe(1);
    expect(grownL3.spell_slots_l2).toEqual(pool(2, 2));
    // Reaching the same level again must not duplicate.
    const grownAgain = growPoolsOnLevelUp(grownL3 as never, 3, cleric, wizard);
    expect(grownAgain.spell_slots_l2.maximum).toBe(3); // +1 growth, not a second grant
    // Level 5 adds the cleric's l3 tier alongside wizard's (already present).
    const grownL5 = growPoolsOnLevelUp(grownAgain as never, 5, cleric, wizard);
    expect(grownL5.spell_slots_l3).toEqual(pool(2, 2));
    expect(grownL5.spell_slots_l2.maximum).toBe(4);
  });
});

describe("Death saves", () => {
  // rollDeathSave now rolls locally (browser players have no backend), so
  // determinism comes from intercepting crypto.getRandomValues: the roll
  // consumes one u32 and maps it to face = (u32 % 20) + 1.
  function stubD20(face: number) {
    return stubNextU32(face - 1);
  }
  afterEach(() => vi.restoreAllMocks());

  const dying = () => {
    const c = newCharacter("Falling");
    c.resource_pools.hp!.current = 0;
    useStore.setState({
      characters: [c],
      combatantStates: { [c.id]: { id: c.id, name: "Falling", hit_points: 0, status: "dying" } },
      deathSaves: {},
    });
    return c;
  };

  it("increments successes on a roll of 10+", async () => {
    stubD20(15);
    const c = dying();
    await useStore.getState().rollDeathSave(c.id);
    expect(useStore.getState().deathSaves[c.id]).toEqual({ successes: 1, failures: 0 });
  });

  it("third success stabilizes the character", async () => {
    stubD20(15);
    const c = dying();
    useStore.setState({ deathSaves: { [c.id]: { successes: 2, failures: 0 } } });

    await useStore.getState().rollDeathSave(c.id);

    const st = useStore.getState();
    expect(st.deathSaves[c.id]).toEqual({ successes: 3, failures: 0 });
    expect(st.combatantStates[c.id]?.status).toBe("stable");
  });

  it("third failure marks the character dead", async () => {
    stubD20(4);
    const c = dying();
    useStore.setState({ deathSaves: { [c.id]: { successes: 0, failures: 2 } } });

    await useStore.getState().rollDeathSave(c.id);

    const st = useStore.getState();
    expect(st.deathSaves[c.id]).toEqual({ successes: 0, failures: 3 });
    expect(st.combatantStates[c.id]?.status).toBe("dead");
    expect(st.combatantStates[c.id]?.hit_points).toBe(-1);
  });
});

describe("undoLastHpChange", () => {
  it("restores previous HP and clears the undo buffer", () => {
    const c = newCharacter("Zap");
    useStore.setState({
      combatantStates: { [c.id]: { id: c.id, name: "Zap", hit_points: 4, status: undefined } },
      lastHpChange: { entityId: c.id, previousHp: 10, newHp: 4 },
    });

    useStore.getState().undoLastHpChange();

    const st = useStore.getState();
    expect(st.combatantStates[c.id]?.hit_points).toBe(10);
    expect(st.lastHpChange).toBeNull();
  });

  it("is a no-op when there is nothing to undo", () => {
    useStore.setState({ lastHpChange: null, combatantStates: {} });
    expect(() => useStore.getState().undoLastHpChange()).not.toThrow();
  });

  it("revives and clears death saves when undoing a killing blow", () => {
    const c = newCharacter("Victim");
    useStore.setState({
      combatantStates: {
        [c.id]: { id: c.id, name: "Victim", hit_points: -3, status: "DEFEATED" },
      },
      deathSaves: { [c.id]: { successes: 1, failures: 2 } },
      lastHpChange: { entityId: c.id, previousHp: 9, newHp: -3 },
    });

    useStore.getState().undoLastHpChange();

    const st = useStore.getState();
    expect(st.combatantStates[c.id]?.hit_points).toBe(9);
    expect(st.combatantStates[c.id]?.status).toBe("ALIVE");
    expect(st.deathSaves[c.id]).toBeUndefined();
    expect(st.lastHpChange).toBeNull();
  });
});

describe("rollDiceLocal", () => {
  it("rolls within range for plain NdN", () => {
    for (let i = 0; i < 200; i++) {
      const r = rollDiceLocal("2d6");
      expect(r.total).toBeGreaterThanOrEqual(2);
      expect(r.total).toBeLessThanOrEqual(12);
    }
  });

  it("applies positive and negative modifiers", () => {
    for (let i = 0; i < 100; i++) {
      expect(rollDiceLocal("1d20 + 5").total).toBeGreaterThanOrEqual(6);
      expect(rollDiceLocal("1d20 + 5").total).toBeLessThanOrEqual(25);
      expect(rollDiceLocal("1d20 - 3").total).toBeGreaterThanOrEqual(-2);
      expect(rollDiceLocal("1d20 - 3").total).toBeLessThanOrEqual(17);
    }
  });

  it("rejects unsupported expressions loudly", () => {
    expect(() => rollDiceLocal("4d6kh3")).toThrow();
    expect(() => rollDiceLocal("hello")).toThrow();
  });

  it("distribution sanity: d20 covers the full range over many rolls", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 3000; i++) seen.add(rollDiceLocal("1d20").total);
    for (let face = 1; face <= 20; face++) {
      expect(seen.has(face)).toBe(true);
    }
  });
});

describe("Battle map", () => {
  const seedEntity = () => {
    const c = newCharacter("Mapguy");
    useStore.setState({ characters: [c] });
    return c;
  };

  it("spawn/move/remove manage tokens with clamped positions", () => {
    const e = seedEntity();
    useStore.setState({ mapTokens: [] });

    useStore.getState().spawnMapToken(e);
    const [t] = useStore.getState().mapTokens;
    expect(t.label).toBe("Mapguy");
    expect(t.entity_id).toBe(e.id);
    expect(t.x).toBeGreaterThanOrEqual(0);

    useStore.getState().moveMapToken(t.id, 500, -20);
    const moved = useStore.getState().mapTokens[0];
    expect(moved.x).toBe(100); // clamped high
    expect(moved.y).toBe(0); // clamped low

    useStore.getState().removeMapToken(t.id);
    expect(useStore.getState().mapTokens).toHaveLength(0);
  });

  it("persists map tokens and background with combat state", async () => {
    const { backend } = await import("../backend");
    vi.mocked(backend.saveCombatState).mockClear();
    const e = seedEntity();
    useStore.setState({
      activeSceneId: "scene-map",
      mapTokens: [],
      mapBackground: "",
      initiativeOrder: [],
      combatantStates: {},
      combatantConditions: {},
      deathSaves: {},
    });
    useStore.getState().setMapBackground("assets/maps/tavern.jpg");
    const nBefore = useStore.getState().mapTokens.length;
    useStore.getState().spawnMapToken(e, 25, 75);

    // persistCombat is debounced (300ms); flush it.
    await new Promise((r) => setTimeout(r, 360));

    expect(vi.mocked(backend.saveCombatState)).toHaveBeenCalled();
    const payload = JSON.parse(
      vi.mocked(backend.saveCombatState).mock.calls[vi.mocked(backend.saveCombatState).mock.calls.length - 1][1] as string,
    );
    expect(payload.mapBackground).toBe("assets/maps/tavern.jpg");
    expect(payload.mapTokens).toHaveLength(1);
    // Anti-stacking jitter: ((n%5)-2)*6 applied to the requested x.
    expect(payload.mapTokens[0].x).toBe(25 + ((nBefore % 5) - 2) * 6);
  });

  it("clearMapTokens empties the board", () => {
    const e = seedEntity();
    useStore.getState().spawnMapToken(e);
    useStore.getState().spawnMapToken(e);
    useStore.getState().clearMapTokens();
    expect(useStore.getState().mapTokens).toHaveLength(0);
  });
});
