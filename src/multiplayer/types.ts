// Mirror of the server's wire protocol types.
// Field names match the Rust serde output (snake_case).

import type {
  CharacterProfile,
  DoomClock,
  EpisodicSummary,
  LogEntry,
  NpcCharacter,
  Scene,
} from "../types";

// ── Game mode ────────────────────────────────────────────────────────

export type GameMode = "exploration" | "combat";

// ── Turn check (from /combat/skip error or client-side gating) ───────

export type TurnCheck =
  | { status: "allowed" }
  | { status: "waiting"; position: number }
  | { status: "not_in_queue" };

// ── WsMessage envelope ───────────────────────────────────────────────

export type WsMessage =
  | { type: "event"; event: GameEvent }
  | { type: "resync"; payload: ResyncPayload };

// ── GameEvent (mirrors engine/src/events.rs) ─────────────────────────

export type GameEvent =
  | { type: "scene_updated"; scene_id: string }
  | { type: "npc_spoke"; speaker: string }
  | { type: "clock_advanced"; clock_id: string; ticks: number }
  | { type: "item_added"; name: string; quantity: number }
  | {
      type: "damage_applied";
      target_id: string;
      target_name: string;
      amount: number;
      temp_absorbed: number;
      hp_remaining: number;
      defeated: boolean;
      shock: boolean;
    }
  | { type: "condition_applied"; target: string; condition: string }
  | { type: "ambiguous_target"; kind: string; message: string; candidates: string[] }
  | { type: "rule_answered"; question: string };

// ── ResyncPayload (mirrors server/src/session.rs) ───────────────────

export interface ResyncPayload {
  scene: Scene | null;
  scene_summary: string;
  doom_clocks: DoomClock[];
  npcs: NpcCharacter[];
  loot: Array<{
    id: string;
    scene_id: string;
    name: string;
    quantity: number;
    source_entity: string;
    assigned_to: string | null;
    timestamp: string;
  }>;
  threads: Array<{
    id: string;
    description: string;
    status: string;
    opened_scene_id: string;
    resolved_scene_id: string | null;
    created_at: string;
  }>;
  summaries: EpisodicSummary[];
  combat_state: string | null;
  characters: CharacterProfile[];
  player_characters: Record<string, string>;
  recent_logs: LogEntry[];
}

// ── REST response types ──────────────────────────────────────────────

export interface CreateSessionResponse {
  session_id: string;
  join_code: string;
  host_token: string;
}

export interface JoinSessionResponse {
  session_id: string;
  player_token: string;
  player_id: string;
}

export interface CombatStatusResponse {
  mode: GameMode;
  current_turn: string | null;
  queue: string[];
}

export interface StartCombatResponse {
  mode: GameMode;
  current_turn: string;
}

export interface SkipTurnResponse {
  mode: GameMode;
  skipped: string;
  current_turn: string | null;
}

export interface SessionSummary {
  id: string;
  join_code: string;
  player_count: number;
}

// ── Player info (derived from resync) ────────────────────────────────

export interface PlayerInfo {
  id: string;
  name: string;
  connected: boolean;
}
