// WebSocket client for the auto-dm multiplayer server.
// Handles connection, resync, event dispatch, ping/pong heartbeat,
// and HTTP resolve (DM actions routed through the server).

import type { CharacterProfile, DmRequest, DmResponse } from "../types";
import type { GameEvent, ResyncPayload, WsMessage } from "./types";

export type WsEventHandler = (event: GameEvent, seq?: number) => void;
export type ResyncHandler = (payload: ResyncPayload) => void;
export type ConnectionHandler = (connected: boolean) => void;
export type TurnStateHandler = (state: {
  mode: "exploration" | "combat";
  current_turn: string | null;
  queue: string[];
}) => void;

const PING_INTERVAL_MS = 30_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

/** DM resolution can legitimately run for minutes (local LLM); everything
 * else should fail fast instead of spinning a busy flag forever. */
const RESOLVE_TIMEOUT_MS = 210_000;
const DEFAULT_TIMEOUT_MS = 45_000;

function fetchSignal(path: string): AbortSignal {
  const ms = path.startsWith("/resolve")
    ? RESOLVE_TIMEOUT_MS
    : DEFAULT_TIMEOUT_MS;
  return AbortSignal.timeout(ms);
}

/**
 * Derive a WebSocket URL from a server base URL. Accepts http(s) URLs,
 * bare hosts, or already-correct ws(s) URLs — required so Cloudflare
 * Tunnel endpoints (https://…) produce valid wss:// connections.
 */
