import { useEffect, useRef, useState } from "react";
import { backend } from "../backend";
import { useStore } from "../store";
import { useConfirmDialog } from "../hooks/useConfirmDialog";
import { save, open } from "@tauri-apps/plugin-dialog";
import { writeTextFile, readTextFile } from "@tauri-apps/plugin-fs";

export function DiceRoller() {
  const rollHistory = useStore((s) => s.rollHistory);
  const [expr, setExpr] = useState("1d20 + @attributes.STR.derived_modifier");
  const [result, setResult] = useState<string | null>(null);
  const [rolling, setRolling] = useState(false);

  const roll = async () => {
    setRolling(true);
    try {
      const r = await backend.rollDice(expr);
      setResult(`${r.total}  (${r.detail})`);
    } catch (e) {
      setResult(String(e));
    } finally {
      setRolling(false);
    }
  };

  const presets = [
    { label: "d4", expr: "1d4" },
    { label: "d6", expr: "1d6" },
    { label: "d8", expr: "1d8" },
    { label: "d10", expr: "1d10" },
    { label: "d12", expr: "1d12" },
    { label: "d20", expr: "1d20" },
    { label: "d100", expr: "1d100" },
    { label: "Adv", expr: "2d20kh1" },
    { label: "Disadv", expr: "2d20kl1" },
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
        <button type="submit" disabled={rolling} className={rolling ? "rolling" : ""}>
          {rolling ? "🎲…" : "Roll"}
        </button>
      </form>
      {result && (
        <p key={result} className={`roll-result ${rolling ? "" : "roll-landed"}`}>
          {result}
        </p>
      )}
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
  const [showTable, setShowTable] = useState(false);

  const ACTIONS = [
    "Altered", "Attitude", "Arrival", "Betrayal", "Communication", "Complication",
    "Council", "Danger", "Discovery", "Enemy", "Expedition", "Favor",
    "Flow", "Goal", "Grave", "Guard", "Harm", "Hatred",
    "Health", "Help", "Hierarchy", "Humor", "Inattention", "Injury",
    "Interest", "Intrigue", "Journey", "Judge", "Knowledge", "Leadership",
    "Location", "Military", "Move", "Mundane", "Nature", "Neutral",
    "Object", "Obstacle", "Open", "Oppose", "Outdoor", "Peace",
    "Physical", "Plot", "Possessions", "Prison", "Promise", "Reason",
    "Report", "Resistance", "Revival", "Ruin", "Rumor", "Setback",
    "Siege", "Stranger", "Struggle", "Supply", "Suspense", "Theme",
    "Time", "Tradition", "Trap", "Trouble", "Truth", "Use",
    "Vengeance", "Victory", "Vulnerability", "Waste", "Weapon", "Weather",
  ];
  const SUBJECTS = [
    "Adversity", "Allies", "An enemy", "An object", "Bad news", "Benefits",
    "Bounty", "Capabilities", "Clues", "Communication", "Complications", "Disaster",
    "Evidence", "Familiar face", "Forgotten lore", "Friend", "Grants", "Guardian",
    "Harm", "Helpers", "Information", "Interruption", "Location", "Messengers",
    "Misfortune", "Mundane thing", "Nature", "NPC", "Obstacle", "Ominous signs",
    "Opposition", "Outdoor", "Pain", "Peace", "Person", "Possessions",
    "Power", "Prize", "Rival", "Rumor", "Ruin", "Setback",
    "Something", "Stress", "Success", "Surprise", "Threat", "Time",
    "Tools", "Trouble", "Truth", "Unknown", "Valuable", "Vehicle",
    "Vulnerability", "Weapon", "Weather", "Work", "Wound", "Your objective",
  ];

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

  const [lastSceneTest, setLastSceneTest] = useState<import("../backend").SceneTestResponse | null>(null);

  const sceneTest = async () => {
    try {
      const result = await backend.sceneTest(chaosFactor);
      setLastSceneTest(result);
      if (result.event?.meaning) {
        useStore.getState().recordEvent(result.event.meaning);
      }
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
        <button onClick={() => void sceneTest()}>Scene Test</button>
      </div>
      {lastSceneTest && (
        <div className="oracle-result">
          <strong className={lastSceneTest.outcome === "Interrupted" ? "exceptional" : ""}>
            {lastSceneTest.outcome}
          </strong>
          {lastSceneTest.event && (
            <span className="muted"> — {lastSceneTest.event.meaning.action} the {lastSceneTest.event.meaning.subject}</span>
          )}
        </div>
      )}
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

      {/* Meaning Table Reference */}
      <div className="meaning-table-section">
        <button className="log-toggle" onClick={() => setShowTable(!showTable)}>
          {showTable ? "Hide" : "Show"} Meaning Tables
        </button>
        {showTable && (
          <div className="meaning-tables">
            <div className="meaning-col">
              <h4>Actions ({ACTIONS.length})</h4>
              <div className="meaning-grid">
                {ACTIONS.map((a) => <span key={a} className="meaning-entry">{a}</span>)}
              </div>
            </div>
            <div className="meaning-col">
              <h4>Subjects ({SUBJECTS.length})</h4>
              <div className="meaning-grid">
                {SUBJECTS.map((s) => <span key={s} className="meaning-entry">{s}</span>)}
              </div>
            </div>
          </div>
        )}
      </div>

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
  const setNumPredict = useStore((s) => s.setNumPredict);

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
        <label>
          Max Tokens
          <select
            value={ollama.numPredict}
            onChange={(e) => setNumPredict(Number(e.currentTarget.value))}
          >
            {[128, 256, 512, 768, 1024, 1536, 2048].map((n) => (
              <option key={n} value={n}>{n}</option>
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

export function CampaignData() {
  const exportCampaign = useStore((s) => s.exportCampaign);
  const importCampaign = useStore((s) => s.importCampaign);
  const logs = useStore((s) => s.logs);
  const scenes = useStore((s) => s.scenes);
  const activeSceneId = useStore((s) => s.activeSceneId);
  const [importing, setImporting] = useState(false);

  const doExport = async () => {
    try {
      const json = await exportCampaign();
      const filePath = await save({
        title: "Export Campaign Data",
        defaultPath: `auto-dm-campaign-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: "JSON Campaign Files", extensions: ["json"] }],
      });
      if (!filePath) return;
      await writeTextFile(filePath, json);
      useStore.getState().showToast("Campaign exported");
    } catch (e) {
      useStore.getState().setError(String(e));
    }
  };

  const doImport = async () => {
    try {
      const filePath = await open({
        title: "Import Campaign Data",
        filters: [{ name: "JSON Campaign Files", extensions: ["json"] }],
        multiple: false,
      });
      if (!filePath) return;
      setImporting(true);
      const text = await readTextFile(filePath);
      await importCampaign(text);
    } catch (e) {
      useStore.getState().setError(String(e));
    } finally {
      setImporting(false);
    }
  };

  const generateSummary = async () => {
    const scene = scenes.find((sc) => sc.id === activeSceneId);
    const sceneLogs = logs;
    const combatLogs = sceneLogs.filter((l) => l.content.includes("damage") || l.content.includes("DEFEATED") || l.content.includes("attack"));
    const dmLogs = sceneLogs.filter((l) => l.speaker === "Auto-DM" || l.speaker === "Narrator");
    const playerLogs = sceneLogs.filter((l) => l.speaker === "Player" || l.speaker === "Narrator");

    const lines: string[] = [];
    lines.push(`# Session Summary — ${scene?.title ?? "Untitled Scene"}`);
    lines.push(`**Date:** ${new Date().toLocaleDateString()}`);
    lines.push(`**Scene:** #${scene?.scene_number ?? "?"} (CF ${scene?.chaos_factor ?? "?"})`);
    lines.push("");
    if (scene?.summary_text) {
      lines.push(`## Scene Summary\n${scene.summary_text}`);
      lines.push("");
    }
    lines.push(`## Key Events (${sceneLogs.length} total entries)`);
    if (dmLogs.length > 0) {
      lines.push("\n### DM Narration");
      dmLogs.slice(-10).forEach((l) => lines.push(`- ${l.content.slice(0, 200)}`));
    }
    if (playerLogs.length > 0) {
      lines.push("\n### Player Actions");
      playerLogs.slice(-10).forEach((l) => lines.push(`- ${l.content}`));
    }
    if (combatLogs.length > 0) {
      lines.push(`\n### Combat (${combatLogs.length} combat-related entries)`);
      combatLogs.slice(-10).forEach((l) => lines.push(`- ${l.content.slice(0, 200)}`));
    }

    const md = lines.join("\n");
    const filePath = await save({
      title: "Export Session Summary",
      defaultPath: `session-summary-${new Date().toISOString().slice(0, 10)}.md`,
      filters: [{ name: "Markdown Files", extensions: ["md"] }],
    });
    if (!filePath) return;
    await writeTextFile(filePath, md);
    useStore.getState().showToast("Session summary exported");
  };

  return (
    <section className="panel">
      <h2>Campaign Data</h2>
      <div className="row">
        <button onClick={() => void doExport()}>Export Campaign</button>
        <button onClick={() => void doImport()} disabled={importing}>
          {importing ? "Importing…" : "Import Campaign"}
        </button>
        <button onClick={() => void generateSummary()}>Session Summary</button>
      </div>
      <p className="muted">Export saves all data as JSON. Session Summary generates a Markdown digest of the current scene's logs.</p>
    </section>
  );
}

export function NpcNotesPanel() {
  const npcNotes = useStore((s) => s.npcNotes);
  const addNpcNote = useStore((s) => s.addNpcNote);
  const deleteNpcNote = useStore((s) => s.deleteNpcNote);
  const { confirm, dialog } = useConfirmDialog();
  const [npcName, setNpcName] = useState("");
  const [relation, setRelation] = useState("");
  const [note, setNote] = useState("");

  const RELATIONS = ["Ally", "Enemy", "Neutral", "Employer", "Rival", "Mentor", "Contact", "Unknown"];

  const add = () => {
    if (!npcName.trim() || !note.trim()) return;
    addNpcNote(npcName.trim(), relation || "Unknown", note.trim());
    setNpcName("");
    setNote("");
  };

  const grouped = npcNotes.reduce<Record<string, typeof npcNotes>>((acc, n) => {
    (acc[n.npcName] = acc[n.npcName] ?? []).push(n);
    return acc;
  }, {});

  return (
    <section className="panel">
      <h2>NPC Notes</h2>
      <div className="row">
        <input value={npcName} onChange={(e) => setNpcName(e.currentTarget.value)} placeholder="NPC name" />
        <select value={relation} onChange={(e) => setRelation(e.currentTarget.value)}>
          <option value="">Relation</option>
          {RELATIONS.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>
      <div className="row">
        <input value={note} onChange={(e) => setNote(e.currentTarget.value)} placeholder="Note about this NPC…" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
        <button onClick={add} disabled={!npcName.trim() || !note.trim()}>Add</button>
      </div>
      {Object.entries(grouped).map(([name, notes]) => (
        <div key={name} className="npc-group">
          <h4>{name}</h4>
          {notes.map((n) => (
            <div key={n.id} className="card-row npc-note">
              <span className="badge">{n.relation}</span>
              <span>{n.note}</span>
              <span className="muted">{n.timestamp.slice(0, 10)}</span>
              <button className="danger" onClick={async () => { if (await confirm({ title: "Delete Note", message: `Delete note about ${n.npcName}?` })) deleteNpcNote(n.id); }} style={{ fontSize: "0.7rem" }}>×</button>
            </div>
          ))}
        </div>
      ))}
      {npcNotes.length === 0 && <p className="muted">No NPC notes yet.</p>}
      {dialog}
    </section>
  );
}

export function LinesVeilPanel() {
  const [lines, setLines] = useState<string[]>([]);
  const [veils, setVeils] = useState<string[]>([]);
  const [newLine, setNewLine] = useState("");
  const [newVeil, setNewVeil] = useState("");
  const showToast = useStore((s) => s.showToast);
  const saveSeq = useRef(0);

  useEffect(() => {
    backend.getLinesVeils().then((lv) => {
      setLines(lv.lines);
      setVeils(lv.veils);
    }).catch(() => {});
  }, []);

  const save = async (l: string[], v: string[]) => {
    const seq = ++saveSeq.current;
    await backend.setLinesVeils(l, v);
    // If a newer save was triggered, skip updating local state
    if (seq !== saveSeq.current) return;
  };

  const addLine = () => {
    if (!newLine.trim()) return;
    const updated = [...lines, newLine.trim()];
    setLines(updated);
    setNewLine("");
    void save(updated, veils);
    showToast("Line added");
  };
  const removeLine = (i: number) => {
    const updated = lines.filter((_, idx) => idx !== i);
    setLines(updated);
    void save(updated, veils);
  };
  const addVeil = () => {
    if (!newVeil.trim()) return;
    const updated = [...veils, newVeil.trim()];
    setVeils(updated);
    setNewVeil("");
    void save(lines, updated);
    showToast("Veil added");
  };
  const removeVeil = (i: number) => {
    const updated = veils.filter((_, idx) => idx !== i);
    setVeils(updated);
    void save(lines, updated);
  };

  return (
    <section className="tool-card">
      <h3>Lines &amp; Veils</h3>
      <p className="muted" style={{ fontSize: "0.8rem" }}>
        <strong>Lines</strong> = hard bans (never generate).
        <strong> Veils</strong> = fade to black (implied off-screen).
      </p>
      <div>
        <strong>Lines (hard ban)</strong>
        <div className="row" style={{ marginTop: "0.3rem" }}>
          <input value={newLine} onChange={(e) => setNewLine(e.currentTarget.value)} placeholder="Topic to ban…" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addLine(); } }} />
          <button onClick={addLine} disabled={!newLine.trim()}>Add</button>
        </div>
        {lines.map((l, i) => (
          <div key={i} className="card-row" style={{ marginTop: "0.2rem" }}>
            <span className="badge disp-hostile">LINE</span>
            <span>{l}</span>
            <button className="danger" onClick={() => removeLine(i)} style={{ fontSize: "0.7rem" }}>×</button>
          </div>
        ))}
        {lines.length === 0 && <p className="muted" style={{ fontSize: "0.8rem" }}>No lines set.</p>}
      </div>
      <div style={{ marginTop: "0.6rem" }}>
        <strong>Veils (fade to black)</strong>
        <div className="row" style={{ marginTop: "0.3rem" }}>
          <input value={newVeil} onChange={(e) => setNewVeil(e.currentTarget.value)} placeholder="Topic to veil…" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addVeil(); } }} />
          <button onClick={addVeil} disabled={!newVeil.trim()}>Add</button>
        </div>
        {veils.map((v, i) => (
          <div key={i} className="card-row" style={{ marginTop: "0.2rem" }}>
            <span className="badge disp-friendly">VEIL</span>
            <span>{v}</span>
            <button className="danger" onClick={() => removeVeil(i)} style={{ fontSize: "0.7rem" }}>×</button>
          </div>
        ))}
        {veils.length === 0 && <p className="muted" style={{ fontSize: "0.8rem" }}>No veils set.</p>}
      </div>
    </section>
  );
}
