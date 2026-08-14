import { useState } from "react";
import { useStore } from "../store";
import type { EngineOutcome } from "../types";

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
    ...characters.map((c) => ({ key: `char:${c.id}`, name: c.identity.name, value: c })),
    ...statBlocks.map((b) => ({ key: `block:${b.id}`, name: b.name, value: b })),
  ];

  const resolve = (key: string) => {
    const e = entities.find((x) => x.key === key);
    return e ? e.value : null;
  };

  const hpLabel = (key: string, fallback: number) => {
    const e = entities.find((x) => x.key === key);
    if (!e) return fallback;
    const st = combatantStates[e.value.id];
    return st ? st.hit_points : fallback;
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
    const picks = [resolve(attackerKey), resolve(targetKey)].filter(Boolean) as NonNullable<
      ReturnType<typeof resolve>
    >[];
    if (!picks.length) return;
    void rollInitiative(picks);
  };

  return (
    <section className="panel">
      <h2>Combat</h2>
      <div className="row">
        <label>
          Attacker
          <select value={attackerKey} onChange={(e) => setAttackerKey(e.currentTarget.value)}>
            <option value="">—</option>
            {entities.map((e) => (
              <option key={e.key} value={e.key}>
                {e.name} (HP {hpLabel(e.key, 0)})
              </option>
            ))}
          </select>
        </label>
        <label>
          Target
          <select value={targetKey} onChange={(e) => setTargetKey(e.currentTarget.value)}>
            <option value="">—</option>
            {entities.map((e) => (
              <option key={e.key} value={e.key}>
                {e.name} (HP {hpLabel(e.key, 0)})
              </option>
            ))}
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
      </div>

      {lastCombat && <CombatResult outcome={lastCombat} />}

      {initiativeOrder.length > 0 && (
        <ol className="initiative">
          {initiativeOrder.map((e) => (
            <li key={e.combatant_id}>
              {e.name} — {e.roll}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function CombatResult({ outcome }: { outcome: EngineOutcome }) {
  return (
    <div className="combat-result">
      <p>
        {outcome.attack_result} <span className="muted">({outcome.attack_roll ?? "?"})</span>
      </p>
      <p>
        Damage: <strong>{outcome.damage_dealt}</strong> · Target HP:{" "}
        <strong>{outcome.target_hp_remaining}</strong> · Status:{" "}
        <strong>{outcome.target_status}</strong>
      </p>
    </div>
  );
}
