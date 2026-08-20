import { create } from "zustand";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { backend } from "./backend";
import type {
  ActionDefinition,
  CharacterProfile,
  CombatantState,
  EncounterStatBlock,
  EngineOutcome,
  EventMeaning,
  FateCheckResponse,
  InitiativeEntry,
  LogEntry,
  PrerequisiteCheck,
  RollResponse,
  Scene,
} from "./types";

export interface AutoDmState {
  loading: boolean;
  error: string | null;
  toast: string | null;

  characters: CharacterProfile[];
  actions: ActionDefinition[];
  statBlocks: EncounterStatBlock[];
  scenes: Scene[];
  activeSceneId: string | null;
  logs: LogEntry[];

  lastRoll: RollResponse | null;
  rollHistory: RollResponse[];
  lastFate: FateCheckResponse | null;
  fateHistory: FateCheckResponse[];
  lastEvent: EventMeaning | null;
  eventHistory: EventMeaning[];
  lastCombat: EngineOutcome | null;
  combatHistory: EngineOutcome[];
  lastDm: import("./types").DmResponse | null;
  dmHistory: import("./types").DmResponse[];
  initiativeOrder: InitiativeEntry[];
  combatantStates: Record<string, CombatantState>;
  combatantConditions: Record<string, string[]>;
  currentRound: number;
  currentTurnIndex: number;

  // Ollama status (polled from Tools tab).
  ollama: { reachable: boolean; models: string[]; currentModel: string };
  pollOllamaModels: () => Promise<void>;
  setOllamaModel: (model: string) => Promise<void>;
  ingestToMemory: (speaker: string, content: string) => Promise<void>;

  bootstrap: () => Promise<void>;
  setError: (msg: string | null) => void;

  createCharacter: (name: string) => Promise<void>;
  saveCharacter: (profile: CharacterProfile) => Promise<void>;
  deleteCharacter: (id: string) => Promise<void>;

  saveAction: (action: ActionDefinition) => Promise<void>;
  deleteAction: (id: string) => Promise<void>;

  saveStatBlock: (block: EncounterStatBlock) => Promise<void>;
  deleteStatBlock: (id: string) => Promise<void>;

  createScene: (title: string, chaosFactor: number) => Promise<void>;
  setActiveScene: (id: string) => Promise<void>;
  deleteScene: (id: string) => Promise<void>;
  refreshLogs: () => Promise<void>;

  recordRoll: (r: RollResponse) => void;
  recordFate: (f: FateCheckResponse) => void;
  recordEvent: (e: EventMeaning) => void;
  resolveDmAction: (playerAction: string) => Promise<void>;

  runAttack: (
    attacker: CharacterProfile | EncounterStatBlock,
    target: CharacterProfile | EncounterStatBlock,
    actionId: string,
    prereq?: PrerequisiteCheck | null,
  ) => Promise<EngineOutcome>;
  rollInitiative: (
    combatants: (CharacterProfile | EncounterStatBlock)[],
    formula?: string,
  ) => Promise<void>;
  nextTurn: () => void;
  endCombat: () => void;
  toggleCondition: (entityId: string, condition: string) => void;
  showToast: (msg: string) => void;
  cloneStatBlock: (id: string) => Promise<void>;
}

export function newCharacter(name: string): CharacterProfile {
  const mk = (base: number, mod?: number): { base_value: number; current_value: number; derived_modifier?: number } => ({
    base_value: base,
    current_value: base,
    derived_modifier: mod ?? Math.floor((base - 10) / 2),
  });
  return {
    id: crypto.randomUUID(),
    system_id: "universal",
    identity: { name, level_or_rank: 1 },
    attributes: {
      STR: mk(10),
      DEX: mk(10),
      CON: mk(10),
      INT: mk(10),
      WIS: mk(10),
      CHA: mk(10),
    },
    resource_pools: {
      hp: { current: 10, maximum: 10, temporary: 0, reset_condition: "long_rest" },
    },
    inventory: [],
    abilities: [],
  };
}

export const entityName = (e: CharacterProfile | EncounterStatBlock): string =>
  "identity" in e ? e.identity.name : e.name;

export function newStatBlock(name: string): EncounterStatBlock {
  return {
    id: crypto.randomUUID(),
    name,
    challenge_rating: 1,
    armor_class: 12,
    hit_points: { current: 10, maximum: 10 },
    attributes: { STR: 12, DEX: 12, CON: 12, INT: 8, WIS: 10, CHA: 8 },
    actions: [],
  };
}

