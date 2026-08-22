// Turn Indicator — shows whose turn it is in combat.
// Displays in the combat panel or as a floating banner.

import { useMultiplayerStore } from "../multiplayer";
import { Swords, SkipForward } from "lucide-react";

export function TurnIndicator() {
  const gameMode = useMultiplayerStore((s) => s.gameMode);
  const currentTurn = useMultiplayerStore((s) => s.currentTurn);
  const players = useMultiplayerStore((s) => s.players);
  const playerId = useMultiplayerStore((s) => s.playerId);
  const sessionId = useMultiplayerStore((s) => s.sessionId);
  const skipTurn = useMultiplayerStore((s) => s.skipTurn);

  if (!sessionId || gameMode !== "combat") return null;

  const currentPlayer = players.find((p) => p.id === currentTurn);
  const isMyTurn = currentTurn === playerId;
  const name = currentPlayer?.name ?? currentTurn?.slice(0, 8) ?? "Unknown";

  return (
    <div className={`turn-indicator ${isMyTurn ? "my-turn" : ""}`}>
      <Swords size={14} />
      <span className="turn-label">
        {isMyTurn ? "Your turn" : `${name}'s turn`}
      </span>
      {isMyTurn && (
        <button className="btn btn-sm btn-ghost" onClick={skipTurn} title="Skip turn">
          <SkipForward size={12} />
        </button>
      )}
    </div>
  );
}
