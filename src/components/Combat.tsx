import { useState } from "react";
import { useStore } from "../store";
import type { CharacterProfile, EncounterStatBlock, EngineOutcome } from "../types";

const CONDITIONS = ["Poisoned", "Prone", "Stunned", "Frightened", "Blinded", "Charmed", "Invisible", "Exhaustion"];

const CONDITION_DESC: Record<string, string> = {
  Poisoned: "Disadvantage on attack rolls and ability checks.",
  Prone: "Disadvantage on attack rolls. Melee attacks against you have advantage.",
  Stunned: "Incapacitated. Auto-fails STR and DEX saves. Attacks against you have advantage.",
  Frightened: "Disadvantage on ability checks and attack rolls while source is in line of sight.",
  Blinded: "Auto-fails sight-based checks. Attacks against you have advantage. Your attacks have disadvantage.",
  Charmed: "Can't target the charmer with harmful abilities. Charmer has advantage on social checks.",
  Invisible: "Attacks against you have disadvantage. Your attacks have advantage.",
  Exhaustion: "6 levels. Level 1: disadvantage on ability checks. Level 2: halved speed. And worse...",
};

const CONDITION_EFFECTS: Record<string, string[]> = {
  Poisoned: ["disadvantage on attack rolls", "disadvantage on ability checks"],
  Prone: ["disadvantage on ranged attack rolls", "melee attacks against you gain advantage"],
  Stunned: ["incapacitated", "auto-fail STR/DEX saves", "attacks against you gain advantage"],
  Frightened: ["disadvantage on ability checks", "disadvantage on attack rolls while source visible"],
  Blinded: ["auto-fail sight-based checks", "attacks against you gain advantage", "your attacks have disadvantage"],
  Charmed: ["can't target charmer with harmful effects", "charmer has advantage on social checks"],
  Invisible: ["attacks against you have disadvantage", "your attacks have advantage"],
  Exhaustion: ["level 1: disadvantage on ability checks", "level 2: halved speed", "level 3: disadvantage on attacks & saves"],
};

