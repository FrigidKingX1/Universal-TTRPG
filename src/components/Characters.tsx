import { useState } from "react";
import { useStore } from "../store";
import type { ActionDefinition, CharacterProfile, InventoryItem } from "../types";

function NewCharacterForm() {
  const createCharacter = useStore((s) => s.createCharacter);
  const [name, setName] = useState("");
  return (
    <form
      className="row"
      onSubmit={(e) => {
        e.preventDefault();
        void createCharacter(name.trim());
        setName("");
      }}
    >
      <input
        value={name}
        onChange={(e) => setName(e.currentTarget.value)}
        placeholder="New character name"
        aria-label="Character name"
      />
      <button type="submit">Add</button>
    </form>
  );
}

export function CharacterList() {
  const characters = useStore((s) => s.characters);
  const deleteCharacter = useStore((s) => s.deleteCharacter);
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <section className="panel">
      <h2>Characters</h2>
      <NewCharacterForm />
      <ul className="card-list">
        {characters.map((c) => (
          <li key={c.id} className="card">
            <div className="card-row">
              <strong>{c.identity.name}</strong>
              <span className="muted">
                {c.identity.archetype ?? c.identity.ancestry ?? "Adventurer"} Lv {c.identity.level_or_rank}
              </span>
              <span className="muted">
                HP {c.resource_pools.hp?.current ?? 0}/{c.resource_pools.hp?.maximum ?? 0}
              </span>
              <button onClick={() => setEditingId(editingId === c.id ? null : c.id)}>
                {editingId === c.id ? "Close" : "Edit"}
              </button>
              <button className="danger" onClick={() => void deleteCharacter(c.id)}>
                Delete
              </button>
            </div>
            {editingId === c.id && <CharacterSheet profile={c} />}
          </li>
        ))}
      </ul>
      {characters.length === 0 && <p className="muted">No characters yet.</p>}
    </section>
  );
}

