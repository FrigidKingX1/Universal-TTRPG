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
    it("adds loot entry", () => {
      useStore.getState().addLoot("Gold Coins", 100, "");
      expect(useStore.getState().loot).toHaveLength(1);
      expect(useStore.getState().loot[0].name).toBe("Gold Coins");
      expect(useStore.getState().loot[0].quantity).toBe(100);
    });

    it("assigns loot to character", () => {
      useStore.getState().addLoot("Magic Sword", 1, "");
      const lootId = useStore.getState().loot[0].id;
      useStore.getState().assignLoot(lootId, "char_1");
      expect(useStore.getState().loot[0].assignedTo).toBe("char_1");
    });

    it("clears all loot", () => {
      useStore.getState().addLoot("Potion", 3, "");
      useStore.getState().clearLoot();
      expect(useStore.getState().loot).toEqual([]);
    });
  });

  describe("NPC Notes", () => {
    it("adds and retrieves notes", () => {
      useStore.getState().addNpcNote("Bartender", "Ally", "Knows the underground");
      expect(useStore.getState().npcNotes).toHaveLength(1);
      expect(useStore.getState().npcNotes[0].npcName).toBe("Bartender");
      expect(useStore.getState().npcNotes[0].relation).toBe("Ally");
    });

    it("deletes notes by id", () => {
      useStore.getState().addNpcNote("Guard", "Enemy", "Watches the gate");
      const id = useStore.getState().npcNotes[0].id;
      useStore.getState().deleteNpcNote(id);
      expect(useStore.getState().npcNotes).toHaveLength(0);
    });

    it("groups notes by NPC name", () => {
      useStore.getState().addNpcNote("Bartender", "Ally", "Friendly");
      useStore.getState().addNpcNote("Bartender", "Contact", "Has info");
      useStore.getState().addNpcNote("Guard", "Enemy", "Hostile");
      expect(useStore.getState().npcNotes).toHaveLength(3);
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
