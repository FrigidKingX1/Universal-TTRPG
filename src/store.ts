import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { backend } from "./backend";
import { isInMultiplayerSession, useMultiplayerStore } from "./multiplayer";
import { PRESET_CLASSES, applyClassTemplate } from "./presets/classes";
import { findPresetAction } from "./presets/actions";
import { CONCENTRATION_ACTIONS } from "./presets/actions";
import { playDiceSound, playCombatSfx, sfxForOutcome } from "./sound";
import type {
  ActionDefinition,
  CampaignGenerationResult,
  CharacterProfile,
  CombatantState,
  Disposition,
  DoomClock,
  DmResponse,
  EncounterStatBlock,
  EngineOutcome,
  EpisodicSummary,
  EventMeaning,
  ExplorationNode,
  ExplorationZone,
  ResourcePool,
  FateCheckResponse,
  InitiativeEntry,
  LogEntry,
  NpcCharacter,
  PlotThread,
  PrerequisiteCheck,
  RollResponse,
  Scene,
  StoryLogEntry,
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

  // Toast queue
  toasts: Array<{ id: string; message: string; type: "info" | "success" | "warning" | "error"; duration?: number }>;
  showToast: (message: string, type?: "info" | "success" | "warning" | "error", duration?: number) => void;
  removeToast: (id: string) => void;
  setToast: (msg: string | null) => void;

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

  createCharacter: (name: string, classId?: string) => Promise<void>;
  saveCharacter: (profile: CharacterProfile) => Promise<void>;
  deleteCharacter: (id: string) => Promise<void>;
  dropItemToScene: (characterId: string, item: import("./types").InventoryItem) => Promise<void>;
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
  cloneStatBlock: (id: string) => Promise<void>;
  completeScene: (cfAdjust?: "favor" | "against") => Promise<void>;
  deathSaves: Record<string, { successes: number; failures: number }>;
  rollDeathSave: (entityId: string) => Promise<void>;
  /** entityId → action name the entity is concentrating on. */
  concentration: Record<string, string>;
  dropConcentration: (entityId: string) => void;
  lastHpChange: { entityId: string; previousHp: number; newHp: number } | null;
  undoLastHpChange: () => void;
  exportCampaign: () => Promise<string>;
  importCampaign: (json: string) => Promise<void>;
  autoSave: () => Promise<void>;
  autoSaveTimer: ReturnType<typeof setInterval> | null;
  lastSavedAt: string | null;

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
  updateNpcPillars: (id: string, drive?: string, leverage?: string, flaw?: string) => Promise<void>;
  revealNpcFlaw: (id: string) => Promise<void>;

  // Episodic Summaries
  episodeSummaries: EpisodicSummary[];
  summarizeScene: (sceneId: string) => Promise<void>;

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

  // ── Two-Mode Architecture ──────────────────────────────────────────────
  appMode: "setup" | "tabletop";
  setAppMode: (mode: "setup" | "tabletop") => void;

  // Active character for tabletop mode
  activeCharacter: CharacterProfile | null;
  setActiveCharacter: (profile: CharacterProfile | null) => void;
  selectActiveCharacter: (id: string) => void;

  // Campaign generation pipeline
  generation: { status: "idle" | "generating" | "success" | "error"; progress?: string; result?: CampaignGenerationResult };
  generateCampaign: (concept: string, levelRange?: string, sceneCount?: number) => Promise<void>;

  // Active DM runtime loop
  dmIntent: { loading: boolean; lastResponse: DmResponse | null; streamingText: string };
  processDmIntent: (input: string) => Promise<void>;

  // Story log for narrative stream
  storyLog: StoryLogEntry[];
  addStoryEntry: (entry: Partial<StoryLogEntry>) => void;
  clearStoryLog: () => void;

  // UI chrome shared between App shell and Command Palette
  settingsOpen: boolean;
  shortcutsOpen: boolean;
  activeNav: string;
  setSettingsOpen: (open: boolean) => void;
  setShortcutsOpen: (open: boolean) => void;
  setActiveNav: (nav: string) => void;
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

/** Shared concentration-clearing logic (voluntary drop / toggle-off). */
function dropConcentrationRecord(
  entityId: string,
  set: (fn: (s: AutoDmState) => Partial<AutoDmState>) => void,
): void {
  set((s) => ({
    concentration: Object.fromEntries(Object.entries(s.concentration).filter(([id]) => id !== entityId)),
    combatantConditions: {
      ...s.combatantConditions,
      [entityId]: (s.combatantConditions[entityId] ?? []).filter((c) => c !== "Concentrating"),
    },
  }));
  persistCombat();
}

/**
 * Pools (other than HP) whose reset_condition matches this rest type,
 * restored to maximum — spell slots, rage uses, second wind, etc.
 */
function resetPools(
  pools: Record<string, ResourcePool>,
  condition: "long_rest" | "short_rest",
): Record<string, ResourcePool> {
  const out: Record<string, ResourcePool> = {};
  for (const [name, p] of Object.entries(pools)) {
    if (name !== "hp" && p.reset_condition === condition && p.current < p.maximum) {
      out[name] = { ...p, current: p.maximum };
    }
  }
  return out;
}

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
    resistances: [],
    vulnerabilities: [],
    immunities: [],
    senses: [],
    languages: [],
    condition_immunities: [],
    traits: [],
    multiattack: null,
    reactions: [],
    description: null,
    portrait: null,
    key: null,
  };
}