function CharacterSheet({ profile }: { profile: CharacterProfile }) {
  const saveCharacter = useStore((s) => s.saveCharacter);
  const [name, setName] = useState(profile.identity.name);
  const [ancestry, setAncestry] = useState(profile.identity.ancestry ?? "");
  const [archetype, setArchetype] = useState(profile.identity.archetype ?? "");
  const [background, setBackground] = useState(profile.identity.background ?? "");
  const [level, setLevel] = useState(profile.identity.level_or_rank);
  const [attrs, setAttrs] = useState(profile.attributes);
  const [hp, setHp] = useState(profile.resource_pools.hp?.current ?? 10);
  const [maxHp, setMaxHp] = useState(profile.resource_pools.hp?.maximum ?? 10);
  const [inventory, setInventory] = useState<InventoryItem[]>(profile.inventory);
  const [abilities, setAbilities] = useState(profile.abilities);

  const [newItemName, setNewItemName] = useState("");
  const [newAbility, setNewAbility] = useState("");

  const mod = (base: number) => Math.floor((base - 10) / 2);

  const save = () => {
    const updated: CharacterProfile = {
      ...profile,
      identity: {
        name: name.trim() || profile.identity.name,
        ancestry: ancestry.trim() || undefined,
        archetype: archetype.trim() || undefined,
        background: background.trim() || undefined,
        level_or_rank: level,
      },
      attributes: Object.fromEntries(
        Object.entries(attrs).map(([k, v]) => [
          k,
          { ...v, current_value: v.base_value, derived_modifier: mod(v.base_value) },
        ]),
      ),
      resource_pools: {
        ...profile.resource_pools,
        hp: {
          current: Math.max(0, hp),
          maximum: Math.max(1, maxHp),
          temporary: profile.resource_pools.hp?.temporary ?? 0,
          reset_condition: profile.resource_pools.hp?.reset_condition ?? "long_rest",
        },
      },
      inventory,
      abilities,
    };
    void saveCharacter(updated);
  };

  const addItem = () => {
    if (!newItemName.trim()) return;
    setInventory([
      ...inventory,
      { id: crypto.randomUUID(), name: newItemName.trim(), quantity: 1, is_equipped: false, weight: 0, tags: [] },
    ]);
    setNewItemName("");
  };

  const removeItem = (id: string) => setInventory(inventory.filter((i) => i.id !== id));

  const toggleEquip = (id: string) =>
    setInventory(inventory.map((i) => (i.id === id ? { ...i, is_equipped: !i.is_equipped } : i)));

  const addAbility = () => {
    if (!newAbility.trim()) return;
    setAbilities([...abilities, newAbility.trim()]);
    setNewAbility("");
  };

  return (
    <div className="sheet">
      <h3>Identity</h3>
      <div className="attr-grid">
        <label className="attr">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.currentTarget.value)} />
        </label>
        <label className="attr">
          <span>Level</span>
          <input type="number" min={1} value={level} onChange={(e) => setLevel(Number(e.currentTarget.value))} />
        </label>
        <label className="attr">
          <span>Ancestry</span>
          <input value={ancestry} onChange={(e) => setAncestry(e.currentTarget.value)} placeholder="e.g. Human" />
        </label>
        <label className="attr">
          <span>Class</span>
          <input value={archetype} onChange={(e) => setArchetype(e.currentTarget.value)} placeholder="e.g. Fighter" />
        </label>
        <label className="attr">
          <span>Background</span>
          <input value={background} onChange={(e) => setBackground(e.currentTarget.value)} placeholder="e.g. Knight" />
        </label>
      </div>

      <h3>Attributes</h3>
      <div className="attr-grid">
        {Object.entries(attrs).map(([k, v]) => (
          <label key={k} className="attr">
            <span>{k}</span>
            <input
              type="number"
              value={v.base_value}
              onChange={(e) =>
                setAttrs({ ...attrs, [k]: { ...v, base_value: Number(e.currentTarget.value) } })
              }
            />
            <span className="muted">({mod(v.base_value)})</span>
          </label>
        ))}
      </div>

      <h3>Hit Points</h3>
      <div className="attr-grid">
        <label className="attr">
          <span>Current</span>
          <input type="number" min={0} value={hp} onChange={(e) => setHp(Number(e.currentTarget.value))} />
        </label>
        <label className="attr">
          <span>Max</span>
          <input type="number" min={1} value={maxHp} onChange={(e) => setMaxHp(Number(e.currentTarget.value))} />
        </label>
      </div>
      <div className="hp-bar">
        <div
          className={`hp-bar-fill ${hp <= 0 ? "dead" : hp < maxHp * 0.25 ? "critical" : hp < maxHp * 0.5 ? "wounded" : "healthy"}`}
          style={{ width: `${Math.max(0, Math.min(100, (hp / maxHp) * 100))}%` }}
        />
      </div>

      <h3>Inventory</h3>
      <div className="inventory-list">
        {inventory.map((item) => (
          <div key={item.id} className="card-row" style={{ gap: "0.4rem", marginBottom: "0.25rem" }}>
            <span className={item.is_equipped ? "" : "muted"}>{item.name}</span>
            {item.is_equipped && <span className="badge">equipped</span>}
            <button onClick={() => toggleEquip(item.id)}>
              {item.is_equipped ? "Unequip" : "Equip"}
            </button>
            <button className="danger" onClick={() => removeItem(item.id)}>
              Remove
            </button>
          </div>
        ))}
        {inventory.length === 0 && <p className="muted">Empty backpack.</p>}
      </div>
      <div className="row">
        <input
          value={newItemName}
          onChange={(e) => setNewItemName(e.currentTarget.value)}
          placeholder="New item"
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addItem(); } }}
        />
        <button onClick={addItem}>Add Item</button>
      </div>

      <h3>Abilities</h3>
      <ul className="ability-list">
        {abilities.map((a) => (
          <li key={a} className="card-row" style={{ gap: "0.4rem" }}>
            <span>{a}</span>
            <button className="danger" onClick={() => setAbilities(abilities.filter((x) => x !== a))}>
              Remove
            </button>
          </li>
        ))}
        {abilities.length === 0 && <li className="muted">No abilities.</li>}
      </ul>
      <div className="row">
        <input
          value={newAbility}
          onChange={(e) => setNewAbility(e.currentTarget.value)}
          placeholder="Action ID (e.g. act_longsword)"
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addAbility(); } }}
        />
        <button onClick={addAbility}>Add</button>
      </div>

      <button onClick={save}>Save Character</button>
    </div>
  );
}

