import { invoke } from "@tauri-apps/api/core";
import type {
  ActionDefinition,
  CharacterProfile,
  CombatantState,
  DoomClock,
  DmRequest,
  DmResponse,
  EncounterStatBlock,
  EngineOutcome,
  EventMeaning,
  FateCheckResponse,
  InitiativeEntry,
  LogEntry,
  OddsName,
  PrerequisiteCheck,
  RollResponse,
  Scene,
} from "./types";

// NOTE: Tauri converts Rust snake_case command args to camelCase on the JS side.

export const backend = {
  ping: () => invoke<string>("ping"),

  // Characters
  saveCharacter: (profile: CharacterProfile) =>
    invoke<CharacterProfile>("save_character", { profile }),
  loadCharacter: (id: string) =>
    invoke<CharacterProfile | null>("load_character", { id }),
  listCharacters: () => invoke<CharacterProfile[]>("list_characters"),
  deleteCharacter: (id: string) =>
    invoke<boolean>("delete_character", { id }),

  // Actions
  saveAction: (action: ActionDefinition) =>
    invoke<ActionDefinition>("save_action", { action }),
  listActions: () => invoke<ActionDefinition[]>("list_actions"),
  deleteAction: (id: string) => invoke<boolean>("delete_action", { id }),

  // Stat blocks
  saveStatBlock: (block: EncounterStatBlock) =>
    invoke<EncounterStatBlock>("save_stat_block", { block }),
  listStatBlocks: () => invoke<EncounterStatBlock[]>("list_stat_blocks"),
  deleteStatBlock: (id: string) =>
    invoke<boolean>("delete_stat_block", { id }),

  // Scenes
  createScene: (title: string, chaosFactor: number) =>
    invoke<Scene>("create_scene", { title, chaosFactor }),
  listScenes: () => invoke<Scene[]>("list_scenes"),
  activeScene: () => invoke<Scene | null>("active_scene"),
  setActiveScene: (id: string) =>
    invoke<void>("set_active_scene", { id }),
  deleteScene: (id: string) => invoke<boolean>("delete_scene", { id }),
  updateSceneSummary: (id: string, summary: string | null) =>
    invoke<void>("update_scene_summary", { id, summary }),
  updateSceneChaosFactor: (id: string, chaosFactor: number) =>
    invoke<void>("update_scene_chaos_factor", { id, chaosFactor }),

  // Log
  appendLog: (sceneId: string, speaker: string, content: string) =>
    invoke<LogEntry>("append_log", { sceneId, speaker, content }),
  listLogs: (sceneId: string, limit: number) =>
    invoke<LogEntry[]>("list_logs", { sceneId, limit }),

  // Dice
  rollDice: (expression: string, seed?: number) =>
    invoke<RollResponse>("roll_dice", { expression, seed }),

  // DM loop
  dmResolve: (request: DmRequest) =>
    invoke<DmResponse>("dm_resolve", { request }),

  // Oracle
  fateCheck: (odds: OddsName, chaosFactor: number, seed?: number) =>
    invoke<FateCheckResponse>("fate_check", { odds, chaosFactor, seed }),
  randomEvent: (chaosFactor: number, seed?: number) =>
    invoke<EventMeaning>("random_event", { chaosFactor, seed }),

  // Scene Test (Mythic)
  sceneTest: (chaosFactor: number, seed?: number) =>
    invoke<SceneTestResponse>("scene_test_cmd", { chaosFactor, seed }),

  // Lines & Veils safety
  getLinesVeils: () =>
    invoke<{ lines: string[]; veils: string[] }>("get_lines_veils"),
  setLinesVeils: (lines: string[], veils: string[]) =>
    invoke<void>("set_lines_veils", { lines, veils }),

  // Doom Clocks
  createDoomClock: (label: string, max: number, consequence: string, sceneId?: string) =>
    invoke<DoomClock>("create_doom_clock", { label, max, consequence, sceneId }),
  listDoomClocks: () => invoke<DoomClock[]>("list_doom_clocks"),
  tickDoomClock: (id: string) =>
    invoke<[number, number] | null>("tick_doom_clock", { id }),
  advanceDoomClock: (id: string, ticks: number) =>
    invoke<[number, number] | null>("advance_doom_clock", { id, ticks }),
  resetDoomClock: (id: string) =>
    invoke<void>("reset_doom_clock", { id }),
  deleteDoomClock: (id: string) =>
    invoke<boolean>("delete_doom_clock", { id }),

  // Exploration
  createExplorationZone: (name: string, zoneType: string, description?: string, dangerLevel?: number) =>
    invoke<{ id: string; name: string; zone_type: string; description: string | null; danger_level: number; mapped: boolean }>(
      "create_exploration_zone", { name, zoneType, description, dangerLevel },
    ),
  listExplorationZones: () =>
    invoke<{ id: string; name: string; zone_type: string; description: string | null; danger_level: number; mapped: boolean }[]>(
      "list_exploration_zones",
    ),
  deleteExplorationZone: (id: string) =>
    invoke<boolean>("delete_exploration_zone", { id }),
  createExplorationNode: (zoneId: string, name: string, description?: string) =>
    invoke<{ id: string; zone_id: string; name: string; discovered: boolean; safe: boolean; description: string | null; connections: string[]; contents: string[]; notes: string | null }>(
      "create_exploration_node", { zoneId, name, description },
    ),
  listExplorationNodes: (zoneId: string) =>
    invoke<{ id: string; zone_id: string; name: string; discovered: boolean; safe: boolean; description: string | null; connections: string[]; contents: string[]; notes: string | null }[]>(
      "list_exploration_nodes", { zoneId },
    ),
  updateExplorationNode: (id: string, discovered?: boolean, safe?: boolean, description?: string, connectionsJson?: string, contentsJson?: string, notes?: string) =>
    invoke<void>("update_exploration_node", { id, discovered, safe, description, connectionsJson, contentsJson, notes }),
  deleteExplorationNode: (id: string) =>
    invoke<boolean>("delete_exploration_node", { id }),

  // Combat
  combatAttack: (
    attacker: CharacterProfile | EncounterStatBlock,
    target: CharacterProfile | EncounterStatBlock,
    actionId: string,
    prereq: PrerequisiteCheck | null,
    sceneId?: string,
  ) =>
    invoke<EngineOutcome>("combat_attack", {
      attacker,
      target,
      actionId,
      prereq,
      sceneId,
    }),
  initiative: (
    combatants: (CharacterProfile | EncounterStatBlock)[],
    formula: string,
  ) =>
    invoke<InitiativeEntry[]>("initiative", { combatants, formula }),

  // Seed
  seedDefaults: () => invoke<void>("seed_defaults"),

  // Ollama
  ollamaModels: () => invoke<string[]>("ollama_models"),
  getOllamaModel: () => invoke<string>("get_ollama_model"),
  setOllamaModel: (model: string) => invoke<void>("set_ollama_model", { model }),
  ingestMemory: (speaker: string, content: string) =>
    invoke<void>("ingest_memory", { speaker, content }),

  // Export / Import
  exportCampaign: () => invoke<CampaignExport>("export_campaign"),
  importCampaign: (data: CampaignExport) =>
    invoke<void>("import_campaign", { data }),

  // Loot (SQLite)
  saveLoot: (sceneId: string, name: string, quantity: number, sourceEntity: string) =>
    invoke<LootRow>("save_loot", { sceneId, name, quantity, sourceEntity }),
  assignLootToCharacter: (lootId: string, characterId: string) =>
    invoke<void>("assign_loot", { lootId, characterId }),
  listLoot: (sceneId: string) =>
    invoke<LootRow[]>("list_loot", { sceneId }),
  clearLootInScene: (sceneId: string) =>
    invoke<void>("clear_loot", { sceneId }),
  rollMonsterLoot: (statBlockId: string, sceneId: string) =>
    invoke<LootRow[]>("roll_monster_loot", { statBlockId, sceneId }),

  // NPC Notes (SQLite)
  saveNpcNote: (sceneId: string, npcName: string, relation: string, note: string) =>
    invoke<NpcNoteRow>("save_npc_note", { sceneId, npcName, relation, note }),
  listNpcNotes: (sceneId: string) =>
    invoke<NpcNoteRow[]>("list_npc_notes", { sceneId }),
  deleteNpcNote: (id: string) =>
    invoke<boolean>("delete_npc_note", { id }),

  // Combat state persistence
  saveCombatState: (sceneId: string, stateJson: string) =>
    invoke<void>("save_combat_state", { sceneId, stateJson }),
  loadCombatState: (sceneId: string) =>
    invoke<string | null>("load_combat_state", { sceneId }),

  // Plot Threads
  saveThread: (description: string, status: string, openedSceneId: string, resolvedSceneId?: string) =>
    invoke<ThreadRow>("save_thread", { description, status, openedSceneId, resolvedSceneId }),
  updateThreadStatus: (id: string, status: string, resolvedSceneId?: string) =>
    invoke<void>("update_thread_status", { id, status, resolvedSceneId }),
  listThreads: () =>
    invoke<ThreadRow[]>("list_threads"),
  deleteThread: (id: string) =>
    invoke<boolean>("delete_thread", { id }),

  // NPC Characters
  saveNpcCharacter: (name: string, disposition: string, alive: boolean, location?: string, knowsJson?: string, notes?: string, lastSeenSceneId?: string) =>
    invoke<NpcCharacterRow>("save_npc_character", { name, disposition, alive, location, knowsJson: knowsJson ?? "[]", notes, lastSeenSceneId }),
  updateNpcCharacter: (id: string, disposition?: string, alive?: boolean, location?: string, knowsJson?: string, notes?: string, lastSeenSceneId?: string) =>
    invoke<void>("update_npc_character", { id, disposition, alive, location, knowsJson, notes, lastSeenSceneId }),
  listNpcCharacters: () =>
    invoke<NpcCharacterRow[]>("list_npc_characters"),
  deleteNpcCharacter: (id: string) =>
    invoke<boolean>("delete_npc_character", { id }),
};

