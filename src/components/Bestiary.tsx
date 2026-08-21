import { useState } from "react";
import { useStore, newStatBlock } from "../store";
import { backend } from "../backend";
import { useConfirmDialog } from "../hooks/useConfirmDialog";
import type { EncounterStatBlock, LootTableEntry, Size } from "../types";

export function Bestiary() {
  const statBlocks = useStore((s) => s.statBlocks);
  const saveStatBlock = useStore((s) => s.saveStatBlock);
  const deleteStatBlock = useStore((s) => s.deleteStatBlock);
  const cloneStatBlock = useStore((s) => s.cloneStatBlock);
  const actions = useStore((s) => s.actions);
  const { confirm, dialog } = useConfirmDialog();
  const [editingId, setEditingId] = useState<string | null>(null);

  const create = () => {
    const block = newStatBlock(`Monster ${statBlocks.length + 1}`);
    void saveStatBlock(block);
    setEditingId(block.id);
  };

  const requestDelete = async (id: string, name: string) => {
    if (await confirm({ title: "Delete Monster", message: `Delete ${name}? This cannot be undone.` })) {
      void deleteStatBlock(id);
    }
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
              <span className="muted">
                {b.size ?? "Medium"} {b.type ?? "creature"}
              </span>
              <span className="muted">CR {b.challenge_rating}</span>
              <span className="muted">AC {b.armor_class}</span>
              <span className="muted">
                HP {b.hit_points.current}/{b.hit_points.maximum}
              </span>
              <button onClick={() => setEditingId(editingId === b.id ? null : b.id)}>
                {editingId === b.id ? "Close" : "Edit"}
              </button>
              <button onClick={() => void cloneStatBlock(b.id)}>Clone</button>
              <button className="danger" onClick={() => void requestDelete(b.id, b.name)}>
                Delete
              </button>
            </div>
            <div className="hp-bar">
              <div
                className={`hp-bar-fill ${
                  b.hit_points.current <= 0
                    ? "dead"
                    : b.hit_points.current < b.hit_points.maximum * 0.25
                      ? "critical"
                      : b.hit_points.current < b.hit_points.maximum * 0.5
                        ? "wounded"
                        : "healthy"
                }`}
                style={{
                  transform: `scaleX(${Math.max(0, Math.min(100, (b.hit_points.current / b.hit_points.maximum) * 100)) / 100})`,
                }}
              />
            </div>
            {editingId === b.id && <StatBlockEditor block={b} allActions={actions} />}
          </li>
        ))}
      </ul>
      {statBlocks.length === 0 && (
        <div className="fantasy-empty" role="status">
          <span className="fantasy-empty-icon" aria-hidden="true">🐉</span>
          <span>No monsters yet — the bestiary awaits.</span>
        </div>
      )}
      {dialog}
    </section>
  );
}

const SIZES: Size[] = ["tiny", "small", "medium", "large", "huge", "gargantuan"];