export function Combat() {
  const characters = useStore((s) => s.characters);
  const statBlocks = useStore((s) => s.statBlocks);
  const actions = useStore((s) => s.actions);
  const runAttack = useStore((s) => s.runAttack);
  const rollInitiative = useStore((s) => s.rollInitiative);
  const nextTurn = useStore((s) => s.nextTurn);
  const endCombat = useStore((s) => s.endCombat);
  const removeCombatant = useStore((s) => s.removeCombatant);
  const longRest = useStore((s) => s.longRest);
  const shortRest = useStore((s) => s.shortRest);
  const lastCombat = useStore((s) => s.lastCombat);
  const combatHistory = useStore((s) => s.combatHistory);
  const initiativeOrder = useStore((s) => s.initiativeOrder);
  const combatantStates = useStore((s) => s.combatantStates);
  const combatantConditions = useStore((s) => s.combatantConditions);
  const toggleCondition = useStore((s) => s.toggleCondition);
  const currentRound = useStore((s) => s.currentRound);
  const currentTurnIndex = useStore((s) => s.currentTurnIndex);
  const deathSaves = useStore((s) => s.deathSaves);
  const rollDeathSave = useStore((s) => s.rollDeathSave);
  const lastHpChange = useStore((s) => s.lastHpChange);
  const undoLastHpChange = useStore((s) => s.undoLastHpChange);
  const loot = useStore((s) => s.loot);
  const addLoot = useStore((s) => s.addLoot);
  const assignLoot = useStore((s) => s.assignLoot);
  const clearLoot = useStore((s) => s.clearLoot);

  const [attackerKey, setAttackerKey] = useState("");
  const [targetKey, setTargetKey] = useState("");
  const [actionId, setActionId] = useState("");
  const [busy, setBusy] = useState(false);
  const [customHpAmount, setCustomHpAmount] = useState(0);
  const [customHpTarget, setCustomHpTarget] = useState("");
  const [showLog, setShowLog] = useState(false);
  const [showLoot, setShowLoot] = useState(false);
  const [lootName, setLootName] = useState("");
  const [lootQty, setLootQty] = useState(1);
  const [lootSource, setLootSource] = useState("");
  const [selectedEntities, setSelectedEntities] = useState<Set<string>>(new Set());
  const [batchHpAmount, setBatchHpAmount] = useState(0);
  const [showSummary, setShowSummary] = useState(false);
  const [combatSummary, setCombatSummary] = useState<{ damageDealt: number; targetsHit: string[]; defeated: string[] } | null>(null);

  const entities = [
    ...characters.map((c) => ({ key: `char:${c.id}`, name: c.identity.name, value: c as CharacterProfile | EncounterStatBlock })),
    ...statBlocks.map((b) => ({ key: `block:${b.id}`, name: b.name, value: b as EncounterStatBlock | CharacterProfile })),
  ];

  const resolve = (key: string) => {
    const e = entities.find((x) => x.key === key);
    return e ? e.value : null;
  };

  const hpInfo = (entity: CharacterProfile | EncounterStatBlock) => {
    const max = getMaxHp(entity);
    const st = combatantStates[entity.id];
    if (st) return { current: st.hit_points, max, status: st.status };
    return { current: getHitPoints(entity), max, status: undefined };
  };

  // Get actions available to the selected attacker.
  const attackerActions = (() => {
    const attacker = resolve(attackerKey);
    if (!attacker) return actions;
    if ("identity" in attacker) {
      // CharacterProfile — filter by abilities list.
      const abilityIds = new Set(attacker.abilities);
      const matched = actions.filter((a) => abilityIds.has(a.id));
      return matched.length > 0 ? matched : actions;
    }
    // EncounterStatBlock — filter by actions list.
    const actionIds = new Set((attacker as EncounterStatBlock).actions);
    const matched = actions.filter((a) => actionIds.has(a.id));
    return matched.length > 0 ? matched : actions;
  })();

  const quickHpAdjust = (entity: CharacterProfile | EncounterStatBlock, isChar: boolean, amount: number) => {
    const previousHp = combatantStates[entity.id]?.hit_points ?? (isChar ? (entity as CharacterProfile).resource_pools.hp?.current ?? 0 : (entity as EncounterStatBlock).hit_points.current);
    if (isChar) {
      const c = characters.find((x) => x.id === entity.id);
      if (!c) return;
      const current = combatantStates[c.id]?.hit_points ?? c.resource_pools.hp?.current ?? 0;
      const max = c.resource_pools.hp?.maximum ?? current;
      const newHp = Math.max(0, Math.min(max, current + amount));
      useStore.setState({
        lastHpChange: { entityId: entity.id, previousHp, newHp },
        combatantStates: {
          ...combatantStates,
          [c.id]: { hit_points: newHp, status: combatantStates[c.id]?.status },
        },
      });
      void saveCharacter({
        ...c,
        resource_pools: {
          ...c.resource_pools,
          hp: { ...c.resource_pools.hp!, current: newHp },
        },
      });
    } else {
      const b = statBlocks.find((x) => x.id === entity.id);
      if (!b) return;
      const current = combatantStates[b.id]?.hit_points ?? b.hit_points.current;
      const max = b.hit_points.maximum;
      const newHp = Math.max(0, Math.min(max, current + amount));
      useStore.setState({
        lastHpChange: { entityId: entity.id, previousHp, newHp },
        combatantStates: {
          ...combatantStates,
          [b.id]: { hit_points: newHp, status: combatantStates[b.id]?.status },
        },
      });
      void saveStatBlock({
        ...b,
        hit_points: { ...b.hit_points, current: newHp },
      });
    }
  };

  const applyCustomHp = () => {
    if (!customHpTarget || customHpAmount === 0) return;
    const entity = resolve(customHpTarget);
    if (!entity) return;
    const isChar = "identity" in entity;
    quickHpAdjust(entity, isChar, customHpAmount);
    setCustomHpAmount(0);
  };

  const toggleSelect = (entityId: string) => {
    setSelectedEntities((prev) => {
      const next = new Set(prev);
      if (next.has(entityId)) next.delete(entityId);
      else next.add(entityId);
      return next;
    });
  };

  const applyBatchHp = () => {
    if (batchHpAmount === 0 || selectedEntities.size === 0) return;
    for (const key of selectedEntities) {
      const entity = resolve(key);
      if (!entity) continue;
      const isChar = "identity" in entity;
      quickHpAdjust(entity, isChar, batchHpAmount);
    }
    setBatchHpAmount(0);
    setSelectedEntities(new Set());
  };

  const endCombatWithSummary = () => {
    let totalDmg = 0;
    let hits = 0;
    let kills = 0;
    for (const h of combatHistory) {
      totalDmg += h.damage_dealt;
      if (h.damage_dealt > 0) hits++;
      if (h.target_status === "DEFEATED") kills++;
    }
    setCombatSummary({ damageDealt: totalDmg, targetsHit: [`${hits} hit${hits !== 1 ? "s" : ""}`], defeated: [`${kills} defeated`] });
    setShowSummary(true);
    endCombat();
  };

  const attack = async () => {
    const attacker = resolve(attackerKey);
    const target = resolve(targetKey);
    if (!attacker || !target || !actionId) {
      useStore.getState().setError("Pick an attacker, target, and action.");
      return;
    }
    setBusy(true);
    try {
      await runAttack(attacker, target, actionId);
    } catch (e) {
      useStore.getState().setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const initiative = () => {
    const picks = entities.map((e) => e.value);
    if (picks.length < 2) {
      useStore.getState().showToast("Need at least 2 combatants for initiative");
      return;
    }
    void rollInitiative(picks);
  };

  // Find the current combatant in initiative order.
  const currentTurnId = initiativeOrder.length > 0 ? initiativeOrder[currentTurnIndex]?.combatant_id : null;

  return (
    <>
    <section className="panel">
      <h2>Combat Tracker</h2>

      {/* Round & Turn Tracker */}
      {initiativeOrder.length > 0 && (
        <div className="combat-tracker">
          <div className="tracker-info">
            <span className="tracker-round">Round {currentRound}</span>
            <span className="tracker-turn muted">
              Current: {initiativeOrder[currentTurnIndex]?.name ?? "—"}
            </span>
          </div>
          <div className="tracker-actions">
            <button onClick={nextTurn}>Next Turn</button>
            <button className="danger" onClick={endCombatWithSummary}>End Combat</button>
          </div>
        </div>
      )}

      <div className="combat-roster">
        {entities.map((e) => {
          const hp = hpInfo(e.value);
          const pct = Math.max(0, Math.min(100, (hp.current / Math.max(1, hp.max)) * 100));
          const barClass = hp.current <= 0 ? "dead" : hp.current < hp.max * 0.25 ? "critical" : hp.current < hp.max * 0.5 ? "wounded" : "healthy";
          const isChar = "identity" in e.value;
          const initEntry = initiativeOrder.find((i) => i.combatant_id === e.value.id);
          const isCurrentTurn = initEntry && e.value.id === currentTurnId;
          return (
            <div key={e.key} className={`combatant-card ${isCurrentTurn ? "current-turn" : ""}`}>
              <div className="card-row">
                {initEntry && <span className="init-badge">#{initiativeOrder.indexOf(initEntry) + 1}</span>}
                <strong>{e.name}</strong>
                <span className="muted">AC {getArmorClass(e.value)}</span>
                {hp.status && <span className="badge">{hp.status}</span>}
                {isCurrentTurn && <span className="badge turn-badge">active</span>}
              </div>
              <div className="hp-row">
                <span>HP {hp.current}/{hp.max}</span>
                <div className="hp-bar">
                  <div className={`hp-bar-fill ${barClass}`} style={{ width: `${pct}%` }} />
                </div>
              </div>
              <div className="hp-adjust-row">
                {[-5, -1, 1, 5].map((amt) => (
                  <button
                    key={amt}
                    className={amt < 0 ? "hp-dmg" : "hp-heal"}
                    onClick={() => quickHpAdjust(e.value, isChar, amt)}
                  >
                    {amt > 0 ? "+" : ""}{amt}
                  </button>
                ))}
              </div>
              <div className="condition-row">
                {(combatantConditions[e.value.id] ?? []).map((c) => {
                  const effects = CONDITION_EFFECTS[c];
                  return (
                    <span
                      key={c}
                      className="condition-badge"
                      title={`${CONDITION_DESC[c] ?? c}\n${effects ? "\nEffects:\n• " + effects.join("\n• ") : ""}`}
                      onClick={() => toggleCondition(e.value.id, c)}
                    >
                      {c} ×
                    </span>
                  );
                })}
                <select
                  className="condition-select"
                  value=""
                  onChange={(ev) => { if (ev.currentTarget.value) toggleCondition(e.value.id, ev.currentTarget.value); ev.currentTarget.value = ""; }}
                >
                  <option value="">+ Condition</option>
                  {CONDITIONS.filter((c) => !(combatantConditions[e.value.id] ?? []).includes(c)).map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div className="card-footer-row">
                {hp.current <= 0 && hp.status !== "dead" && hp.status !== "stable" && isChar && (
                  <div className="death-save-row">
                    <span className="muted">Death Saves: {deathSaves[e.value.id]?.successes ?? 0}/{deathSaves[e.value.id]?.failures ?? 0}</span>
                    <button className="death-save-btn" onClick={() => void rollDeathSave(e.value.id)}>Roll Death Save</button>
                  </div>
                )}
                {lastHpChange?.entityId === e.value.id && (
                  <button className="undo-btn" onClick={undoLastHpChange}>Undo</button>
                )}
                <button className="remove-combatant-btn danger" onClick={() => { if (confirm(`Remove ${e.name} from combat?`)) removeCombatant(e.value.id); }}>
                  Remove
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Custom HP Input */}
      <div className="row custom-hp-row">
        <label>
          Target
          <select value={customHpTarget} onChange={(e) => setCustomHpTarget(e.currentTarget.value)}>
            <option value="">—</option>
            {entities.map((e) => (
              <option key={e.key} value={e.key}>{e.name}</option>
            ))}
          </select>
        </label>
        <label>
          HP
          <input
            type="number"
            value={customHpAmount}
            onChange={(e) => setCustomHpAmount(Number(e.currentTarget.value))}
            placeholder="± amount"
            style={{ width: "5rem" }}
          />
        </label>
        <button onClick={applyCustomHp} disabled={!customHpTarget || customHpAmount === 0}>
          {customHpAmount >= 0 ? "Heal" : "Damage"}
        </button>
      </div>

      {/* Batch HP Adjust */}
      <div className="row custom-hp-row" style={{ marginTop: "0.5rem" }}>
        <label>
          Batch Target(s)
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem", maxWidth: "20rem" }}>
            {entities.map((e) => (
              <label key={e.key} style={{ fontSize: "0.85rem", display: "flex", gap: "0.2rem" }}>
                <input type="checkbox" checked={selectedEntities.has(e.key)} onChange={() => toggleSelect(e.key)} />
                {e.name}
              </label>
            ))}
          </div>
        </label>
        <label>
          HP
          <input
            type="number"
            value={batchHpAmount}
            onChange={(e) => setBatchHpAmount(Number(e.currentTarget.value))}
            placeholder="± amount"
            style={{ width: "5rem" }}
          />
        </label>
        <button onClick={applyBatchHp} disabled={selectedEntities.size === 0 || batchHpAmount === 0}>
          {batchHpAmount >= 0 ? "Batch Heal" : "Batch Damage"}
        </button>
      </div>

      {/* Rest Buttons */}
      <div className="rest-buttons-row">
        <button className="rest-btn short-rest" onClick={() => void shortRest()}>Short Rest</button>
        <button className="rest-btn long-rest" onClick={() => void longRest()}>Long Rest</button>
      </div>

      <div className="row">
        <label>
          Attacker
          <select value={attackerKey} onChange={(e) => { setAttackerKey(e.currentTarget.value); setActionId(""); }}>
            <option value="">—</option>
            {entities.map((e) => {
              const hp = hpInfo(e.value);
              return (
                <option key={e.key} value={e.key}>
                  {e.name} (HP {hp.current}/{hp.max})
                </option>
              );
            })}
          </select>
        </label>
        <label>
          Target
          <select value={targetKey} onChange={(e) => setTargetKey(e.currentTarget.value)}>
            <option value="">—</option>
            {entities.map((e) => {
              const hp = hpInfo(e.value);
              return (
                <option key={e.key} value={e.key}>
                  {e.name} (HP {hp.current}/{hp.max})
                </option>
              );
            })}
          </select>
        </label>
        <label>
          Action
          <select value={actionId} onChange={(e) => setActionId(e.currentTarget.value)}>
            <option value="">—</option>
            {attackerActions.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="row">
        <button onClick={() => void attack()} disabled={busy}>
          {busy ? "Rolling…" : "Attack"}
        </button>
        <button onClick={initiative}>Roll Initiative</button>
      </div>

      {lastCombat && <CombatResult outcome={lastCombat} />}

      {initiativeOrder.length > 0 && (
        <div className="initiative-section">
          <h3>Initiative Order</h3>
          <ol className="initiative">
            {initiativeOrder.map((e, idx) => (
              <li key={e.combatant_id} className={`card-row ${idx === currentTurnIndex ? "current-turn-row" : ""}`}>
                <strong>{e.name}</strong>
                <span className="muted">
                  {e.modifier >= 0 ? "+" : ""}{e.modifier}
                </span>
                <span>{e.roll}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Mini Combat Log */}
      {combatHistory.length > 0 && (
        <div className="combat-log-section">
          <button className="log-toggle" onClick={() => setShowLog(!showLog)}>
            {showLog ? "Hide" : "Show"} Combat Log ({combatHistory.length})
          </button>
          {showLog && (
            <div className="combat-log">
              {combatHistory.slice().reverse().map((outcome, i) => (
                <CombatLogEntry key={i} outcome={outcome} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Loot Distribution */}
      <div className="loot-section">
        <button className="log-toggle" onClick={() => setShowLoot(!showLoot)}>
          {showLoot ? "Hide" : "Show"} Loot ({loot.filter((l) => !l.assignedTo).length} unassigned)
        </button>
        {showLoot && (
          <div className="loot-panel">
            <div className="row">
              <input
                value={lootName}
                onChange={(e) => setLootName(e.currentTarget.value)}
                placeholder="Item name"
              />
              <input
                type="number"
                min={1}
                value={lootQty}
                onChange={(e) => setLootQty(Math.max(1, Number(e.currentTarget.value)))}
                style={{ width: "4rem" }}
              />
              <label>
                Source
                <select value={lootSource} onChange={(e) => setLootSource(e.currentTarget.value)}>
                  <option value="">—</option>
                  {entities.map((en) => (
                    <option key={en.key} value={en.key}>{en.name}</option>
                  ))}
                </select>
              </label>
              <button
                onClick={() => { if (lootName.trim()) { addLoot(lootName.trim(), lootQty, lootSource); setLootName(""); setLootQty(1); } }}
                disabled={!lootName.trim()}
              >
                Add Loot
              </button>
            </div>
            {loot.length > 0 && (
              <div className="loot-list">
                {loot.map((l) => (
                  <div key={l.id} className="card-row loot-entry">
                    <span>{l.quantity}× {l.name}</span>
                    {l.sourceEntity && <span className="muted">from {entities.find((e) => e.key === l.sourceEntity)?.name ?? "?"}</span>}
                    {l.assignedTo ? (
                      <span className="badge">{characters.find((c) => c.id === l.assignedTo)?.identity.name ?? "assigned"}</span>
                    ) : (
                      <select
                        value=""
                        onChange={(e) => { if (e.currentTarget.value) assignLoot(l.id, e.currentTarget.value); }}
                      >
                        <option value="">Assign to…</option>
                        {characters.map((c) => (
                          <option key={c.id} value={c.id}>{c.identity.name}</option>
                        ))}
                      </select>
                    )}
                  </div>
                ))}
                <button className="muted" onClick={clearLoot} style={{ fontSize: "0.8rem", marginTop: "0.25rem" }}>
                  Clear All Loot
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
    {showSummary && combatSummary && (
      <div className="modal-overlay" onClick={() => setShowSummary(false)}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <h3>Combat Summary</h3>
          <p>Total damage dealt: <strong>{combatSummary.damageDealt}</strong></p>
          <p>Targets hit: <strong>{combatSummary.targetsHit.length}</strong></p>
          {combatSummary.defeated.length > 0 && (
            <p className="exceptional">Defeated: {combatSummary.defeated.join(", ")}</p>
          )}
          <p className="muted">Loot rolled and added to the Loot tab.</p>
          <button onClick={() => setShowSummary(false)}>Close</button>
        </div>
      </div>
    )}
    </>
  );
}

function CombatLogEntry({ outcome }: { outcome: EngineOutcome }) {
  return (
    <div className="combat-log-entry">
      <span className="muted">{outcome.attack_result}</span>
      {outcome.attack_roll != null && (
        <span className="muted"> (rolled {outcome.attack_roll}</span>
      )}
      {outcome.target_ac != null && (
        <span className="muted"> vs AC {outcome.target_ac})</span>
      )}
      {outcome.damage_dealt > 0 && (
        <span> — <strong>{outcome.damage_dealt} dmg</strong>
          {outcome.damage_type && <span className="muted"> [{outcome.damage_type}]</span>}
          {outcome.damage_modifier && <span className={outcome.damage_modifier === "immune" ? "exceptional" : outcome.damage_modifier === "vulnerable" ? "fury" : "muted"}> ({outcome.damage_modifier})</span>}
        </span>
      )}
      {outcome.damage_dealt === 0 && outcome.damage_modifier === "immune" && (
        <span className="exceptional"> — immune!</span>
      )}
      {outcome.target_hp_remaining <= 0 && (
        <span className="exceptional"> — defeated!</span>
      )}
    </div>
  );
}

function getHitPoints(entity: CharacterProfile | EncounterStatBlock): number {
  if ("resource_pools" in entity) {
    return entity.resource_pools.hp?.current ?? 0;
  }
  return entity.hit_points.current;
}

function getMaxHp(entity: CharacterProfile | EncounterStatBlock): number {
  if ("resource_pools" in entity) {
    return entity.resource_pools.hp?.maximum ?? getHitPoints(entity);
  }
  return entity.hit_points.maximum;
}

function getArmorClass(entity: CharacterProfile | EncounterStatBlock): number {
  if ("armor_class" in entity) return entity.armor_class;
  return 10;
}

function saveCharacter(c: CharacterProfile) {
  void useStore.getState().saveCharacter(c);
}

function saveStatBlock(b: EncounterStatBlock) {
  void useStore.getState().saveStatBlock(b);
}

function CombatResult({ outcome }: { outcome: EngineOutcome }) {
  return (
    <div className="combat-result">
      {outcome.check_result && (
        <p>
          Prerequisite: {outcome.check_result}{" "}
          <span className="muted">({outcome.check_detail ?? "?"})</span>
        </p>
      )}
      <p>
        {outcome.attack_result}{" "}
        <span className="muted">
          ({outcome.attack_roll != null ? `rolled ${outcome.attack_roll}` : "?"}
          {outcome.target_ac != null ? ` vs AC ${outcome.target_ac}` : ""})
        </span>
      </p>
      <p>
        Damage: <strong>{outcome.damage_dealt}</strong>
        {outcome.damage_type && <span className="muted"> [{outcome.damage_type}]</span>}
        {outcome.damage_modifier && <span className={outcome.damage_modifier === "immune" ? "exceptional" : outcome.damage_modifier === "vulnerable" ? "fury" : "muted"}> ({outcome.damage_modifier})</span>}
        {" · "}Target HP:{" "}
        <strong>{outcome.target_hp_remaining}</strong> · Status:{" "}
        <strong>{outcome.target_status}</strong>
      </p>
      {outcome.applied_status && (
        <p className="exceptional">Applied status: {outcome.applied_status}</p>
      )}
    </div>
  );
}