export function toWebSocketUrl(base: string): string {
  const trimmed = base.trim().replace(/\/+$/, "");
  if (/^wss:\/\//i.test(trimmed)) return trimmed;
  if (/^ws:\/\//i.test(trimmed)) return trimmed;
  if (/^https:\/\//i.test(trimmed)) return "wss://" + trimmed.slice("https://".length);
  if (/^http:\/\//i.test(trimmed)) return "ws://" + trimmed.slice("http://".length);
  // Bare host or host:port — assume secure (tunnels and public hosts).
  return "wss://" + trimmed;
}

export class MultiplayerClient {
  private ws: WebSocket | null = null;
  private url: string;
  private httpBase: string;
  private sessionId: string;
  private token: string;
  private onEvent: WsEventHandler;
  private onResync: ResyncHandler;
  private onConnection: ConnectionHandler;
  private onTurnState: TurnStateHandler | null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private lastActivity = 0;
  private disposed = false;

  constructor(opts: {
    serverUrl: string;
    sessionId: string;
    token: string;
    onEvent: WsEventHandler;
    onResync: ResyncHandler;
    onConnection: ConnectionHandler;
    /** Optional — receives turn-gate pushes (C4). */
    onTurnState?: TurnStateHandler;
  }) {
    // Strip trailing slash from server URL.
    const base = opts.serverUrl.replace(/\/+$/, "");
    this.httpBase = base;
    this.sessionId = opts.sessionId;
    this.token = opts.token;
    this.url = `${toWebSocketUrl(base)}/sessions/${opts.sessionId}/ws?token=${encodeURIComponent(opts.token)}`;
    this.onEvent = opts.onEvent;
    this.onResync = opts.onResync;
    this.onConnection = opts.onConnection;
    this.onTurnState = opts.onTurnState ?? null;
  }

  connect() {
    if (this.disposed) return;
    this.cleanup();
    this.onConnection(false);

    try {
      this.ws = new WebSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.lastActivity = Date.now();
      this.onConnection(true);
      this.startPing();
    };

    this.ws.onmessage = (ev) => {
      // Any inbound message — including keepalive pongs — proves the
      // socket is alive; without this, quiet tables trip the 90s
      // watchdog even though protocol-level pings are flowing.
      this.lastActivity = Date.now();
      try {
        const msg: WsMessage = JSON.parse(ev.data);
        if (msg.type === "event") {
          this.onEvent(msg.event, msg.seq);
        } else if (msg.type === "resync") {
          this.onResync(msg.payload);
        } else if (msg.type === "turn_state") {
          this.onTurnState?.({
            mode: msg.mode,
            current_turn: msg.current_turn,
            queue: msg.queue,
          });
        }
      } catch {
        // Ignore malformed messages.
      }
    };

    this.ws.onclose = () => {
      this.onConnection(false);
      this.stopPing();
      if (!this.disposed) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = () => {
      // onclose will fire after onerror.
    };
  }

  disconnect() {
    this.disposed = true;
    this.stopPing();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.cleanup();
  }

  // ── HTTP helpers ──────────────────────────────────────────────────

  /** POST a DM action through the server's /resolve endpoint. */
  async resolve(request: DmRequest): Promise<DmResponse> {
    return this.httpPost<DmResponse>("/resolve", request);
  }

  // ── Character actions ─────────────────────────────────────────────

  /** Get the authenticated player's linked character. */
  async getMyCharacter(): Promise<{ character: CharacterProfile | null }> {
    return this.httpGet("/characters/me");
  }

  /** Create a new character and link it to the calling player. */
  async createCharacter(profile: CharacterProfile): Promise<{ character: CharacterProfile }> {
    return this.httpPost("/characters/me", { profile });
  }

  /** Equip or stow an item. */
  async equipItem(itemId: string, equipped: boolean): Promise<{ character: CharacterProfile }> {
    return this.httpPost("/characters/me/equip", { item_id: itemId, equipped });
  }

  /** Use/consume an item (decrements quantity, removes if zero). */
  async useItem(itemId: string): Promise<{ character: CharacterProfile }> {
    return this.httpPost("/characters/me/use-item", { item_id: itemId });
  }

  /** Add an item to the player's inventory. */
  async addItem(name: string, quantity = 1, tags: string[] = []): Promise<{ character: CharacterProfile }> {
    return this.httpPost("/characters/me/add-item", { name, quantity, tags });
  }

  /** Take a short or long rest. */
  async rest(long = false): Promise<{ character: CharacterProfile }> {
    return this.httpPost("/characters/me/rest", { long });
  }

  /** Link a player to a character (host only). */
  async linkCharacter(playerId: string, characterId: string): Promise<{ ok: boolean }> {
    return this.httpPost("/characters/link", { player_id: playerId, character_id: characterId });
  }

  /** List all characters in the session. */
  async listCharacters(): Promise<{ characters: CharacterProfile[] }> {
    return this.httpGet("/characters");
  }

  // ── Combat actions ─────────────────────────────────────────────────

  /** Execute an attack through the server's combat engine. */
  async combatAttack(
    attacker: unknown,
    target: unknown,
    actionId: string,
    prereq: unknown | null,
    attackerConditions: string[],
    targetConditions: string[],
  ): Promise<import("../types").EngineOutcome> {
    return this.httpPost("/combat/attack", {
      attacker,
      target,
      action_id: actionId,
      prereq,
      attacker_conditions: attackerConditions,
      target_conditions: targetConditions,
    });
  }

  /** Heal a combatant through the server. */
  async combatHeal(
    target: unknown,
    amount: number,
  ): Promise<{ healed: number; hit_points: number; status: string | null }> {
    return this.httpPost("/combat/heal", { target, amount });
  }

  /** Toggle a condition on a combatant. */
  async combatCondition(
    targetId: string,
    condition: string,
    add: boolean,
  ): Promise<{ target_id: string; conditions: string[] }> {
    return this.httpPost("/combat/condition", { target_id: targetId, condition, add });
  }

  /** Push the full combatant list to the server (host only). */
  async combatSync(
    combatants: unknown[],
    conditions: Record<string, string[]>,
  ): Promise<{ ok: boolean }> {
    return this.httpPost("/combat/sync", { combatants, conditions });
  }

  /** Roll initiative through the server's dice engine. */
  async rollInitiative(
    combatants: unknown[],
    formula: string,
  ): Promise<import("../types").InitiativeEntry[]> {
    return this.httpPost("/combat/initiative", { combatants, formula });
  }

  /** Replace the shared battle-map state on the server. */
  async updateMap(tokens: unknown[], background: string): Promise<void> {
    await this.httpPost("/map", { tokens, background });
  }

  /** Generic authenticated POST to the session's REST API. */
  async httpPost<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.httpBase}/sessions/${this.sessionId}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.token}`,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: fetchSignal(path),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Server ${path} failed (${res.status}): ${text}`);
    }
    return res.json() as Promise<T>;
  }

  /** Generic authenticated GET to the session's REST API. */
  async httpGet<T>(path: string): Promise<T> {
    const res = await fetch(`${this.httpBase}/sessions/${this.sessionId}${path}`, {
      headers: { Authorization: `Bearer ${this.token}` },
      signal: fetchSignal(path),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Server ${path} failed (${res.status}): ${text}`);
    }
    return res.json() as Promise<T>;
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private cleanup() {
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onclose = null;
      this.ws.onerror = null;
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close();
      }
      this.ws = null;
    }
  }

  private startPing() {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      // Check pong timeout.
      if (Date.now() - this.lastActivity > 90_000) {
        this.ws.close();
        return;
      }
      try {
        this.ws.send(JSON.stringify({ type: "ping" }));
      } catch {
        this.ws.close();
      }
    }, PING_INTERVAL_MS);
  }

  private stopPing() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private scheduleReconnect() {
    if (this.disposed) return;
    const delay = Math.min(
      RECONNECT_BASE_MS * 2 ** this.reconnectAttempts,
      RECONNECT_MAX_MS,
    );
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }
}
