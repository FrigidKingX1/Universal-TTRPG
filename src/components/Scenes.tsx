import { useState } from "react";
import { backend } from "../backend";
import { useStore } from "../store";

export function Scenes() {
  const scenes = useStore((s) => s.scenes);
  const activeSceneId = useStore((s) => s.activeSceneId);
  const createScene = useStore((s) => s.createScene);
  const setActiveScene = useStore((s) => s.setActiveScene);
  const deleteScene = useStore((s) => s.deleteScene);
  const [title, setTitle] = useState("");
  const [cf, setCf] = useState(5);

  return (
    <section className="panel">
      <h2>Campaign Scenes</h2>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim()) {
            void createScene(title.trim(), cf);
            setTitle("");
          }
        }}
      >
        <input
          value={title}
          onChange={(e) => setTitle(e.currentTarget.value)}
          placeholder="Scene title"
          aria-label="Scene title"
        />
        <label>
          CF
          <input
            type="number"
            min={1}
            max={9}
            value={cf}
            onChange={(e) => setCf(Number(e.currentTarget.value))}
          />
        </label>
        <button type="submit">Create</button>
      </form>
      <ul className="card-list">
        {scenes.map((sc) => (
          <li key={sc.id} className="card">
            <div className="card-row">
              <strong>
                #{sc.scene_number} {sc.title}
              </strong>
              <span className="muted">CF {sc.chaos_factor}</span>
              {sc.id === activeSceneId && <span className="badge">active</span>}
              {sc.id !== activeSceneId && (
                <button onClick={() => void setActiveScene(sc.id)}>Set active</button>
              )}
              <button className="danger" onClick={() => { if (confirm(`Delete scene "${sc.title}"?`)) void deleteScene(sc.id); }}>
                Delete
              </button>
            </div>
            {sc.id !== activeSceneId && sc.summary_text && (
              <p className="scene-preview muted">{sc.summary_text.length > 120 ? sc.summary_text.slice(0, 120) + "…" : sc.summary_text}</p>
            )}
            {sc.id === activeSceneId && <SceneSummaryEditor scene={sc} />}
            {sc.id === activeSceneId && <SceneCfEditor scene={sc} />}
          </li>
        ))}
      </ul>
      {scenes.length === 0 && <p className="muted">No scenes yet.</p>}
    </section>
  );
}

function SceneSummaryEditor({ scene }: { scene: { id: string; summary_text?: string | null; title: string } }) {
  const [text, setText] = useState(scene.summary_text ?? "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await backend.updateSceneSummary(scene.id, text.trim() || null);
    } catch {
      // best-effort
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="sheet">
      <textarea
        className="summary-input"
        value={text}
        onChange={(e) => setText(e.currentTarget.value)}
        placeholder={`Describe what's happening in "${scene.title}"...`}
        rows={3}
      />
      <button onClick={() => void save()} disabled={saving}>
        {saving ? "Saving…" : "Save Summary"}
      </button>
    </div>
  );
}

function SceneCfEditor({ scene }: { scene: { id: string; chaos_factor: number } }) {
  const [cf, setCf] = useState(scene.chaos_factor);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await backend.updateSceneChaosFactor(scene.id, cf);
    } catch {
      // best-effort
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="sheet cf-editor">
      <label className="attr">
        <span>CF</span>
        <input
          type="number"
          min={1}
          max={9}
          value={cf}
          onChange={(e) => setCf(Number(e.currentTarget.value))}
        />
      </label>
      <button onClick={() => void save()} disabled={saving || cf === scene.chaos_factor}>
        {saving ? "Saving…" : "Update CF"}
      </button>
    </div>
  );
}