export function ActionList() {
  const actions = useStore((s) => s.actions);
  const saveAction = useStore((s) => s.saveAction);
  const deleteAction = useStore((s) => s.deleteAction);
  const [editingId, setEditingId] = useState<string | null>(null);

  const create = () => {
    const action: ActionDefinition = {
      id: crypto.randomUUID(),
      name: "New Attack",
      action_cost: { type: "action", amount: 1 },
      targeting: { target_type: "single_entity", size_feet: 0 },
      resolution: {
        type: "target_dc",
        primary_attribute: "STR",
        roll_formula: "1d20 + @attributes.STR.derived_modifier",
        vs_defense: "armor_class",
        outcomes: {
          on_success: { formula: "1d8 + @attributes.STR.derived_modifier", damage_type: "slashing" },
          on_failure: { formula: "", half_damage: false },
        },
      },
    };
    void saveAction(action);
    setEditingId(action.id);
  };

  return (
    <section className="panel">
      <h2>Actions</h2>
      <button onClick={create}>New Attack</button>
      <ul className="card-list">
        {actions.map((a) => (
          <li key={a.id} className="card">
            <div className="card-row">
              <strong>{a.name}</strong>
              <span className="muted">{a.resolution.type}</span>
              <button onClick={() => setEditingId(editingId === a.id ? null : a.id)}>
                {editingId === a.id ? "Close" : "Edit"}
              </button>
              <button className="danger" onClick={() => void deleteAction(a.id)}>
                Delete
              </button>
            </div>
            {editingId === a.id && (
              <ActionEditor action={a} onDone={() => setEditingId(null)} />
            )}
          </li>
        ))}
      </ul>
      {actions.length === 0 && <p className="muted">No actions yet.</p>}
    </section>
  );
}

function ActionEditor({ action, onDone }: { action: ActionDefinition; onDone: () => void }) {
  const saveAction = useStore((s) => s.saveAction);
  const [name, setName] = useState(action.name);
  const [formula, setFormula] = useState(action.resolution.roll_formula ?? "");
  const [damageFormula, setDamageFormula] = useState(action.resolution.outcomes?.on_success?.formula ?? "");
  const [damageType, setDamageType] = useState(action.resolution.outcomes?.on_success?.damage_type ?? "");

  const save = () => {
    void saveAction({
      ...action,
      name: name.trim() || action.name,
      resolution: {
        ...action.resolution,
        roll_formula: formula || undefined,
        outcomes: {
          on_success: {
            formula: damageFormula || undefined,
            damage_type: damageType || undefined,
          },
          on_failure: action.resolution.outcomes?.on_failure,
        },
      },
    });
    onDone();
  };

  return (
    <div className="sheet">
      <div className="attr-grid">
        <label className="attr">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.currentTarget.value)} />
        </label>
        <label className="attr">
          <span>Roll</span>
          <input value={formula} onChange={(e) => setFormula(e.currentTarget.value)} placeholder="1d20 + @attr" />
        </label>
        <label className="attr">
          <span>Damage</span>
          <input value={damageFormula} onChange={(e) => setDamageFormula(e.currentTarget.value)} placeholder="1d8 + @attr" />
        </label>
        <label className="attr">
          <span>Type</span>
          <input value={damageType} onChange={(e) => setDamageType(e.currentTarget.value)} placeholder="slashing" />
        </label>
      </div>
      <button onClick={save}>Save</button>
    </div>
  );
}