export const useStore = create<AutoDmState>((set, get) => ({
  loading: true,
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
  ollama: { reachable: false, models: [], currentModel: "llama3.2" },

  bootstrap: async () => {
    set({ loading: true, error: null });
    try {
      await backend.ping();
      await backend.seedDefaults();
      const [characters, actions, statBlocks, scenes, active] = await Promise.all([
        backend.listCharacters(),
        backend.listActions(),
        backend.listStatBlocks(),
        backend.listScenes(),
        backend.activeScene(),
      ]);
      const activeSceneId = active ? active.id : null;
      const logs = activeSceneId
        ? await backend.listLogs(activeSceneId, 200)
        : [];
      set({
        characters,
        actions,
        statBlocks,
        scenes,
        activeSceneId,
        logs,
        loading: false,
      });
    } catch (e) {
      set({ loading: false, error: String(e) });
    }
  },

  setError: (msg) => set({ error: msg }),

  createCharacter: async (name) => {
    const profile = newCharacter(name || "Unnamed Adventurer");
    await backend.saveCharacter(profile);
    const characters = await backend.listCharacters();
    set({ characters });
  },

  saveCharacter: async (profile) => {
    await backend.saveCharacter(profile);
    const characters = await backend.listCharacters();
    set({ characters });
  },

  deleteCharacter: async (id) => {
    await backend.deleteCharacter(id);
    set({ characters: (await backend.listCharacters()) });
  },

  saveAction: async (action) => {
    await backend.saveAction(action);
    set({ actions: (await backend.listActions()) });
  },

  deleteAction: async (id) => {
    await backend.deleteAction(id);
    set({ actions: (await backend.listActions()) });
  },

  saveStatBlock: async (block) => {
    await backend.saveStatBlock(block);
    set({ statBlocks: (await backend.listStatBlocks()) });
  },

  deleteStatBlock: async (id) => {
    await backend.deleteStatBlock(id);
    set({ statBlocks: (await backend.listStatBlocks()) });
  },

  createScene: async (title, chaosFactor) => {
    const scene = await backend.createScene(title, chaosFactor);
    set({ scenes: (await backend.listScenes()) });
    await get().setActiveScene(scene.id);
  },

  setActiveScene: async (id) => {
    await backend.setActiveScene(id);
    const logs = await backend.listLogs(id, 200);
    set({ activeSceneId: id, logs, scenes: (await backend.listScenes()) });
  },

  deleteScene: async (id) => {
    await backend.deleteScene(id);
    const scenes = await backend.listScenes();
    let activeSceneId = get().activeSceneId;
    if (activeSceneId === id) {
      const active = await backend.activeScene();
      activeSceneId = active ? active.id : null;
    }
    const logs =
      activeSceneId && activeSceneId !== id
        ? await backend.listLogs(activeSceneId, 200)
        : [];
    set({ scenes, activeSceneId, logs });
  },

  refreshLogs: async () => {
    const id = get().activeSceneId;
    if (!id) return;
    set({ logs: (await backend.listLogs(id, 200)) });
  },

  recordRoll: (r) => set((s) => ({ lastRoll: r, rollHistory: [...s.rollHistory.slice(-49), r] })),
  recordFate: (f) => set((s) => ({ lastFate: f, fateHistory: [...s.fateHistory.slice(-19), f] })),
  recordEvent: (e) => set((s) => ({ lastEvent: e, eventHistory: [...s.eventHistory.slice(-19), e] })),

  resolveDmAction: async (playerAction) => {
    const s = useStore.getState();
    const scene = s.scenes.find((sc) => sc.id === s.activeSceneId);
    const response = await backend.dmResolve({
      scene_summary: scene?.summary_text ?? scene?.title ?? "",
      player_action: playerAction,
      chaos_factor: scene?.chaos_factor ?? 5,
    });
    set((s) => ({ lastDm: response, dmHistory: [...s.dmHistory.slice(-19), response] }));
    if (scene && response.narrative) {
      // Auto-update scene summary with the latest narrative.
      try {
        const newSummary = response.narrative.slice(0, 500);
        await backend.updateSceneSummary(scene.id, newSummary);
        set((s) => ({
          scenes: s.scenes.map((sc) =>
            sc.id === scene.id ? { ...sc, summary_text: newSummary } : sc,
          ),
        }));
      } catch {
        // best-effort
      }
      try {
        await backend.appendLog(scene.id, "Auto-DM", response.narrative);
      } catch {
        // Best-effort log write; don't block the DM flow.
      }
      await get().ingestToMemory("Auto-DM", response.narrative);
    }
    await get().ingestToMemory("Player", playerAction);
    try {
      await get().refreshLogs();
    } catch {
      // Best-effort refresh; the response is already in state.
    }
  },

  pollOllamaModels: async () => {
    try {
      const models = await backend.ollamaModels();
      const currentModel = await backend.getOllamaModel();
      set({ ollama: { reachable: true, models, currentModel } });
    } catch {
      set((s) => ({ ollama: { ...s.ollama, reachable: false, models: [] } }));
    }
  },

  setOllamaModel: async (model) => {
    try {
      await backend.setOllamaModel(model);
      set((s) => ({ ollama: { ...s.ollama, currentModel: model } }));
    } catch (e) {
      useStore.getState().setError(String(e));
    }
  },

  ingestToMemory: async (speaker, content) => {
    try {
      await backend.ingestMemory(speaker, content);
    } catch {
      // Memory sync is best-effort; never block the session on it.
    }
  },

  runAttack: async (attacker, target, actionId, prereq) => {
    const sceneId = get().activeSceneId ?? undefined;
    const outcome = await backend.combatAttack(attacker, target, actionId, prereq ?? null, sceneId);
    set((s) => ({
      lastCombat: outcome,
      combatantStates: {
        ...s.combatantStates,
        [target.id]: {
          id: target.id,
          name: entityName(target),
          hit_points: outcome.target_hp_remaining,
          status: outcome.target_status,
        },
      },
    }));
    await get().refreshLogs();
    return outcome;
  },

  rollInitiative: async (combatants, formula) => {
    const order = await backend.initiative(combatants, formula ?? "");
    set({ initiativeOrder: order, currentRound: 1, currentTurnIndex: 0 });
  },

  nextTurn: () => set((s) => {
    if (s.initiativeOrder.length === 0) return {};
    const nextIdx = (s.currentTurnIndex + 1) % s.initiativeOrder.length;
    const newRound = nextIdx === 0 ? s.currentRound + 1 : s.currentRound;
    return { currentTurnIndex: nextIdx, currentRound: newRound };
  }),

  endCombat: () => set({
    initiativeOrder: [],
    currentRound: 0,
    currentTurnIndex: 0,
    combatantStates: {},
    combatantConditions: {},
    lastCombat: null,
  }),

  toggleCondition: (entityId, condition) => set((s) => {
    const current = s.combatantConditions[entityId] ?? [];
    const updated = current.includes(condition)
      ? current.filter((c) => c !== condition)
      : [...current, condition];
    return { combatantConditions: { ...s.combatantConditions, [entityId]: updated } };
  }),

  showToast: (msg) => {
    set({ toast: msg });
    setTimeout(() => set({ toast: null }), 2500);
  },

  cloneStatBlock: async (id) => {
    const blocks = get().statBlocks;
    const original = blocks.find((b) => b.id === id);
    if (!original) return;
    const clone: EncounterStatBlock = {
      ...original,
      id: crypto.randomUUID(),
      name: `${original.name} (copy)`,
      hit_points: { ...original.hit_points, current: original.hit_points.maximum },
    };
    await backend.saveStatBlock(clone);
    set({ statBlocks: await backend.listStatBlocks() });
    get().showToast(`Cloned "${original.name}"`);
  },
}));

