// Multiplayer Zustand store â€” manages session state, player list,
// combat queue, connection status, and DM action routing through the server.

import { create } from "zustand";
import { MultiplayerClient } from "./client";
import type { DmRequest, DmResponse } from "../types";
import type {
  CombatStatusResponse,
  GameMode,
  PlayerInfo,
  ResyncPayload,
  GameEvent,
} from "./types";

const SERVER_URL_KEY = "autodm-server-url";
const SESSION_KEY = "autodm-mp-session";

interface PersistedSession {
  sessionId: string;
  playerToken: string;
  playerId: string | null;
  isHost: boolean;
  joinCode: string;
  serverUrl: string;
}

function persistSession(p: PersistedSession) {
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(p)); } catch { /* noop */ }
}

function loadPersistedSession(): PersistedSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function clearPersistedSession() {
  try { localStorage.removeItem(SESSION_KEY); } catch { /* noop */ }
}

// While the local user is dragging token X, incoming boards must not
// clobber *that* token's in-flight position â€” but updates from other
// players (dragging different tokens) must still land, so the guard is
// scoped to the dragged id rather than a blanket time window.
export const mapDragGuard: { until: number; tokenId: string | null } = {
  until: 0,
  tokenId: null,
};

/**
 * Merge an authoritative remote board into local state. If a local drag
 * is active on token T, T keeps its local position while every other
 * token takes the remote value â€” simultaneous drags stay live for both.
 */
function mergeRemoteMap(
  setState: MainStoreSet | null,
  getLocal: () => { x: number; y: number } | null,
  remoteTokens: any[],
  background: string,
) {
  if (!setState) return;
  const dragging =
    Date.now() < mapDragGuard.until && mapDragGuard.tokenId
      ? mapDragGuard.tokenId
      : null;
  const localPos = dragging ? getLocal() : null;
  const tokens = localPos
    ? remoteTokens.map((t: any) =>
        t?.id === dragging ? { ...t, x: localPos.x, y: localPos.y } : t,
      )
    : remoteTokens;
  setState(() => ({ mapTokens: tokens, mapBackground: background }));
}

export interface MultiplayerState {
  // â”€â”€ Connection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  connected: boolean;
  serverUrl: string;
  sessionId: string | null;
  playerToken: string | null;
  playerId: string | null;
  isHost: boolean;

  // â”€â”€ Session â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  joinCode: string | null;
  players: PlayerInfo[];

  // â”€â”€ Combat â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  gameMode: GameMode;
  currentTurn: string | null;
  turnQueue: string[];

  // â”€â”€ Resync state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  scene: ResyncPayload["scene"];
  sceneSummary: string;
  doomClocks: ResyncPayload["doom_clocks"];
  npcs: ResyncPayload["npcs"];
  loot: ResyncPayload["loot"];
  threads: ResyncPayload["threads"];
  summaries: ResyncPayload["summaries"];
  recentLogs: ResyncPayload["recent_logs"];
  mapTokens: unknown[];
  mapBackground: string;

  // â”€â”€ UI state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  lobbyOpen: boolean;
  setLobbyOpen: (open: boolean) => void;
  setServerUrl: (url: string) => void;

  // â”€â”€ Actions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  createSession: (title: string) => Promise<void>;
  joinSession: (joinCode: string, playerName: string) => Promise<void>;
  leaveSession: () => void;
  connect: () => void;
  disconnect: () => void;
  restoreSession: () => boolean;

  // â”€â”€ DM resolve (routed through server) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  resolveAction: (request: DmRequest) => Promise<DmResponse>;
  importCampaign: (data: any) => Promise<void>;
  fetchLogs: () => Promise<void>;

  // â”€â”€ Combat actions (via server) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  startCombat: () => Promise<void>;
  endCombat: () => Promise<void>;
  joinCombatQueue: () => Promise<void>;
  skipTurn: () => Promise<void>;
  fetchCombatStatus: () => Promise<void>;

  // â”€â”€ Internal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  _handleResync: (payload: ResyncPayload) => void;
  _handleEvent: (event: GameEvent, seq?: number) => void;
  _handleConnection: (connected: boolean) => void;
  _handleTurnState: (state: {
    mode: "exploration" | "combat";
    current_turn: string | null;
    queue: string[];
  }) => void;
  /** Internal/test hook: clears exactly-once replay state (new session). */
  _resetReplayState: () => void;
}

