import { useEffect, useState, useCallback, useRef } from "react";
import { useStore, subscribeToEvents } from "./store";
import { CampaignWizard } from "./components/CampaignWizard";
import { PlayerCommandDeck } from "./components/PlayerCommandDeck";
import { NarrativeStream } from "./components/NarrativeStream";
import { TacticalMatrix } from "./components/TacticalMatrix";
import { SettingsPanel } from "./components/SettingsPanel";
import { ToastContainer } from "./components/ToastContainer";
import { CommandPalette } from "./components/CommandPalette";
import { Scenes } from "./components/Scenes";
import { CharacterList } from "./components/Characters";
import { Bestiary } from "./components/Bestiary";
import { Combat } from "./components/Combat";
import { DiceRoller, OraclePanel, DmPanel, SessionLog, OllamaStatus, NpcNotesPanel, LinesVeilPanel } from "./components/Tools";
import { CampaignExport } from "./components/CampaignExport";
import { ShortcutsHelp } from "./components/ShortcutsHelp";
import { usePanelResize } from "./hooks/usePanelResize";
import "./App.css";

type NavItem = "campaign" | "scenes" | "characters" | "bestiary" | "combat" | "tools";

const NAV_ITEMS: { id: NavItem; label: string; icon: string }[] = [
  { id: "campaign", label: "Campaign", icon: "🧙" },
  { id: "scenes", label: "Scenes", icon: "📖" },
  { id: "characters", label: "Characters", icon: "👥" },
  { id: "bestiary", label: "Bestiary", icon: "🐉" },
  { id: "combat", label: "Combat", icon: "⚔️" },
  { id: "tools", label: "Tools", icon: "🛠️" },
];

