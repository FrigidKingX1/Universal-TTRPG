import { useEffect, useState, useCallback, useRef } from "react";
import { useStore, subscribeToEvents } from "./store";
import { CharacterList, ActionList } from "./components/Characters";
import { Bestiary } from "./components/Bestiary";
import { Scenes } from "./components/Scenes";
import { Combat } from "./components/Combat";
import { DiceRoller, OraclePanel, DmPanel, SessionLog, OllamaStatus, CampaignData, NpcNotesPanel, LinesVeilPanel } from "./components/Tools";
import "./App.css";

type NavItem = "scenes" | "characters" | "bestiary" | "combat" | "tools";

const NAV_ITEMS: { id: NavItem; label: string; icon: string }[] = [
  { id: "scenes", label: "Scenes", icon: "📖" },
  { id: "characters", label: "Characters", icon: "👥" },
  { id: "bestiary", label: "Bestiary", icon: "🐉" },
  { id: "combat", label: "Combat", icon: "⚔️" },
  { id: "tools", label: "Tools", icon: "🛠️" },
];

function App() {
  const [activeNav, setActiveNav] = useState<NavItem>("scenes");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const bootstrap = useStore((s) => s.bootstrap);
  const loading = useStore((s) => s.loading);
  const error = useStore((s) => s.error);
  const setError = useStore((s) => s.setError);
  const toast = useStore((s) => s.toast);
  const activeScene = useStore((s) =>
    s.scenes.find((sc) => sc.id === s.activeSceneId),
  );
  const charCount = useStore((s) => s.characters.length);
  const monsterCount = useStore((s) => s.statBlocks.length);
  const logCount = useStore((s) => s.logs.length);
  const sceneCount = useStore((s) => s.scenes.length);
  const ollamaStatus = useStore((s) => s.ollama.reachable);
  const sidebarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void bootstrap();
    void subscribeToEvents();
  }, [bootstrap]);

  // Keyboard shortcuts: 1-5 to switch tabs, Esc to dismiss errors/toasts, Ctrl+B to toggle sidebar
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
    const navKeys: Record<string, NavItem> = { "1": "scenes", "2": "characters", "3": "bestiary", "4": "combat", "5": "tools" };
    if (navKeys[e.key]) { setActiveNav(navKeys[e.key]); e.preventDefault(); }
    if (e.key === "Escape") { setError(null); }
    if (e.ctrlKey && e.key === "b") { setSidebarCollapsed(prev => !prev); e.preventDefault(); }
  }, [setError]);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const getCount = (id: NavItem) => {
    switch (id) {
      case "scenes": return sceneCount;
      case "characters": return charCount;
      case "bestiary": return monsterCount;
      case "tools": return logCount;
      default: return 0;
    }
  };

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarCollapsed ? "collapsed" : ""}`} ref={sidebarRef}>
        <div className="sidebar-header">
          {!sidebarCollapsed && (
            <h1 className="app-title">Auto-DM</h1>
          )}
          <button
            className="sidebar-toggle"
            onClick={() => setSidebarCollapsed(prev => !prev)}
            aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={sidebarCollapsed ? "Expand sidebar (Ctrl+B)" : "Collapse sidebar (Ctrl+B)"}
          >
            {sidebarCollapsed ? "▶" : "◀"}
          </button>
        </div>

        <nav className="sidebar-nav" role="navigation" aria-label="Main navigation">
          {NAV_ITEMS.map((item) => {
            const count = getCount(item.id);
            const isActive = activeNav === item.id;
            return (
              <button
                key={item.id}
                className={`nav-item ${isActive ? "active" : ""}`}
                onClick={() => setActiveNav(item.id)}
                title={sidebarCollapsed ? item.label : undefined}
                aria-current={isActive ? "page" : undefined}
              >
                <span className="nav-icon" aria-hidden="true">{item.icon}</span>
                {!sidebarCollapsed && (
                  <>
                    <span className="nav-label">{item.label}</span>
                    {count > 0 && <span className="nav-badge">{count}</span>}
                  </>
                )}
              </button>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          {!sidebarCollapsed && (
            <div className="status-indicator">
              <span className={`status-dot ${ollamaStatus ? "online" : "offline"}`} />
              <span className="status-text">{ollamaStatus ? "Ollama Connected" : "Ollama Offline"}</span>
            </div>
          )}
          {!sidebarCollapsed && (
            <div className="shortcuts-hint">
              <kbd>1-5</kbd> <span>Navigate</span>
              <kbd>Esc</kbd> <span>Dismiss</span>
              <kbd>Ctrl+B</kbd> <span>Toggle Sidebar</span>
            </div>
          )}
        </div>
      </aside>

      <main className="main-content">
        <header className="top-bar">
          <div className="top-bar-left">
            {activeScene ? (
              <div className="active-scene-badge">
                <span className="scene-number">#{activeScene.scene_number}</span>
                <span className="scene-title">{activeScene.title}</span>
                <span className="scene-cf">CF {activeScene.chaos_factor}</span>
              </div>
            ) : (
              <div className="no-scene-badge">
                <span className="scene-icon">📖</span>
                <span>No active scene</span>
              </div>
            )}
          </div>
          <div className="top-bar-right">
            <button className="icon-btn" title="Settings" aria-label="Settings">⚙️</button>
          </div>
        </header>

        {error && (
          <div className="banner error" role="alert">
            <span>{error}</span>
            <button onClick={() => setError(null)} aria-label="Dismiss error">✕</button>
          </div>
        )}
        {toast && <div className="toast" role="status">{toast}</div>}
        {loading && <div className="loading-overlay">Loading…</div>}

        <div className="content-area">
          {!loading && activeNav === "scenes" && <Scenes />}
          {!loading && activeNav === "characters" && (
            <>
              <CharacterList />
              <ActionList />
            </>
          )}
          {!loading && activeNav === "bestiary" && <Bestiary />}
          {!loading && activeNav === "combat" && <Combat />}
          {!loading && activeNav === "tools" && (
            <>
              <OllamaStatus />
              <DmPanel />
              <DiceRoller />
              <OraclePanel />
              <NpcNotesPanel />
              <LinesVeilPanel />
              <SessionLog />
              <CampaignData />
            </>
          )}
        </div>
      </main>
    </div>
  );
}

export default App;