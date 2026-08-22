// Session Lobby — create a new session (host) or join with a code (player).
// Renders as a modal overlay.

import { useState } from "react";
import { useMultiplayerStore } from "../multiplayer";
import { backend } from "../backend";
import { Users, Plus, LogIn, X, Copy, Check, Upload } from "lucide-react";

export function SessionLobby() {
  const lobbyOpen = useMultiplayerStore((s) => s.lobbyOpen);
  const setLobbyOpen = useMultiplayerStore((s) => s.setLobbyOpen);
  const createSession = useMultiplayerStore((s) => s.createSession);
  const joinSession = useMultiplayerStore((s) => s.joinSession);
  const serverUrl = useMultiplayerStore((s) => s.serverUrl);
  const setServerUrl = useMultiplayerStore((s) => s.setServerUrl);
  const connected = useMultiplayerStore((s) => s.connected);
  const sessionId = useMultiplayerStore((s) => s.sessionId);
  const joinCode = useMultiplayerStore((s) => s.joinCode);
  const isHost = useMultiplayerStore((s) => s.isHost);
  const leaveSession = useMultiplayerStore((s) => s.leaveSession);
  const importCampaign = useMultiplayerStore((s) => s.importCampaign);

  const [tab, setTab] = useState<"create" | "join">("join");
  const [title, setTitle] = useState("Campaign");
  const [code, setCode] = useState("");
  const [playerName, setPlayerName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importStatus, setImportStatus] = useState<string | null>(null);

  if (!lobbyOpen) return null;

  const handleCreate = async () => {
    setLoading(true);
    setError(null);
    try {
      await createSession(title);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleJoin = async () => {
    if (!code.trim() || !playerName.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await joinSession(code.trim(), playerName.trim());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleCopyCode = () => {
    if (joinCode) {
      navigator.clipboard.writeText(joinCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleImportCampaign = async () => {
    setImporting(true);
    setImportStatus(null);
    setError(null);
    try {
      const data = await backend.exportCampaign();
      await importCampaign(data);
      setImportStatus("Campaign loaded successfully!");
    } catch (e) {
      setError(`Import failed: ${e}`);
    } finally {
      setImporting(false);
    }
  };

  // If already in a session, show session info.
  if (sessionId) {
    return (
      <div className="lobby-overlay" onClick={() => setLobbyOpen(false)}>
        <div className="lobby-modal" onClick={(e) => e.stopPropagation()}>
          <div className="lobby-header">
            <Users size={20} />
            <h2>Multiplayer Session</h2>
            <button className="lobby-close" onClick={() => setLobbyOpen(false)}>
              <X size={16} />
            </button>
          </div>
          <div className="lobby-body">
            <div className="session-info">
              <div className="session-status">
                <span className={`status-dot ${connected ? "online" : "offline"}`} />
                <span>{connected ? "Connected" : "Disconnected"}</span>
              </div>
              {joinCode && (
                <div className="join-code-display">
                  <span className="label">Join Code</span>
                  <div className="code-row">
                    <span className="code">{joinCode}</span>
                    <button className="copy-btn" onClick={handleCopyCode} title="Copy code">
                      {copied ? <Check size={14} /> : <Copy size={14} />}
                    </button>
                  </div>
                </div>
              )}
              <div className="session-role">
                {isHost ? "You are the host" : "You are a player"}
              </div>
            </div>
            {isHost && (
              <button
                className="btn btn-primary"
                onClick={handleImportCampaign}
                disabled={importing}
              >
                <Upload size={14} />
                {importing ? "Loading Campaign..." : "Load Campaign to Server"}
              </button>
            )}
            {importStatus && <div className="lobby-import-status">{importStatus}</div>}
            {error && <div className="lobby-error">{error}</div>}
            <button className="btn btn-danger" onClick={leaveSession}>
              Leave Session
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="lobby-overlay" onClick={() => setLobbyOpen(false)}>
      <div className="lobby-modal" onClick={(e) => e.stopPropagation()}>
        <div className="lobby-header">
          <Users size={20} />
          <h2>Multiplayer Session</h2>
          <button className="lobby-close" onClick={() => setLobbyOpen(false)}>
            <X size={16} />
          </button>
        </div>

        <div className="lobby-server">
          <label className="field-label">Server URL</label>
          <input
            type="text"
            className="lobby-input"
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
            placeholder="http://localhost:3000"
          />
        </div>

        <div className="lobby-tabs">
          <button
            className={`lobby-tab ${tab === "join" ? "active" : ""}`}
            onClick={() => setTab("join")}
          >
            <LogIn size={14} /> Join
          </button>
          <button
            className={`lobby-tab ${tab === "create" ? "active" : ""}`}
            onClick={() => setTab("create")}
          >
            <Plus size={14} /> Create
          </button>
        </div>

        <div className="lobby-body">
          {tab === "join" ? (
            <div className="lobby-form">
              <div className="field">
                <label className="field-label">Join Code</label>
                <input
                  type="text"
                  className="lobby-input"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="6-character code"
                  maxLength={6}
                  autoFocus
                />
              </div>
              <div className="field">
                <label className="field-label">Your Name</label>
                <input
                  type="text"
                  className="lobby-input"
                  value={playerName}
                  onChange={(e) => setPlayerName(e.target.value)}
                  placeholder="Enter your name"
                  onKeyDown={(e) => e.key === "Enter" && handleJoin()}
                />
              </div>
              <button
                className="btn btn-primary"
                onClick={handleJoin}
                disabled={loading || !code.trim() || !playerName.trim()}
              >
                {loading ? "Joining..." : "Join Session"}
              </button>
            </div>
          ) : (
            <div className="lobby-form">
              <div className="field">
                <label className="field-label">Campaign Title</label>
                <input
                  type="text"
                  className="lobby-input"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Campaign title"
                  autoFocus
                />
              </div>
              <button
                className="btn btn-primary"
                onClick={handleCreate}
                disabled={loading || !title.trim()}
              >
                {loading ? "Creating..." : "Create Session"}
              </button>
            </div>
          )}

          {error && <div className="lobby-error">{error}</div>}
        </div>
      </div>
    </div>
  );
}
