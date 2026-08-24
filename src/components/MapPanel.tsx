import { useRef, useState } from "react";
import { useStore } from "../store";
import { resolvePortrait } from "../assets";
import type { CharacterProfile, EncounterStatBlock, MapToken } from "../types";

/**
 * Minimal battle map (Phase 1): background image + grid overlay, tokens
 * spawned from characters/bestiary entries, pointer-drag movement.
 * Positions are percentages of the board so any window size works.
 */
export function MapPanel() {
  const mapTokens = useStore((s) => s.mapTokens);
  const mapBackground = useStore((s) => s.mapBackground);
  const characters = useStore((s) => s.characters);
  const statBlocks = useStore((s) => s.statBlocks);
  const initiativeOrder = useStore((s) => s.initiativeOrder);
  const currentTurnIndex = useStore((s) => s.currentTurnIndex);

  const spawnMapToken = useStore((s) => s.spawnMapToken);
  const moveMapToken = useStore((s) => s.moveMapToken);
  const removeMapToken = useStore((s) => s.removeMapToken);
  const clearMapTokens = useStore((s) => s.clearMapTokens);
  const setMapBackground = useStore((s) => s.setMapBackground);

  const boardRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    id: string;
    startClientX: number;
    startClientY: number;
    startX: number;
    startY: number;
    width: number;
  } | null>(null);
  const [spawnKey, setSpawnKey] = useState("");
  const [showGrid, setShowGrid] = useState(true);

  const entities: Array<{ key: string; label: string; value: CharacterProfile | EncounterStatBlock }> = [
    ...characters.map((c) => ({ key: `char:${c.id}`, label: c.identity.name, value: c as CharacterProfile | EncounterStatBlock })),
    ...statBlocks.map((b) => ({ key: `block:${b.id}`, label: b.name, value: b as EncounterStatBlock | CharacterProfile })),
  ];

  const currentTurnId =
    initiativeOrder.length > 0 ? initiativeOrder[currentTurnIndex]?.combatant_id : null;

  const clampPct = (n: number) => Math.min(100, Math.max(0, n));

  const onTokenPointerDown = (
    e: React.PointerEvent<HTMLDivElement>,
    token: MapToken,
  ) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const rect = boardRef.current?.getBoundingClientRect();
    dragRef.current = {
      id: token.id,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startX: token.x,
      startY: token.y,
      // Guard for jsdom / unrendered layouts: fall back to px==pct.
      width: rect?.width || 100,
    };
  };

  const onBoardPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    const board = boardRef.current;
    if (!d || !board) return;
    const dxPct = ((e.clientX - d.startClientX) / d.width) * 100;
    const dyPct = ((e.clientY - d.startClientY) / (board.clientHeight || 100)) * 100;
    moveMapToken(d.id, clampPct(d.startX + dxPct), clampPct(d.startY + dyPct));
  };

  const onBoardPointerUp = () => {
    dragRef.current = null;
  };

  return (
    <section className="panel">
      <h2>Battle Map</h2>

      {/* Spawn + scene controls */}
      <div className="row" style={{ marginBottom: "0.5rem" }}>
        <label>
          Spawn
          <select value={spawnKey} onChange={(e) => setSpawnKey(e.currentTarget.value)}>
            <option value="">—</option>
            {entities.map((e) => (
              <option key={e.key} value={e.key}>{e.label}</option>
            ))}
          </select>
        </label>
        <button
          disabled={!spawnKey}
          onClick={() => {
            const found = entities.find((e) => e.key === spawnKey);
            if (found) {
              spawnMapToken(found.value);
              setSpawnKey("");
            }
          }}
        >
          Add Token
        </button>
        <button onClick={clearMapTokens} disabled={mapTokens.length === 0} className="danger">
          Clear Map
        </button>
      </div>
      <div className="row" style={{ marginBottom: "0.5rem" }}>
        <input
          value={mapBackground}
          onChange={(e) => setMapBackground(e.currentTarget.value)}
          placeholder="Map image URL or path (e.g. assets/maps/tavern.jpg)"
          style={{ flex: 1 }}
          aria-label="Map background"
        />
        <label style={{ display: "flex", alignItems: "center", gap: "0.3rem", fontSize: "0.85rem" }}>
          <input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.currentTarget.checked)} />
          Grid
        </label>
      </div>

      {/* The board */}
      <div
        ref={boardRef}
        className={`map-board ${showGrid ? "map-grid" : ""}`}
        onPointerMove={onBoardPointerMove}
        onPointerUp={onBoardPointerUp}
        onPointerLeave={onBoardPointerUp}
        role="application"
        aria-label="Battle map board"
      >
        {mapBackground && (
          <img src={mapBackground} alt="" className="map-bg" draggable={false} />
        )}
        {mapTokens.length === 0 && !mapBackground && (
          <div className="fantasy-empty" role="status">
            <span className="fantasy-empty-icon" aria-hidden="true">🗺️</span>
            <p>Spawn a token or set a background image to begin.</p>
          </div>
        )}
        {mapTokens.map((t) => {
          const isCurrentTurn = t.entity_id === currentTurnId;
          return (
            <div
              key={t.id}
              className={`map-token ${isCurrentTurn ? "active-turn" : ""}`}
              style={{ left: `${t.x}%`, top: `${t.y}%`, background: t.color }}
              title={`${t.label}${isCurrentTurn ? " — active turn" : ""}`}
              onPointerDown={(e) => onTokenPointerDown(e, t)}
              onDoubleClick={() => removeMapToken(t.id)}
              role="button"
              aria-label={`Map token ${t.label}`}
            >
              <TokenFace entityId={t.entity_id} label={t.label} />
            </div>
          );
        })}
      </div>
      <p className="muted" style={{ fontSize: "0.8rem", margin: "0.35rem 0 0" }}>
        Drag tokens to move · double-click removes · gold ring marks the active combat turn.
      </p>
    </section>
  );
}

/** Monster tokens show their auto-loaded portrait art; others show an initial. */
function TokenFace({ entityId, label }: { entityId: string; label: string }) {
  const statBlocks = useStore((s) => s.statBlocks);
  const sb = statBlocks.find((b) => b.id === entityId);
  const src = sb ? resolvePortrait(sb) : null;

  if (src) {
    return (
      <img
        src={src}
        alt={label}
        draggable={false}
        onError={(e) => {
          const img = e.currentTarget;
          img.style.display = "none";
          const parent = img.parentElement;
          if (parent && !parent.dataset.fallback) {
            parent.dataset.fallback = "1";
            const span = document.createElement("span");
            span.className = "map-token-letter";
            span.textContent = label.charAt(0);
            parent.appendChild(span);
          }
        }}
      />
    );
  }
  return <span className="map-token-letter">{label.charAt(0)}</span>;
}
