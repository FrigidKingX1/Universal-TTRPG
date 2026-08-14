import { useEffect, useState } from "react";
import { backend } from "../backend";
import { useStore } from "../store";

export function DiceRoller() {
  const lastRoll = useStore((s) => s.lastRoll);
  const [expr, setExpr] = useState("1d20 + @attributes.STR.derived_modifier");
  const [result, setResult] = useState<string | null>(null);

  const roll = async () => {
    try {
      const r = await backend.rollDice(expr);
      setResult(`${r.total}  (${r.detail})`);
    } catch (e) {
      setResult(String(e));
    }
  };

  return (
    <section className="panel">
      <h2>Dice Roller</h2>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          void roll();
        }}
      >
        <input
          value={expr}
          onChange={(e) => setExpr(e.currentTarget.value)}
          aria-label="Dice expression"
        />
        <button type="submit">Roll</button>
      </form>
      <p className="roll-result">
        {result ?? (lastRoll ? `${lastRoll.total}  (${lastRoll.detail})` : "Roll something.")}
      </p>
    </section>
  );
}

export function OraclePanel() {
  const lastFate = useStore((s) => s.lastFate);
  const lastEvent = useStore((s) => s.lastEvent);
  const chaosFactor = useStore((s) => {
    const active = s.scenes.find((sc) => sc.id === s.activeSceneId);
    return active ? active.chaos_factor : 5;
  });
  const [odds, setOdds] = useState("fifty_fifty");

  const fate = async () => {
    try {
      await backend.fateCheck(odds as never, chaosFactor);
    } catch (e) {
      useStore.getState().setError(String(e));
    }
  };

  const event = async () => {
    try {
      await backend.randomEvent(chaosFactor);
    } catch (e) {
      useStore.getState().setError(String(e));
    }
  };

  return (
    <section className="panel">
      <h2>Oracle</h2>
      <div className="row">
        <label>
          Odds
          <select value={odds} onChange={(e) => setOdds(e.currentTarget.value)}>
            <option value="impossible">Impossible</option>
            <option value="no_way">No Way</option>
            <option value="very_unlikely">Very Unlikely</option>
            <option value="unlikely">Unlikely</option>
            <option value="fifty_fifty">50/50</option>
            <option value="somewhat_likely">Somewhat Likely</option>
            <option value="likely">Likely</option>
            <option value="very_likely">Very Likely</option>
            <option value="near_sure_thing">Near Sure Thing</option>
            <option value="sure_thing">A Sure Thing</option>
          </select>
        </label>
        <span className="muted">Chaos Factor {chaosFactor}</span>
        <button onClick={() => void fate()}>Fate Check</button>
        <button onClick={() => void event()}>Random Event</button>
      </div>
      {lastFate && (
        <div className="oracle-result">
          <strong className={lastFate.exceptional ? "exceptional" : ""}>
            {lastFate.interpretation}
          </strong>
          <span className="muted">
            (rolled {lastFate.roll} vs target {lastFate.target})
          </span>
        </div>
      )}
      {lastEvent && (
        <div className="oracle-result">
          <strong>{lastEvent.action}</strong> the <strong>{lastEvent.subject}</strong> —{" "}
          {lastEvent.descriptor}, {lastEvent.focus}
        </div>
      )}
    </section>
  );
}

export function DmPanel() {
  const lastDm = useStore((s) => s.lastDm);
  const resolveDmAction = useStore((s) => s.resolveDmAction);
  const alisonLive = useStore((s) => s.alison.reachable);
  const [action, setAction] = useState("");
  const [busy, setBusy] = useState(false);

  const resolve = async () => {
    if (!action.trim()) return;
    setBusy(true);
    try {
      await resolveDmAction(action.trim());
      setAction("");
    } catch (e) {
      useStore.getState().setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel">
      <h2>
        Auto-DM{" "}
        <span className="muted">
          ({alisonLive ? "A.L.I.S.O.N. live" : "stub backend"})
        </span>
      </h2>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          void resolve();
        }}
      >
        <input
          value={action}
          onChange={(e) => setAction(e.currentTarget.value)}
          placeholder="What does your character do?"
        />
        <button type="submit" disabled={busy}>
          {busy ? "Resolving…" : "Resolve"}
        </button>
      </form>
      {lastDm && (
        <div className="combat-result">
          <p>{lastDm.narrative}</p>
          <p className="muted">
            Fate: {lastDm.fate_interpretation} (rolled {lastDm.fate_roll} vs {lastDm.fate_target})
          </p>
          {lastDm.event_meaning && (
            <p className="exceptional">
              Random Event: {lastDm.event_meaning.action} the {lastDm.event_meaning.subject} —{" "}
              {lastDm.event_meaning.descriptor}, {lastDm.event_meaning.focus}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

export function SessionLog() {
  const logs = useStore((s) => s.logs);
  const activeSceneId = useStore((s) => s.activeSceneId);
  const [draft, setDraft] = useState("");

  const send = async () => {
    if (!activeSceneId || !draft.trim()) return;
    try {
      await backend.appendLog(activeSceneId, "Narrator", draft.trim());
      setDraft("");
    } catch (e) {
      useStore.getState().setError(String(e));
    }
  };

  return (
    <section className="panel">
      <h2>Session Log</h2>
      <div className="log">
        {logs.map((l) => (
          <p key={l.id} className="log-line">
            <span className="muted">[{l.timestamp.slice(11, 19)}]</span>{" "}
            <strong>{l.speaker}:</strong> {l.content}
          </p>
        ))}
        {logs.length === 0 && <p className="muted">Nothing logged yet.</p>}
      </div>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.currentTarget.value)}
          placeholder={activeSceneId ? "Note for the session log…" : "Create a scene first."}
          disabled={!activeSceneId}
        />
        <button type="submit" disabled={!activeSceneId}>
          Log
        </button>
      </form>
    </section>
  );
}

export function AlisonStatus() {
  const alison = useStore((s) => s.alison);

  useEffect(() => {
    const poll = () => void useStore.getState().pollAlisonAffect();
    poll();
    const timer = window.setInterval(poll, 2000);
    return () => window.clearInterval(timer);
  }, []);

  if (!alison.reachable) {
    return (
      <section className="panel">
        <h2>A.L.I.S.O.N.</h2>
        <p className="muted">offline — stub DM active (start A.L.I.S.O.N. to go live)</p>
      </section>
    );
  }

  return (
    <section className="panel">
      <h2>A.L.I.S.O.N.</h2>
      <p>
        connected — precision γ={alison.gamma != null ? alison.gamma.toFixed(2) : "—"} · mood:{" "}
        <strong>{alison.mood}</strong>
      </p>
      <p className="muted">
        drives: [{alison.drives.map((d) => d.toFixed(2)).join(", ")}]
      </p>
    </section>
  );
}
