import { useEffect, useRef, useState } from "react";
import { backend } from "../backend";
import { useStore } from "../store";

export function DiceRoller() {
  const rollHistory = useStore((s) => s.rollHistory);
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

  const presets = [
    { label: "d20", expr: "1d20" },
    { label: "d20+STR", expr: "1d20 + @attributes.STR.derived_modifier" },
    { label: "d20+DEX", expr: "1d20 + @attributes.DEX.derived_modifier" },
    { label: "d20+CON", expr: "1d20 + @attributes.CON.derived_modifier" },
    { label: "d20+INT", expr: "1d20 + @attributes.INT.derived_modifier" },
    { label: "d20+WIS", expr: "1d20 + @attributes.WIS.derived_modifier" },
    { label: "d20+CHA", expr: "1d20 + @attributes.CHA.derived_modifier" },
    { label: "2d6", expr: "2d6" },
    { label: "4d6kh3", expr: "4d6kh3" },
  ];

  return (
    <section className="panel">
      <h2>Dice Roller</h2>
      <div className="dice-presets">
        {presets.map((p) => (
          <button key={p.label} onClick={() => setExpr(p.expr)} className="preset-btn">
            {p.label}
          </button>
        ))}
      </div>
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
      {result && <p className="roll-result">{result}</p>}
      {rollHistory.length > 0 && (
        <div className="roll-history">
          {rollHistory.slice().reverse().map((r, i) => (
            <div key={i} className="roll-history-entry">
              <span className="muted">{r.expression}</span>
              <strong>{r.total}</strong>
              <span className="muted">{r.detail}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function OraclePanel() {
  const lastFate = useStore((s) => s.lastFate);
  const fateHistory = useStore((s) => s.fateHistory);
  const lastEvent = useStore((s) => s.lastEvent);
  const eventHistory = useStore((s) => s.eventHistory);
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
        <span className="muted">CF {chaosFactor}</span>
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
      {fateHistory.length > 0 && (
        <div className="oracle-history">
          <h3>Fate History</h3>
          {fateHistory.slice().reverse().map((f, i) => (
            <div key={i} className="oracle-history-entry">
              <span className={f.exceptional ? "exceptional" : ""}>{f.interpretation}</span>
              <span className="muted">
                {f.odds} — {f.roll}/{f.target} (CF {f.chaos_factor})
              </span>
            </div>
          ))}
        </div>
      )}
      {eventHistory.length > 0 && (
        <div className="oracle-history">
          <h3>Event History</h3>
          {eventHistory.slice().reverse().map((e, i) => (
            <div key={i} className="oracle-history-entry">
              <strong>{e.action}</strong> the <strong>{e.subject}</strong> — {e.descriptor}, {e.focus}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function DmPanel() {
  const lastDm = useStore((s) => s.lastDm);
  const dmHistory = useStore((s) => s.dmHistory);
  const resolveDmAction = useStore((s) => s.resolveDmAction);
  const ollamaLive = useStore((s) => s.ollama.reachable);
  const currentModel = useStore((s) => s.ollama.currentModel);
  const activeSceneId = useStore((s) => s.activeSceneId);
  const [action, setAction] = useState("");
  const [busy, setBusy] = useState(false);

  const suggestions = [
    "I look around the area",
    "I talk to the nearest NPC",
    "I investigate the surroundings",
    "I attempt to stealth",
    "I rest and recover",
    "I search for traps",
    "I use my action to Dash",
    "I make a Perception check",
  ];

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
          ({ollamaLive ? currentModel : "stub backend"})
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
      {/* Quick action suggestions */}
      <div className="suggestion-chips">
        {suggestions.map((s) => (
          <button key={s} className="suggestion-btn" onClick={() => setAction(s)} disabled={!activeSceneId || busy}>
            {s}
          </button>
        ))}
      </div>
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
      {dmHistory.length > 1 && (
        <div className="dm-history">
          <h3>Prior Resolutions</h3>
          {dmHistory.slice(0, -1).reverse().map((d, i) => (
            <div key={i} className="dm-history-entry">
              <p className="narrative">{d.narrative}</p>
              <span className="muted">{d.fate_interpretation} — {d.source}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function SessionLog() {
  const logs = useStore((s) => s.logs);
  const activeSceneId = useStore((s) => s.activeSceneId);
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
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

  const filteredLogs = search.trim()
    ? logs.filter((l) => {
        const q = search.toLowerCase();
        return l.content.toLowerCase().includes(q) || l.speaker.toLowerCase().includes(q);
      })
    : logs;

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
      {logs.length > 5 && (
        <div className="row log-search">
          <input
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            placeholder="Search logs…"
          />
          {search && (
            <button className="muted" onClick={() => setSearch("")} style={{ fontSize: "0.8rem" }}>
              clear
            </button>
          )}
          <span className="muted" style={{ fontSize: "0.8rem" }}>
            {filteredLogs.length}/{logs.length}
          </span>
        </div>
      )}
      <div className="log">
        {filteredLogs.map((l) => (
          <p key={l.id} className="log-line">
            <span className="muted">[{l.timestamp.slice(11, 19)}]</span>{" "}
            <span className={speakerClass(l.speaker)}><strong>{l.speaker}:</strong></span>{" "}
            {l.content}
          </p>
        ))}
        {filteredLogs.length === 0 && <p className="muted">{search ? "No matching entries." : "Nothing logged yet."}</p>}
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
  const setOllamaModel = useStore((s) => s.setOllamaModel);

  useEffect(() => {
    const poll = () => void useStore.getState().pollOllamaModels();
    poll();
    const timer = window.setInterval(poll, 5000);
    return () => window.clearInterval(timer);
  }, []);

  if (!ollama.reachable) {
    return (
      <section className="panel ollama-status offline">
        <h2>Ollama</h2>
        <p className="muted">offline — stub DM active (start Ollama to go live)</p>
      </section>
    );
  }

  return (
    <section className="panel ollama-status online">
      <h2>
        Ollama{" "}
        <span className="badge">online</span>
      </h2>
      <div className="row">
        <label>
          Model
          <select
            value={ollama.currentModel}
            onChange={(e) => void setOllamaModel(e.currentTarget.value)}
          >
            {ollama.models.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </label>
        <span className="muted">
          {ollama.models.length} model{ollama.models.length !== 1 ? "s" : ""} installed
        </span>
      </div>
      {ollama.models.length === 0 && (
        <p className="muted">no models found — pull one with `ollama pull llama3.2`</p>
      )}
    </section>
  );
}
