import { useEffect, useState } from "react";
import { backend } from "../backend";
import { useStore } from "../store";
import { useConfirmDialog } from "../hooks/useConfirmDialog";
import { PRESET_CLASSES, findClassByArchetype, growPoolsOnLevelUp } from "../presets/classes";
import { EQUIPMENT_CATALOG, findEquipment } from "../presets/equipment";
import { playDiceSound } from "../sound";
import type { ActionDefinition, CharacterProfile, InventoryItem } from "../types";

export function NewCharacterForm() {
  const createCharacter = useStore((s) => s.createCharacter);
  const [name, setName] = useState("");
  const [classId, setClassId] = useState("");
  const [dualClassId, setDualClassId] = useState("");
  return (
    <form
      className="row"
      onSubmit={(e) => {
        e.preventDefault();
        void createCharacter(name.trim(), classId || undefined, dualClassId || undefined);
        setName("");
      }}
    >
      <input
        value={name}
        onChange={(e) => setName(e.currentTarget.value)}
        placeholder="New character name"
        aria-label="Character name"
      />
      <select value={classId} onChange={(e) => setClassId(e.currentTarget.value)} aria-label="Class">
        <option value="">No class</option>
        {PRESET_CLASSES.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name} (d{c.hit_die})
          </option>
        ))}
      </select>
      <select
        value={dualClassId}
        onChange={(e) => setDualClassId(e.currentTarget.value)}
        aria-label="Dual class (optional)"
        title="Dual-class: gains half hit die, secondary pools at half, and both ability lists"
      >
        <option value="">No dual class</option>
        {PRESET_CLASSES.filter((c) => c.id !== classId).map((c) => (
          <option key={c.id} value={c.id}>
            + {c.name}
          </option>
        ))}
      </select>
      <button type="submit">Add</button>
    </form>
  );
}

function QuickRollRow({ profile }: { profile: CharacterProfile }) {
  const [result, setResult] = useState<string | null>(null);
  const [rolling, setRolling] = useState(false);

  const roll = async (attr: string) => {
    setRolling(true);
    playDiceSound();
    try {
      const r = await backend.rollDice(`1d20 + @attributes.${attr}.derived_modifier`);
      setResult(`${attr}: ${r.total} (${r.detail})`);
    } catch (e) {
      setResult(String(e));
    } finally {
      setRolling(false);
    }
  };

  const ATTRS = ["STR", "DEX", "CON", "INT", "WIS", "CHA"];

  return (
    <div className="quick-roll-row">
      <div className="roll-buttons">
        {ATTRS.map((attr) => {
          const attrState = profile.attributes[attr];
          const mod = attrState?.derived_modifier ?? Math.floor(((attrState?.base_value ?? 10) - 10) / 2);
          return (
            <button key={attr} className="roll-btn" onClick={() => void roll(attr)} disabled={rolling}>
              {attr} <span className="muted">({mod >= 0 ? "+" : ""}{mod})</span>
            </button>
          );
        })}
      </div>
      {result && <span className="roll-quick-result">{result}</span>}
    </div>
  );
}

