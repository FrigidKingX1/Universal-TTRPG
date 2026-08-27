// Combat Queue — shows the turn order during combat.
// Lists who's waiting and their position.

import { useMultiplayerStore } from "../multiplayer";
import { ListOrdered, Swords } from "lucide-react";

export function CombatQueue() {
  const gameMode = useMultiplayerStore((s) => s.gameMode);
  const currentTurn = useMultiplayerStore((s) => s.currentTurn);
  const turnQueue = useMultiplayerStore((s) => s.turnQueue);
  const players = useMultiplayerStore((s) => s.players);
  const sessionId = useMultiplayerStore((s) => s.sessionId);
  const startCombat = useMultiplayerStore((s) => s.startCombat);
  const endCombat = useMultiplayerStore((s) => s.endCombat);
  const joinCombatQueue = useMultiplayerStore((s) => s.joinCombatQueue);
  const playerId = useMultiplayerStore((s) => s.playerId);
  const isHost = useMultiplayerStore((s) => s.isHost);

  if (!sessionId) return null;

  if (gameMode !== "combat") {
    return (
      <div className="combat-queue">
        <div className="panel-header">
          <Swords size={14} />
          <span>Combat</span>
        </div>
        <div className="combat-queue-body">
          <div className="combat-queue-empty">Not in combat</div>
          {isHost && (
            <button className="btn btn-sm btn-primary" onClick={startCombat}>
              Start Combat
            </button>
          )}
        </div>
      </div>
    );
  }

  const currentPlayer = players.find((p) => p.id === currentTurn);

  return (
    <div className="combat-queue">
      <div className="panel-header">
        <Swords size={14} />
        <span>Combat — Turn Order</span>
      </div>
      <div className="combat-queue-body">
        {/* Current turn holder */}
        <div className="queue-current">
          <span className="queue-label">Active</span>
          <span className="queue-player">
            {currentPlayer?.name ?? currentTurn?.slice(0, 8) ?? "?"}
          </span>
        </div>

        {/* Waiting queue */}
        {turnQueue.length > 0 && (
          <div className="queue-waiting">
            <ListOrdered size={12} />
            <span className="queue-label">Waiting</span>
            {turnQueue.map((pid, i) => {
              const p = players.find((pl) => pl.id === pid);
              return (
                <div key={pid} className="queue-entry">
                  <span className="queue-pos">{i + 1}.</span>
                  <span className="queue-player">
                    {p?.name ?? pid.slice(0, 8)}
                    {pid === playerId && " (you)"}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* Join queue button */}
        {!turnQueue.includes(playerId ?? "") && currentTurn !== playerId && (
          <button className="btn btn-sm btn-ghost" onClick={joinCombatQueue}>
            Join Queue
          </button>
        )}

        {/* End combat (host only) */}
        {isHost && (
          <button className="btn btn-sm btn-danger" onClick={endCombat}>
            End Combat
          </button>
        )}
      </div>
    </div>
  );
}