export const useStore = create<AutoDmState>()(
  subscribeWithSelector((set, get) => ({
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
  concentration: {},
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
  autoSaveTimer: null as ReturnType<typeof setInterval> | null,

  // ── Two-Mode Architecture (initial state) ──────────────────────────────
  appMode: "setup" as const,
  activeCharacter: null,
  generation: { status: "idle" },
  dmIntent: { loading: false, lastResponse: null, streamingText: "" },
  storyLog: [],
  toasts: [],

  // UI chrome
  settingsOpen: false,
  shortcutsOpen: false,
  activeNav: "campaign",
  lastSavedAt: null as string | null,

  bootstrap: async () => {
    set({ loading: true, error: null });
    try {
      await backend.ping();
      await backend.seedDefaults();
      let [characters, actions, statBlocks, scenes, active] = await Promise.all([
        backend.listCharacters(),
        backend.listActions(),
        backend.listStatBlocks(),
        backend.listScenes(),
        backend.activeScene(),
      ]);
      // Crash-recovery: if the DB is empty but a localStorage autosave
      // exists (e.g. after a failed import or crash), offer to restore it.
      if (scenes.length === 0 && characters.length === 0) {
        try {
          const autosave = localStorage.getItem("autodm-autosave");
          if (autosave) {
            const parsed = JSON.parse(autosave);
            // Only restore if it looks like a real campaign (has scenes or characters).
            if (Array.isArray(parsed.scenes) && parsed.scenes.length > 0) {
              await backend.importCampaign(parsed);
              [characters, actions, statBlocks, scenes, active] = await Promise.all([
                backend.listCharacters(),
                backend.listActions(),
                backend.listStatBlocks(),
                backend.listScenes(),
                backend.activeScene(),
              ]);
              get().showToast("Recovered campaign from auto-save", "success", 5000);
            }
          }
        } catch {
          // Recovery is best-effort; fall through to normal empty state.
        }
      }
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
          drive: r.drive ?? undefined,
          leverage: r.leverage ?? undefined,
          flaw: r.flaw ?? undefined,
          flaw_revealed: r.flaw_revealed ?? false,
          created_at: r.created_at,
        }));
      } catch { /* best-effort */ }
      // Load doom clocks.
      let doomClocks: DoomClock[] = [];
      try {
        doomClocks = await backend.listDoomClocks();
      } catch { /* best-effort */ }
      // Load episodic summaries for the active scene.
      let episodeSummaries: EpisodicSummary[] = [];
      if (activeSceneId) {
        try {
          const rows = await backend.listEpisodicSummaries(activeSceneId);
          episodeSummaries = rows.map((r) => ({
            id: r.id,
            scene_id: r.scene_id,
            summary: r.summary,
            last_log_id: r.last_log_id,
            created_at: r.created_at,
          }));
        } catch { /* best-effort */ }
      }
      // Load exploration zones.
      let explorationZones: ExplorationZone[] = [];
      try {
        explorationZones = (await backend.listExplorationZones()) as ExplorationZone[];
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
        episodeSummaries,
        explorationZones,
        // Auto-select the first character so the tabletop command deck and DM
        // context have an actor; the user can change it in the Characters view.
        activeCharacter: get().activeCharacter ?? characters[0] ?? null,
      });
      // Start auto-save timer (every 30 seconds)
      if (!get().autoSaveTimer) {
        const timer = setInterval(() => get().autoSave(), 30000);
        set({ autoSaveTimer: timer });
      }
    } catch (e) {
      set({ loading: false, error: String(e) });
    }
  },

  setError: (msg) => set({ error: msg }),

  dropItemToScene: async (characterId, item) => {
    const s = get();
    const sceneId = s.activeSceneId;
    if (!sceneId) { s.showToast("No active scene — can't drop items"); return; }
    const character = s.characters.find((ch) => ch.id === characterId);
    if (!character) return;
    // Ownership decouples from possession: dropped = unowned scene loot.
    await backend.saveLoot(sceneId, item.name, item.quantity, character.identity.name);
    const updated: import("./types").CharacterProfile = {
      ...character,
      inventory: character.inventory.filter((i) => i.id !== item.id),
    };
    await s.saveCharacter(updated);
    s.showToast(`Dropped ${item.quantity}× ${item.name} on the ground`);
  },

  createCharacter: async (name, classId) => {
    let profile = newCharacter(name || "Unnamed Adventurer");
    if (classId) {
      const template = PRESET_CLASSES.find((c) => c.id === classId);
      if (template) {
        // Install any class-granted actions missing from the vault so
        // attacks resolve locally and via campaign export.
        const existingIds = new Set(get().actions.map((a) => a.id));
        for (const abilityId of template.starting_abilities) {
          if (existingIds.has(abilityId)) continue;
          const def = findPresetAction(abilityId);
          if (def) await backend.saveAction(def);
        }
        set({ actions: await backend.listActions() });
        profile = applyClassTemplate(profile, template);
      }
    }
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
    const characters = await backend.listCharacters();
    set((s) => ({
      characters,
      // Clear or advance the active character if it was deleted.
      activeCharacter:
        s.activeCharacter?.id === id ? characters[0] ?? null : s.activeCharacter,
    }));
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
    const [logs, lootRows, noteRows, scenes] = await Promise.all([
      backend.listLogs(id, 200),
      backend.listLoot(id).catch(() => []),
      backend.listNpcNotes(id).catch(() => []),
      backend.listScenes(),
    ]);
    const loot: LootEntry[] = lootRows.map((r) => ({
      id: r.id,
      name: r.name,
      quantity: r.quantity,
      assignedTo: r.assigned_to,
      sourceEntity: r.source_entity,
      timestamp: r.timestamp,
    }));
    const npcNotes: NpcNote[] = noteRows.map((r) => ({
      id: r.id,
      npcName: r.npc_name,
      relation: r.relation,
      note: r.note,
      timestamp: r.timestamp,
    }));
    set({ activeSceneId: id, logs, loot, npcNotes, scenes });
  },

  deleteScene: async (id) => {
    await backend.deleteScene(id);
    const scenes = await backend.listScenes();
    let activeSceneId = get().activeSceneId;
    if (activeSceneId === id) {
      const active = await backend.activeScene();
      activeSceneId = active ? active.id : null;
    }
    const shouldReload = activeSceneId && activeSceneId !== id;
    const [logs, lootRows, noteRows] = shouldReload
      ? await Promise.all([
          backend.listLogs(activeSceneId!, 200),
          backend.listLoot(activeSceneId!).catch(() => []),
          backend.listNpcNotes(activeSceneId!).catch(() => []),
        ])
      : ([[], [], []] as unknown as [
          import("./types").LogEntry[],
          import("./backend").LootRow[],
          import("./backend").NpcNoteRow[],
        ]);
    const loot: LootEntry[] = (lootRows as import("./backend").LootRow[]).map((r) => ({
      id: r.id,
      name: r.name,
      quantity: r.quantity,
      assignedTo: r.assigned_to,
      sourceEntity: r.source_entity,
      timestamp: r.timestamp,
    }));
    const npcNotes: NpcNote[] = (noteRows as import("./backend").NpcNoteRow[]).map((r) => ({
      id: r.id,
      npcName: r.npc_name,
      relation: r.relation,
      note: r.note,
      timestamp: r.timestamp,
    }));
    set({ scenes, activeSceneId, logs, loot, npcNotes });
  },

  refreshLogs: async () => {
    const id = get().activeSceneId;
    if (!id) return;
    const logs = await backend.listLogs(id, 200);
    set((s) => ({
      logs,
      // Seed the tabletop story log from persisted history so returning to a
      // session shows prior entries instead of starting empty. Only seeds when
      // the in-memory log is empty to avoid duplicating live entries.
      storyLog:
        s.storyLog.length === 0
          ? logs.map((l) => ({
              id: l.id,
              speaker: l.speaker,
              role: logSpeakerToRole(l.speaker),
              content: l.content,
              timestamp: l.timestamp,
            }))
          : s.storyLog,
    }));
  },

  recordRoll: (r) => set((s) => ({ lastRoll: r, rollHistory: [...s.rollHistory.slice(-49), r] })),
  recordFate: (f) => set((s) => ({ lastFate: f, fateHistory: [...s.fateHistory.slice(-19), f] })),
  recordEvent: (e) => set((s) => ({ lastEvent: e, eventHistory: [...s.eventHistory.slice(-19), e] })),

  resolveDmAction: async (playerAction) => {
    const s = useStore.getState();
    const scene = s.scenes.find((sc) => sc.id === s.activeSceneId);

    const request = {
      scene_summary: scene?.summary_text ?? scene?.title ?? "",
      player_action: playerAction,
      chaos_factor: scene?.chaos_factor ?? 5,
      memory_context: void 0,
      lines: [],
      veils: [],
      scene_id: s.activeSceneId ?? undefined,
      num_predict: get().ollama.numPredict,
    };

    let response: DmResponse;

    if (isInMultiplayerSession()) {
      const mp = useMultiplayerStore.getState();
      response = await mp.resolveAction(request);
    } else {
      response = await backend.dmResolve(request);
    }

    set((s) => ({ lastDm: response, dmHistory: [...s.dmHistory.slice(-19), response] }));

    if (scene && response.narrative) {
      // In multiplayer mode the server handles scene summary + log writes.
      if (!isInMultiplayerSession()) {
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
      }
    }

    if (!isInMultiplayerSession()) {
      await get().ingestToMemory("Auto-DM", response.narrative);
      await get().ingestToMemory("Player", playerAction);
    }

    try {
      await get().refreshLogs();
    } catch {
      // Best-effort refresh; the response is already in state.
    }
  },

  pollOllamaModels: async () => {
    try {
      const [models, currentModel, numPredict] = await Promise.all([
        backend.ollamaModels(),
        backend.getOllamaModel(),
        backend.getOllamaNumPredict().catch(() => 512),
      ]);
      set((s) => ({ ollama: { ...s.ollama, reachable: true, models, currentModel, numPredict } }));
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
    // Spell-slot gate: character casters must have the pool to spend.
    const action = get().actions.find((a) => a.id === actionId);
    const slotCost = action?.slot_cost;
    const casterIsChar = "identity" in attacker;
    if (slotCost && casterIsChar) {
      const pool = attacker.resource_pools[slotCost.pool];
      if ((pool?.current ?? 0) < slotCost.amount) {
        get().showToast(`No ${slotCost.pool.replace(/_/g, " ")} left for ${action!.name}!`);
        const blocked: EngineOutcome = {
          check_result: undefined,
          check_roll: undefined,
          check_detail: undefined,
          attack_result: "NO_SLOTS",
          attack_roll: undefined,
          attack_detail: undefined,
          target_ac: undefined,
          damage_dealt: 0,
          heal_amount: 0,
          target_hp_remaining: "hit_points" in target ? target.hit_points.current : target.resource_pools.hp?.current ?? 0,
          target_status: "ALIVE",
          applied_status: undefined,
          damage_type: undefined,
          damage_modifier: undefined,
        };
        set({ lastCombat: blocked });
        return blocked;
      }
    }
    const prevHp = get().combatantStates[target.id]?.hit_points ?? ("resource_pools" in target ? target.resource_pools.hp?.current ?? 0 : target.hit_points.current);
    // Overlay live combat HP so wounded targets don't reset to DB values,
    // and thread live conditions so advantage/disadvantage fires in the engine.
    const states = get().combatantStates;
    const liveTarget = states[target.id]
      ? ("hit_points" in target
        ? { ...target, hit_points: { ...target.hit_points, current: states[target.id].hit_points } }
        : { ...target, resource_pools: { ...target.resource_pools, hp: { ...target.resource_pools.hp!, current: states[target.id].hit_points } } })
      : target;

    let outcome;
    if (isInMultiplayerSession()) {
      const client = (await import("./multiplayer")).getMultiplayerClient();
      outcome = await client!.combatAttack(
        attacker,
        liveTarget,
        actionId,
        prereq ?? null,
        get().combatantConditions[attacker.id] ?? [],
        get().combatantConditions[target.id] ?? [],
      );
    } else {
      outcome = await backend.combatAttack(
        attacker,
        liveTarget,
        actionId,
        prereq ?? null,
        sceneId,
        get().combatantConditions[attacker.id] ?? [],
        get().combatantConditions[target.id] ?? [],
      );
    }
    playCombatSfx(sfxForOutcome(outcome));
    // Expend the declared resource (the spell was cast — hit or miss).
    if (slotCost && casterIsChar) {
      const caster = get().characters.find((c) => c.id === attacker.id);
      const pool = caster?.resource_pools[slotCost.pool];
      if (caster && pool) {
        const remaining = Math.max(0, pool.current - slotCost.amount);
        await get().saveCharacter({
          ...caster,
          resource_pools: {
            ...caster.resource_pools,
            [slotCost.pool]: { ...pool, current: remaining },
          },
        });
        get().showToast(`${action!.name}: ${remaining}/${pool.maximum} ${slotCost.pool.replace(/_/g, " ")} left`);
      }
    }
    // Concentration: starting a concentration spell ends the caster's
    // previous one (5e RAW — only one at a time).
    if (action && CONCENTRATION_ACTIONS.has(action.id) && "identity" in attacker) {
      const prior = get().concentration[attacker.id];
      set((s) => ({
        concentration: { ...s.concentration, [attacker.id]: action.name },
        combatantConditions: {
          ...s.combatantConditions,
          [attacker.id]: [
            ...(s.combatantConditions[attacker.id] ?? []).filter((c) => c !== "Concentrating"),
            "Concentrating",
          ],
        },
      }));
      if (prior && prior !== action.name) {
        get().showToast(`${attacker.identity.name} stops concentrating on ${prior}`);
      }
      persistCombat();
    }
    // Concentration save: damaged casters roll CON vs DC 10 or half damage.
    if (
      outcome.damage_dealt > 0 &&
      (get().combatantConditions[target.id] ?? []).some((c) => c === "Concentrating")
    ) {
      const dc = Math.max(10, Math.floor(outcome.damage_dealt / 2));
      let conMod: number;
      if ("identity" in target) {
        const a = target.attributes.CON;
        conMod = a?.derived_modifier ?? Math.floor(((a?.base_value ?? 10) - 10) / 2);
      } else {
        conMod = Math.floor((((target.attributes.CON as number | undefined) ?? 10) - 10) / 2);
      }
      playDiceSound();
      const save = await backend.rollDice(`1d20 + ${conMod}`);
      const broke = save.total < dc;
      if (broke) {
        const spellName = get().concentration[target.id];
        set((s) => ({
          concentration: Object.fromEntries(Object.entries(s.concentration).filter(([id]) => id !== target.id)),
          combatantConditions: {
            ...s.combatantConditions,
            [target.id]: (s.combatantConditions[target.id] ?? []).filter((c) => c !== "Concentrating"),
          },
        }));
        get().showToast(`${entityName(target)} takes ${outcome.damage_dealt} and loses concentration${spellName ? ` on ${spellName}` : ""}!`);
        persistCombat();
      }
    }
    // Incapacitation ends concentration outright.
    if (
      outcome.target_status === "DEFEATED" &&
      get().concentration[target.id]
    ) {
      set((s) => ({
        concentration: Object.fromEntries(Object.entries(s.concentration).filter(([id]) => id !== target.id)),
        combatantConditions: {
          ...s.combatantConditions,
          [target.id]: (s.combatantConditions[target.id] ?? []).filter((c) => c !== "Concentrating"),
        },
      }));
      persistCombat();
    }
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
    let order;
    if (isInMultiplayerSession()) {
      const client = (await import("./multiplayer")).getMultiplayerClient();
      order = await client!.rollInitiative(combatants, formula ?? "");
    } else {
      order = await backend.initiative(combatants, formula ?? "");
    }
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
    let recharged = 0;
    for (const c of s.characters) {
      const currentStates = useStore.getState().combatantStates;
      const max = c.resource_pools.hp?.maximum ?? 10;
      const current = currentStates[c.id]?.hit_points ?? c.resource_pools.hp?.current ?? 0;
      const poolResets = resetPools(c.resource_pools, "long_rest");
      const needsPools = Object.keys(poolResets).length > 0;
      if (current >= max && !needsPools) continue;
      if (current < max) {
        // Route through the engine's apply_healing: max-clamped, revives,
        // clears conditions — one source of truth for healing rules.
        if (isInMultiplayerSession()) {
          try {
            const client = (await import("./multiplayer")).getMultiplayerClient();
            await client?.combatHeal(c, max - current);
          } catch { /* fall back to direct save below */ }
        } else {
          try {
            await backend.combatHeal(c, max - current);
          } catch { /* fall back to direct save below */ }
        }
      }
      await s.saveCharacter({
        ...c,
        resource_pools: {
          ...c.resource_pools,
          ...(current < max ? { hp: { ...c.resource_pools.hp!, current: max } } : {}),
          ...poolResets,
        },
      });
      if (current < max) {
        const latest = useStore.getState().combatantStates;
        useStore.setState({
          combatantStates: {
            ...latest,
            [c.id]: { ...latest[c.id], hit_points: max },
          },
        });
        healed++;
      }
      if (needsPools) recharged++;
    }
    get().showToast(`Long Rest: ${healed} character${healed !== 1 ? "s" : ""} healed to full${recharged > 0 ? `, ${recharged} recharged` : ""}`);
    if (s.activeSceneId && (healed > 0 || recharged > 0)) {
      await backend.appendLog(s.activeSceneId, "System", `Party takes a Long Rest. ${healed} character${healed !== 1 ? "s" : ""} fully healed${recharged > 0 ? `, ${recharged} pool${recharged !== 1 ? "s" : ""} recharged` : ""}.`);
    }
    persistCombat();
  },

  shortRest: async () => {
    const s = useStore.getState();
    let healed = 0;
    let recharged = 0;
    for (const c of s.characters) {
      const currentStates = useStore.getState().combatantStates;
      const max = c.resource_pools.hp?.maximum ?? 10;
      const current = currentStates[c.id]?.hit_points ?? c.resource_pools.hp?.current ?? 0;
      const halfMax = Math.floor(max / 2);
      const poolResets = resetPools(c.resource_pools, "short_rest");
      const needsPools = Object.keys(poolResets).length > 0;
      const wounded = current < max && halfMax > 0;
      if (!wounded && !needsPools) continue;
      let newHp = current;
      if (wounded) {
        newHp = current + Math.min(halfMax, max - current);
        if (isInMultiplayerSession()) {
          try {
            const client = (await import("./multiplayer")).getMultiplayerClient();
            await client?.combatHeal(c, newHp - current);
          } catch { /* fall through to direct save */ }
        } else {
          try {
            await backend.combatHeal(c, newHp - current);
          } catch { /* fall through to direct save */ }
        }
      }
      await s.saveCharacter({
        ...c,
        resource_pools: {
          ...c.resource_pools,
          ...(wounded ? { hp: { ...c.resource_pools.hp!, current: newHp } } : {}),
          ...poolResets,
        },
      });
      if (wounded) {
        const latest = useStore.getState().combatantStates;
        useStore.setState({
          combatantStates: {
            ...latest,
            [c.id]: { ...latest[c.id], hit_points: newHp },
          },
        });
        healed++;
      }
      if (needsPools) recharged++;
    }
    get().showToast(`Short Rest: ${healed} character${healed !== 1 ? "s" : ""} recovered HP${recharged > 0 ? `, ${recharged} recharged` : ""}`);
    if (s.activeSceneId && (healed > 0 || recharged > 0)) {
      await backend.appendLog(s.activeSceneId, "System", `Party takes a Short Rest. ${healed} character${healed !== 1 ? "s" : ""} recovered hit points${recharged > 0 ? `, ${recharged} pool${recharged !== 1 ? "s" : ""} recharged` : ""}.`);
    }
    persistCombat();
  },

  toggleCondition: (entityId, condition) => {
    set((s) => {
      const current = s.combatantConditions[entityId] ?? [];
      const updated = current.includes(condition)
        ? current.filter((c) => c !== condition)
        : [...current, condition];
      return { combatantConditions: { ...s.combatantConditions, [entityId]: updated } };
    });
    persistCombat();
    if (condition === "Concentrating") dropConcentrationRecord(entityId, set);
    // Fire-and-forget: sync condition to server in multiplayer.
    if (isInMultiplayerSession()) {
      const current = get().combatantConditions[entityId] ?? [];
      const add = current.includes(condition);
      (async () => {
        try {
          const client = (await import("./multiplayer")).getMultiplayerClient();
          await client?.combatCondition(entityId, condition, add);        } catch { /* best-effort */ }
      })();
    }
  },

  dropConcentration: (entityId) => {
    dropConcentrationRecord(entityId, set);
  },

  showToast: (message: string, type: "info" | "success" | "warning" | "error" = "info", duration = 3000) => {
    const id = crypto.randomUUID();
    set((s) => ({
      // Cap the visible queue so rapid actions can't stack unbounded.
      toasts: [...s.toasts, { id, message, type, duration }].slice(-4),
      toast: message,
    }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id), toast: s.toasts.length > 1 ? s.toasts[s.toasts.length - 2].message : null }));
    }, duration);
  },
  removeToast: (id: string) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  // Legacy single toast support
  setToast: (msg: string | null) => set({ toast: msg }),

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
    playDiceSound();
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

  autoSave: async () => {
    try {
      const data = await backend.exportCampaign();
      const json = JSON.stringify(data);
      localStorage.setItem("autodm-autosave", json);
      set({ lastSavedAt: new Date().toISOString() });
    } catch (e) {
      const msg = String(e);
      if (msg.includes("QuotaExceeded") || msg.includes("quota") || msg.includes("storage")) {
        get().showToast("Auto-save failed: storage full — export your campaign", "warning", 6000);
      }
    }
  },

  setNumPredict: (n) => {
    const clamped = Math.max(64, Math.min(2048, n));
    set((s) => ({ ollama: { ...s.ollama, numPredict: clamped } }));
    void backend.setOllamaNumPredict(clamped).catch(() => {});
  },

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
        drive: row.drive ?? undefined,
        leverage: row.leverage ?? undefined,
        flaw: row.flaw ?? undefined,
        flaw_revealed: row.flaw_revealed ?? false,
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

  updateNpcPillars: async (id, drive, leverage, flaw) => {
    try {
      await backend.updateNpcPillars(id, drive, leverage, flaw);
      set((s) => ({
        npcCharacters: s.npcCharacters.map((n) =>
          n.id === id ? { ...n, drive, leverage, flaw } : n
        ),
      }));
    } catch (e) {
      get().showToast(`Error: ${e}`);
    }
  },

  revealNpcFlaw: async (id) => {
    try {
      await backend.revealFlaw(id);
      set((s) => ({
        npcCharacters: s.npcCharacters.map((n) =>
          n.id === id ? { ...n, flaw_revealed: true } : n
        ),
      }));
      get().showToast("Flaw revealed!");
    } catch (e) {
      get().showToast(`Error: ${e}`);
    }
  },

  // ── Episodic Summaries ──────────────────────────────────────────

  episodeSummaries: [],

  summarizeScene: async (sceneId) => {
    try {
      get().showToast("Generating episode summary...");
      const row = await backend.summarizeScene(sceneId);
      const summary: EpisodicSummary = {
        id: row.id,
        scene_id: row.scene_id,
        summary: row.summary,
        last_log_id: row.last_log_id,
        created_at: row.created_at,
      };
      set((s) => ({ episodeSummaries: [...s.episodeSummaries, summary] }));
      get().showToast("Episode summary generated!");
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
        const [current] = result;
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
      set((s) => ({ explorationZones: [...s.explorationZones, zone as ExplorationZone] }));
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
    // Random encounter check: seeded d10 vs zone danger level (deterministic
    // engine, logged like every other roll).
    const zone = get().explorationZones.find((z) => z.id === activeZoneId);
    const dangerLevel = zone?.danger_level ?? 0;
    let encounter: string | null = null;
    if (dangerLevel > 0) {
      try {
        const roll = await backend.rollDice("1d10");
        if (roll.total <= dangerLevel) {
          encounter = `Random encounter! (rolled ${roll.total} vs danger ${dangerLevel})`;
          get().showToast(encounter);
        }
      } catch {
        // Roll failure shouldn't block travel.
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

  // ── Two-Mode Architecture Actions ──────────────────────────────────────

  setAppMode: (mode) => set({ appMode: mode }),
  setActiveCharacter: (profile) => set({ activeCharacter: profile, appMode: "tabletop" }),
  selectActiveCharacter: (id) =>
    set((s) => ({ activeCharacter: s.characters.find((c) => c.id === id) ?? null })),

  // UI chrome actions
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setShortcutsOpen: (open) => set({ shortcutsOpen: open }),
  setActiveNav: (nav) => set({ activeNav: nav }),

  generateCampaign: async (concept: string, levelRange?: string, sceneCount?: number) => {
    set({ generation: { status: "generating", progress: "Generating campaign..." } });
    try {
      const result = await backend.generateCampaign(concept, levelRange, sceneCount);
      get().showToast(`Campaign "${result.campaign_title}" generated!`);

      // The backend persists the campaign in SQLite via a single transaction.
      // Refresh the store to pick up the new data.
      await get().bootstrap();
      set({ generation: { status: "success", result }, appMode: "tabletop" });
    } catch (e) {
      get().setError(String(e));
      set({ generation: { status: "error" }, appMode: "setup" });
    }
  },

  processDmIntent: async (input: string) => {
    const { activeSceneId, activeCharacter: char, scenes } = get();
    const scene = activeSceneId ? scenes.find((s) => s.id === activeSceneId) : null;
    if (!scene) return;

    set((s) => ({ dmIntent: { ...s.dmIntent, loading: true, streamingText: "" } }));

    try {
      const request = {
        scene_summary: scene.summary_text || scene.title,
        player_action: input,
        chaos_factor: scene.chaos_factor,
        memory_context: char?.identity.name ? `${char.identity.name} is acting` : undefined,
        lines: [],
        veils: [],
        scene_id: activeSceneId ?? undefined,
        num_predict: get().ollama.numPredict,
      };

      let response: DmResponse;

      if (isInMultiplayerSession()) {
        // Route through the server — the server handles LLM, effects, broadcast.
        const mp = useMultiplayerStore.getState();
        response = await mp.resolveAction(request);
        // Server handles scene summary, log writes, memory — skip local DB writes.
      } else {
        // Solo path — Tauri IPC to local engine.
        response = await backend.processDmIntent(request);
      }

      set({ dmIntent: { loading: false, lastResponse: response, streamingText: "" } });

      if (response.narrative) {
        get().addStoryEntry({
          speaker: "Dungeon Master",
          role: "narrator",
          content: response.narrative,
        });
      }

      get().addStoryEntry({
        speaker: "Player",
        role: "player",
        content: input,
      });

      // Mechanical events from the DM pipeline
      for (const mech of response.mechanical_events) {
        get().addStoryEntry({
          speaker: "System",
          role: "system",
          content: mech,
        });
      }

      // Fate interpretation
      if (response.fate_interpretation) {
        get().addStoryEntry({
          speaker: "Oracle",
          role: "narrator",
          content: response.fate_interpretation,
        });
      }

      // Update Chaos Factor if the backend adjusted it
      if (response.chaos_factor !== undefined && response.chaos_factor !== scene.chaos_factor) {
        set((s) => ({
          scenes: s.scenes.map((sc) =>
            sc.id === activeSceneId ? { ...sc, chaos_factor: response.chaos_factor } : sc
          ),
        }));
        // In multiplayer mode the server persists this; solo needs local write.
        if (!isInMultiplayerSession()) {
          try {
            await backend.updateSceneChaosFactor(scene.id, response.chaos_factor);
          } catch { /* best-effort */ }
        }
      }

      // Solo: refresh logs from local DB. Multiplayer: server pushes via resync.
      if (!isInMultiplayerSession()) {
        await get().refreshLogs();
      }
    } catch (e) {
      get().setError(String(e));
      set({ dmIntent: { loading: false, lastResponse: null, streamingText: "" } });
    }
  },

  addStoryEntry: (entry: Partial<StoryLogEntry>) => {
    const populated: StoryLogEntry = {
      id: entry.id ?? crypto.randomUUID(),
      speaker: entry.speaker ?? "System",
      role: entry.role ?? "system",
      content: entry.content ?? "",
      timestamp: entry.timestamp ?? new Date().toISOString(),
    };
    set((s) => ({
      storyLog: [...s.storyLog, populated],
    }));
  },

  clearStoryLog: () => set({ storyLog: [] }),
})));

