// Type mirrors of the auto-dm-core / Tauri command contracts.
// Field names follow serde naming (snake_case for struct fields).

export type ResetCondition = "short_rest" | "long_rest" | "turn_start" | "scene_end" | "manual";
export type CostType = "action" | "bonus_action" | "reaction" | "action_point" | "free";
export type TargetType = "single_entity" | "area_of_effect" | "self" | "ally";
export type Shape = "sphere" | "cone" | "cube" | "line" | "single";
export type ResolutionType = "contested_check" | "target_dc" | "guaranteed_effect" | "opposed_roll";
export type Size = "tiny" | "small" | "medium" | "large" | "huge" | "gargantuan";

export interface Identity {
  name: string;
  ancestry?: string;
  archetype?: string;
  background?: string;
  level_or_rank: number;
}

export interface AttributeState {
  base_value: number;
  current_value: number;
  derived_modifier?: number;
}

export interface ResourcePool {
  current: number;
  maximum: number;
  temporary: number;
  reset_condition: ResetCondition;
}

export interface InventoryItem {
  id: string;
  name: string;
  quantity: number;
  is_equipped: boolean;
  weight: number;
  tags: string[];
}

export interface CharacterProfile {
  id: string;
  system_id: string;
  identity: Identity;
  attributes: Record<string, AttributeState>;
  resource_pools: Record<string, ResourcePool>;
  inventory: InventoryItem[];
  abilities: string[];
}

export interface ActionCost {
  type: CostType;
  amount: number;
}

export interface Targeting {
  range_feet?: number;
  target_type: TargetType;
  shape?: Shape;
  size_feet: number;
}

export interface SuccessOutcome {
  formula?: string;
  damage_type?: string;
  applied_status?: string;
}

export interface FailureOutcome {
  formula?: string;
  half_damage: boolean;
}

export interface Outcomes {
  on_success?: SuccessOutcome;
  on_failure?: FailureOutcome;
}

export interface Resolution {
  type: ResolutionType;
  primary_attribute?: string;
  roll_formula?: string;
  vs_defense?: string;
  outcomes?: Outcomes;
}

export interface ActionDefinition {
  id: string;
  name: string;
  action_cost: ActionCost;
  targeting?: Targeting;
  resolution: Resolution;
}

export interface HitPoints {
  current: number;
  maximum: number;
  formula?: string;
}

export interface LootTableEntry {
  name: string;
  quantity_formula: string;
  chance: number;
}

export interface EncounterStatBlock {
  id: string;
  name: string;
  challenge_rating: number;
  size?: Size;
  type?: string;
  alignment?: string;
  armor_class: number;
  hit_points: HitPoints;
  speed_feet?: number;
  attributes: Record<string, number>;
  actions: string[];
  loot_table: LootTableEntry[];
}

export interface Scene {
  id: string;
  scene_number: number;
  title: string;
  chaos_factor: number;
  summary_text?: string;
  is_active: boolean;
}

export interface LogEntry {
  id: string;
  scene_id?: string;
  speaker: string;
  content: string;
  payload?: unknown;
  timestamp: string;
}

export interface RollResponse {
  expression: string;
  total: number;
  detail: string;
}

export type OddsName =
  | "impossible"
  | "no_way"
  | "very_unlikely"
  | "unlikely"
  | "fifty_fifty"
  | "somewhat_likely"
  | "likely"
  | "very_likely"
  | "near_sure_thing"
  | "sure_thing";

export const ODDS_LABELS: Record<OddsName, string> = {
  impossible: "Impossible",
  no_way: "No Way",
  very_unlikely: "Very Unlikely",
  unlikely: "Unlikely",
  fifty_fifty: "50/50",
  somewhat_likely: "Somewhat Likely",
  likely: "Likely",
  very_likely: "Very Likely",
  near_sure_thing: "Near Sure Thing",
  sure_thing: "A Sure Thing",
};

export interface FateCheckResponse {
  roll: number;
  target: number;
  chaos_factor: number;
  odds: string;
  outcome: "Yes" | "No";
  exceptional: boolean;
  random_event: boolean;
  interpretation: string;
}

export interface EventMeaning {
  action: string;
  subject: string;
  descriptor: string;
  focus: string;
}

export interface PrerequisiteCheck {
  attribute?: string;
  skill?: string;
  dc: number;
  reason: string;
}

export interface EngineOutcome {
  check_result?: string;
  check_roll?: number;
  check_detail?: string;
  attack_result: string;
  attack_roll?: number;
  attack_detail?: string;
  target_ac?: number;
  damage_dealt: number;
  target_hp_remaining: number;
  target_status: string;
  applied_status?: string;
  damage_type?: string;
  damage_modifier?: string;
}

