import { useMemo } from "react";
import type { ExplorationNode, ExplorationZone } from "../types";
import "../App.css";

interface ZoneMapProps {
  zone: ExplorationZone;
  nodes: ExplorationNode[];
  currentNodeId: string | null;
  onTravel?: (nodeId: string) => void;
  onSelect?: (nodeId: string) => void;
}

const WIDTH = 480;
const HEIGHT = 320;
const PADDING = 48;

/**
 * Renders the active zone's nodes as an SVG graph.
 * Undiscovered nodes are fogged; the current position is highlighted.
 * Connected nodes to the current position are clickable for travel.
 */
export function ZoneMap({ zone, nodes, currentNodeId, onTravel, onSelect }: ZoneMapProps) {
  const positions = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    const count = Math.max(nodes.length, 1);
    // Circular layout seeded by node id for stable ordering
    const sorted = [...nodes].sort((a, b) => a.id.localeCompare(b.id));
    sorted.forEach((n, i) => {
      const angle = (2 * Math.PI * i) / count - Math.PI / 2;
      const rx = (WIDTH - PADDING * 2) / 2;
      const ry = (HEIGHT - PADDING * 2) / 2;
      map.set(n.id, {
        x: WIDTH / 2 + rx * Math.cos(angle),
        y: HEIGHT / 2 + ry * Math.sin(angle),
      });
    });
    return map;
  }, [nodes]);

  if (nodes.length === 0) {
    return (
      <div className="zone-map empty">
        <p className="muted">Add nodes to see the map of {zone.name}.</p>
      </div>
    );
  }

  const currentNode = nodes.find((n) => n.id === currentNodeId);
  const edges: Array<{ from: string; to: string }> = [];
  for (const n of nodes) {
    for (const c of n.connections) {
      if (nodes.some((o) => o.id === c)) {
        edges.push({ from: n.id, to: c });
      }
    }
  }

  return (
    <div className="zone-map" aria-label={`Map of ${zone.name} with ${nodes.length} locations`}>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="zone-map-svg" aria-hidden="true">
        <defs>
          <radialGradient id="fog" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(255,255,255,0.06)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0.02)" />
          </radialGradient>
        </defs>

        <rect width={WIDTH} height={HEIGHT} fill="url(#fog)" rx={8} />

        {/* Edges */}
        {edges.map(({ from, to }, i) => {
          const a = positions.get(from);
          const b = positions.get(to);
          if (!a || !b) return null;
          const bothDiscovered =
            nodes.find((n) => n.id === from)?.discovered &&
            nodes.find((n) => n.id === to)?.discovered;
          const isTraversable =
            currentNodeId != null &&
            ((from === currentNodeId && to !== currentNodeId) ||
              (to === currentNodeId && from !== currentNodeId));
          return (
            <line
              key={i}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              className={`zone-edge ${bothDiscovered ? "" : "fogged"} ${isTraversable ? "traversable" : ""}`}
            />
          );
        })}

        {/* Nodes */}
        {nodes.map((n) => {
          const p = positions.get(n.id);
          if (!p) return null;
          const isCurrent = n.id === currentNodeId;
          const isReachable =
            currentNodeId != null && !isCurrent && currentNode?.connections.includes(n.id);
          const fill = isCurrent
            ? "var(--accent)"
            : n.discovered
              ? n.safe
                ? "var(--success)"
                : "var(--danger)"
              : "var(--border-hover)";
          return (
            <g
              key={n.id}
              className={`zone-node ${isCurrent ? "current" : ""} ${isReachable ? "reachable" : ""}`}
              onClick={() => {
                if (isReachable && onTravel) onTravel(n.id);
                else if (onSelect) onSelect(n.id);
              }}
              onKeyDown={(e) => {
                if ((e.key === "Enter" || e.key === " ") && isReachable && onTravel) {
                  e.preventDefault();
                  onTravel(n.id);
                }
              }}
              tabIndex={isReachable ? 0 : undefined}
              role={isReachable ? "button" : undefined}
              aria-label={
                isReachable && n.discovered
                  ? `Travel to ${n.name}${n.safe ? " (safe)" : " (dangerous)"}`
                  : n.discovered
                    ? n.name
                    : "Undiscovered location"
              }
              style={{ cursor: isReachable ? "pointer" : "default" }}
            >
              {isCurrent && <circle cx={p.x} cy={p.y} r={18} className="zone-node-pulse" />}
              <circle cx={p.x} cy={p.y} r={12} fill={fill} stroke="var(--text)" strokeWidth={1.5} opacity={n.discovered ? 1 : 0.45} />
              <text x={p.x} y={p.y + 26} textAnchor="middle" className="zone-node-label" opacity={n.discovered ? 1 : 0.4}>
                {n.discovered ? n.name : "???"}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="zone-map-legend">
        <span><span className="legend-dot" style={{ background: "var(--accent)" }} /> You</span>
        <span><span className="legend-dot" style={{ background: "var(--success)" }} /> Safe</span>
        <span><span className="legend-dot" style={{ background: "var(--danger)" }} /> Danger</span>
        <span><span className="legend-dot" style={{ background: "var(--border-hover)" }} /> Unexplored</span>
      </div>
    </div>
  );
}
