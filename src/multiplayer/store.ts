// Multiplayer Zustand store — manages session state, player list,
// combat queue, and connection status. Separate from the main store
// to keep multiplayer concerns isolated.

import { create } from "zustand";
import { MultiplayerClient } from "./client";
import type {
  CombatStatusResponse,
  GameMode,
  PlayerInfo,
  ResyncPayload,
  GameEvent,
} from "./types";

const SERVER_URL_KEY = "autodm-server-url";

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

    get().connect();
  },

  // ── Leave session ───────────────────────────────────────────────
  leaveSession: () => {
    get().disconnect();
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

  // ── Combat actions ──────────────────────────────────────────────
  startCombat: async () => {
    const { serverUrl, sessionId, playerToken } = get();
    if (!sessionId || !playerToken) return;
    const res = await fetch(`${serverUrl}/sessions/${sessionId}/combat/start`, {
      method: "POST",
      headers: { Authorization: `Bearer ${playerToken}` },
    });
    if (!res.ok) throw new Error(`Start combat failed: ${res.status}`);
    const data: { mode: GameMode; current_turn: string } = await res.json();
    set({ gameMode: data.mode, currentTurn: data.current_turn });
  },

  endCombat: async () => {
    const { serverUrl, sessionId, playerToken } = get();
    if (!sessionId || !playerToken) return;
    const res = await fetch(`${serverUrl}/sessions/${sessionId}/combat/end`, {
      method: "POST",
      headers: { Authorization: `Bearer ${playerToken}` },
    });
    if (!res.ok) throw new Error(`End combat failed: ${res.status}`);
    set({ gameMode: "exploration", currentTurn: null, turnQueue: [] });
  },

  joinCombatQueue: async () => {
    const { serverUrl, sessionId, playerToken } = get();
    if (!sessionId || !playerToken) return;
    const res = await fetch(`${serverUrl}/sessions/${sessionId}/combat/join`, {
      method: "POST",
      headers: { Authorization: `Bearer ${playerToken}` },
    });
    if (!res.ok) throw new Error(`Join queue failed: ${res.status}`);
    const data: CombatStatusResponse = await res.json();
    set({
      gameMode: data.mode,
      currentTurn: data.current_turn,
      turnQueue: data.queue,
    });
  },

  skipTurn: async () => {
    const { serverUrl, sessionId, playerToken } = get();
    if (!sessionId || !playerToken) return;
    const res = await fetch(`${serverUrl}/sessions/${sessionId}/combat/skip`, {
      method: "POST",
      headers: { Authorization: `Bearer ${playerToken}` },
    });
    if (!res.ok) throw new Error(`Skip turn failed: ${res.status}`);
    const data: { mode: GameMode; current_turn: string | null } = await res.json();
    set({ gameMode: data.mode, currentTurn: data.current_turn });
  },

  fetchCombatStatus: async () => {
    const { serverUrl, sessionId, playerToken } = get();
    if (!sessionId || !playerToken) return;
    const res = await fetch(`${serverUrl}/sessions/${sessionId}/combat/status`, {
      headers: { Authorization: `Bearer ${playerToken}` },
    });
    if (!res.ok) return;
    const data: CombatStatusResponse = await res.json();
    set({
      gameMode: data.mode,
      currentTurn: data.current_turn,
      turnQueue: data.queue,
    });
  },

  // ── Internal handlers ───────────────────────────────────────────
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
  },

  _handleEvent: (event) => {
    // Optimistic updates for common events.
    switch (event.type) {
      case "scene_updated":
        // Refetch scene summary from resync data on next resync.
        break;
      case "clock_advanced":
        set((s) => ({
          doomClocks: s.doomClocks.map((c) =>
            c.id === event.clock_id
              ? { ...c, current: Math.max(0, c.current + event.ticks) }
              : c,
          ),
        }));
        break;
      case "item_added":
        // Refetch loot on next resync.
        break;
    }
  },

  _handleConnection: (connected) => {
    set({ connected });
  },
}));
