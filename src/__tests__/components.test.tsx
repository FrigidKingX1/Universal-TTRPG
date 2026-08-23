import { describe, it, expect, vi, afterEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ZoneMap } from "../components/ZoneMap";
import { newCharacter, newStatBlock, useStore } from "../store";

describe("ConfirmDialog", () => {
  const noop = () => {};

  it("does not render when closed", () => {
    const { container } = render(
      <ConfirmDialog isOpen={false} title="Delete?" message="Sure?" onConfirm={noop} onCancel={noop} />,
    );
    expect(container.textContent).toBe("");
  });

  it("renders title and message when open", () => {
    render(
      <ConfirmDialog isOpen title="Delete item" message="This cannot be undone." onConfirm={noop} onCancel={noop} />,
    );
    expect(screen.getByText("Delete item")).toBeInTheDocument();
    expect(screen.getByText("This cannot be undone.")).toBeInTheDocument();
  });

  it("calls onConfirm when Confirm is clicked", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog isOpen title="Delete?" message="Sure?" onConfirm={onConfirm} onCancel={onCancel} />,
    );
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("calls onCancel when Cancel is clicked", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog isOpen title="Delete?" message="Sure?" onConfirm={onConfirm} onCancel={onCancel} />,
    );
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("uses danger styling by default", () => {
    render(
      <ConfirmDialog isOpen title="Delete?" message="Sure?" confirmText="Delete" onConfirm={noop} onCancel={noop} />,
    );
    expect(screen.getByRole("button", { name: "Delete" }).className).toContain("btn-danger");
  });
});

describe("ZoneMap", () => {
  const baseZone = {
    id: "z1",
    name: "Haunted Forest",
    zone_type: "hex" as const,
    description: "A foggy forest",
    danger_level: 2,
    mapped: true,
  };

  it("shows placeholder when empty", () => {
    render(<ZoneMap zone={baseZone} nodes={[]} currentNodeId={null} />);
    expect(screen.getByText(/add nodes to see the map/i)).toBeInTheDocument();
  });

  it("renders node names when discovered", () => {
    const nodes = [
      { id: "n1", zone_id: "z1", name: "Crossroads", discovered: true, safe: true, connections: [], contents: [], description: null, notes: null },
      { id: "n2", zone_id: "z1", name: "Ruins", discovered: true, safe: false, connections: [], contents: [], description: null, notes: null },
    ];
    render(<ZoneMap zone={baseZone} nodes={nodes} currentNodeId={null} />);
    expect(screen.getByText("Crossroads")).toBeInTheDocument();
    // In SVG, use getByText for both; check collapsed? Both should be visible.
    expect(document.documentElement.textContent).toContain("Ruins");
  });

  it("hides undiscovered node names behind ???", () => {
    const nodes = [
      { id: "n1", zone_id: "z1", name: "Hidden Shrine", discovered: false, safe: false, connections: [], contents: [], description: null, notes: null },
    ];
    render(<ZoneMap zone={baseZone} nodes={nodes} currentNodeId={null} />);
    expect(screen.getByText("???")).toBeInTheDocument();
  });

  it("calls onTravel for reachable current-neighbor nodes", async () => {
    const user = userEvent.setup();
    const onTravel = vi.fn();
    const nodes = [
      { id: "n1", zone_id: "z1", name: "Camp", discovered: true, safe: true, connections: ["n2"], contents: [], description: null, notes: null },
      { id: "n2", zone_id: "z1", name: "Cave", discovered: true, safe: false, connections: [], contents: [], description: null, notes: null },
    ];
    render(<ZoneMap zone={baseZone} nodes={nodes} currentNodeId="n1" onTravel={onTravel} />);
    const travelNode = screen.getByLabelText(/travel to cave/i);
    await user.click(travelNode);
    expect(onTravel).toHaveBeenCalledWith("n2");
  });

  it("has an accessible map label", () => {
    render(<ZoneMap zone={baseZone} nodes={[]} currentNodeId={null} />);
    const map = screen.getByLabelText(/map of haunted forest/i);
    expect(map).toBeInTheDocument();
  });
});

// ── Character creation & dual-class sheet (round 3 coverage) ──────────
import { NewCharacterForm, CharacterSheet } from "../components/Characters";
import { PRESET_CLASSES, applyClassTemplate, mergeSecondaryClass } from "../presets/classes";

describe("NewCharacterForm", () => {
  it("offers all 36 classes plus a no-class option", () => {
    render(<NewCharacterForm />);
    const classSelect = screen.getByLabelText("Class") as HTMLSelectElement;
    expect(classSelect.options.length).toBe(PRESET_CLASSES.length + 1);
  });

  it("has an optional dual-class dropdown defaulting to none", () => {
    render(<NewCharacterForm />);
    const dual = screen.getByLabelText("Dual class (optional)") as HTMLSelectElement;
    expect(dual.value).toBe("");
    expect(dual.options[0].text).toBe("No dual class");
  });

  it("excludes the chosen primary from the dual-class list", async () => {
    const user = userEvent.setup();
    render(<NewCharacterForm />);
    const classSelect = screen.getByLabelText("Class") as HTMLSelectElement;
    await user.selectOptions(classSelect, "paladin");
    const dual = screen.getByLabelText("Dual class (optional)") as HTMLSelectElement;
    const values = Array.from(dual.options).map((o) => o.value);
    expect(values).not.toContain("paladin");
    expect(values).toContain("wizard");
  });
});

