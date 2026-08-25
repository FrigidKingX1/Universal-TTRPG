// Unit tests for multiplayer client helpers — C4/C5 closeout.
// toWebSocketUrl must produce valid ws(s) URLs from any server base the
// user can enter (localhost http, Cloudflare Tunnel https, bare host).

import { describe, it, expect } from "vitest";
import { toWebSocketUrl } from "../multiplayer/client";

describe("toWebSocketUrl", () => {
  it("maps http:// to ws://", () => {
    expect(toWebSocketUrl("http://localhost:3000")).toBe("ws://localhost:3000");
  });

  it("maps https:// to wss:// (Cloudflare Tunnel)", () => {
    expect(
      toWebSocketUrl("https://random-words.trycloudflare.com")
    ).toBe("wss://random-words.trycloudflare.com");
  });

  it("passes through already-valid ws:// and wss:// URLs", () => {
    expect(toWebSocketUrl("ws://192.168.1.10:3000")).toBe("ws://192.168.1.10:3000");
    expect(toWebSocketUrl("wss://table.example.com")).toBe("wss://table.example.com");
  });

  it("assumes secure for bare hosts (host or host:port)", () => {
    expect(toWebSocketUrl("table.example.com")).toBe("wss://table.example.com");
    expect(toWebSocketUrl("table.example.com:8443")).toBe("wss://table.example.com:8443");
  });

  it("strips trailing slashes before mapping", () => {
    expect(toWebSocketUrl("http://localhost:3000/")).toBe("ws://localhost:3000");
    expect(toWebSocketUrl("https://tunnel.example.com///")).toBe("wss://tunnel.example.com");
  });

  it("trims surrounding whitespace", () => {
    expect(toWebSocketUrl("  https://tunnel.example.com  ")).toBe(
      "wss://tunnel.example.com"
    );
  });
});