let unlisteners: UnlistenFn[] = [];

export async function subscribeToEvents() {
  if (unlisteners.length) return;
  const get = useStore.getState;
  const fns = await Promise.all([
    listen<LogEntry>("log:new", () => void get().refreshLogs()),
    listen<RollResponse>("dice:rolled", (e) => get().recordRoll(e.payload)),
    listen<FateCheckResponse>("oracle:fate", (e) => get().recordFate(e.payload)),
    listen<EventMeaning>("oracle:event", (e) => get().recordEvent(e.payload)),
    listen<EngineOutcome>("combat:outcome", (e) =>
      useStore.setState((s) => ({
        lastCombat: e.payload,
        combatHistory: [...s.combatHistory.slice(-19), e.payload],
      })),
    ),
    listen<CombatantState>("combatant:state", (e) => {
      const p = e.payload;
      const s = useStore.getState();
      const updated = { ...s.combatantStates, [p.id]: p };
      // Keep loaded CharacterProfile HP pools in sync for player characters.
      const characters = s.characters.map((c) =>
        c.id === p.id && c.resource_pools.hp
          ? {
              ...c,
              resource_pools: {
                ...c.resource_pools,
                hp: { ...c.resource_pools.hp, current: p.hit_points },
              },
            }
          : c,
      );
      useStore.setState({ combatantStates: updated, characters });
    }),
    listen<Scene>("scene:created", async () => {
      const scenes = await backend.listScenes();
      useStore.setState({ scenes });
    }),
  ]);
  unlisteners = fns;
}