function StatBlockEditor({ block, allActions }: { block: EncounterStatBlock; allActions: { id: string; name: string }[] }) {
  const saveStatBlock = useStore((s) => s.saveStatBlock);
  const [name, setName] = useState(block.name);
  const [cr, setCr] = useState(block.challenge_rating);
  const [size, setSize] = useState<Size>(block.size ?? "medium");
  const [type, setType] = useState(block.type ?? "");
  const [alignment, setAlignment] = useState(block.alignment ?? "");
  const [ac, setAc] = useState(block.armor_class);
  const [hp, setHp] = useState(block.hit_points.current);
  const [maxHp, setMaxHp] = useState(block.hit_points.maximum);
  const [hpFormula, setHpFormula] = useState(block.hit_points.formula ?? "");
  const [speed, setSpeed] = useState(block.speed_feet ?? 30);
  const [attrs, setAttrs] = useState(block.attributes);
  const [actions, setActions] = useState(block.actions);
  const [lootTable, setLootTable] = useState<LootTableEntry[]>(block.loot_table ?? []);
  const [newLootName, setNewLootName] = useState("");
  const [newLootQty, setNewLootQty] = useState("1");
  const [newLootChance, setNewLootChance] = useState(100);

  const save = () => {
    void saveStatBlock({
      ...block,
      name: name.trim() || block.name,
      challenge_rating: cr,
      size,
      type: type.trim() || undefined,
      alignment: alignment.trim() || undefined,
      armor_class: ac,
      hit_points: {
        current: Math.max(0, hp),
        maximum: Math.max(1, maxHp),
        formula: hpFormula.trim() || undefined,
      },
      speed_feet: speed,
      attributes: attrs,
      actions,
      loot_table: lootTable,
    });
  };

  const addLootEntry = () => {
    if (!newLootName.trim()) return;
    setLootTable([...lootTable, { name: newLootName.trim(), quantity_formula: newLootQty || "1", chance: newLootChance }]);
    setNewLootName("");
    setNewLootQty("1");
    setNewLootChance(100);
  };

  const removeLootEntry = (idx: number) => setLootTable(lootTable.filter((_, i) => i !== idx));

  const toggleAction = (id: string) =>
    setActions(actions.includes(id) ? actions.filter((a) => a !== id) : [...actions, id]);

  return (
    <div className="sheet">
      <div className="attr-grid">
        <label className="attr">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.currentTarget.value)} />
        </label>
        <label className="attr">
          <span>CR</span>
          <input type="number" min={0} step={0.25} value={cr} onChange={(e) => setCr(Number(e.currentTarget.value))} />
        </label>
        <label className="attr">
          <span>Size</span>
          <select value={size} onChange={(e) => setSize(e.currentTarget.value as Size)}>
            {SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="attr">
          <span>Type</span>
          <input value={type} onChange={(e) => setType(e.currentTarget.value)} placeholder="beast, undead, etc." />
        </label>
        <label className="attr">
          <span>Align</span>
          <input value={alignment} onChange={(e) => setAlignment(e.currentTarget.value)} placeholder="neutral evil" />
        </label>
      </div>

      <h3>Combat Stats</h3>
      <div className="attr-grid">
        <label className="attr">
          <span>AC</span>
          <input type="number" min={0} value={ac} onChange={(e) => setAc(Number(e.currentTarget.value))} />
        </label>
        <label className="attr">
          <span>HP</span>
          <input type="number" min={0} value={hp} onChange={(e) => setHp(Number(e.currentTarget.value))} />
        </label>
        <label className="attr">
          <span>Max HP</span>
          <input type="number" min={1} value={maxHp} onChange={(e) => setMaxHp(Number(e.currentTarget.value))} />
        </label>
        <label className="attr">
          <span>Formula</span>
          <input value={hpFormula} onChange={(e) => setHpFormula(e.currentTarget.value)} placeholder="2d6" />
        </label>
        {hpFormula.trim() && (
          <button className="roll-hp-btn" onClick={async () => {
            try {
              const r = await backend.rollDice(hpFormula.trim());
              const rolled = Math.max(1, r.total);
              setHp(rolled);
              setMaxHp(rolled);
            } catch { /* ignore */ }
          }}>Roll HP</button>
        )}
        <label className="attr">
          <span>Speed</span>
          <input type="number" min={0} value={speed} onChange={(e) => setSpeed(Number(e.currentTarget.value))} />
        </label>
      </div>
      <div className="hp-bar">
        <div
          className={`hp-bar-fill ${hp <= 0 ? "dead" : hp < maxHp * 0.25 ? "critical" : hp < maxHp * 0.5 ? "wounded" : "healthy"}`}
          style={{ transform: `scaleX(${Math.max(0, Math.min(100, (hp / Math.max(1, maxHp)) * 100)) / 100})` }}
        />
      </div>

      <h3>Attributes</h3>
      <div className="attr-grid">
        {Object.entries(attrs).map(([k, v]) => (
          <label key={k} className="attr">
            <span>{k}</span>
            <input type="number" value={v} onChange={(e) => setAttrs({ ...attrs, [k]: Number(e.currentTarget.value) })} />
          </label>
        ))}
      </div>

      <h3>Actions</h3>
      <div className="action-chips">
        {allActions.map((a) => (
          <button
            key={a.id}
            className={actions.includes(a.id) ? "" : "muted"}
            onClick={() => toggleAction(a.id)}
          >
            {actions.includes(a.id) ? "✓ " : ""}{a.name}
          </button>
        ))}
        {allActions.length === 0 && <p className="muted">Create actions in the Characters tab first.</p>}
      </div>

      <h3>Loot Table</h3>
      {lootTable.length > 0 && (
        <div className="loot-table-list">
          {lootTable.map((entry, idx) => (
            <div key={idx} className="card-row" style={{ gap: "0.4rem", marginBottom: "0.25rem" }}>
              <span>{entry.name}</span>
              <span className="muted">×{entry.quantity_formula}</span>
              <span className="muted">{entry.chance}%</span>
              <button className="danger" onClick={() => removeLootEntry(idx)} style={{ fontSize: "0.7rem" }}>×</button>
            </div>
          ))}
        </div>
      )}
      <div className="row" style={{ marginTop: "0.25rem" }}>
        <input value={newLootName} onChange={(e) => setNewLootName(e.currentTarget.value)} placeholder="Item name" />
        <input value={newLootQty} onChange={(e) => setNewLootQty(e.currentTarget.value)} placeholder="Qty formula" style={{ width: "5rem" }} />
        <input type="number" min={0} max={100} value={newLootChance} onChange={(e) => setNewLootChance(Number(e.currentTarget.value))} style={{ width: "4rem" }} />
        <button onClick={addLootEntry} disabled={!newLootName.trim()}>Add</button>
      </div>
      <p className="muted">Quantity formula (e.g. "2d6"), drop chance % (0-100).</p>

      <button onClick={save}>Save Monster</button>
    </div>
  );
}