export interface InitiativeEntry {
  combatant_id: string;
  name: string;
  roll: number;
  modifier: number;
}

export interface DmRequest {
  scene_summary: string;
  player_action: string;
  chaos_factor: number;
  memory_context?: string;
  lines?: string[];
  veils?: string[];
  scene_id?: string;
}

export type GameIntent =
  | { Narration: { text: string } }
  | { SceneDelta: { delta: string } }
  | { NpcSpeech: { npc_id?: string; line: string } }
  | { DiceRoll: { skill: string; modifier?: number; dc?: number; reason?: string } }
  | { RuleCheck: { question: string } }
  | { FateQuestion: { question: string } }
  | { Ooc: { message: string } };

export interface DmResponse {
  narrative: string;
  mechanical_events: string[];
  fate_interpretation: string;
  fate_roll: number;
  fate_target: number;
  chaos_factor: number;
  event_meaning?: EventMeaning;
  intent: GameIntent;
  source: string;
}

export interface CombatantState {
  id: string;
  name: string;
  hit_points: number;
  status?: string;
}

// ── Oracle / Mythic — Thread & NPC Character Lists ──────────────────────

export type ThreadStatus = "open" | "resolved" | "abandoned";
export type Disposition = "hostile" | "unfriendly" | "neutral" | "friendly" | "helpful";

export interface PlotThread {
  id: string;
  description: string;
  status: ThreadStatus;
  opened_scene_id: string;
  resolved_scene_id?: string;
  created_at: string;
}

export interface NpcKnowledge {
  text: string;
  scene_id?: string | null;
  timestamp?: string | null;
}

export interface NpcCharacter {
  id: string;
  name: string;
  disposition: Disposition;
  alive: boolean;
  location?: string | null;
  knows: NpcKnowledge[];
  notes?: string | null;
  last_seen_scene_id?: string | null;
  created_at: string;
}

export interface DoomClock {
  id: string;
  label: string;
  current: number;
  max: number;
  consequence: string;
  scene_id?: string | null;
  active: boolean;
}

export interface ExplorationZone {
  id: string;
  name: string;
  zone_type: "hex" | "point" | "dungeon";
  description?: string | null;
  danger_level: number;
  mapped: boolean;
}

export interface ExplorationNode {
  id: string;
  zone_id: string;
  name: string;
  discovered: boolean;
  safe: boolean;
  description?: string | null;
  connections: string[];
  contents: string[];
  notes?: string | null;
}

// ── Two-Mode Architecture Types ──────────────────────────────────────────

export type AppMode = "setup" | "tabletop";

export interface LinesAndVeils {
  lines: string[];
  veils: string[];
}

export interface CampaignPromptInput {
  settingTheme: string;
  partyLevel: number;
  startingLocation: string;
  dangerLevel: number;
  linesAndVeils: LinesAndVeils;
}

export interface GeneratedNodeSchema {
  nodeId: string;
  name: string;
  description: string;
  dangerLevel: number;
  connectedTo: string[];
  isSafe: boolean;
}

export interface GeneratedNpcSchema {
  name: string;
  role: string;
  disposition: "Friendly" | "Neutral" | "Hostile";
  initialLocation: string;
  knowledgeTags: string[];
}

export interface GeneratedClockSchema {
  title: string;
  maxTicks: number;
  consequence: string;
}

export interface GeneratedCampaignPayload {
  campaignTitle: string;
  openingSceneTitle: string;
  openingSceneSummary: string;
  initialChaosFactor: number;
  zoneName: string;
  zoneType: "Hex" | "Point" | "Dungeon";
  zoneDescription: string;
  zoneDangerLevel: number;
  nodes: GeneratedNodeSchema[];
  npcs: GeneratedNpcSchema[];
  doomClocks: GeneratedClockSchema[];
  plotThreads: string[];
}

export interface StoryLogEntry {
  id: string;
  speaker: string;
  role: "player" | "narrator" | "npc" | "system" | "combat" | "auto-dm";
  content: string;
  timestamp: string;
}

export interface GeneratedSceneInfo {
  title: string;
  chaos_factor: number;
  summary: string;
  hook: string;
}

export interface GeneratedNpcInfo {
  name: string;
  disposition: string;
  notes: string;
}

export interface GeneratedDoomClockInfo {
  id: string;
  label: string;
  tick_max: number;
  consequence: string;
}

export interface GeneratedPlotThreadInfo {
  description: string;
  status: string;
}

export interface CampaignGenerationResult {
  campaign_title: string;
  campaign_theme: string;
  campaign_summary: string;
  scenes: GeneratedSceneInfo[];
  npcs: GeneratedNpcInfo[];
  doom_clocks: GeneratedDoomClockInfo[];
  plot_threads: GeneratedPlotThreadInfo[];
  lines: string[];
  veils: string[];
}
