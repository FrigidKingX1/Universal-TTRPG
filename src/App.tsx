import { useEffect, useState, useCallback } from "react";
import { useStore, subscribeToEvents } from "./store";
import { CharacterList, ActionList } from "./components/Characters";
import { Bestiary } from "./components/Bestiary";
import { Scenes } from "./components/Scenes";
import { Combat } from "./components/Combat";
import { DiceRoller, OraclePanel, DmPanel, SessionLog, OllamaStatus, CampaignData, NpcNotesPanel } from "./components/Tools";
import "./App.css";

type Tab = "scenes" | "characters" | "bestiary" | "combat" | "tools";

const TABS: { id: Tab; label: string }[] = [
  { id: "scenes", label: "Scenes" },
  { id: "characters", label: "Characters" },
  { id: "bestiary", label: "Bestiary" },
  { id: "combat", label: "Combat" },
  { id: "tools", label: "Tools" },
];

function App() {
  const [tab, setTab] = useState<Tab>("scenes");
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

  useEffect(() => {
    void bootstrap();
    void subscribeToEvents();
  }, [bootstrap]);

  // Keyboard shortcuts: 1-5 to switch tabs, Esc to dismiss errors/toasts
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
    const tabKeys: Record<string, Tab> = { "1": "scenes", "2": "characters", "3": "bestiary", "4": "combat", "5": "tools" };
    if (tabKeys[e.key]) { setTab(tabKeys[e.key]); e.preventDefault(); }
    if (e.key === "Escape") { setError(null); }
  }, [setError]);

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return (
    <main className="app">
      <header className="app-header">
        <h1>Auto-DM</h1>
        <div className="row">
          {activeScene ? (
            <span className="badge">
              #{activeScene.scene_number} {activeScene.title} (CF {activeScene.chaos_factor})
            </span>
          ) : (
            <span className="badge muted">no active scene</span>
          )}
        </div>
      </header>

      <nav className="tabs">
        {TABS.map((t) => {
          let count = 0;
          if (t.id === "scenes") count = sceneCount;
          else if (t.id === "characters") count = charCount;
          else if (t.id === "bestiary") count = monsterCount;
          else if (t.id === "tools") count = logCount;
          return (
            <button
              key={t.id}
              className={tab === t.id ? "tab active" : "tab"}
              onClick={() => setTab(t.id)}
            >
              {t.label}
              {count > 0 && <span className="tab-badge">{count}</span>}
            </button>
          );
        })}
      </nav>

      {error && (
        <div className="banner error">
          <span>{error}</span>
          <button onClick={() => setError(null)}>dismiss</button>
        </div>
      )}
      {toast && <div className="toast">{toast}</div>}
      {loading && <p className="muted">Loading…</p>}
      {!loading && tab === "scenes" && <Scenes />}
      {!loading && tab === "characters" && (
        <>
          <CharacterList />
          <ActionList />
        </>
      )}
      {!loading && tab === "bestiary" && <Bestiary />}
      {!loading && tab === "combat" && <Combat />}
      {!loading && tab === "tools" && (
        <>
          <OllamaStatus />
          <DmPanel />
          <DiceRoller />
          <OraclePanel />
          <NpcNotesPanel />
          <SessionLog />
          <CampaignData />
        </>
      )}
    </main>
  );
}

export default App;
