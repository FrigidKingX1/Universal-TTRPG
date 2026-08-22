import { useState } from "react";
import { useStore, newStatBlock } from "../store";
import { backend } from "../backend";
import { useConfirmDialog } from "../hooks/useConfirmDialog";
import { PRESET_ACTIONS, PRESET_MONSTERS } from "../presets/bestiary";
import type { EncounterStatBlock, LootTableEntry, MonsterTrait, Size } from "../types";

const DAMAGE_TYPES = [
  "slashing", "piercing", "bludgeoning", "fire", "cold", "lightning", "poison",
  "psychic", "necrotic", "radiant", "force", "thunder", "acid",
];

const CONDITIONS = [
  "blinded", "charmed", "deafened", "frightened", "grappled", "incapacitated",
  "invisible", "paralyzed", "petrified", "poisoned", "prone", "restrained",
  "stunned", "unconscious", "exhaustion",
];

function TagChips({ options, selected, onToggle }: {
  options: string[];
  selected: string[];
  onToggle: (tag: string) => void;
}) {
  return (
    <div className="action-chips">
      {options.map((o) => (
        <button
          key={o}
          className={selected.includes(o) ? "" : "muted"}
          onClick={() => onToggle(o)}
          type="button"
        >
          {selected.includes(o) ? "✓ " : ""}{o}
        </button>
      ))}
    </div>
  );
}

const toggleIn = (list: string[], tag: string) =>
  list.includes(tag) ? list.filter((t) => t !== tag) : [...list, tag];

/** Editor for named trait/reaction lists (name + description rows). */
function TraitListEditor({ title, items, onChange }: {
  title: string;
  items: MonsterTrait[];
  onChange: (items: MonsterTrait[]) => void;
}) {
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");

  const add = () => {
    if (!name.trim()) return;
    onChange([...items, { name: name.trim(), description: desc.trim() }]);
    setName("");
    setDesc("");
  };

  return (
    <>
      {title && <h3>{title}</h3>}
      {items.length > 0 && (
        <div className="loot-table-list">
          {items.map((t, idx) => (
            <div key={idx} className="card-row" style={{ gap: "0.4rem", marginBottom: "0.25rem", alignItems: "flex-start" }}>
              <span style={{ whiteSpace: "nowrap" }}><strong>{t.name}.</strong></span>
              <span className="muted" style={{ flex: 1 }}>{t.description}</span>
              <button className="danger" onClick={() => onChange(items.filter((_, i) => i !== idx))} style={{ fontSize: "0.7rem" }}>×</button>
            </div>
          ))}
        </div>
      )}
      <div className="row" style={{ marginTop: "0.25rem" }}>
        <input value={name} onChange={(e) => setName(e.currentTarget.value)} placeholder="Name" style={{ width: "10rem" }} />
        <input value={desc} onChange={(e) => setDesc(e.currentTarget.value)} placeholder="Description" />
        <button onClick={add} disabled={!name.trim()}>Add</button>
      </div>
    </>
  );
}

