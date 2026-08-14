import { useEffect, useState } from "react";
import { useStore, subscribeToEvents } from "./store";
import { CharacterList, ActionList } from "./components/Characters";
import { Bestiary } from "./components/Bestiary";
import { Scenes } from "./components/Scenes";
import { Combat } from "./components/Combat";
import { DiceRoller, OraclePanel, DmPanel, SessionLog, AlisonStatus } from "./components/Tools";
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
  const activeScene = useStore((s) =>
    s.scenes.find((sc) => sc.id === s.activeSceneId),
  );

  useEffect(() => {
    void bootstrap();
    void subscribeToEvents();
  }, [bootstrap]);

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
        {TABS.map((t) => (
          <button
            key={t.id}
            className={tab === t.id ? "tab active" : "tab"}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {error && (
        <div className="banner error">
          <span>{error}</span>
          <button onClick={() => setError(null)}>dismiss</button>
        </div>
      )}
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
          <AlisonStatus />
          <DmPanel />
          <DiceRoller />
          <OraclePanel />
          <SessionLog />
        </>
      )}
    </main>
  );
}

export default App;
