import { useState } from "react";
import { useStore, newStatBlock } from "../store";
import type { EncounterStatBlock } from "../types";

export function Bestiary() {
  const statBlocks = useStore((s) => s.statBlocks);
  const saveStatBlock = useStore((s) => s.saveStatBlock);
  const deleteStatBlock = useStore((s) => s.deleteStatBlock);
  const [editingId, setEditingId] = useState<string | null>(null);

  const create = () => {
    const block = newStatBlock(`Monster ${statBlocks.length + 1}`);
    void saveStatBlock(block);
    setEditingId(block.id);
  };

  return (
    <section className="panel">
      <h2>Bestiary</h2>
      <button onClick={create}>New Monster</button>
      <ul className="card-list">
        {statBlocks.map((b) => (
          <li key={b.id} className="card">
            <div className="card-row">
              <strong>{b.name}</strong>
              <span className="muted">CR {b.challenge_rating}</span>
              <span className="muted">AC {b.armor_class}</span>
              <button onClick={() => setEditingId(editingId === b.id ? null : b.id)}>
                {editingId === b.id ? "Close" : "Edit"}
              </button>
              <button className="danger" onClick={() => void deleteStatBlock(b.id)}>
                Delete
              </button>
            </div>
            {editingId === b.id && <StatBlockEditor block={b} />}
          </li>
        ))}
      </ul>
      {statBlocks.length === 0 && <p className="muted">No monsters yet.</p>}
    </section>
  );
}

function StatBlockEditor({ block }: { block: EncounterStatBlock }) {
  const saveStatBlock = useStore((s) => s.saveStatBlock);
  const [hp, setHp] = useState(block.hit_points.current);
  const [ac, setAc] = useState(block.armor_class);

  const save = () => {
    void saveStatBlock({
      ...block,
      armor_class: ac,
      hit_points: { ...block.hit_points, current: Math.max(0, hp), maximum: Math.max(1, hp) },
    });
  };

  return (
    <div className="sheet">
      <label className="attr">
        <span>AC</span>
        <input type="number" value={ac} onChange={(e) => setAc(Number(e.currentTarget.value))} />
      </label>
      <label className="attr">
        <span>HP</span>
        <input type="number" value={hp} onChange={(e) => setHp(Number(e.currentTarget.value))} />
      </label>
      <button onClick={save}>Save</button>
    </div>
  );
}