export interface CampaignExport {
  characters: CharacterProfile[];
  actions: ActionDefinition[];
  stat_blocks: EncounterStatBlock[];
  scenes: Scene[];
  logs: LogEntry[];
  loot: LootRow[];
  npc_notes: NpcNoteRow[];
  plot_threads: ThreadRow[];
  npc_characters: NpcCharacterRow[];
}

export interface LootRow {
  id: string;
  scene_id: string;
  name: string;
  quantity: number;
  source_entity: string;
  assigned_to: string | null;
  timestamp: string;
}

export interface NpcNoteRow {
  id: string;
  scene_id: string;
  npc_name: string;
  relation: string;
  note: string;
  timestamp: string;
}

export interface ThreadRow {
  id: string;
  description: string;
  status: string;
  opened_scene_id: string;
  resolved_scene_id: string | null;
  created_at: string;
}

export interface NpcCharacterRow {
  id: string;
  name: string;
  disposition: string;
  alive: boolean;
  location: string | null;
  knows_json: string;
  notes: string | null;
  last_seen_scene_id: string | null;
  created_at: string;
}

export interface SceneTestResponse {
  outcome: string;
  event: EnrichedEvent | null;
}

export interface EnrichedEvent {
  meaning: EventMeaning;
  suggested_npc_name: string | null;
  remove_thread_id: string | null;
  acting_npc: string | null;
}

export type CombatEvents = {
  "log:new": LogEntry;
  "dice:rolled": RollResponse;
  "oracle:fate": FateCheckResponse;
  "oracle:event": EventMeaning;
  "combat:outcome": EngineOutcome;
  "combatant:state": CombatantState;
  "scene:created": Scene;
};