let client: MultiplayerClient | null = null;

// Exactly-once replay state (R10). lastAppliedEventSeq tracks the highest
// event seq applied locally; lastResyncAt timestamps the most recent resync
// so the filter only suppresses the replay burst right after connecting —
// a stale seq must never swallow fresh events hours later.
let lastAppliedEventSeq = 0;
let lastResyncAt = 0;
const RESYNC_GRACE_MS = 10_000;

export function getMultiplayerClient(): MultiplayerClient | null {
  return client;
}

/** Check if currently in a multiplayer session. */
export function isInMultiplayerSession(): boolean {
  return useMultiplayerStore.getState().sessionId !== null;
}

export const useMultiplayerStore = create<MultiplayerState>()((set, get) => ({
  // â”€â”€ Initial state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  connected: false,
  serverUrl: localStorage.getItem(SERVER_URL_KEY) ?? "http://localhost:3000",
  sessionId: null,
  playerToken: null,
  playerId: null,
  isHost: false,
  joinCode: null,
  players: [],
  gameMode: "exploration",
  currentTurn: null,
  turnQueue: [],
  scene: null,
  sceneSummary: "",
  doomClocks: [],
  npcs: [],
  loot: [],
  threads: [],
  summaries: [],
  recentLogs: [],
  mapTokens: [],
  mapBackground: "",
  lobbyOpen: false,

  setLobbyOpen: (open) => set({ lobbyOpen: open }),
  setServerUrl: (url) => {
    localStorage.setItem(SERVER_URL_KEY, url);
    set({ serverUrl: url });
  },

  // â”€â”€ Restore persisted session (auto-rejoin on app restart) â”€â”€â”€â”€â”€â”€
  restoreSession: () => {
    const persisted = loadPersistedSession();
    if (!persisted) return false;
    set({
      serverUrl: persisted.serverUrl,
      sessionId: persisted.sessionId,
      playerToken: persisted.playerToken,
      playerId: persisted.playerId,
      isHost: persisted.isHost,
      joinCode: persisted.joinCode,
      lobbyOpen: false,
    });
    localStorage.setItem(SERVER_URL_KEY, persisted.serverUrl);
    get().connect();
    return true;
  },

  // â”€â”€ Create session (host) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  createSession: async (title) => {
    const { serverUrl } = get();
    const res = await fetch(`${serverUrl}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) throw new Error(`Create session failed: ${res.status}`);
    const data = await res.json();

    set({
      sessionId: data.session_id,
      joinCode: data.join_code,
      playerToken: data.host_token,
      isHost: true,
      lobbyOpen: false,
    });

    persistSession({
      sessionId: data.session_id,
      playerToken: data.host_token,
      playerId: null,
      isHost: true,
      joinCode: data.join_code,
      serverUrl,
    });

    get().connect();
  },

  // â”€â”€ Join session (player) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  joinSession: async (joinCode, playerName) => {
    const { serverUrl } = get();
    const res = await fetch(`${serverUrl}/sessions/${joinCode}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ player_name: playerName }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) throw new Error(`Join session failed: ${res.status}`);
    const data = await res.json();

    set({
      sessionId: data.session_id,
      playerToken: data.player_token,
      playerId: data.player_id,
      isHost: false,
      joinCode: joinCode.toUpperCase(),
      lobbyOpen: false,
    });

    persistSession({
      sessionId: data.session_id,
      playerToken: data.player_token,
      playerId: data.player_id,
      isHost: false,
      joinCode: joinCode.toUpperCase(),
      serverUrl,
    });

    get().connect();
  },

  // â”€â”€ Leave session â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  leaveSession: () => {
    get().disconnect();
    clearPersistedSession();
    set({
      sessionId: null,
      playerToken: null,
      playerId: null,
      isHost: false,
      joinCode: null,
      players: [],
      gameMode: "exploration",
      currentTurn: null,
      turnQueue: [],
      scene: null,
      sceneSummary: "",
      doomClocks: [],
      npcs: [],
      loot: [],
      threads: [],
      summaries: [],
      recentLogs: [],
    });
  },

  // â”€â”€ Connect WebSocket â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  connect: () => {
    const { serverUrl, sessionId, playerToken } = get();
    if (!sessionId || !playerToken) return;

    // Fresh session ⇒ fresh sequence space. Without this, connecting to a
    // new session kept the previous one's high seq and the grace filter
    // swallowed the new session's low-numbered events after every resync.
    get()._resetReplayState();

    client?.disconnect();
    client = new MultiplayerClient({
      serverUrl,
      sessionId,
      token: playerToken,
      onEvent: get()._handleEvent,
      onResync: get()._handleResync,
      onConnection: get()._handleConnection,
      onTurnState: get()._handleTurnState,
    });
    client.connect();
  },

  // â”€â”€ Turn-gate push (C4 closeout) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  _handleTurnState: (state) => {
    set({
      gameMode: state.mode,
      currentTurn: state.current_turn,
      turnQueue: state.queue,
    });
  },

  // â”€â”€ Disconnect â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  disconnect: () => {
    client?.disconnect();
    client = null;
    set({ connected: false });
  },

  // â”€â”€ DM resolve (POST to server /resolve) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  resolveAction: async (request) => {
    if (!client) throw new Error("Not connected to multiplayer server");
    return client.resolve(request);
  },

  // â”€â”€ Campaign import (host uploads campaign data to session) â”€â”€â”€â”€â”€
  importCampaign: async (data) => {
    if (!client) throw new Error("Not connected to multiplayer server");
    await client.httpPost("/campaign", data);
  },

  // â”€â”€ Fetch logs from server â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  fetchLogs: async () => {
    if (!client) return;
    try {
      const logs = await client.httpGet<Array<{
        id: string;
        scene_id: string;
        speaker: string;
        content: string;
        timestamp: string;
      }>>("/logs?limit=200");
      set({ recentLogs: logs as any });
    } catch { /* best-effort */ }
  },

  // â”€â”€ Combat actions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  startCombat: async () => {
    if (!client) return;
    try {
      const data = await client.httpPost<{ mode: GameMode; current_turn: string }>("/combat/start");
      set({ gameMode: data.mode, currentTurn: data.current_turn });
    } catch (e) {
      console.error("[multiplayer] startCombat failed", e);
      return;
    }

    // Immediately push the full combatant list to the server so all
    // clients see the same combatants from the start. Overlay live HP from
    // combatantStates — a wounded combatant that was already on the board
    // must not rejoin at full DB HP (same overlay as syncCombatantsToServer).
    try {
      const mainState = _mainStoreGet?.();
      if (mainState) {
        const states = mainState.combatantStates;
        const combatants = [
          ...mainState.characters.map((c: any) => {
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
          ...mainState.statBlocks.map((b: any) => {
            const live = states[b.id];
            if (!live) return b;
            return { ...b, hit_points: { ...b.hit_points, current: live.hit_points } };
          }),
        ];
        await client.combatSync(combatants, mainState.combatantConditions);
      }
    } catch { /* best-effort */ }
  },

  endCombat: async () => {
    if (!client) return;
    try {
      await client.httpPost("/combat/end");
    } catch (e) {
      console.error("[multiplayer] endCombat failed", e);
      return;
    }
    set({ gameMode: "exploration", currentTurn: null, turnQueue: [] });
    // Clear server combatant state.
    try { await client.combatSync([], {}); } catch { /* best-effort */ }
  },

  joinCombatQueue: async () => {
    if (!client) return;
    try {
      const data = await client.httpPost<CombatStatusResponse>("/combat/join");
      set({
        gameMode: data.mode,
        currentTurn: data.current_turn,
        turnQueue: data.queue,
      });
    } catch (e) {
      console.error("[multiplayer] joinCombatQueue failed", e);
    }
  },

  skipTurn: async () => {
    if (!client) return;
    try {
      const data = await client.httpPost<{ mode: GameMode; current_turn: string | null }>("/combat/skip");
      set({ gameMode: data.mode, currentTurn: data.current_turn });
    } catch (e) {
      console.error("[multiplayer] skipTurn failed", e);
    }
  },

  fetchCombatStatus: async () => {
    if (!client) return;
    try {
      const data = await client.httpGet<CombatStatusResponse>("/combat/status");
      set({
        gameMode: data.mode,
        currentTurn: data.current_turn,
        turnQueue: data.queue,
      });
    } catch { /* best-effort */ }
  },

  // â”€â”€ Internal: Resync handler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  _handleResync: (payload) => {
    // Record the snapshot's event bound BEFORE applying anything: queued
    // frames at or below this seq are already reflected in the payload.
    if (typeof payload.last_event_seq === "number") {
      lastAppliedEventSeq = Math.max(lastAppliedEventSeq, payload.last_event_seq);
    }
    lastResyncAt = Date.now();
    set({
      scene: payload.scene,
      sceneSummary: payload.scene_summary,
      doomClocks: payload.doom_clocks,
      npcs: payload.npcs as any,
      loot: payload.loot as any,
      threads: payload.threads as any,
      summaries: payload.summaries,
      recentLogs: payload.recent_logs,
    });
    // Turn-gate snapshot: late joiners / reconnectors land with a correct
    // turn UI instead of "exploration / nobody" until someone acts.
    if (payload.turn) {
      set({
        gameMode: payload.turn.mode,
        currentTurn: payload.turn.current_turn,
        turnQueue: payload.turn.queue,
      });
    }
    // Live roster + presence: TurnIndicator/CombatQueue names and the
    // connected dots otherwise only refresh on a full reconnect.
    if (payload.players) {
      set({
        players: payload.players.map((p) => ({
          id: p.id,
          name: p.name,
          connected: p.connected,
          character_id: p.character_id ?? null,
        })),
      });
    }

    // Sync resync data into the main store so the UI reflects server state.
    _syncResyncToMainStore(payload);
  },

  // â”€â”€ Internal: Event handler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Pure forwarder with exactly-once replay filtering: after a resync the
  // snapshot already reflects every effect up to last_event_seq, so queued
  // frames at or below that bound must be dropped (otherwise doom-clock
  // deltas double-apply). Events without seq (older servers) pass through.
  _handleEvent: (event, seq) => {
    if (
      seq !== undefined &&
      seq <= lastAppliedEventSeq &&
      Date.now() - lastResyncAt < RESYNC_GRACE_MS
    ) {
      return;
    }
    if (seq !== undefined) {
      lastAppliedEventSeq = Math.max(lastAppliedEventSeq, seq);
    }
    _dispatchEventToMainStore(event);
  },

  _resetReplayState: () => {
    lastAppliedEventSeq = 0;
    lastResyncAt = 0;
  },

  _handleConnection: (connected) => {
    set({ connected });
  },
}));