export function Bestiary() {
  const statBlocks = useStore((s) => s.statBlocks);
  const saveStatBlock = useStore((s) => s.saveStatBlock);
  const deleteStatBlock = useStore((s) => s.deleteStatBlock);
  const cloneStatBlock = useStore((s) => s.cloneStatBlock);
  const actions = useStore((s) => s.actions);
  const saveAction = useStore((s) => s.saveAction);
  const showToast = useStore((s) => s.showToast);
  const { confirm, dialog } = useConfirmDialog();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [presetKey, setPresetKey] = useState<string>("");

  const create = () => {
    const block = newStatBlock(`Monster ${statBlocks.length + 1}`);
    void saveStatBlock(block);
    setEditingId(block.id);
  };

  const importPreset = async () => {
    const preset = PRESET_MONSTERS.find((m) => m.key === presetKey);
    if (!preset) return;

    // Ensure referenced actions exist; import any that are missing.
    const existingIds = new Set(actions.map((a) => a.id));
    for (const actionId of preset.actions ?? []) {
      if (existingIds.has(actionId)) continue;
      const def = PRESET_ACTIONS.find((a) => a.id === actionId);
      if (def && actionId !== "act_shortsword") await saveAction(def);
    }

    // Skip if this exact monster already exists.
    if (statBlocks.some((b) => b.name === preset.name)) {
      showToast(`"${preset.name}" is already in your bestiary.`);
      return;
    }

    const block: EncounterStatBlock = {
      ...newStatBlock(preset.name),
      ...preset,
      id: crypto.randomUUID(),
      hit_points: { ...preset.hit_points },
      loot_table: preset.loot_table.map((l) => ({ ...l })),
    };
    await saveStatBlock(block);
    setEditingId(block.id);
    setPresetKey("");
  };

  const requestDelete = async (id: string, name: string) => {
    if (await confirm({ title: "Delete Monster", message: `Delete ${name}? This cannot be undone.` })) {
      void deleteStatBlock(id);
    }
  };

  return (
    <section className="panel">
      <h2>Bestiary</h2>
      <div className="row">
        <button onClick={create}>New Monster</button>
        <select value={presetKey} onChange={(e) => setPresetKey(e.currentTarget.value)}>
          <option value="">Add preset…</option>
          {PRESET_MONSTERS.filter((p) => !statBlocks.some((b) => b.name === p.name)).map((p) => (
            <option key={p.key} value={p.key}>{p.name} (CR {p.challenge_rating})</option>
          ))}
        </select>
        <button onClick={() => void importPreset()} disabled={!presetKey}>Add</button>
      </div>
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
              {(b.resistances?.length || b.immunities?.length || b.vulnerabilities?.length) ? (
                <span className="muted" title={`Resists: ${(b.resistances ?? []).join(", ")} | Immune: ${(b.immunities ?? []).join(", ")}`}>
                  ⛨
                </span>
              ) : null}
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

  const [resistances, setResistances] = useState<string[]>(block.resistances ?? []);
  const [vulnerabilities, setVulnerabilities] = useState<string[]>(block.vulnerabilities ?? []);
  const [immunities, setImmunities] = useState<string[]>(block.immunities ?? []);
  const [conditionImmunities, setConditionImmunities] = useState<string[]>(block.condition_immunities ?? []);

  const [sensesRaw, setSensesRaw] = useState((block.senses ?? []).join(", "));
  const [languagesRaw, setLanguagesRaw] = useState((block.languages ?? []).join(", "));
  const parseList = (raw: string) =>
    raw.split(",").map((s) => s.trim()).filter(Boolean);

  const [traits, setTraits] = useState<MonsterTrait[]>(block.traits ?? []);
  const [reactions, setReactions] = useState<MonsterTrait[]>(block.reactions ?? []);
  const [multiattack, setMultiattack] = useState(block.multiattack ?? "");
  const [description, setDescription] = useState(block.description ?? "");

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
      resistances,
      vulnerabilities,
      immunities,
      condition_immunities: conditionImmunities,
      senses: parseList(sensesRaw),
      languages: parseList(languagesRaw),
      traits,
      reactions,
      multiattack: multiattack.trim() || null,
      description: description.trim() || null,
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

      <h3>Defenses</h3>
      <div className="defense-group">
        <span className="muted">Resistant (half)</span>
        <TagChips options={DAMAGE_TYPES} selected={resistances} onToggle={(t) => setResistances(toggleIn(resistances, t))} />
      </div>
      <div className="defense-group">
        <span className="muted">Vulnerable (double)</span>
        <TagChips options={DAMAGE_TYPES} selected={vulnerabilities} onToggle={(t) => setVulnerabilities(toggleIn(vulnerabilities, t))} />
      </div>
      <div className="defense-group">
        <span className="muted">Immune (no damage)</span>
        <TagChips options={DAMAGE_TYPES} selected={immunities} onToggle={(t) => setImmunities(toggleIn(immunities, t))} />
      </div>
      <div className="defense-group">
        <span className="muted">Condition immunities</span>
        <TagChips options={CONDITIONS} selected={conditionImmunities} onToggle={(t) => setConditionImmunities(toggleIn(conditionImmunities, t))} />
      </div>

      <h3>Senses &amp; Languages</h3>
      <div className="row">
        <input
          value={sensesRaw}
          onChange={(e) => setSensesRaw(e.currentTarget.value)}
          placeholder='Senses, e.g. "darkvision 60 ft., passive Perception 12"'
        />
      </div>
      <div className="row" style={{ marginTop: "0.25rem" }}>
        <input
          value={languagesRaw}
          onChange={(e) => setLanguagesRaw(e.currentTarget.value)}
          placeholder='Languages, e.g. "Common, Giant"'
        />
      </div>
      <p className="muted">Comma-separated.</p>

      <TraitListEditor title="Traits" items={traits} onChange={setTraits} />

      <h3>Multiattack</h3>
      <div className="row">
        <input
          value={multiattack}
          onChange={(e) => setMultiattack(e.currentTarget.value)}
          placeholder="e.g. The troll makes three attacks: one bite and two claws."
        />
      </div>

      <h3>Reactions</h3>
      <TraitListEditor title="" items={reactions} onChange={setReactions} />

      <h3>Description</h3>
      <textarea
        value={description}
        onChange={(e) => setDescription(e.currentTarget.value)}
        placeholder="Flavor text and lore…"
        rows={3}
        style={{ width: "100%" }}
      />

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
