import { useState } from "react";
import { useStore } from "../store";
import type { CharacterProfile, EncounterStatBlock, EngineOutcome } from "../types";

export function Combat() {
  const characters = useStore((s) => s.characters);
  const statBlocks = useStore((s) => s.statBlocks);
  const actions = useStore((s) => s.actions);
  const runAttack = useStore((s) => s.runAttack);
  const rollInitiative = useStore((s) => s.rollInitiative);
  const lastCombat = useStore((s) => s.lastCombat);
  const initiativeOrder = useStore((s) => s.initiativeOrder);
  const combatantStates = useStore((s) => s.combatantStates);

  const [attackerKey, setAttackerKey] = useState("");
  const [targetKey, setTargetKey] = useState("");
  const [actionId, setActionId] = useState("");
  const [busy, setBusy] = useState(false);

  const entities = [
    ...characters.map((c) => ({ key: `char:${c.id}`, name: c.identity.name, value: c as CharacterProfile | EncounterStatBlock })),
    ...statBlocks.map((b) => ({ key: `block:${b.id}`, name: b.name, value: b as CharacterProfile | EncounterStatBlock })),
  ];

  const resolve = (key: string) => {
    const e = entities.find((x) => x.key === key);
    return e ? e.value : null;
  };

  const hpInfo = (entity: CharacterProfile | EncounterStatBlock) => {
    const st = combatantStates[entity.id];
    if (st) return { current: st.hit_points, max: getHitPoints(entity), status: st.status };
    return { current: getHitPoints(entity), max: getHitPoints(entity), status: undefined };
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
    if (picks.length < 2) return;
    void rollInitiative(picks);
  };

  return (
    <section className="panel">
      <h2>Combat Tracker</h2>

      <div className="combat-roster">
        {entities.map((e) => {
          const hp = hpInfo(e.value);
          const pct = Math.max(0, Math.min(100, (hp.current / Math.max(1, hp.max)) * 100));
          const barClass = hp.current <= 0 ? "dead" : hp.current < hp.max * 0.25 ? "critical" : hp.current < hp.max * 0.5 ? "wounded" : "healthy";
          return (
            <div key={e.key} className="combatant-card">
              <div className="card-row">
                <strong>{e.name}</strong>
                <span className="muted">AC {getArmorClass(e.value)}</span>
                {hp.status && <span className="badge">{hp.status}</span>}
              </div>
              <div className="hp-row">
                <span>HP {hp.current}/{hp.max}</span>
                <div className="hp-bar">
                  <div className={`hp-bar-fill ${barClass}`} style={{ width: `${pct}%` }} />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="row">
        <label>
          Attacker
          <select value={attackerKey} onChange={(e) => setAttackerKey(e.currentTarget.value)}>
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
            {actions.map((a) => (
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
        <HealButton />
      </div>

      {lastCombat && <CombatResult outcome={lastCombat} />}

      {initiativeOrder.length > 0 && (
        <div className="initiative-section">
          <h3>Initiative Order</h3>
          <ol className="initiative">
            {initiativeOrder.map((e) => (
              <li key={e.combatant_id} className="card-row">
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
    </section>
  );
}

function getHitPoints(entity: CharacterProfile | EncounterStatBlock): number {
  if ("resource_pools" in entity) {
    return entity.resource_pools.hp?.current ?? 0;
  }
  return entity.hit_points.current;
}

function getArmorClass(entity: CharacterProfile | EncounterStatBlock): number {
  if ("armor_class" in entity) return entity.armor_class;
  return 10;
}

function HealButton() {
  const characters = useStore((s) => s.characters);
  const statBlocks = useStore((s) => s.statBlocks);
  const saveCharacter = useStore((s) => s.saveCharacter);
  const saveStatBlock = useStore((s) => s.saveStatBlock);
  const combatantStates = useStore((s) => s.combatantStates);
  const [amount, setAmount] = useState(5);

  const entities = [
    ...characters.map((c) => ({ id: c.id, name: c.identity.name, isChar: true, entity: c })),
    ...statBlocks.map((b) => ({ id: b.id, name: b.name, isChar: false, entity: b })),
  ];

  const heal = (id: string, isChar: boolean) => {
    const st = combatantStates[id];
    if (isChar) {
      const c = characters.find((x) => x.id === id);
      if (!c) return;
      const current = st?.hit_points ?? c.resource_pools.hp?.current ?? 0;
      const max = c.resource_pools.hp?.maximum ?? current;
      void saveCharacter({
        ...c,
        resource_pools: {
          ...c.resource_pools,
          hp: { ...c.resource_pools.hp!, current: Math.min(max, current + amount) },
        },
      });
    } else {
      const b = statBlocks.find((x) => x.id === id);
      if (!b) return;
      const current = st?.hit_points ?? b.hit_points.current;
      const max = b.hit_points.maximum;
      void saveStatBlock({
        ...b,
        hit_points: { ...b.hit_points, current: Math.min(max, current + amount) },
      });
    }
  };

  return (
    <div className="row" style={{ gap: "0.25rem", flexWrap: "wrap" }}>
      <label className="muted" style={{ fontSize: "0.8rem" }}>Heal</label>
      <input
        type="number"
        min={1}
        value={amount}
        onChange={(e) => setAmount(Math.max(1, Number(e.currentTarget.value)))}
        style={{ width: "3.5rem" }}
      />
      {entities.map((e) => (
        <button key={e.id} onClick={() => heal(e.id, e.isChar)}>
          {e.name}
        </button>
      ))}
    </div>
  );
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
        Damage: <strong>{outcome.damage_dealt}</strong> · Target HP:{" "}
        <strong>{outcome.target_hp_remaining}</strong> · Status:{" "}
        <strong>{outcome.target_status}</strong>
      </p>
      {outcome.applied_status && (
        <p className="exceptional">Applied status: {outcome.applied_status}</p>
      )}
    </div>
  );
}