describe("CharacterSheet dual-class rendering", () => {
  const fighter = PRESET_CLASSES.find((c) => c.id === "fighter")!;
  const wizard = PRESET_CLASSES.find((c) => c.id === "wizard")!;
  const base = applyClassTemplate(newCharacter("Gish"), fighter);
  const dualProfile = mergeSecondaryClass(base, wizard);

  it("shows the secondary badge and both feature sections", () => {
    render(<CharacterSheet profile={dualProfile} />);
    expect(screen.getAllByText(/Wizard/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Fighter Features/)).toBeInTheDocument();
    expect(screen.getByText(/Wizard Features/)).toBeInTheDocument();
    // Wizard level-1 features visible under the dual heading.
    expect(screen.getByText("Arcane Recovery")).toBeInTheDocument();
  });

  it("single-class profiles show no secondary badge", () => {
    const solo = applyClassTemplate(newCharacter("Solo"), wizard);
    render(<CharacterSheet profile={solo} />);
    expect(screen.queryByText(/\/ Wizard/)).not.toBeInTheDocument();
    expect(screen.getByText(/Wizard Features/)).toBeInTheDocument();
  });
});

// ── PlayerPanel (multiplayer-mocked, round 5 coverage) ────────────────
import * as multiplayerModule from "../multiplayer/store";
import { PlayerPanel } from "../components/PlayerPanel";

vi.mock("../multiplayer/store", () => {
  const holder: { client: unknown } = { client: null };
  return {
    getMultiplayerClient: () => holder.client,
    __setMockClient: (c: unknown) => { holder.client = c; },
    isInMultiplayerSession: () => false,
    useMultiplayerStore: (sel: (s: unknown) => unknown) =>
      sel({
        playerId: "p1",
        players: [{ id: "p1", name: "Host", connected: true, character_id: "char_1" }],
      }),
  };
});

describe("PlayerPanel", () => {
  const fighter = PRESET_CLASSES.find((c) => c.id === "fighter")!;
  const wizard = PRESET_CLASSES.find((c) => c.id === "wizard")!;
  const seed = () => {
    const base = applyClassTemplate(newCharacter("Gish"), fighter);
    base.id = "char_1";
    const profile = mergeSecondaryClass(base, wizard);
    const goblin = newStatBlock("Punching Bag");
    useStore.setState({ characters: [profile], statBlocks: [goblin], actions: [] });
    return profile;
  };

  afterEach(() => {
    (multiplayerModule as unknown as { __setMockClient: (c: unknown) => void })
      .__setMockClient(null);
  });

  it("renders nothing when there is no multiplayer client", () => {
    seed();
    const { container } = render(<PlayerPanel />);
    expect(container.textContent).toBe("");
  });

  it("shows vitals, class crest, and the Fighter / Wizard meta line", () => {
    (multiplayerModule as unknown as { __setMockClient: (c: unknown) => void })
      .__setMockClient({});
    const profile = seed();
    render(<PlayerPanel />);
    expect(screen.getByText("Gish")).toBeInTheDocument();
    expect(screen.getByText(/Fighter/)).toBeInTheDocument();
    expect(screen.getByText(/\/ Wizard/)).toBeInTheDocument();
    const crest = screen.getByAltText("") as HTMLImageElement;
    expect(crest.src).toContain(`class_${fighter.id}.png`);
    void profile;
  });

  it("ability rows resolve via preset fallback, offer self-target, and gate on slots", async () => {
    const user = userEvent.setup();
    (multiplayerModule as unknown as { __setMockClient: (c: unknown) => void })
      .__setMockClient({});
    const profile = seed();
    // Give an explicitly slot-costed heal ability to exercise gating.
    profile.abilities = ["act_cure_wounds"];
    useStore.setState({ characters: [profile] });

    render(<PlayerPanel />);
    // Empty local vault -> preset fallback still surfaces the action.
    const row = screen.getByRole("button", { name: /Cure Wounds/ });
    expect(row).toBeInTheDocument();

    const target = screen.getByLabelText("Ability target") as HTMLSelectElement;
    const options = Array.from(target.options).map((o) => o.text);
    expect(options.some((t) => t.includes("(you)"))).toBe(true);

    // No target chosen yet -> rows stay disabled even with slots available.
    expect(row).toBeDisabled();

    // Pick self as target -> funded pool enables the cast.
    const youValue = Array.from(target.options).find((o) => o.text.includes("(you)"))!.value;
    await user.selectOptions(target, youValue);
    expect(await screen.findByRole("button", { name: /Cure Wounds/ })).toBeEnabled();

    // Drain the pool -> gated again.
    useStore.setState((s) => ({
      characters: s.characters.map((c) => ({
        ...c,
        resource_pools: {
          ...c.resource_pools,
          spell_slots_l1: { ...c.resource_pools.spell_slots_l1!, current: 0 },
        },
      })),
    }));
    expect(await screen.findByRole("button", { name: /Cure Wounds/ })).toBeDisabled();
  });
});

