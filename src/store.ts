import { create } from "zustand";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { backend } from "./backend";
import type {
  ActionDefinition,
  CharacterProfile,
  CombatantState,
  Disposition,
  DoomClock,
  EncounterStatBlock,
  EngineOutcome,
  EventMeaning,
  ExplorationNode,
  ExplorationZone,
  FateCheckResponse,
  InitiativeEntry,
  LogEntry,
  NpcCharacter,
  PlotThread,
  PrerequisiteCheck,
  RollResponse,
  Scene,
} from "./types";

export interface LootEntry {
  id: string;
  name: string;
  quantity: number;
  assignedTo: string | null;
  sourceEntity: string;
  timestamp: string;
}

export interface NpcNote {
  id: string;
  npcName: string;
  relation: string;
  note: string;
  timestamp: string;
}

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
  ollama: { reachable: boolean; models: string[]; currentModel: string; numPredict: number };
  pollOllamaModels: () => Promise<void>;
  setOllamaModel: (model: string) => Promise<void>;
  setNumPredict: (n: number) => void;
  ingestToMemory: (speaker: string, content: string) => Promise<void>;

  bootstrap: () => Promise<void>;
  setError: (msg: string | null) => void;

  createCharacter: (name: string) => Promise<void>;
  saveCharacter: (profile: CharacterProfile) => Promise<void>;
  deleteCharacter: (id: string) => Promise<void>;
  cloneCharacter: (id: string) => Promise<void>;

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
  removeCombatant: (entityId: string) => void;
  longRest: () => Promise<void>;
  shortRest: () => Promise<void>;
  toggleCondition: (entityId: string, condition: string) => void;
  showToast: (msg: string) => void;
  cloneStatBlock: (id: string) => Promise<void>;
  completeScene: (cfAdjust?: "favor" | "against") => Promise<void>;
  deathSaves: Record<string, { successes: number; failures: number }>;
  rollDeathSave: (entityId: string) => Promise<void>;
  lastHpChange: { entityId: string; previousHp: number; newHp: number } | null;
  undoLastHpChange: () => void;
  exportCampaign: () => Promise<string>;
  importCampaign: (json: string) => Promise<void>;

  // Loot
  loot: LootEntry[];
  addLoot: (name: string, qty: number, sourceEntity: string) => Promise<void>;
  assignLoot: (lootId: string, characterId: string) => Promise<void>;
  clearLoot: () => Promise<void>;

  // NPC relationship notes
  npcNotes: NpcNote[];
  addNpcNote: (npcName: string, relation: string, note: string) => Promise<void>;
  deleteNpcNote: (id: string) => Promise<void>;

  // Plot Threads (Mythic Oracle)
  plotThreads: PlotThread[];
  addThread: (description: string) => Promise<void>;
  resolveThread: (id: string) => Promise<void>;
  abandonThread: (id: string) => Promise<void>;
  deleteThread: (id: string) => Promise<void>;

  // NPC Characters (Mythic Oracle)
  npcCharacters: NpcCharacter[];
  addNpcCharacter: (name: string, disposition: Disposition) => Promise<void>;
  updateNpcDisposition: (id: string, disposition: Disposition) => Promise<void>;
  updateNpcLocation: (id: string, location: string) => Promise<void>;
  updateNpcNotes: (id: string, notes: string) => Promise<void>;
  addNpcKnowledge: (id: string, fact: string) => Promise<void>;
  removeNpcKnowledge: (id: string, index: number) => Promise<void>;
  markNpcDead: (id: string) => Promise<void>;
  deleteNpcCharacter: (id: string) => Promise<void>;

  // Doom Clocks
  doomClocks: DoomClock[];
  addDoomClock: (label: string, max: number, consequence: string) => Promise<void>;
  tickDoomClock: (id: string) => Promise<void>;
  advanceDoomClock: (id: string, ticks: number) => Promise<void>;
  resetDoomClock: (id: string) => Promise<void>;
  deleteDoomClock: (id: string) => Promise<void>;

  // Exploration
  explorationZones: ExplorationZone[];
  explorationNodes: ExplorationNode[];
  activeZoneId: string | null;
  setActiveZone: (id: string | null) => void;
  addExplorationZone: (name: string, zoneType: string, description?: string, dangerLevel?: number) => Promise<void>;
  deleteExplorationZone: (id: string) => Promise<void>;
  addExplorationNode: (zoneId: string, name: string, description?: string) => Promise<void>;
  updateExplorationNode: (id: string, opts: { discovered?: boolean; safe?: boolean; description?: string; connections?: string[]; contents?: string[]; notes?: string }) => Promise<void>;
  deleteExplorationNode: (id: string) => Promise<void>;

  // Expedition / Travel
  currentNodeId: string | null;
  travelLog: { nodeId: string; nodeName: string; timestamp: string; encounter: string | null }[];
  startExpedition: (nodeId: string) => void;
  travelToNode: (nodeId: string) => Promise<void>;
  endExpedition: () => void;
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
    loot_table: [],
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
  deathSaves: {},
  lastHpChange: null,
  ollama: { reachable: false, models: [], currentModel: "llama3.2", numPredict: 512 },
  loot: [],
  npcNotes: [],
  plotThreads: [],
  npcCharacters: [],
  doomClocks: [],
  explorationZones: [],
  explorationNodes: [],
  activeZoneId: null,
  currentNodeId: null,
  travelLog: [],

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
      // Restore persisted combat state from SQLite.
      let combatState: Partial<AutoDmState> = {};
      let loot: LootEntry[] = [];
      let npcNotes: NpcNote[] = [];
      let plotThreads: PlotThread[] = [];
      let npcCharacters: NpcCharacter[] = [];
      if (activeSceneId) {
        try {
          const saved = await backend.loadCombatState(activeSceneId);
          if (saved) {
            const parsed = JSON.parse(saved);
            combatState = {
              initiativeOrder: parsed.initiativeOrder ?? [],
              combatantStates: parsed.combatantStates ?? {},
              combatantConditions: parsed.combatantConditions ?? {},
              currentRound: parsed.currentRound ?? 0,
              currentTurnIndex: parsed.currentTurnIndex ?? 0,
              deathSaves: parsed.deathSaves ?? {},
            };
          }
        } catch {
          // Corrupted or missing — start fresh.
        }
        // Load loot from SQLite.
        try {
          const rows = await backend.listLoot(activeSceneId);
          loot = rows.map((r) => ({ id: r.id, name: r.name, quantity: r.quantity, assignedTo: r.assigned_to, sourceEntity: r.source_entity, timestamp: r.timestamp }));
        } catch { /* best-effort */ }
        // Load NPC notes from SQLite.
        try {
          const rows = await backend.listNpcNotes(activeSceneId);
          npcNotes = rows.map((r) => ({ id: r.id, npcName: r.npc_name, relation: r.relation, note: r.note, timestamp: r.timestamp }));
        } catch { /* best-effort */ }
      }
      // Load plot threads (campaign-wide, not per-scene).
      try {
        const rows = await backend.listThreads();
        plotThreads = rows.map((r) => ({
          id: r.id,
          description: r.description,
          status: r.status as PlotThread["status"],
          opened_scene_id: r.opened_scene_id,
          resolved_scene_id: r.resolved_scene_id ?? undefined,
          created_at: r.created_at,
        }));
      } catch { /* best-effort */ }
      // Load NPC characters (campaign-wide).
      try {
        const rows = await backend.listNpcCharacters();
        npcCharacters = rows.map((r) => ({
          id: r.id,
          name: r.name,
          disposition: r.disposition as Disposition,
          alive: r.alive,
          location: r.location ?? undefined,
          knows: (() => {
            try {
              const raw = JSON.parse(r.knows_json);
              if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === "string") {
                return raw.map((s: string) => ({ text: s } as import("./types").NpcKnowledge));
              }
              return raw as import("./types").NpcKnowledge[];
            } catch { return []; }
          })(),
          notes: r.notes ?? undefined,
          last_seen_scene_id: r.last_seen_scene_id ?? undefined,
          created_at: r.created_at,
        }));
      } catch { /* best-effort */ }
      // Load doom clocks.
      let doomClocks: DoomClock[] = [];
      try {
        doomClocks = await backend.listDoomClocks();
      } catch { /* best-effort */ }
      // Load exploration zones.
      let explorationZones: ExplorationZone[] = [];
      try {
        explorationZones = await backend.listExplorationZones();
      } catch { /* best-effort */ }
      set({
        characters,
        actions,
        statBlocks,
        scenes,
        activeSceneId,
        logs,
        loading: false,
        ...combatState,
        loot,
        npcNotes,
        plotThreads,
        npcCharacters,
        doomClocks,
        explorationZones,
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

  cloneCharacter: async (id) => {
    const chars = get().characters;
    const orig = chars.find((c) => c.id === id);
    if (!orig) return;
    const clone: CharacterProfile = {
      ...structuredClone(orig),
      id: crypto.randomUUID(),
      identity: { ...orig.identity, name: `${orig.identity.name} (copy)` },
    };
    await backend.saveCharacter(clone);
    set({ characters: await backend.listCharacters() });
    get().showToast(`Cloned "${orig.identity.name}"`);
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
      set((s) => ({ ollama: { ...s.ollama, reachable: true, models, currentModel } }));
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
    const prevHp = get().combatantStates[target.id]?.hit_points ?? ("resource_pools" in target ? target.resource_pools.hp?.current ?? 0 : target.hit_points.current);
    const outcome = await backend.combatAttack(attacker, target, actionId, prereq ?? null, sceneId);
    set((s) => ({
      lastCombat: outcome,
      lastHpChange: { entityId: target.id, previousHp: prevHp, newHp: outcome.target_hp_remaining },
      combatHistory: [...s.combatHistory.slice(-19), outcome],
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
    persistCombat();
    await get().refreshLogs();
    return outcome;
  },

  rollInitiative: async (combatants, formula) => {
    const order = await backend.initiative(combatants, formula ?? "");
    set({ initiativeOrder: order, currentRound: 1, currentTurnIndex: 0 });
    persistCombat();
  },

  nextTurn: () => { set((s) => {
    if (s.initiativeOrder.length === 0) return {};
    const nextIdx = (s.currentTurnIndex + 1) % s.initiativeOrder.length;
    const newRound = nextIdx === 0 ? s.currentRound + 1 : s.currentRound;
    return { currentTurnIndex: nextIdx, currentRound: newRound };
  }); persistCombat(); },

  endCombat: () => { set({
    initiativeOrder: [],
    currentRound: 0,
    currentTurnIndex: 0,
    combatantStates: {},
    combatantConditions: {},
    deathSaves: {},
    lastCombat: null,
  }); persistCombat(); },

  removeCombatant: (entityId) => { set((s) => {
    const newStates = { ...s.combatantStates };
    delete newStates[entityId];
    const newConditions = { ...s.combatantConditions };
    delete newConditions[entityId];
    const newOrder = s.initiativeOrder.filter((e) => e.combatant_id !== entityId);
    const newDeathSaves = { ...s.deathSaves };
    delete newDeathSaves[entityId];
    return {
      combatantStates: newStates,
      combatantConditions: newConditions,
      initiativeOrder: newOrder,
      deathSaves: newDeathSaves,
    };
  }); persistCombat(); },

  longRest: async () => {
    const s = useStore.getState();
    let healed = 0;
    for (const c of s.characters) {
      const currentStates = useStore.getState().combatantStates;
      const max = c.resource_pools.hp?.maximum ?? 10;
      const current = currentStates[c.id]?.hit_points ?? c.resource_pools.hp?.current ?? 0;
      if (current < max) {
        await s.saveCharacter({
          ...c,
          resource_pools: {
            ...c.resource_pools,
            hp: { ...c.resource_pools.hp!, current: max },
          },
        });
        const latest = useStore.getState().combatantStates;
        useStore.setState({
          combatantStates: {
            ...latest,
            [c.id]: { ...latest[c.id], hit_points: max },
          },
        });
        healed++;
      }
    }
    get().showToast(`Long Rest: ${healed} character${healed !== 1 ? "s" : ""} healed to full`);
    if (s.activeSceneId && healed > 0) {
      await backend.appendLog(s.activeSceneId, "System", `Party takes a Long Rest. ${healed} character${healed !== 1 ? "s" : ""} fully healed.`);
    }
    persistCombat();
  },

  shortRest: async () => {
    const s = useStore.getState();
    let healed = 0;
    for (const c of s.characters) {
      const currentStates = useStore.getState().combatantStates;
      const max = c.resource_pools.hp?.maximum ?? 10;
      const current = currentStates[c.id]?.hit_points ?? c.resource_pools.hp?.current ?? 0;
      const halfMax = Math.floor(max / 2);
      if (current < max && halfMax > 0) {
        const restored = Math.min(halfMax, max - current);
        const newHp = current + restored;
        await s.saveCharacter({
          ...c,
          resource_pools: {
            ...c.resource_pools,
            hp: { ...c.resource_pools.hp!, current: newHp },
          },
        });
        const latest = useStore.getState().combatantStates;
        useStore.setState({
          combatantStates: {
            ...latest,
            [c.id]: { ...latest[c.id], hit_points: newHp },
          },
        });
        healed++;
      }
    }
    get().showToast(`Short Rest: ${healed} character${healed !== 1 ? "s" : ""} recovered HP`);
    if (s.activeSceneId && healed > 0) {
      await backend.appendLog(s.activeSceneId, "System", `Party takes a Short Rest. ${healed} character${healed !== 1 ? "s" : ""} recovered hit points.`);
    }
    persistCombat();
  },

  toggleCondition: (entityId, condition) => { set((s) => {
    const current = s.combatantConditions[entityId] ?? [];
    const updated = current.includes(condition)
      ? current.filter((c) => c !== condition)
      : [...current, condition];
    return { combatantConditions: { ...s.combatantConditions, [entityId]: updated } };
  }); persistCombat(); },

  showToast: (msg) => {
    set({ toast: msg });
    setTimeout(() => {
      const current = useStore.getState().toast;
      if (current === msg) set({ toast: null });
    }, 2500);
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

  completeScene: async (cfAdjust) => {
    const s = get();
    const scene = s.scenes.find((sc) => sc.id === s.activeSceneId);
    if (!scene) return;
    // Auto-adjust Chaos Factor based on Mythic rule:
    // Against PCs → CF +1, In PCs' favor → CF -1.
    if (cfAdjust) {
      const newCf = cfAdjust === "favor"
        ? Math.max(1, scene.chaos_factor - 1)
        : Math.min(9, scene.chaos_factor + 1);
      if (newCf !== scene.chaos_factor) {
        await backend.updateSceneChaosFactor(scene.id, newCf);
        set((prev) => ({
          scenes: prev.scenes.map((sc) => sc.id === scene.id ? { ...sc, chaos_factor: newCf } : sc),
        }));
        get().showToast(`CF adjusted: ${scene.chaos_factor} → ${newCf} (${cfAdjust})`);
      }
    }
    if (scene.summary_text) {
      await backend.appendLog(scene.id, "System", `[Scene #${scene.scene_number} Complete] ${scene.summary_text}`);
    }
    await backend.appendLog(scene.id, "System", `Scene "${scene.title}" has been completed.`);
    get().showToast(`Scene "${scene.title}" completed`);
  },

  rollDeathSave: async (entityId) => {
    const s = get();
    const ds = s.deathSaves[entityId] ?? { successes: 0, failures: 0 };
    const r = await backend.rollDice("1d20");
    const isTenPlus = r.total >= 10;
    const newDs = isTenPlus
      ? { successes: ds.successes + 1, failures: ds.failures }
      : { successes: ds.successes, failures: ds.failures + 1 };
    const result = isTenPlus ? "Success" : "Failure";
    if (newDs.successes >= 3) {
      set((st) => ({
        deathSaves: { ...st.deathSaves, [entityId]: newDs },
        combatantStates: {
          ...st.combatantStates,
          [entityId]: { ...st.combatantStates[entityId], status: "stable" },
        },
      }));
      get().showToast("Stabilized!");
    } else if (newDs.failures >= 3) {
      set((st) => ({
        deathSaves: { ...st.deathSaves, [entityId]: newDs },
        combatantStates: {
          ...st.combatantStates,
          [entityId]: { ...st.combatantStates[entityId], hit_points: -1, status: "dead" },
        },
      }));
      get().showToast("Dead!");
    } else {
      set((st) => ({ deathSaves: { ...st.deathSaves, [entityId]: newDs } }));
      get().showToast(`Death Save: ${result} (${newDs.successes}/${newDs.failures})`);
    }
    persistCombat();
  },

  undoLastHpChange: () => {
    const change = get().lastHpChange;
    if (!change) return;
    const s = get();
    const st = s.combatantStates[change.entityId];
    if (st) {
      set((prev) => ({
        combatantStates: {
          ...prev.combatantStates,
          [change.entityId]: { ...st, hit_points: change.previousHp },
        },
        lastHpChange: null,
      }));
      persistCombat();
      get().showToast("Undone");
    }
  },

  exportCampaign: async () => {
    const data = await backend.exportCampaign();
    return JSON.stringify(data, null, 2);
  },

  importCampaign: async (json: string) => {
    const data = JSON.parse(json);
    await backend.importCampaign(data);
    await get().bootstrap();
    get().showToast("Campaign imported");
  },

  setNumPredict: (n) => set((s) => ({ ollama: { ...s.ollama, numPredict: Math.max(64, Math.min(2048, n)) } })),

  // Loot
  addLoot: async (name, qty, sourceEntity) => {
    const sceneId = get().activeSceneId;
    if (!sceneId) { get().showToast("No active scene"); return; }
    try {
      const row = await backend.saveLoot(sceneId, name, qty, sourceEntity);
      const entry: LootEntry = { id: row.id, name: row.name, quantity: row.quantity, assignedTo: row.assigned_to, sourceEntity: row.source_entity, timestamp: row.timestamp };
      set((s) => ({ loot: [...s.loot, entry] }));
      get().showToast(`Added ${qty}× ${name} to loot`);
    } catch (e) {
      get().showToast(`Error: ${e}`);
    }
  },
  assignLoot: async (lootId, characterId) => {
    try {
      await backend.assignLootToCharacter(lootId, characterId);
      set((s) => {
        const loot = s.loot.map((l) => l.id === lootId ? { ...l, assignedTo: characterId } : l);
        const entry = loot.find((l) => l.id === lootId);
        if (entry) get().showToast(`Assigned ${entry.name} to ${s.characters.find((c) => c.id === characterId)?.identity.name ?? "character"}`);
        return { loot };
      });
    } catch (e) {
      get().showToast(`Error: ${e}`);
    }
  },
  clearLoot: async () => {
    const sceneId = get().activeSceneId;
    if (!sceneId) return;
    try {
      await backend.clearLootInScene(sceneId);
      set({ loot: [] });
    } catch (e) {
      get().showToast(`Error: ${e}`);
    }
  },

  // NPC relationship notes
  addNpcNote: async (npcName, relation, note) => {
    const sceneId = get().activeSceneId;
    if (!sceneId) { get().showToast("No active scene"); return; }
    try {
      const row = await backend.saveNpcNote(sceneId, npcName, relation, note);
      const entry: NpcNote = { id: row.id, npcName: row.npc_name, relation: row.relation, note: row.note, timestamp: row.timestamp };
      set((s) => ({ npcNotes: [...s.npcNotes, entry] }));
    } catch (e) {
      get().showToast(`Error: ${e}`);
    }
  },
  deleteNpcNote: async (id) => {
    try {
      await backend.deleteNpcNote(id);
      set((s) => ({ npcNotes: s.npcNotes.filter((n) => n.id !== id) }));
    } catch (e) {
      get().showToast(`Error: ${e}`);
    }
  },

  // ── Plot Threads ──────────────────────────────────────────────────────

  addThread: async (description) => {
    const sceneId = get().activeSceneId;
    if (!sceneId) { get().showToast("No active scene"); return; }
    try {
      const row = await backend.saveThread(description, "open", sceneId);
      const thread: PlotThread = {
        id: row.id,
        description: row.description,
        status: row.status as PlotThread["status"],
        opened_scene_id: row.opened_scene_id,
        resolved_scene_id: row.resolved_scene_id ?? undefined,
        created_at: row.created_at,
      };
      set((s) => ({ plotThreads: [...s.plotThreads, thread] }));
      get().showToast(`Thread opened: ${description}`);
    } catch (e) {
      get().showToast(`Error: ${e}`);
    }
  },

  resolveThread: async (id) => {
    const sceneId = get().activeSceneId;
    try {
      await backend.updateThreadStatus(id, "resolved", sceneId ?? undefined);
      set((s) => ({
        plotThreads: s.plotThreads.map((t) =>
          t.id === id ? { ...t, status: "resolved" as const, resolved_scene_id: sceneId ?? undefined } : t
        ),
      }));
      get().showToast("Thread resolved");
    } catch (e) {
      get().showToast(`Error: ${e}`);
    }
  },

  abandonThread: async (id) => {
    try {
      await backend.updateThreadStatus(id, "abandoned");
      set((s) => ({
        plotThreads: s.plotThreads.map((t) =>
          t.id === id ? { ...t, status: "abandoned" as const } : t
        ),
      }));
      get().showToast("Thread abandoned");
    } catch (e) {
      get().showToast(`Error: ${e}`);
    }
  },

  deleteThread: async (id) => {
    try {
      await backend.deleteThread(id);
      set((s) => ({ plotThreads: s.plotThreads.filter((t) => t.id !== id) }));
    } catch (e) {
      get().showToast(`Error: ${e}`);
    }
  },

  // ── NPC Characters ────────────────────────────────────────────────────

  addNpcCharacter: async (name, disposition) => {
    const sceneId = get().activeSceneId;
    try {
      const row = await backend.saveNpcCharacter(name, disposition, true, undefined, "[]", undefined, sceneId ?? undefined);
      const npc: NpcCharacter = {
        id: row.id,
        name: row.name,
        disposition: row.disposition as Disposition,
        alive: row.alive,
        location: row.location ?? undefined,
        knows: (() => {
          try {
            const raw = JSON.parse(row.knows_json);
            if (Array.isArray(raw) && raw.length > 0 && typeof raw[0] === "string") {
              return raw.map((text: string) => ({ text, scene_id: undefined, timestamp: undefined }));
            }
            return raw;
          } catch { return []; }
        })(),
        notes: row.notes ?? undefined,
        last_seen_scene_id: row.last_seen_scene_id ?? undefined,
        created_at: row.created_at,
      };
      set((s) => ({ npcCharacters: [...s.npcCharacters, npc] }));
      get().showToast(`NPC added: ${name}`);
    } catch (e) {
      get().showToast(`Error: ${e}`);
    }
  },

  updateNpcDisposition: async (id, disposition) => {
    try {
      await backend.updateNpcCharacter(id, disposition);
      set((s) => ({
        npcCharacters: s.npcCharacters.map((n) =>
          n.id === id ? { ...n, disposition } : n
        ),
      }));
    } catch (e) {
      get().showToast(`Error: ${e}`);
    }
  },

  updateNpcLocation: async (id, location) => {
    try {
      await backend.updateNpcCharacter(id, undefined, undefined, location);
      set((s) => ({
        npcCharacters: s.npcCharacters.map((n) =>
          n.id === id ? { ...n, location } : n
        ),
      }));
    } catch (e) {
      get().showToast(`Error: ${e}`);
    }
  },

  updateNpcNotes: async (id, notes) => {
    try {
      await backend.updateNpcCharacter(id, undefined, undefined, undefined, undefined, notes);
      set((s) => ({
        npcCharacters: s.npcCharacters.map((n) =>
          n.id === id ? { ...n, notes } : n
        ),
      }));
    } catch (e) {
      get().showToast(`Error: ${e}`);
    }
  },

  addNpcKnowledge: async (id, fact) => {
    const npc = get().npcCharacters.find((n) => n.id === id);
    if (!npc) return;
    const entry: import("./types").NpcKnowledge = {
      text: fact,
      scene_id: get().activeSceneId,
      timestamp: new Date().toISOString(),
    };
    const newKnows = [...npc.knows, entry];
    const knowsJson = JSON.stringify(newKnows);
    try {
      await backend.updateNpcCharacter(id, undefined, undefined, undefined, knowsJson);
      set((s) => ({
        npcCharacters: s.npcCharacters.map((n) =>
          n.id === id ? { ...n, knows: newKnows } : n
        ),
      }));
    } catch (e) {
      get().showToast(`Error: ${e}`);
    }
  },

  removeNpcKnowledge: async (id, index) => {
    const npc = get().npcCharacters.find((n) => n.id === id);
    if (!npc) return;
    const newKnows = npc.knows.filter((_, i) => i !== index);
    const knowsJson = JSON.stringify(newKnows);
    try {
      await backend.updateNpcCharacter(id, undefined, undefined, undefined, knowsJson);
      set((s) => ({
        npcCharacters: s.npcCharacters.map((n) =>
          n.id === id ? { ...n, knows: newKnows } : n
        ),
      }));
    } catch (e) {
      get().showToast(`Error: ${e}`);
    }
  },

  markNpcDead: async (id) => {
    try {
      await backend.updateNpcCharacter(id, undefined, false);
      set((s) => ({
        npcCharacters: s.npcCharacters.map((n) =>
          n.id === id ? { ...n, alive: false } : n
        ),
      }));
      get().showToast("NPC marked as dead");
    } catch (e) {
      get().showToast(`Error: ${e}`);
    }
  },

  deleteNpcCharacter: async (id) => {
    try {
      await backend.deleteNpcCharacter(id);
      set((s) => ({ npcCharacters: s.npcCharacters.filter((n) => n.id !== id) }));
    } catch (e) {
      get().showToast(`Error: ${e}`);
    }
  },

  // ── Doom Clocks ────────────────────────────────────────────────

  addDoomClock: async (label, max, consequence) => {
    try {
      const clock = await backend.createDoomClock(label, max, consequence);
      set((s) => ({ doomClocks: [...s.doomClocks, clock] }));
      get().showToast(`Doom Clock created: ${label}`);
    } catch (e) {
      get().showToast(`Error: ${e}`);
    }
  },

  tickDoomClock: async (id) => {
    try {
      const result = await backend.tickDoomClock(id);
      if (result) {
        const [current, max] = result;
        set((s) => ({
          doomClocks: s.doomClocks.map((c) => c.id === id ? { ...c, current } : c),
        }));
        if (current === 0) {
          const clock = get().doomClocks.find((c) => c.id === id);
          get().showToast(`DOOM: ${clock?.consequence ?? "Something terrible happens!"}`);
        }
      }
    } catch (e) {
      get().showToast(`Error: ${e}`);
    }
  },

  advanceDoomClock: async (id, ticks) => {
    try {
      const result = await backend.advanceDoomClock(id, ticks);
      if (result) {
        const [current, _max] = result;
        set((s) => ({
          doomClocks: s.doomClocks.map((c) => c.id === id ? { ...c, current } : c),
        }));
        if (current === 0) {
          const clock = get().doomClocks.find((c) => c.id === id);
          get().showToast(`DOOM: ${clock?.consequence ?? "Something terrible happens!"}`);
        }
      }
    } catch (e) {
      get().showToast(`Error: ${e}`);
    }
  },

  resetDoomClock: async (id) => {
    try {
      await backend.resetDoomClock(id);
      set((s) => ({
        doomClocks: s.doomClocks.map((c) => c.id === id ? { ...c, current: c.max } : c),
      }));
      get().showToast("Doom Clock reset");
    } catch (e) {
      get().showToast(`Error: ${e}`);
    }
  },

  deleteDoomClock: async (id) => {
    try {
      await backend.deleteDoomClock(id);
      set((s) => ({ doomClocks: s.doomClocks.filter((c) => c.id !== id) }));
    } catch (e) {
      get().showToast(`Error: ${e}`);
    }
  },

  // Exploration
  setActiveZone: (id) => {
    set({ activeZoneId: id, explorationNodes: [] });
    if (id) {
      const zoneId = id;
      void backend.listExplorationNodes(zoneId).then((nodes) => {
        // Only apply if zone hasn't changed during the async load
        if (get().activeZoneId === zoneId) set({ explorationNodes: nodes });
      }).catch(() => {});
    }
  },
  addExplorationZone: async (name, zoneType, description, dangerLevel) => {
    try {
      const zone = await backend.createExplorationZone(name, zoneType, description, dangerLevel);
      set((s) => ({ explorationZones: [...s.explorationZones, zone] }));
    } catch (e) {
      get().showToast(`Error: ${e}`);
    }
  },
  deleteExplorationZone: async (id) => {
    try {
      await backend.deleteExplorationZone(id);
      set((s) => ({
        explorationZones: s.explorationZones.filter((z) => z.id !== id),
        activeZoneId: s.activeZoneId === id ? null : s.activeZoneId,
        explorationNodes: s.activeZoneId === id ? [] : s.explorationNodes,
      }));
    } catch (e) {
      get().showToast(`Error: ${e}`);
    }
  },
  addExplorationNode: async (zoneId, name, description) => {
    try {
      const node = await backend.createExplorationNode(zoneId, name, description);
      set((s) => ({ explorationNodes: [...s.explorationNodes, node] }));
    } catch (e) {
      get().showToast(`Error: ${e}`);
    }
  },
  updateExplorationNode: async (id, opts) => {
    try {
      const connectionsJson = opts.connections ? JSON.stringify(opts.connections) : undefined;
      const contentsJson = opts.contents ? JSON.stringify(opts.contents) : undefined;
      await backend.updateExplorationNode(id, opts.discovered, opts.safe, opts.description, connectionsJson, contentsJson, opts.notes);
      set((s) => ({
        explorationNodes: s.explorationNodes.map((n) =>
          n.id === id ? { ...n, ...opts, ...(connectionsJson ? { connections: opts.connections! } : {}), ...(contentsJson ? { contents: opts.contents! } : {}) } : n
        ),
      }));
    } catch (e) {
      get().showToast(`Error: ${e}`);
    }
  },
  deleteExplorationNode: async (id) => {
    try {
      await backend.deleteExplorationNode(id);
      set((s) => ({ explorationNodes: s.explorationNodes.filter((n) => n.id !== id) }));
    } catch (e) {
      get().showToast(`Error: ${e}`);
    }
  },

  // Expedition / Travel
  startExpedition: (nodeId) => {
    const node = get().explorationNodes.find((n) => n.id === nodeId);
    if (!node) return;
    set({ currentNodeId: nodeId, travelLog: [{ nodeId, nodeName: node.name, timestamp: new Date().toISOString(), encounter: null }] });
  },
  travelToNode: async (nodeId) => {
    const { currentNodeId, explorationNodes, activeZoneId } = get();
    if (!currentNodeId || !activeZoneId) return;
    const current = explorationNodes.find((n) => n.id === currentNodeId);
    if (!current) return;
    const target = explorationNodes.find((n) => n.id === nodeId);
    if (!target) return;
    if (!current.connections.includes(nodeId)) {
      get().showToast("No path to that node");
      return;
    }
    // Discover the target node
    if (!target.discovered) {
      await get().updateExplorationNode(nodeId, { discovered: true });
    }
    // Random encounter check: d10 vs zone danger level
    const zone = get().explorationZones.find((z) => z.id === activeZoneId);
    const dangerLevel = zone?.danger_level ?? 0;
    let encounter: string | null = null;
    if (dangerLevel > 0) {
      const roll = Math.floor(Math.random() * 10) + 1;
      if (roll <= dangerLevel) {
        encounter = `Random encounter! (rolled ${roll} vs danger ${dangerLevel})`;
        get().showToast(encounter);
      }
    }
    const entry = { nodeId, nodeName: target.name, timestamp: new Date().toISOString(), encounter };
    set((s) => ({ currentNodeId: nodeId, travelLog: [...s.travelLog, entry] }));
  },
  endExpedition: () => {
    const { travelLog, activeSceneId } = get();
    if (activeSceneId && travelLog.length > 0) {
      const summary = travelLog.map((e) => `${e.nodeName}${e.encounter ? ` — ${e.encounter}` : ""}`).join(" → ");
      void backend.appendLog(activeSceneId, "Expedition", `Travel: ${summary}`).catch(() => {});
    }
    set({ currentNodeId: null, travelLog: [] });
  },
}));

// Persist combat state to SQLite (best-effort).
function persistCombat() {
  const s = useStore.getState();
  const sceneId = s.activeSceneId;
  if (!sceneId) return;
  const data = {
    initiativeOrder: s.initiativeOrder,
    combatantStates: s.combatantStates,
    combatantConditions: s.combatantConditions,
    currentRound: s.currentRound,
    currentTurnIndex: s.currentTurnIndex,
    deathSaves: s.deathSaves,
  };
  void backend.saveCombatState(sceneId, JSON.stringify(data));
}

let unlisteners: UnlistenFn[] = [];

export async function subscribeToEvents() {
  if (unlisteners.length) return;
  const get = useStore.getState;
  const fns = await Promise.all([
    listen<LogEntry>("log:new", () => void get().refreshLogs()),
    listen<RollResponse>("dice:rolled", (e) => get().recordRoll(e.payload)),
    listen<FateCheckResponse>("oracle:fate", (e) => get().recordFate(e.payload)),
    listen<EventMeaning>("oracle:event", (e) => get().recordEvent(e.payload)),
    listen<EngineOutcome>("combat:outcome", (e) => {
      useStore.setState((s) => ({
        lastCombat: e.payload,
        combatHistory: [...s.combatHistory.slice(-19), e.payload],
      }));
      persistCombat();
    }),
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
      persistCombat();
    }),
    listen<Scene>("scene:created", async () => {
      const scenes = await backend.listScenes();
      useStore.setState({ scenes });
    }),
  ]);
  unlisteners = fns;
}
