import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { ZoneMap } from "../components/ZoneMap";

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