// ── Combat panel: slot gating, cost labels, heal output (round 6) ─────
const { mockCombatAttack } = vi.hoisted(() => ({ mockCombatAttack: vi.fn() }));
vi.mock("../backend", () => ({
  backend: new Proxy({}, {
    get: (_t, prop) => {
      if (prop === "combatAttack") return (...a: unknown[]) => mockCombatAttack(...(a as []));
      return vi.fn().mockResolvedValue([]);
    },
  }),
}));
import { Combat } from "../components/Combat";

describe("Combat panel", () => {
  const cleric = PRESET_CLASSES.find((c) => c.id === "cleric")!;
  const seedCombat = (slotsCurrent: number) => {
    const c = applyClassTemplate(newCharacter("Mira"), cleric);
    c.abilities = ["act_cure_wounds"];
    c.resource_pools.spell_slots_l1!.current = slotsCurrent;
    const target = newStatBlock("Orc Dummy");
    useStore.setState({
      characters: [c],
      statBlocks: [target],
      actions: [], // empty vault -> preset fallback path
      lastCombat: null,
      combatHistory: [],
    });
    return { c, target };
  };

  /** Several controls share the "Target" label; pick the entity selector. */
  const entityTargetSelect = (blockId: string): HTMLSelectElement => {
    const candidates = screen.getAllByLabelText("Target") as HTMLSelectElement[];
    const found = candidates.find((el) =>
      Array.from(el.options).some((o) => o.value === `block:${blockId}`),
    );
    if (!found) throw new Error("entity Target select not found");
    return found;
  };

  it("action dropdown shows live slot counts from the preset fallback", async () => {
    const user = userEvent.setup();
    const { c, target } = seedCombat(2);
    render(<Combat />);
    await user.selectOptions(screen.getByLabelText("Attacker"), `char:${c.id}`);
    await user.selectOptions(entityTargetSelect(target.id), `block:${target.id}`);
    const actionSel = screen.getByLabelText("Action") as HTMLSelectElement;
    const labels = Array.from(actionSel.options).map((o) => o.text);
    expect(labels.some((t) => t.includes("Cure Wounds") && t.includes("2/2"))).toBe(true);
  });

  it("draining the caster's pool disables Attack as 'No slots'", async () => {
    const user = userEvent.setup();
    const { c, target } = seedCombat(1);
    render(<Combat />);
    await user.selectOptions(screen.getByLabelText("Attacker"), `char:${c.id}`);
    await user.selectOptions(entityTargetSelect(target.id), `block:${target.id}`);
    await user.selectOptions(screen.getByLabelText("Action"), "act_cure_wounds");

    const attackBtn = screen.getByRole("button", { name: "Attack" });
    expect(attackBtn).toBeEnabled();

    useStore.setState((s) => ({
      characters: s.characters.map((x) =>
        x.id === c.id
          ? { ...x, resource_pools: { ...x.resource_pools, spell_slots_l1: { ...x.resource_pools.spell_slots_l1!, current: 0 } } }
          : x,
      ),
    }));
    expect(await screen.findByRole("button", { name: /No slots/ })).toBeDisabled();
  });

  it("heal actions render a green '+N HP restored' result and log line", async () => {
    const user = userEvent.setup();
    const { c, target } = seedCombat(2);
    mockCombatAttack.mockResolvedValue({
      check_result: undefined, check_roll: undefined, check_detail: undefined,
      attack_result: "GUARANTEED", attack_roll: undefined,
      attack_detail: "[2d8 + 2] = 7",
      target_ac: undefined,
      damage_dealt: 0, heal_amount: 7,
      target_hp_remaining: 12, target_status: "ALIVE",
      applied_status: undefined, damage_type: undefined, damage_modifier: undefined,
    });
    render(<Combat />);
    await user.selectOptions(screen.getByLabelText("Attacker"), `char:${c.id}`);
    await user.selectOptions(entityTargetSelect(target.id), `block:${target.id}`);
    await user.selectOptions(screen.getByLabelText("Action"), "act_cure_wounds");
    expect((screen.getByLabelText("Attacker") as HTMLSelectElement).value).toBe(`char:${c.id}`);
    expect((entityTargetSelect(target.id) as HTMLSelectElement).value).toBe(`block:${target.id}`);
    // Drive the store directly: UI gating is covered by the two tests
    // above; this one focuses on the heal outcome rendering contract.
    await act(async () => {
      await useStore.getState().runAttack(c, target, "act_cure_wounds");
    });

    await waitFor(() =>
      expect(useStore.getState().lastCombat?.heal_amount).toBe(7),
    );
    const resultEl = document.querySelector(".combat-result");
    expect(resultEl?.textContent ?? "").toContain("Healed");
    expect(resultEl?.textContent ?? "").toContain("+7");
    expect(mockCombatAttack).toHaveBeenCalledTimes(1);
  });
});