export function CharacterList() {
  const characters = useStore((s) => s.characters);
  const deleteCharacter = useStore((s) => s.deleteCharacter);
  const cloneCharacter = useStore((s) => s.cloneCharacter);
  const activeCharacterId = useStore((s) => s.activeCharacter?.id ?? null);
  const selectActiveCharacter = useStore((s) => s.selectActiveCharacter);
  const { confirm, dialog } = useConfirmDialog();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [rollingId, setRollingId] = useState<string | null>(null);

  const requestDeleteCharacter = async (id: string, name: string) => {
    if (await confirm({ title: "Delete Character", message: `Delete ${name}? This cannot be undone.` })) {
      void deleteCharacter(id);
    }
  };

  return (
    <section className="panel">
      <h2>Characters</h2>
      <NewCharacterForm />
      <ul className="card-list">
        {characters.map((c) => (
          <li key={c.id} className={`card ${activeCharacterId === c.id ? "active-card" : ""}`}>
            <div className="card-row">
              <strong>{c.identity.name}</strong>
              <span className="muted">
                {c.identity.archetype ?? c.identity.ancestry ?? "Adventurer"}
                {c.identity.archetype_secondary ? ` / ${c.identity.archetype_secondary}` : ""}
                {` Lv ${c.identity.level_or_rank}`}
              </span>
              <span className="muted">
                HP {c.resource_pools.hp?.current ?? 0}/{c.resource_pools.hp?.maximum ?? 0}
              </span>
            </div>
            <div className="hp-bar">
              <div
                className={`hp-bar-fill ${(() => {
                  const cur = c.resource_pools.hp?.current ?? 0;
                  const max = c.resource_pools.hp?.maximum ?? 1;
                  return cur <= 0 ? "dead" : cur < max * 0.25 ? "critical" : cur < max * 0.5 ? "wounded" : "healthy";
                })()}`}
                style={{ transform: `scaleX(${Math.max(0, Math.min(100, ((c.resource_pools.hp?.current ?? 0) / Math.max(1, c.resource_pools.hp?.maximum ?? 1)) * 100)) / 100})` }}
              />
            </div>
            <div className="card-row">
              {activeCharacterId === c.id ? (
                <span className="badge">⭐ Active</span>
              ) : (
                <button onClick={() => selectActiveCharacter(c.id)} title="Use this character in Tabletop mode">
                  Set Active
                </button>
              )}
              <button onClick={() => setEditingId(editingId === c.id ? null : c.id)}>
                {editingId === c.id ? "Close" : "Edit"}
              </button>
              <button onClick={() => void cloneCharacter(c.id)}>
                Clone
              </button>
              <button onClick={() => setRollingId(rollingId === c.id ? null : c.id)}>
                {rollingId === c.id ? "Hide" : "Roll"}
              </button>
              <button className="danger" onClick={() => void requestDeleteCharacter(c.id, c.identity.name)}>
                Delete
              </button>
            </div>
            {rollingId === c.id && <QuickRollRow profile={c} />}
            {editingId === c.id && <CharacterSheet profile={c} />}
          </li>
        ))}
      </ul>
      {characters.length === 0 && (
        <div className="fantasy-empty" role="status">
          <span className="fantasy-empty-icon" aria-hidden="true">⚔️</span>
          <span>No characters yet — forge your first hero.</span>
        </div>
      )}
      {dialog}
    </section>
  );
}