// â”€â”€ Bridge: push multiplayer events/resync into the main store â”€â”€â”€â”€â”€â”€â”€â”€
// Avoids circular static imports. Bridge is initialized once at app startup.

type MainStoreGet = () => any;
type MainStoreSet = (fn: (s: any) => Partial<any>) => void;

let _mainStoreGet: MainStoreGet | null = null;
let _mainStoreSet: MainStoreSet | null = null;

/** Called once from App.tsx on mount to wire the two stores together. */
export function initMultiplayerBridge(get: MainStoreGet, set: MainStoreSet) {
  _mainStoreGet = get;
  _mainStoreSet = set;
}

function _syncResyncToMainStore(payload: ResyncPayload) {
  const setState = _mainStoreSet;
  if (!setState) return;

  if (payload.scene) {
    setState((s: any) => ({
      scenes: s.scenes.some((sc: any) => sc.id === payload.scene!.id)
        ? s.scenes.map((sc: any) => sc.id === payload.scene!.id ? payload.scene : sc)
        : [...s.scenes, payload.scene],
      activeSceneId: payload.scene!.id,
    }));
  }

  if (payload.recent_logs?.length) {
    // Seed BOTH the raw log array and the tabletop storyLog feed. refreshLogs()
    // normally derives storyLog from the local Tauri DB, but in a hosted session
    // the log is server-authoritative (recent_logs) and refreshLogs is
    // deliberately skipped — without this the story feed stays empty on a
    // reconnect/join until the next log:new arrives.
    const storyLog = payload.recent_logs.map((l: any) => ({
      id: l.id,
      speaker: l.speaker,
      role: (() => {
        const s = String(l.speaker ?? "").toLowerCase();
        if (s === "player") return "player";
        if (s === "dungeon master" || s === "dm" || s === "narrator") return "narrator";
        if (s === "combat") return "combat";
        if (s === "oracle" || s === "system") return "system";
        return "npc";
      })(),
      content: l.content,
      timestamp: l.timestamp,
    }));
    setState(() => ({ logs: payload.recent_logs, storyLog }));
  }

  if (payload.doom_clocks) {
    setState(() => ({ doomClocks: payload.doom_clocks }));
  }

  if (payload.npcs) {
    setState(() => ({ npcCharacters: payload.npcs }));
  }

  if (payload.threads) {
    setState(() => ({ plotThreads: payload.threads }));
  }

  if (payload.summaries) {
    setState(() => ({ episodeSummaries: payload.summaries }));
  }

  if (payload.loot) {
    setState(() => ({
      loot: payload.loot.map((r: any) => ({
        id: r.id,
        name: r.name,
        quantity: r.quantity,
        assignedTo: r.assigned_to,
        sourceEntity: r.source_entity,
        timestamp: r.timestamp,
      })),
    }));
  }

  if (payload.characters) {
    setState(() => ({ characters: payload.characters }));
  }

  // Sync server-authoritative combatant state into main store.
  if (payload.combatants) {
    const combatantStates: Record<string, { id: string; name: string; hit_points: number; status?: string }> = {};
    for (const c of payload.combatants) {
      const id = (c as any).id as string | undefined;
      if (!id) continue;
      // CharacterProfile has resource_pools.hp.current; EncounterStatBlock has hit_points.current
      let hp = 0;
      let name = (c as any).name as string || id;
      let status: string | undefined;
      if ("resource_pools" in (c as any)) {
        hp = (c as any).resource_pools?.hp?.current ?? 0;
        // CharacterProfile has no top-level `name`; the display name lives at
        // `identity.name`. Falling back to `id` rendered a bare UUID.
        name = (c as any).identity?.name ?? (c as any).name ?? id;
      } else if ("hit_points" in (c as any)) {
        const hpObj = (c as any).hit_points;
        hp = typeof hpObj === "object" ? (hpObj.current ?? hpObj) : hpObj;
        name = (c as any).name ?? id;
      }
      // Check for defeated status
      if ("status" in (c as any) && (c as any).status) {
        status = (c as any).status;
      }
      combatantStates[id] = { id, name, hit_points: hp, status };
    }
    setState(() => ({ combatantStates }));
  }

  if (payload.combatant_conditions) {
    setState(() => ({ combatantConditions: payload.combatant_conditions }));
  }

  // Server-authoritative battle state (round, death saves, turn index) so
  // reconnectors / late joiners don't reset to round 1 with empty saves.
  if (typeof (payload as any).combat_state === "string" && (payload as any).combat_state) {
    _applyCombatStateBlob(setState, (payload as any).combat_state);
  }

  // Map state (joiners need the current board without waiting for an event).
  if ((payload as any).map_tokens || (payload as any).map_background !== undefined) {
    mergeRemoteMap(
      setState,
      () => {
        const t = _mainStoreGet?.().mapTokens?.find(
          (tok: any) => tok.id === mapDragGuard.tokenId,
        );
        return t ? { x: t.x, y: t.y } : null;
      },
      (payload as any).map_tokens ?? [],
      (payload as any).map_background ?? "",
    );
  }

  // Initiative order (reconnectors / late joiners keep the turn order).
  // The pointer is re-derived from the turn-holder so the highlight lands
  // on the right combatant instead of resetting to the top of the list.
  if (payload.initiative?.length) {
    const turnHolder = useMultiplayerStore.getState().currentTurn;
    setState((s: any) => {
      const order = payload.initiative!;
      const idx = order.findIndex((e) => e.combatant_id === turnHolder);
      return {
        initiativeOrder: order,
        ...(idx >= 0 ? { currentTurnIndex: idx } : {}),
        // A fresh order with no round context starts at round 1.
        ...(s.currentRound ? {} : { currentRound: 1 }),
      };
    });
  }
}

