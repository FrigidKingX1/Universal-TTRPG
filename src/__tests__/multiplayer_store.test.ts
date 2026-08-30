// Regression coverage for the scoped map drag guard (QA round).
// While token T is being dragged locally, incoming authoritative boards
// must preserve T's in-flight position but still apply every other
// player's token moves — previously ANY local drag suppressed ALL
// incoming board updates for its whole duration.

import { describe, it, expect, beforeEach } from "vitest";
import {
  useMultiplayerStore,
  mapDragGuard,
  initMultiplayerBridge,
} from "../multiplayer/store";

type MainState = {
  mapTokens: Array<{ id: string; x: number; y: number }>;
  mapBackground: string;
  [key: string]: any;
};

function makeMainStore() {
  let state: MainState = {
    mapTokens: [],
    mapBackground: "",
  };
  const get = () => state;
  const set = (fn: (s: MainState) => Partial<MainState>) => {
    state = { ...state, ...fn(state) };
  };
  return { get, set, snapshot: () => state };
}

const BOARD = [
  { id: "dragged", x: 9, y: 9 },
  { id: "other", x: 5, y: 5 },
];

describe("scoped mapDragGuard", () => {
  beforeEach(() => {
    mapDragGuard.until = 0;
    mapDragGuard.tokenId = null;
  });

  it("keeps the dragged token local but applies other tokens mid-drag", () => {
    const main = makeMainStore();
    main.set(() => ({
      mapTokens: [
        { id: "dragged", x: 42, y: 43 },
        { id: "other", x: 2, y: 2 },
      ],
    }));
    initMultiplayerBridge(main.get, main.set as any);

    mapDragGuard.until = Date.now() + 60_000;
    mapDragGuard.tokenId = "dragged";

    useMultiplayerStore.getState()._handleEvent({
      type: "map_updated",
      tokens: BOARD as any,
      background: "bg.png",
    });

    const t = Object.fromEntries(
      main.snapshot().mapTokens.map((tok) => [tok.id, tok]),
    );
    // In-flight drag position survives…
    expect(t.dragged.x).toBe(42);
    expect(t.dragged.y).toBe(43);
    // …while the other player's move lands immediately.
    expect(t.other.x).toBe(5);
    expect(t.other.y).toBe(5);
    expect(main.snapshot().mapBackground).toBe("bg.png");
  });

  it("applies the full remote board once the drag ends", () => {
    const main = makeMainStore();
    main.set(() => ({
      mapTokens: [
        { id: "dragged", x: 42, y: 43 },
        { id: "other", x: 2, y: 2 },
      ],
    }));
    initMultiplayerBridge(main.get, main.set as any);

    mapDragGuard.until = Date.now() - 1; // expired
    mapDragGuard.tokenId = "dragged";

    useMultiplayerStore.getState()._handleEvent({
      type: "map_updated",
      tokens: BOARD as any,
      background: "",
    });

    const t = Object.fromEntries(
      main.snapshot().mapTokens.map((tok) => [tok.id, tok]),
    );
    expect(t.dragged.x).toBe(9);
    expect(t.other.x).toBe(5);
  });

  it("resync honors the same scoped merge", () => {
    const main = makeMainStore();
    main.set(() => ({
      mapTokens: [{ id: "dragged", x: 7, y: 7 }],
    }));
    initMultiplayerBridge(main.get, main.set as any);

    mapDragGuard.until = Date.now() + 60_000;
    mapDragGuard.tokenId = "dragged";

    useMultiplayerStore.getState()._handleResync({
      scene: null,
      scene_summary: "",
      doom_clocks: [],
      npcs: [],
      loot: [],
      threads: [],
      summaries: [],
      combat_state: null,
      characters: [],
      player_characters: {},
      combatants: [],
      combatant_conditions: {},
      recent_logs: [],
      map_tokens: [
        { id: "dragged", x: 99, y: 99 },
        { id: "other", x: 3, y: 3 },
      ],
      map_background: "",
      turn: null,
    } as any);

    const t = Object.fromEntries(
      main.snapshot().mapTokens.map((tok) => [tok.id, tok]),
    );
    expect(t.dragged.x).toBe(7); // protected mid-drag
    expect(t.other?.x).toBe(3); // newcomer still arrives
  });

  it("resync hydrates turn state so reconnectors see the live turn", () => {
    const main = makeMainStore();
    initMultiplayerBridge(main.get, main.set as any);

    useMultiplayerStore.getState()._handleResync({
      scene: null,
      scene_summary: "",
      doom_clocks: [],
      npcs: [],
      loot: [],
      threads: [],
      summaries: [],
      combat_state: null,
      characters: [],
      player_characters: {},
      combatants: [],
      combatant_conditions: {},
      recent_logs: [],
      map_tokens: [],
      map_background: "",
      turn: { mode: "combat", current_turn: "alice", queue: ["bob"] },
    } as any);

    const mp = useMultiplayerStore.getState();
    expect(mp.gameMode).toBe("combat");
    expect(mp.currentTurn).toBe("alice");
    expect(mp.turnQueue).toEqual(["bob"]);
  });

  it("resync hydrates initiative order and aligns the turn pointer", () => {
    const main = makeMainStore();
    initMultiplayerBridge(main.get, main.set as any);

    // Turn-holder is the second entry — pointer must land on them, not idx 0.
    useMultiplayerStore.setState({ currentTurn: "bob" });
    useMultiplayerStore.getState()._handleResync({
      scene: null,
      scene_summary: "",
      doom_clocks: [],
      npcs: [],
      loot: [],
      threads: [],
      summaries: [],
      combat_state: null,
      characters: [],
      player_characters: {},
      combatants: [],
      combatant_conditions: {},
      recent_logs: [],
      map_tokens: [],
      map_background: "",
      turn: null,
      initiative: [
        { combatant_id: "gob1", name: "Goblin", roll: 17, modifier: 2 },
        { combatant_id: "bob", name: "Bob", roll: 12, modifier: 2 },
      ],
    } as any);

    expect(main.snapshot().initiativeOrder).toHaveLength(2);
    expect(main.snapshot().currentTurnIndex).toBe(1); // Bob's seat
    expect(main.snapshot().currentRound).toBe(1); // fresh order starts at 1
  });

  it("drops queued events already covered by the resync snapshot", () => {
    const main = makeMainStore();
    initMultiplayerBridge(main.get, main.set as any);

    useMultiplayerStore.getState()._handleResync({
      scene: null,
      scene_summary: "",
      doom_clocks: [
        { id: "clock1", name: "Ritual", current: 3, max: 6, consequence: "", active: true },
      ],
      npcs: [],
      loot: [],
      threads: [],
      summaries: [],
      combat_state: null,
      characters: [],
      player_characters: {},
      combatants: [],
      combatant_conditions: {},
      recent_logs: [],
      map_tokens: [],
      map_background: "",
      turn: null,
      last_event_seq: 5, // snapshot reflects effects up to seq 5
    } as any);

    // Replayed frame from before the snapshot — must be swallowed.
    useMultiplayerStore.getState()._handleEvent(
      { type: "clock_advanced", clock_id: "clock1", ticks: 2 },
      4,
    );
    expect(main.snapshot().doomClocks[0].current).toBe(3);

    // Genuinely new event — applies normally.
    useMultiplayerStore.getState()._handleEvent(
      { type: "clock_advanced", clock_id: "clock1", ticks: 2 },
      6,
    );
    expect(main.snapshot().doomClocks[0].current).toBe(5);
  });

  it("applies unsequenced events regardless of resync state (older servers)", () => {
    const main = makeMainStore();
    initMultiplayerBridge(main.get, main.set as any);

    useMultiplayerStore.getState()._handleResync({
      scene: null,
      scene_summary: "",
      doom_clocks: [
        { id: "clock1", name: "Ritual", current: 0, max: 6, consequence: "", active: true },
      ],
      npcs: [], loot: [], threads: [], summaries: [], combat_state: null,
      characters: [], player_characters: {}, combatants: [],
      combatant_conditions: {}, recent_logs: [], map_tokens: [],
      map_background: "", turn: null,
    } as any);
    // No last_event_seq in payload → lastAppliedEventSeq stays 0.

    useMultiplayerStore.getState()._handleEvent(
      { type: "clock_advanced", clock_id: "clock1", ticks: 1 },
    ); // no seq — legacy server
    expect(main.snapshot().doomClocks[0].current).toBe(1);
  });

  it("_handleTurnState mirrors the server push into the store", () => {
    useMultiplayerStore.getState()._handleTurnState({
      mode: "combat",
      current_turn: "carol",
      queue: ["alice", "bob"],
    });

    const mp = useMultiplayerStore.getState();
    expect(mp.gameMode).toBe("combat");
    expect(mp.currentTurn).toBe("carol");
    expect(mp.turnQueue).toEqual(["alice", "bob"]);
  });

  it("_resetReplayState lets a NEW session's low-seq events apply", () => {
    const main = makeMainStore();
    initMultiplayerBridge(main.get, main.set as any);
    main.set(() => ({
      doomClocks: [
        { id: "old", name: "Old", current: 0, max: 6, consequence: "", active: true },
        { id: "new-clock", name: "Fresh", current: 0, max: 6, consequence: "", active: true },
      ],
    }));

    // Old session climbed to seq 50 before ending.
    useMultiplayerStore.getState()._handleEvent(
      { type: "clock_advanced", clock_id: "old", ticks: 1 },
      50,
    );
    expect(main.snapshot().doomClocks[0].current).toBe(1); // applied pre-reset

    // Switch sessions: connect() resets replay state.
    useMultiplayerStore.getState()._resetReplayState();

    // New session's board has its own clock.
    main.set(() => ({
      doomClocks: [
        { id: "old", name: "Old", current: 0, max: 6, consequence: "", active: true },
        { id: "new-clock", name: "Fresh", current: 0, max: 6, consequence: "", active: true },
      ],
    }));

    // New session's resync has no last_event_seq (fresh counter at 0), and
    // its first event arrives with seq 1 — must NOT be swallowed by the
    // previous session's high-water mark.
    useMultiplayerStore.getState()._handleResync({
      scene: null,
      scene_summary: "",
      doom_clocks: [
        { id: "new-clock", name: "Fresh", current: 0, max: 6, consequence: "", active: true },
      ],
      npcs: [], loot: [], threads: [], summaries: [], combat_state: null,
      characters: [], player_characters: {}, combatants: [],
      combatant_conditions: {}, recent_logs: [], map_tokens: [],
      map_background: "", turn: null,
    } as any);

    useMultiplayerStore.getState()._handleEvent(
      { type: "clock_advanced", clock_id: "new-clock", ticks: 3 },
      1,
    );
    expect(main.snapshot().doomClocks[0].current).toBe(3);
  });

  it("resync hydrates the live roster so presence stays accurate", () => {
    const main = makeMainStore();
    initMultiplayerBridge(main.get, main.set as any);

    useMultiplayerStore.getState()._handleResync({
      scene: null,
      scene_summary: "",
      doom_clocks: [],
      npcs: [],
      loot: [],
      threads: [],
      summaries: [],
      combat_state: null,
      characters: [],
      player_characters: {},
      combatants: [],
      combatant_conditions: {},
      recent_logs: [],
      map_tokens: [],
      map_background: "",
      turn: null,
      players: [
        { id: "host", name: "Host", connected: true, character_id: null },
        { id: "p2", name: "Remote", connected: false, character_id: "c2" },
      ],
    } as any);

    const mp = useMultiplayerStore.getState();
    expect(mp.players).toEqual([
      { id: "host", name: "Host", connected: true, character_id: null },
      { id: "p2", name: "Remote", connected: false, character_id: "c2" },
    ]);
  });

  it("healed event updates combatant HP on remote clients", () => {
    const main = makeMainStore();
    main.set(() => ({
      combatantStates: {
        fighter: { hit_points: 10, maxHp: 50, ac: 18, conditions: [] },
      },
    }));
    initMultiplayerBridge(main.get, main.set as any);

    useMultiplayerStore.getState()._handleEvent({
      type: "healed",
      target_id: "fighter",
      target_name: "Fighter",
      amount: 15,
      hp_remaining: 25,
    });

    expect(main.snapshot().combatantStates.fighter.hit_points).toBe(25);
  });
});
