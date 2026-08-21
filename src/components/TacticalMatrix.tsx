import { useState } from "react";
import { Map, MapPinned, Check, CircleAlert, HelpCircle } from "lucide-react";
import { useStore } from "../store";
import type { ExplorationNode, DoomClock } from "../types";
import "../App.css";

export function TacticalMatrix() {
  const zones = useStore((s) => s.explorationZones);
  const nodes = useStore((s) => s.explorationNodes);
  const threads = useStore((s) => s.plotThreads);
  const doomClocks = useStore((s) => s.doomClocks);
  const statBlocks = useStore((s) => s.statBlocks);
  const activeZoneId = useStore((s) => s.activeZoneId);

  const activeZone = activeZoneId
    ? zones.find((z) => z.id === activeZoneId)
    : null;

  const zoneNodes = activeZoneId
    ? nodes.filter((n) => n.zone_id === activeZoneId)
    : [];

  const [activeTab, setActiveTab] = useState<"map" | "npcs" | "clocks" | "threads">("map");

  const renderMap = () => {
    if (!activeZone) {
      return (
        <div className="fantasy-empty" style={{ padding: "1rem" }}>
          <span className="fantasy-empty-icon" aria-hidden="true">🗺️</span>
          <span>Select a zone to begin exploring.</span>
        </div>
      );
    }

    return (
      <div className="zone-map">
        <div className="zone-header">
          <h3>{activeZone.name}</h3>
          <span className="zone-meta">
            {activeZone.zone_type} | Danger: {activeZone.danger_level}
            {activeZone.mapped ? (<><MapPinned size={12} style={{ display: "inline", verticalAlign: "-1px", marginLeft: "6px" }} /> Mapped</>) : ""}
          </span>
          {activeZone.description && (
            <p className="zone-description">{activeZone.description}</p>
          )}
        </div>

        <div className="node-list">
          {zoneNodes.length === 0 ? (
            <p className="no-nodes">No nodes discovered in this zone.</p>
          ) : (
            zoneNodes.map((node) => (
              <NodeCard key={node.id} node={node} />
            ))
          )}
        </div>
      </div>
    );
  };

  const renderNpcs = () => {
    return (
      <div className="matrix-npcs">
        <h3>NPC Knowledge</h3>
        {statBlocks.length === 0 ? (
          <div className="fantasy-empty" style={{ padding: "0.8rem" }}>
            <span>No NPC data — add stat blocks in the Bestiary.</span>
          </div>
        ) : (
          <div className="npc-list">
            {statBlocks.map((sb) => (
              <div key={sb.id} className="npc-card">
                <div className="npc-name">{sb.name}</div>
                <div className="npc-meta">{sb.type ?? "Unknown"}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderClocks = () => {
    return (
      <div className="matrix-clocks">
        <h3>Doom Clocks</h3>
        {doomClocks.length === 0 ? (
          <div className="fantasy-empty" style={{ padding: "0.8rem" }}>
            <span>No doom clocks — time is on your side, for now.</span>
          </div>
        ) : (
          <div className="clock-list">
            {doomClocks.map((clock) => (
              <DoomClockCard key={clock.id} clock={clock} />
            ))}
          </div>
        )}
      </div>
    );
  };

  const renderThreads = () => {
    return (
      <div className="matrix-threads">
        <h3>Plot Threads</h3>
        {threads.length === 0 ? (
          <div className="fantasy-empty" style={{ padding: "0.8rem" }}>
            <span>No plot threads — the weave is quiet.</span>
          </div>
        ) : (
          <div className="thread-list">
            {threads.map((thread) => (
              <div key={thread.id} className={`thread-card status-${thread.status}`}>
                <div className="thread-description">{thread.description}</div>
                <span className="thread-status">{thread.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <aside className="panel tactical-matrix">
      <div className="panel-header">
        <span className="panel-icon" aria-hidden="true"><Map size={16} strokeWidth={1.7} /></span>
        <span className="panel-title">Tactical Matrix</span>
      </div>

      <div className="matrix-tabs">
        <button
          className={`tab ${activeTab === "map" ? "active" : ""}`}
          onClick={() => setActiveTab("map")}
        >
          Map
        </button>
        <button
          className={`tab ${activeTab === "npcs" ? "active" : ""}`}
          onClick={() => setActiveTab("npcs")}
        >
          NPCs
        </button>
        <button
          className={`tab ${activeTab === "clocks" ? "active" : ""}`}
          onClick={() => setActiveTab("clocks")}
        >
          Clocks
        </button>
        <button
          className={`tab ${activeTab === "threads" ? "active" : ""}`}
          onClick={() => setActiveTab("threads")}
        >
          Threads
        </button>
      </div>

      <div className="matrix-content">
        {activeTab === "map" && renderMap()}
        {activeTab === "npcs" && renderNpcs()}
        {activeTab === "clocks" && renderClocks()}
        {activeTab === "threads" && renderThreads()}
      </div>
    </aside>
  );
}

function NodeCard({ node }: { node: ExplorationNode }) {
  const discovered = node.discovered;
  const safe = node.safe;

  return (
    <div className={`node-card ${discovered ? "discovered" : "undiscovered"} ${safe ? "safe" : "dangerous"}`}>
      <div className="node-header">
        <span className="node-icon">
          {discovered ? (safe ? <Check size={12} strokeWidth={2} /> : <CircleAlert size={12} strokeWidth={2} />) : <HelpCircle size={12} strokeWidth={2} />}
        </span>
        <span className="node-name">{node.name}</span>
      </div>
      {discovered && node.description && (
        <div className="node-description">{node.description}</div>
      )}
      {discovered && node.contents.length > 0 && (
        <div className="node-contents">
          <span>Contents: {node.contents.join(", ")}</span>
        </div>
      )}
    </div>
  );
}

function DoomClockCard({ clock }: { clock: DoomClock }) {
  const ticks = Array.from({ length: clock.max }, (_, i) => i < clock.current);
  return (
    <div className="doom-clock-card">
      <div className="clock-label">{clock.label}</div>
      <div className="clock-ticks">
        {ticks.map((filled, i) => (
          <span
            key={i}
            className={`tick ${filled ? "filled" : "empty"}`}
            aria-label={filled ? `Tick ${i + 1} filled` : `Tick ${i + 1} empty`}
          />
        ))}
      </div>
      {clock.consequence && (
        <div className="clock-consequence">{clock.consequence}</div>
      )}
    </div>
  );
}