function _applyCombatStateBlob(setState: MainStoreSet, raw: string) {
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }
  if (typeof parsed !== "object" || parsed === null) return;
  const patch: any = {};
  if (Array.isArray(parsed.initiativeOrder)) patch.initiativeOrder = parsed.initiativeOrder;
  if (typeof parsed.combatantStates === "object" && parsed.combatantStates !== null) {
    patch.combatantStates = parsed.combatantStates;
  }
  if (typeof parsed.combatantConditions === "object" && parsed.combatantConditions !== null) {
    patch.combatantConditions = parsed.combatantConditions;
  }
  if (typeof parsed.currentRound === "number") patch.currentRound = parsed.currentRound;
  if (typeof parsed.currentTurnIndex === "number") patch.currentTurnIndex = parsed.currentTurnIndex;
  if (typeof parsed.deathSaves === "object" && parsed.deathSaves !== null) {
    patch.deathSaves = parsed.deathSaves;
  }
  setState(() => patch);
}

function _dispatchEventToMainStore(event: GameEvent) {
  const getState = _mainStoreGet;
  const setState = _mainStoreSet;
  if (!getState || !setState) return;

  switch (event.type) {
    case "scene_updated":
      // Do NOT call refreshLogs() here. In a hosted session the combat/story
      // log is server-authoritative and delivered via resync; refreshLogs()
      // reads the *local* Tauri DB (empty on remote clients) and would clobber
      // the authoritative log with stale/empty entries.
      break;

    case "clock_advanced":
      setState((s: any) => ({
        doomClocks: s.doomClocks.map((c: any) =>
          c.id === event.clock_id
            ? { ...c, current: Math.min(c.max, Math.max(0, c.current + event.ticks)) }
            : c,
        ),
      }));
      break;

    case "item_added":
      break;

    case "damage_applied":
      setState((s: any) => {
        const existing = s.combatantStates[event.target_id];
        if (!existing) return {};
        // Mirror HP into the character sheet / monster pool too, matching the
        // desktop combatant:state handler — otherwise the sheet shows stale
        // full HP after a hit until a resync.
        const characters = (s.characters ?? []).map((c: any) =>
          c.id === event.target_id && c.resource_pools?.hp
            ? {
                ...c,
                resource_pools: {
                  ...c.resource_pools,
                  hp: { ...c.resource_pools.hp, current: event.hp_remaining },
                },
              }
            : c,
        );
        const statBlocks = (s.statBlocks ?? []).map((b: any) =>
          b.id === event.target_id
            ? { ...b, hit_points: { ...b.hit_points, current: event.hp_remaining } }
            : b,
        );
        return {
          combatantStates: {
            ...s.combatantStates,
            [event.target_id]: {
              ...existing,
              hit_points: event.hp_remaining,
              status: event.defeated ? "DEFEATED" : existing.status,
            },
          },
          characters,
          statBlocks,
        };
      });
      break;

    case "healed":
      setState((s: any) => {
        const existing = s.combatantStates[event.target_id];
        if (!existing) return {};
        // Healing above 0 revives: clear a stale DEFEATED overlay so the
        // target isn't stuck "down" on everyone's screen.
        let nextOverlay: any;
        if (event.hp_remaining > 0 && existing.status === "DEFEATED") {
          const revived: any = { ...existing, hit_points: event.hp_remaining };
          delete revived.status;
          nextOverlay = revived;
        } else {
          nextOverlay = { ...existing, hit_points: event.hp_remaining };
        }
        const characters = (s.characters ?? []).map((c: any) =>
          c.id === event.target_id && c.resource_pools?.hp
            ? {
                ...c,
                resource_pools: {
                  ...c.resource_pools,
                  hp: { ...c.resource_pools.hp, current: event.hp_remaining },
                },
              }
            : c,
        );
        const statBlocks = (s.statBlocks ?? []).map((b: any) =>
          b.id === event.target_id
            ? { ...b, hit_points: { ...b.hit_points, current: event.hp_remaining } }
            : b,
        );
        return {
          combatantStates: { ...s.combatantStates, [event.target_id]: nextOverlay },
          characters,
          statBlocks,
        };
      });
      break;

    case "condition_applied":
      setState((s: any) => {
        const existing = s.combatantConditions[event.target] ?? [];
        if (existing.includes(event.condition)) return {};
        return {
          combatantConditions: {
            ...s.combatantConditions,
            [event.target]: [...existing, event.condition],
          },
        };
      });
      break;

    case "map_updated":
      mergeRemoteMap(
        setState,
        () => {
          const t = getState().mapTokens?.find(
            (tok: any) => tok.id === mapDragGuard.tokenId,
          );
          return t ? { x: t.x, y: t.y } : null;
        },
        event.tokens as any,
        event.background,
      );
      break;

    case "npc_spoke":
    case "rule_answered":
    case "ambiguous_target":
      break;
  }
}