export function CharacterSheet({ profile }: { profile: CharacterProfile }) {
  const saveCharacter = useStore((s) => s.saveCharacter);
  const dropItemToScene = useStore((s) => s.dropItemToScene);
  const [name, setName] = useState(profile.identity.name);
  const [ancestry, setAncestry] = useState(profile.identity.ancestry ?? "");
  const [archetype, setArchetype] = useState(profile.identity.archetype ?? "");
  const [background, setBackground] = useState(profile.identity.background ?? "");
  const [level, setLevel] = useState(profile.identity.level_or_rank);
  const [attrs, setAttrs] = useState(profile.attributes);
  const [hp, setHp] = useState(profile.resource_pools.hp?.current ?? 10);
  const [maxHp, setMaxHp] = useState(profile.resource_pools.hp?.maximum ?? 10);
  // Non-HP resource pools (spell slots, rage uses…), edited via level-up/rests.
  const [extraPools, setExtraPools] = useState(() =>
    Object.fromEntries(Object.entries(profile.resource_pools).filter(([k]) => k !== "hp")));
  const [inventory, setInventory] = useState<InventoryItem[]>(profile.inventory);
  const [abilities, setAbilities] = useState(profile.abilities);

  // Sync local state when profile prop changes externally (e.g., combat HP update, long rest)
  useEffect(() => {
    setName(profile.identity.name);
    setAncestry(profile.identity.ancestry ?? "");
    setArchetype(profile.identity.archetype ?? "");
    setBackground(profile.identity.background ?? "");
    setLevel(profile.identity.level_or_rank);
    setAttrs(profile.attributes);
    setHp(profile.resource_pools.hp?.current ?? 10);
    setMaxHp(profile.resource_pools.hp?.maximum ?? 10);
    setExtraPools(Object.fromEntries(Object.entries(profile.resource_pools).filter(([k]) => k !== "hp")));
    setInventory(profile.inventory);
    setAbilities(profile.abilities);
  }, [profile]);

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
        ...extraPools,
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
    // Autofill weight (and typical quantity) when the name matches the catalog.
    const catalog = findEquipment(newItemName);
    setInventory([
      ...inventory,
      {
        id: crypto.randomUUID(),
        name: newItemName.trim(),
        quantity: catalog?.qty ?? 1,
        state: "stowed",
        weight: catalog?.weight ?? 0,
        tags: catalog?.tags ?? [],
      },
    ]);
    setNewItemName("");
  };

  const removeItem = (id: string) => setInventory(inventory.filter((i) => i.id !== id));

  const toggleEquip = (id: string) =>
    setInventory(inventory.map((i) => (i.id === id ? { ...i, state: i.state === "equipped" ? "stowed" : "equipped" } : i)));

  const adjustQuantity = (id: string, delta: number) =>
    setInventory((inv) =>
      inv.map((i) => (i.id === id ? { ...i, quantity: Math.max(1, i.quantity + delta) } : i)),
    );

  const setItemWeight = (id: string, weight: number) =>
    setInventory((inv) => inv.map((i) => (i.id === id ? { ...i, weight: Math.max(0, weight) } : i)));

  const totalWeight = inventory.reduce((sum, i) => sum + i.weight * i.quantity, 0);
  const carryCapacity = 15 * (attrs.STR?.base_value ?? 10);

  const levelUp = () => {
    const newLevel = level + 1;
    const conBonus = mod(attrs.CON?.base_value ?? 10);
    const template = findClassByArchetype(archetype);
    // Hit-dice leveling: take the class hit die average (rounded up) + CON.
    // Unknown classes fall back to the legacy flat gain.
    const hpGain = template
      ? Math.max(1, Math.floor(template.hit_die / 2) + 1 + conBonus)
      : Math.max(1, conBonus + 5);
    setLevel(newLevel);
    setMaxHp(maxHp + hpGain);
    setHp(hp + hpGain);
    // Caster progression: existing pools grow by one use, and class
    // unlocks grant new tiers (primary and dual templates both count).
    setExtraPools((pools) =>
      growPoolsOnLevelUp(pools, newLevel, template, findClassByArchetype(profile.identity.archetype_secondary)),
    );
  };

  const addAbility = () => {
    if (!newAbility.trim()) return;
    setAbilities([...abilities, newAbility.trim()]);
    setNewAbility("");
  };

  return (
    <div className="sheet">
      <h3 style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        Identity
        {(() => {
          const cls = findClassByArchetype(archetype);
          return cls ? (
            <img
              src={`${import.meta.env.BASE_URL}assets/icons/class_${cls.id}.png`}
              alt={cls.name}
              width={28}
              height={28}
              title={cls.name}
              style={{ borderRadius: 5, border: "1px solid var(--border)" }}
            />
          ) : null;
        })()}
      </h3>
      <div className="attr-grid">
        <label className="attr">
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.currentTarget.value)} />
        </label>
        <label className="attr">
          <span>Level</span>
          <input type="number" min={1} value={level} onChange={(e) => setLevel(Number(e.currentTarget.value))} />
        </label>
        <div className="attr level-up-group">
          <button
            onClick={levelUp}
            title={`Gain a level: +HP (${(() => {
              const tpl = findClassByArchetype(archetype);
              const conBonus = mod(attrs.CON?.base_value ?? 10);
              return tpl ? `d${tpl.hit_die} avg + ${conBonus} CON` : `5 + ${conBonus} CON`;
            })()})`}
          >
            ⬆ Level Up
          </button>
        </div>
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

      {(() => {
        const template = findClassByArchetype(archetype);
        if (!template) return null;
        const unlocked = template.features_by_level.filter((f) => f.level <= level);
        const secondaryTemplate = findClassByArchetype(
          profile.identity.archetype_secondary,
        );
        const secondaryUnlocked =
          secondaryTemplate?.features_by_level.filter((f) => f.level <= level) ?? [];
        return (
          <>
            <h3>
              {template.name} Features{" "}
              <span className="muted">(d{template.hit_die} hit die)</span>
              {secondaryTemplate && (
                <span className="badge" title={`Dual class: +${Math.floor(secondaryTemplate.hit_die / 2)} HP, half pools, shared ability list`}>
                  / {secondaryTemplate.name}
                </span>
              )}
            </h3>
            {unlocked.length === 0 ? (
              <p className="muted">Features unlock as you gain levels.</p>
            ) : (
              <ul className="class-features">
                {unlocked.map((f) => (
                  <li key={f.name}>
                    <strong>{f.name}</strong> <span className="badge">Lv {f.level}</span>
                    <p className="muted">{f.description}</p>
                  </li>
                ))}
              </ul>
            )}
            {secondaryTemplate && (
              <>
                <h4 style={{ margin: "0.75rem 0 0.25rem" }}>
                  {secondaryTemplate.name} Features <span className="muted">(dual, d{secondaryTemplate.hit_die})</span>
                </h4>
                <ul className="class-features">
                  {secondaryUnlocked.map((f) => (
                    <li key={`${secondaryTemplate.id}-${f.name}`}>
                      <strong>{f.name}</strong> <span className="badge">Lv {f.level}</span>
                      <p className="muted">{f.description}</p>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        );
      })()}

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
          style={{ transform: `scaleX(${Math.max(0, Math.min(100, (hp / maxHp) * 100)) / 100})` }}
        />
      </div>

      {Object.keys(extraPools).length > 0 && (
        <>
          <h3>Resources</h3>
          <div className="pool-chips">
            {Object.entries(extraPools).map(([name, p]) => (
              <span
                key={name}
                className={`pool-chip ${p.current === 0 ? "pool-empty" : ""}`}
                title={`${p.current}/${p.maximum} — resets on ${String(p.reset_condition).replace(/_/g, " ")}`}
              >
                {name.replace(/_/g, " ")}: <strong>{p.current}/{p.maximum}</strong>
              </span>
            ))}
          </div>
        </>
      )}

      <h3>Inventory</h3>
      <p className="muted" style={{ fontSize: "0.8rem", margin: "0 0 0.4rem 0" }}>
        Carry weight: {totalWeight.toFixed(1)} / {carryCapacity} lbs
        {totalWeight > carryCapacity && <span className="exceptional"> (overloaded!)</span>}
      </p>
      <div className="inventory-list">
        {inventory.map((item) => (
          <div key={item.id} className="card-row inventory-row">
            <span className={item.state === "equipped" ? "" : "muted"}>{item.name}</span>
            {item.state === "equipped" && <span className="badge">equipped</span>}
            <span className="qty-controls">
              <button onClick={() => adjustQuantity(item.id, -1)} aria-label={`Decrease ${item.name} quantity`}>−</button>
              <span>{item.quantity}</span>
              <button onClick={() => adjustQuantity(item.id, 1)} aria-label={`Increase ${item.name} quantity`}>+</button>
            </span>
            <label className="weight-input">
              <input
                type="number"
                min={0}
                step={0.1}
                value={item.weight}
                onChange={(e) => setItemWeight(item.id, Number(e.currentTarget.value))}
                aria-label={`${item.name} weight`}
              />
              <span className="muted">lbs</span>
            </label>
            <button
              onClick={() => void dropItemToScene(profile.id, item)}
              title="Drop on the ground — anyone at this scene can pick it up"
            >
              Drop
            </button>
            <button onClick={() => toggleEquip(item.id)}>
              {item.state === "equipped" ? "Unequip" : "Equip"}
            </button>
            <button className="danger" onClick={() => removeItem(item.id)}>
              Remove
            </button>
          </div>
        ))}
        {inventory.length === 0 && (
          <div className="fantasy-empty" style={{ padding: "0.8rem" }}>
            <span>Empty pack — gather your gear.</span>
          </div>
        )}
      </div>
      <div className="row">
        <input
          value={newItemName}
          onChange={(e) => setNewItemName(e.currentTarget.value)}
          placeholder="New item (type to search catalog)"
          list="equipment-catalog-options"
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addItem(); } }}
        />
        <datalist id="equipment-catalog-options">
          {EQUIPMENT_CATALOG.map((e) => (
            <option key={e.name} value={e.name}>{e.notes ?? `${e.category} · ${e.weight} lb`}</option>
          ))}
        </datalist>
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
  const { confirm, dialog } = useConfirmDialog();
  const [editingId, setEditingId] = useState<string | null>(null);

  const requestDeleteAction = async (id: string, name: string) => {
    if (await confirm({ title: "Delete Action", message: `Delete action "${name}"?` })) {
      void deleteAction(id);
    }
  };

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
              <button className="danger" onClick={() => void requestDeleteAction(a.id, a.name)}>
                Delete
              </button>
            </div>
            {editingId === a.id && (
              <ActionEditor action={a} onDone={() => setEditingId(null)} />
            )}
          </li>
        ))}
      </ul>
      {actions.length === 0 && (
        <div className="fantasy-empty" style={{ padding: "0.7rem" }}>
          <span>No actions yet — forge your first technique.</span>
        </div>
      )}
      {dialog}
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
