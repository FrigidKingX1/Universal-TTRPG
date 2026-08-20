import { useEffect, useRef, useState } from "react";
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
  const ollamaLive = useStore((s) => s.ollama.reachable);
  const activeSceneId = useStore((s) => s.activeSceneId);
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
          ({ollamaLive ? "Ollama live" : "stub backend"})
        </span>
      </h2>
      {!activeSceneId && (
        <p className="muted">Create or activate a scene to use the DM.</p>
      )}
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
          disabled={!activeSceneId}
        />
        <button type="submit" disabled={busy || !activeSceneId}>
          {busy ? "Resolving…" : "Resolve"}
        </button>
      </form>
      {lastDm && (
        <div className="dm-response">
          <div className="narrative">{lastDm.narrative}</div>
          <div className="dm-meta">
            <p className="fate-line">
              <strong>Fate:</strong> {lastDm.fate_interpretation}{" "}
              <span className="muted">
                (rolled {lastDm.fate_roll} vs {lastDm.fate_target})
              </span>
            </p>
            {lastDm.mechanical_events.length > 0 && (
              <div className="mechanical-events">
                <strong>Mechanical Events:</strong>
                <ul>
                  {lastDm.mechanical_events.map((evt, i) => (
                    <li key={i}>{evt}</li>
                  ))}
                </ul>
              </div>
            )}
            {lastDm.event_meaning && (
              <p className="exceptional">
                Random Event: {lastDm.event_meaning.action} the {lastDm.event_meaning.subject} —{" "}
                {lastDm.event_meaning.descriptor}, {lastDm.event_meaning.focus}
              </p>
            )}
            <span className="muted">Source: {lastDm.source}</span>
          </div>
        </div>
      )}
    </section>
  );
}

export function SessionLog() {
  const logs = useStore((s) => s.logs);
  const activeSceneId = useStore((s) => s.activeSceneId);
  const [draft, setDraft] = useState("");
  const logEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new logs
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const speakerClass = (speaker: string) => {
    const s = speaker.toLowerCase();
    if (s.includes("player")) return "speaker-player";
    if (s.includes("combat")) return "speaker-combat";
    if (s.includes("narrator") || s.includes("scene")) return "speaker-narrator";
    if (s.includes("auto-dm") || s.includes("dm")) return "speaker-auto-dm";
    return "speaker-default";
  };

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
            <span className={speakerClass(l.speaker)}><strong>{l.speaker}:</strong></span>{" "}
            {l.content}
          </p>
        ))}
        {logs.length === 0 && <p className="muted">Nothing logged yet.</p>}
        <div ref={logEndRef} />
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

export function OllamaStatus() {
  const ollama = useStore((s) => s.ollama);

  useEffect(() => {
    const poll = () => void useStore.getState().pollOllamaModels();
    poll();
    const timer = window.setInterval(poll, 5000);
    return () => window.clearInterval(timer);
  }, []);

  if (!ollama.reachable) {
    return (
      <section className="panel">
        <h2>Ollama</h2>
        <p className="muted">offline — stub DM active (start Ollama to go live)</p>
      </section>
    );
  }

  return (
    <section className="panel">
      <h2>Ollama</h2>
      <p>
        connected — {ollama.models.length} model{ollama.models.length !== 1 ? "s" : ""} installed
      </p>
      <p className="muted">
        {ollama.models.length > 0
          ? ollama.models.join(", ")
          : "no models found — pull one with `ollama pull llama3.2`"}
      </p>
    </section>
  );
}
