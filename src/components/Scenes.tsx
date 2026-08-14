import { useState } from "react";
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
              <button className="danger" onClick={() => void deleteScene(sc.id)}>
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
      {scenes.length === 0 && <p className="muted">No scenes yet.</p>}
    </section>
  );
}
