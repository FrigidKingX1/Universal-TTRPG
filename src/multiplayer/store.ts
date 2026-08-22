// Multiplayer Zustand store — manages session state, player list,
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

export interface MultiplayerState {
  // ── Connection ────────────────────────────────────────────────────
  connected: boolean;
  serverUrl: string;
  sessionId: string | null;
  playerToken: string | null;
  playerId: string | null;
  isHost: boolean;

  // ── Session ───────────────────────────────────────────────────────
  joinCode: string | null;
  players: PlayerInfo[];

  // ── Combat ────────────────────────────────────────────────────────
  gameMode: GameMode;
  currentTurn: string | null;
  turnQueue: string[];

  // ── Resync state ──────────────────────────────────────────────────
  scene: ResyncPayload["scene"];
  sceneSummary: string;
  doomClocks: ResyncPayload["doom_clocks"];
  npcs: ResyncPayload["npcs"];
  loot: ResyncPayload["loot"];
  threads: ResyncPayload["threads"];
  summaries: ResyncPayload["summaries"];
  recentLogs: ResyncPayload["recent_logs"];

  // ── UI state ──────────────────────────────────────────────────────
  lobbyOpen: boolean;
  setLobbyOpen: (open: boolean) => void;
  setServerUrl: (url: string) => void;

  // ── Actions ───────────────────────────────────────────────────────
  createSession: (title: string) => Promise<void>;
  joinSession: (joinCode: string, playerName: string) => Promise<void>;
  leaveSession: () => void;
  connect: () => void;
  disconnect: () => void;
  restoreSession: () => boolean;

  // ── DM resolve (routed through server) ────────────────────────────
  resolveAction: (request: DmRequest) => Promise<DmResponse>;
  importCampaign: (data: any) => Promise<void>;
  fetchLogs: () => Promise<void>;

  // ── Combat actions (via server) ───────────────────────────────────
  startCombat: () => Promise<void>;
  endCombat: () => Promise<void>;
  joinCombatQueue: () => Promise<void>;
  skipTurn: () => Promise<void>;
  fetchCombatStatus: () => Promise<void>;

  // ── Internal ──────────────────────────────────────────────────────
  _handleResync: (payload: ResyncPayload) => void;
  _handleEvent: (event: GameEvent) => void;
  _handleConnection: (connected: boolean) => void;
}

let client: MultiplayerClient | null = null;

export function getMultiplayerClient(): MultiplayerClient | null {
  return client;
}

/** Check if currently in a multiplayer session. */
export function isInMultiplayerSession(): boolean {
  return useMultiplayerStore.getState().sessionId !== null;
}

export const useMultiplayerStore = create<MultiplayerState>()((set, get) => ({
  // ── Initial state ───────────────────────────────────────────────
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
  lobbyOpen: false,

  setLobbyOpen: (open) => set({ lobbyOpen: open }),
  setServerUrl: (url) => {
    localStorage.setItem(SERVER_URL_KEY, url);
    set({ serverUrl: url });
  },

  // ── Restore persisted session (auto-rejoin on app restart) ──────
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

  // ── Create session (host) ───────────────────────────────────────
  createSession: async (title) => {
    const { serverUrl } = get();
    const res = await fetch(`${serverUrl}/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
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

  // ── Join session (player) ───────────────────────────────────────
  joinSession: async (joinCode, playerName) => {
    const { serverUrl } = get();
    const res = await fetch(`${serverUrl}/sessions/${joinCode}/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ player_name: playerName }),
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

  // ── Leave session ───────────────────────────────────────────────
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

  // ── Connect WebSocket ───────────────────────────────────────────
  connect: () => {
    const { serverUrl, sessionId, playerToken } = get();
    if (!sessionId || !playerToken) return;

    client?.disconnect();
    client = new MultiplayerClient({
      serverUrl,
      sessionId,
      token: playerToken,
      onEvent: get()._handleEvent,
      onResync: get()._handleResync,
      onConnection: get()._handleConnection,
    });
    client.connect();
  },

  // ── Disconnect ──────────────────────────────────────────────────
  disconnect: () => {
    client?.disconnect();
    client = null;
    set({ connected: false });
  },

  // ── DM resolve (POST to server /resolve) ────────────────────────
  resolveAction: async (request) => {
    if (!client) throw new Error("Not connected to multiplayer server");
    return client.resolve(request);
  },

  // ── Campaign import (host uploads campaign data to session) ─────
  importCampaign: async (data) => {
    if (!client) throw new Error("Not connected to multiplayer server");
    await client.httpPost("/campaign", data);
  },

  // ── Fetch logs from server ──────────────────────────────────────
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

  // ── Combat actions ──────────────────────────────────────────────
  startCombat: async () => {
    if (!client) return;
    const data = await client.httpPost<{ mode: GameMode; current_turn: string }>("/combat/start");
    set({ gameMode: data.mode, currentTurn: data.current_turn });
  },

  endCombat: async () => {
    if (!client) return;
    await client.httpPost("/combat/end");
    set({ gameMode: "exploration", currentTurn: null, turnQueue: [] });
  },

  joinCombatQueue: async () => {
    if (!client) return;
    const data = await client.httpPost<CombatStatusResponse>("/combat/join");
    set({
      gameMode: data.mode,
      currentTurn: data.current_turn,
      turnQueue: data.queue,
    });
  },

  skipTurn: async () => {
    if (!client) return;
    const data = await client.httpPost<{ mode: GameMode; current_turn: string | null }>("/combat/skip");
    set({ gameMode: data.mode, currentTurn: data.current_turn });
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

  // ── Internal: Resync handler ────────────────────────────────────
  _handleResync: (payload) => {
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

    // Sync resync data into the main store so the UI reflects server state.
    _syncResyncToMainStore(payload);
  },

  // ── Internal: Event handler (push into main store) ──────────────
  _handleEvent: (event) => {
    // Update multiplayer store's own state.
    switch (event.type) {
      case "clock_advanced":
        set((s) => ({
          doomClocks: s.doomClocks.map((c) =>
            c.id === event.clock_id
              ? { ...c, current: Math.min(c.max, Math.max(0, c.current + event.ticks)) }
              : c,
          ),
        }));
        break;
      case "condition_applied":
        // Optimistic: will be confirmed on next resync.
        break;
      case "item_added":
        // Optimistic loot refresh.
        break;
    }

    // Dispatch to main store for UI updates.
    _dispatchEventToMainStore(event);
  },

  _handleConnection: (connected) => {
    set({ connected });
  },
}));

// ── Bridge: push multiplayer events/resync into the main store ────────
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
    setState(() => ({ logs: payload.recent_logs }));
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
        name = (c as any).name ?? id;
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
}

function _dispatchEventToMainStore(event: GameEvent) {
  const getState = _mainStoreGet;
  const setState = _mainStoreSet;
  if (!getState || !setState) return;

  switch (event.type) {
    case "scene_updated":
      void getState().refreshLogs?.();
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
        return {
          combatantStates: {
            ...s.combatantStates,
            [event.target_id]: { ...existing, hit_points: event.hp_remaining },
          },
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

    case "npc_spoke":
    case "rule_answered":
    case "ambiguous_target":
      break;
  }
}
