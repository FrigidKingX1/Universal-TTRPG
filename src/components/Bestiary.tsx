import { useState } from "react";
import { useStore, newStatBlock, parseNum } from "../store";
import { backend } from "../backend";
import { useConfirmDialog } from "../hooks/useConfirmDialog";
import { PRESET_MONSTERS } from "../presets/bestiary";
import { findPresetAction, ALL_PRESET_ACTIONS } from "../presets/actions";
import { resolvePortrait } from "../assets";
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
          {selected.includes(o) ? "âœ“ " : ""}{o}
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
              <button className="danger" onClick={() => onChange(items.filter((_, i) => i !== idx))} style={{ fontSize: "0.7rem" }}>Ã—</button>
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
  const [query, setQuery] = useState("");

  // Filtered + capped card list: 376 entries render fine but a wall of
  // cards is useless to scan â€” search narrows, and the cap keeps the DOM
  // light until the user refines.
  const RENDER_CAP = 60;
  const visible = statBlocks.filter((b) => {
    if (!query.trim()) return true;
    const q = query.trim().toLowerCase();
    return (
      b.name.toLowerCase().includes(q) ||
      (b.type ?? "").toLowerCase().includes(q) ||
      String(b.challenge_rating) === q
    );
  });
  const shown = visible.slice(0, RENDER_CAP);

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
      const def = findPresetAction(actionId);
      if (def) await saveAction(def);
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

  /** Bulk-install every missing preset action + monster. */
  const installAll = async () => {
    const existingActionIds = new Set(actions.map((a) => a.id));
    let actionsInstalled = 0;
    for (const def of ALL_PRESET_ACTIONS) {
      if (!existingActionIds.has(def.id)) {
        await saveAction({ ...def });
        existingActionIds.add(def.id);
        actionsInstalled += 1;
      }
    }
    const existingNames = new Set(statBlocks.map((b) => b.name));
    let monstersInstalled = 0;
    for (const preset of PRESET_MONSTERS) {
      if (existingNames.has(preset.name)) continue;
      const block: EncounterStatBlock = {
        ...newStatBlock(preset.name),
        ...preset,
        id: crypto.randomUUID(),
        hit_points: { ...preset.hit_points },
        loot_table: preset.loot_table.map((l) => ({ ...l })),
      };
      await saveStatBlock(block);
      monstersInstalled += 1;
    }
    showToast(`Installed ${monstersInstalled} monsters and ${actionsInstalled} actions`, "success");
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
          <option value="">Add presetâ€¦</option>
          {PRESET_MONSTERS.filter((p) => !statBlocks.some((b) => b.name === p.name)).map((p) => (
            <option key={p.key} value={p.key}>{p.name} (CR {p.challenge_rating})</option>
          ))}
        </select>
        <button onClick={() => void importPreset()} disabled={!presetKey}>Add</button>
        {statBlocks.length < PRESET_MONSTERS.length && (
          <button
            onClick={() => void installAll()}
            title={`Install all ${PRESET_MONSTERS.length} preset monsters and every preset action`}
          >
            Install All ({PRESET_MONSTERS.length})
          </button>
        )}
      </div>
      <ul className="card-list">
        {statBlocks.length > 12 && (
          <div className="row">
            <input
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
              placeholder="Search name, type, or CR (e.g. dragon, undead, 5)â€¦"
              aria-label="Search bestiary"
              style={{ flex: 1 }}
            />
            <span className="muted" style={{ alignSelf: "center" }}>
              {visible.length === statBlocks.length
                ? `${statBlocks.length} entries`
                : `${shown.length} of ${visible.length} shown`}
            </span>
          </div>
        )}
        {visible.length > RENDER_CAP && (
          <p className="muted">Showing first {RENDER_CAP} â€” refine the search to narrow further.</p>
        )}
        {shown.map((b) => (
          <li key={b.id} className="card">
            <div className="card-row">
              {resolvePortrait(b) ? (
                <img
                  src={resolvePortrait(b)!}
                  alt={b.name}
                  width={40}
                  height={40}
                  style={{ objectFit: "cover", borderRadius: 4, marginRight: 8 }}
                  onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")}
                />
              ) : null}
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
                  â›¨
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
                  transform: `scaleX(${Math.max(0, Math.min(100, (b.hit_points.current / Math.max(1, b.hit_points.maximum)) * 100)) / 100})`,
                }}
              />
            </div>
            {editingId === b.id && <StatBlockEditor block={b} allActions={actions} />}
          </li>
        ))}
      </ul>
      {statBlocks.length > 0 && visible.length === 0 && (
        <p className="muted" role="status">
          No monsters match "{query}". Try a name, type, or CR.
        </p>
      )}
      {statBlocks.length === 0 && (
        <div className="fantasy-empty" role="status">
          <span className="fantasy-empty-icon" aria-hidden="true">ðŸ‰</span>
          <span>No monsters yet â€” the bestiary awaits.</span>
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
  const [portrait, setPortrait] = useState(block.portrait ?? "");

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
      portrait: portrait.trim() || null,
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
          <input type="number" min={0} step={0.25} value={cr} onChange={(e) => setCr(parseNum(e.currentTarget.value))} />
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
          <input type="number" min={0} value={ac} onChange={(e) => setAc(parseNum(e.currentTarget.value))} />
        </label>
        <label className="attr">
          <span>HP</span>
          <input type="number" min={0} value={hp} onChange={(e) => setHp(parseNum(e.currentTarget.value))} />
        </label>
        <label className="attr">
          <span>Max HP</span>
          <input type="number" min={1} value={maxHp} onChange={(e) => setMaxHp(parseNum(e.currentTarget.value))} />
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
          <input type="number" min={0} value={speed} onChange={(e) => setSpeed(parseNum(e.currentTarget.value))} />
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
            <input type="number" value={v} onChange={(e) => setAttrs({ ...attrs, [k]: parseNum(e.currentTarget.value) })} />
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
        placeholder="Flavor text and loreâ€¦"
        rows={3}
        style={{ width: "100%" }}
      />

      <h3>Portrait</h3>
      <input
        value={portrait}
        onChange={(e) => setPortrait(e.currentTarget.value)}
        placeholder="Image URL or local asset path (e.g. assets/monsters/goblin.png)"
        style={{ width: "100%" }}
      />
      <p className="muted" style={{ marginTop: 4 }}>
        Leave blank to auto-load <code>assets/monsters/{block.key ?? "key"}.png</code> from this monster's key.
      </p>
      {resolvePortrait({ portrait, key: block.key }) ? (
        <img
          src={resolvePortrait({ portrait, key: block.key })!}
          alt={block.name}
          width={64}
          height={64}
          style={{ objectFit: "cover", borderRadius: 6, marginTop: 6 }}
          onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = "none")}
        />
      ) : null}

      <h3>Actions</h3>
      <div className="action-chips">
        {allActions.map((a) => (
          <button
            key={a.id}
            className={actions.includes(a.id) ? "" : "muted"}
            onClick={() => toggleAction(a.id)}
          >
            {actions.includes(a.id) ? "âœ“ " : ""}{a.name}
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
              <span className="muted">Ã—{entry.quantity_formula}</span>
              <span className="muted">{entry.chance}%</span>
              <button className="danger" onClick={() => removeLootEntry(idx)} style={{ fontSize: "0.7rem" }}>Ã—</button>
            </div>
          ))}
        </div>
      )}
      <div className="row" style={{ marginTop: "0.25rem" }}>
        <input value={newLootName} onChange={(e) => setNewLootName(e.currentTarget.value)} placeholder="Item name" />
        <input value={newLootQty} onChange={(e) => setNewLootQty(e.currentTarget.value)} placeholder="Qty formula" style={{ width: "5rem" }} />
        <input type="number" min={0} max={100} value={newLootChance} onChange={(e) => setNewLootChance(parseNum(e.currentTarget.value))} style={{ width: "4rem" }} />
        <button onClick={addLootEntry} disabled={!newLootName.trim()}>Add</button>
      </div>
      <p className="muted">Quantity formula (e.g. "2d6"), drop chance % (0-100).</p>

      <button onClick={save}>Save Monster</button>
    </div>
  );
}
