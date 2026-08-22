// Player List — shows connected players in the session.
// Used in the sidebar or as a floating panel.

import { useMultiplayerStore } from "../multiplayer";
import { Users } from "lucide-react";

export function PlayerList() {
  const players = useMultiplayerStore((s) => s.players);
  const connected = useMultiplayerStore((s) => s.connected);
  const sessionId = useMultiplayerStore((s) => s.sessionId);

  if (!sessionId) return null;

  return (
    <div className="player-list">
      <div className="panel-header">
        <Users size={14} />
        <span>Players</span>
        <span className={`status-dot-sm ${connected ? "online" : "offline"}`} />
      </div>
      <div className="player-list-body">
        {players.length === 0 ? (
          <div className="player-list-empty">No players yet</div>
        ) : (
          players.map((p) => (
            <div key={p.id} className="player-entry">
              <span className={`player-dot ${p.connected ? "online" : "offline"}`} />
              <span className="player-name">{p.name}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
