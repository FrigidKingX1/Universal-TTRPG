import { useState } from "react";
import { useStore } from "../store";
import type { ActionDefinition, CharacterProfile } from "../types";

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
              <span className="muted">Lv {c.identity.level_or_rank}</span>
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
  const [attrs, setAttrs] = useState(profile.attributes);
  const [hp, setHp] = useState(profile.resource_pools.hp?.current ?? 10);

  const mod = (base: number) => Math.floor((base - 10) / 2);

  const save = () => {
    const updated: CharacterProfile = {
      ...profile,
      attributes: Object.fromEntries(
        Object.entries(attrs).map(([k, v]) => [
          k,
          { ...v, derived_modifier: mod(v.base_value) },
        ]),
      ),
      resource_pools: {
        ...profile.resource_pools,
        hp: {
          current: Math.max(0, hp),
          maximum: profile.resource_pools.hp?.maximum ?? Math.max(1, hp),
          temporary: 0,
          reset_condition: profile.resource_pools.hp?.reset_condition ?? "long_rest",
        },
      },
    };
    void saveCharacter(updated);
  };

  return (
    <div className="sheet">
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
        <label className="attr">
          <span>HP</span>
          <input
            type="number"
            value={hp}
            onChange={(e) => setHp(Number(e.currentTarget.value))}
          />
        </label>
      </div>
      <button onClick={save}>Save</button>
    </div>
  );
}

export function ActionList() {
  const actions = useStore((s) => s.actions);
  const saveAction = useStore((s) => s.saveAction);
  const deleteAction = useStore((s) => s.deleteAction);

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
              <button className="danger" onClick={() => void deleteAction(a.id)}>
                Delete
              </button>
            </div>
            <p className="muted">
              roll: {a.resolution.roll_formula ?? "—"} vs {a.resolution.vs_defense ?? "—"}
            </p>
          </li>
        ))}
      </ul>
      {actions.length === 0 && <p className="muted">No actions yet.</p>}
    </section>
  );
}
