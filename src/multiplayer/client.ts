// WebSocket client for the auto-dm multiplayer server.
// Handles connection, resync, event dispatch, and ping/pong heartbeat.

import type { GameEvent, ResyncPayload, WsMessage } from "./types";

export type WsEventHandler = (event: GameEvent) => void;
export type ResyncHandler = (payload: ResyncPayload) => void;
export type ConnectionHandler = (connected: boolean) => void;

const PING_INTERVAL_MS = 30_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

export class MultiplayerClient {
  private ws: WebSocket | null = null;
  private url: string;
  private onEvent: WsEventHandler;
  private onResync: ResyncHandler;
  private onConnection: ConnectionHandler;
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
  }) {
    // Strip trailing slash from server URL.
    const base = opts.serverUrl.replace(/\/+$/, "");
    this.url = `${base}/sessions/${opts.sessionId}/ws?token=${encodeURIComponent(opts.token)}`;
    this.onEvent = opts.onEvent;
    this.onResync = opts.onResync;
    this.onConnection = opts.onConnection;
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
      this.lastActivity = Date.now();
      try {
        const msg: WsMessage = JSON.parse(ev.data);
        if (msg.type === "event") {
          this.onEvent(msg.event);
        } else if (msg.type === "resync") {
          this.onResync(msg.payload);
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