function App() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const bootstrap = useStore((s) => s.bootstrap);
  const loading = useStore((s) => s.loading);
  const error = useStore((s) => s.error);
  const setError = useStore((s) => s.setError);
  const appMode = useStore((s) => s.appMode);
  const setAppMode = useStore((s) => s.setAppMode);
  const activeNav = useStore((s) => s.activeNav);
  const setActiveNav = useStore((s) => s.setActiveNav);
  const settingsOpen = useStore((s) => s.settingsOpen);
  const setSettingsOpen = useStore((s) => s.setSettingsOpen);
  const shortcutsOpen = useStore((s) => s.shortcutsOpen);
  const setShortcutsOpen = useStore((s) => s.setShortcutsOpen);
  const activeCharacter = useStore((s) => s.activeCharacter);
  const activeScene = useStore((s) =>
    s.scenes.find((sc) => sc.id === s.activeSceneId),
  );
  const charCount = useStore((s) => s.characters.length);
  const monsterCount = useStore((s) => s.statBlocks.length);
  const logCount = useStore((s) => s.logs.length);
  const sceneCount = useStore((s) => s.scenes.length);
  const ollamaStatus = useStore((s) => s.ollama.reachable);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const { sizes, beginDrag, resizeByKeyboard } = usePanelResize();

  useEffect(() => {
    void bootstrap();
    void subscribeToEvents();
  }, [bootstrap]);

  // Keyboard shortcuts
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;

    // While a modal is open, only Escape (handled by its focus trap) applies —
    // don't switch nav or stack more modals underneath.
    if (useStore.getState().settingsOpen || useStore.getState().shortcutsOpen) return;

    // Global shortcuts
    if (e.key === "Escape") { setError(null); }
    if (e.ctrlKey && e.key === "b") { setSidebarCollapsed(prev => !prev); e.preventDefault(); }
    if (e.ctrlKey && e.key === "m") { setAppMode(appMode === "setup" ? "tabletop" : "setup"); e.preventDefault(); }
    if (e.key === "?") { setShortcutsOpen(true); e.preventDefault(); }

    if (appMode === "setup") {
      const navKeys: Record<string, NavItem> = { "1": "campaign", "2": "scenes", "3": "characters", "4": "bestiary", "5": "combat", "6": "tools" };
      if (navKeys[e.key]) { setActiveNav(navKeys[e.key]); e.preventDefault(); }
    }
  }, [setError, appMode, setAppMode, setShortcutsOpen, setActiveNav]);

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

  const renderSetupView = () => {
    switch (activeNav) {
      case "scenes": return <Scenes />;
      case "characters": return <CharacterList />;
      case "bestiary": return <Bestiary />;
      case "combat": return <Combat />;
      case "tools":
        return (
          <div className="tools-stack">
            <CampaignExport />
            <DiceRoller />
            <OraclePanel />
            <DmPanel />
            <SessionLog />
            <OllamaStatus />
            <NpcNotesPanel />
            <LinesVeilPanel />
          </div>
        );
      case "campaign":
      default:
        return <CampaignWizard />;
    }
  };

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarCollapsed ? "collapsed" : ""}`} ref={sidebarRef}>
        <div className="sidebar-header">
          <img src="/icon.svg" alt="" aria-hidden="true" className="app-logo" />
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
              <kbd>1-6</kbd> <span>Navigate</span>
              <kbd>Ctrl+K</kbd> <span>Commands</span>
              <kbd>?</kbd> <span>Shortcuts</span>
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
            <button
              className={`mode-toggle ${appMode === "setup" ? "setup-active" : "tabletop-active"}`}
              onClick={() => setAppMode(appMode === "setup" ? "tabletop" : "setup")}
              aria-label={appMode === "setup" ? "Switch to Tabletop Mode" : "Switch to Setup Mode"}
              title={appMode === "setup" ? "Switch to Tabletop Mode" : "Switch to Setup Mode"}
            >
              {appMode === "setup" ? "🧙 Setup" : "🏰 Tabletop"}
            </button>
            <button className="icon-btn" onClick={() => setShortcutsOpen(true)} title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts">❔</button>
            <button className="icon-btn" onClick={() => setSettingsOpen(true)} title="Settings" aria-label="Settings">⚙️</button>
          </div>
        </header>

        {error && (
          <div className="banner error" role="alert">
            <span>{error}</span>
            <button onClick={() => setError(null)} aria-label="Dismiss error">✕</button>
          </div>
        )}

        {loading ? (
          <div className="loading-overlay" role="status">
            Loading…
          </div>
        ) : appMode === "setup" ? (
          <div className="wizard-wrapper">
            {renderSetupView()}
          </div>
        ) : (
          <div className="tabletop-layout" style={{ gridTemplateColumns: `${sizes.left}px 1fr ${sizes.right}px` }}>
            <PlayerCommandDeck character={activeCharacter} />
            <div
              className="panel-gutter"
              onPointerDown={(e) => beginDrag("left", e)}
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft") { resizeByKeyboard("left", 1); e.preventDefault(); }
                if (e.key === "ArrowRight") { resizeByKeyboard("left", -1); e.preventDefault(); }
              }}
              aria-label="Resize left panel"
              role="separator"
              tabIndex={0}
              aria-orientation="vertical"
              title="Drag or use arrow keys to resize"
            />
            <NarrativeStream />
            <div
              className="panel-gutter"
              onPointerDown={(e) => beginDrag("right", e)}
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft") { resizeByKeyboard("right", -1); e.preventDefault(); }
                if (e.key === "ArrowRight") { resizeByKeyboard("right", 1); e.preventDefault(); }
              }}
              aria-label="Resize right panel"
              role="separator"
              tabIndex={0}
              aria-orientation="vertical"
              title="Drag or use arrow keys to resize"
            />
            <TacticalMatrix />
          </div>
        )}
      </main>

      <ToastContainer />
      <CommandPalette />
      {settingsOpen && (
        <SettingsPanel onClose={() => setSettingsOpen(false)} />
      )}
      {shortcutsOpen && (
        <ShortcutsHelp onClose={() => setShortcutsOpen(false)} />
      )}
    </div>
  );
}

export default App;