// Debounced autosave: prevents write-chatter where every Zustand mutation
// would trigger a Tauri IPC payload. Waits 800 ms after the last relevant
// state change before flushing to disk via exportCampaign.
let autosaveDebounce: ReturnType<typeof setTimeout>;
useStore.subscribe((state, prevState) => {
  if (
    state.characters !== prevState.characters ||
    state.scenes !== prevState.scenes ||
    state.plotThreads !== prevState.plotThreads ||
    state.npcCharacters !== prevState.npcCharacters ||
    state.doomClocks !== prevState.doomClocks ||
    state.explorationZones !== prevState.explorationZones ||
    state.explorationNodes !== prevState.explorationNodes
  ) {
    clearTimeout(autosaveDebounce);
    autosaveDebounce = setTimeout(() => {
      void useStore.getState().autoSave();
    }, 800);
  }
});

// Persist combat state to SQLite (best-effort).
function logSpeakerToRole(speaker: string): StoryLogEntry["role"] {
  const s = speaker.toLowerCase();
  if (s === "player") return "player";
  if (s === "dungeon master" || s === "dm" || s === "narrator") return "narrator";
  if (s === "combat") return "combat";
  if (s === "oracle" || s === "system") return "system";
  return "npc";
}

let persistCombatTimer: ReturnType<typeof setTimeout> | null = null;
function persistCombat() {
  if (persistCombatTimer) clearTimeout(persistCombatTimer);
  persistCombatTimer = setTimeout(() => {
    persistCombatTimer = null;
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

    // In multiplayer, push the full combatant list to the server so all
    // clients see the same HP / status / conditions.  This is debounced
    // together with local persistence to avoid flooding the server.
    if (isInMultiplayerSession()) {
      syncCombatantsToServer(s);
    }
  }, 300);
}

