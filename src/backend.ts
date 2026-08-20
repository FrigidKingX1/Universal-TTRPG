import { invoke } from "@tauri-apps/api/core";
import type {
  ActionDefinition,
  CharacterProfile,
  CombatantState,
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
};

export interface CampaignExport {
  characters: CharacterProfile[];
  actions: ActionDefinition[];
  stat_blocks: EncounterStatBlock[];
  scenes: Scene[];
  logs: LogEntry[];
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