let syncCombatantsTimer: ReturnType<typeof setTimeout> | null = null;
function syncCombatantsToServer(s: ReturnType<typeof useStore.getState>) {
  if (syncCombatantsTimer) clearTimeout(syncCombatantsTimer);
  syncCombatantsTimer = setTimeout(async () => {
    syncCombatantsTimer = null;
    try {
      const client = (await import("./multiplayer")).getMultiplayerClient();
      if (!client) return;

      const states = s.combatantStates;
      const conditions = s.combatantConditions;

      // Build the full combatant JSON list from characters + stat blocks,
      // overlaying live HP from combatantStates so the server gets the
      // authoritative current values.
      const combatants: unknown[] = [
        ...s.characters.map((c) => {
          const live = states[c.id];
          if (!live) return c;
          return {
            ...c,
            resource_pools: {
              ...c.resource_pools,
              hp: { ...c.resource_pools.hp, current: live.hit_points },
            },
          };
        }),
        ...s.statBlocks.map((b) => {
          const live = states[b.id];
          if (!live) return b;
          return {
            ...b,
            hit_points: { ...b.hit_points, current: live.hit_points },
          };
        }),
      ];

      await client.combatSync(combatants, conditions);
    } catch {
      // best-effort — don't block the UI
    }
  }, 100);
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
      // Keep monster HP in sync too so damage accumulates across attacks
      // instead of resetting to DB values on every swing.
      const statBlocks = s.statBlocks.map((b) =>
        b.id === p.id ? { ...b, hit_points: { ...b.hit_points, current: p.hit_points } } : b,
      );
      useStore.setState({ combatantStates: updated, characters, statBlocks });
      persistCombat();
    }),
    listen<Scene>("scene:created", async () => {
      const scenes = await backend.listScenes();
      useStore.setState({ scenes });
    }),
    listen<string>("dm:token", (e) => {
      useStore.setState((s) => ({
        dmIntent: { ...s.dmIntent, streamingText: s.dmIntent.streamingText + e.payload },
      }));
    }),
  ]);
  unlisteners = fns;
}
