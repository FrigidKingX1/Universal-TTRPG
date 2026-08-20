import { useState } from "react";
import { backend } from "../backend";
import { useStore } from "../store";
import type { Disposition } from "../types";

const DISPOSITIONS: Disposition[] = ["hostile", "unfriendly", "neutral", "friendly", "helpful"];

export function Scenes() {
  const scenes = useStore((s) => s.scenes);
  const activeSceneId = useStore((s) => s.activeSceneId);
  const createScene = useStore((s) => s.createScene);
  const setActiveScene = useStore((s) => s.setActiveScene);
  const deleteScene = useStore((s) => s.deleteScene);
  const completeScene = useStore((s) => s.completeScene);
  const [title, setTitle] = useState("");
  const [cf, setCf] = useState(5);
  const [showThreads, setShowThreads] = useState(false);
  const [showNpcs, setShowNpcs] = useState(false);
  const [showClocks, setShowClocks] = useState(false);

  return (
    <section className="panel">
      <h2>Campaign Scenes</h2>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim()) {
            void createScene(title.trim(), cf);
            setTitle("");
          }
        }}
      >
        <input
          value={title}
          onChange={(e) => setTitle(e.currentTarget.value)}
          placeholder="Scene title"
          aria-label="Scene title"
        />
        <label>
          CF
          <input
            type="number"
            min={1}
            max={9}
            value={cf}
            onChange={(e) => setCf(Number(e.currentTarget.value))}
          />
        </label>
        <button type="submit">Create</button>
      </form>
      <ul className="card-list">
        {scenes.map((sc) => (
          <li key={sc.id} className="card">
            <div className="card-row">
              <strong>
                #{sc.scene_number} {sc.title}
              </strong>
              <span className="muted">CF {sc.chaos_factor}</span>
              {sc.id === activeSceneId && <span className="badge">active</span>}
              {sc.id === activeSceneId && (
                <button className="complete-scene-btn" onClick={() => {
                  if (!confirm(`Complete scene "${sc.title}"?`)) return;
                  const outcome = prompt("Scene outcome:\nType 'favor' if it went in the player's favor (CF-1),\n'against' if it went against them (CF+1),\nor leave blank for no CF change.");
                  if (outcome === null) return;
                  const adj = outcome === "favor" || outcome === "against" ? outcome as "favor" | "against" : undefined;
                  void completeScene(adj);
                }}>
                  Complete
                </button>
              )}
              {sc.id !== activeSceneId && (
                <button onClick={() => void setActiveScene(sc.id)}>Set active</button>
              )}
              <button className="danger" onClick={() => { if (confirm(`Delete scene "${sc.title}"?`)) void deleteScene(sc.id); }}>
                Delete
              </button>
            </div>
            {sc.id !== activeSceneId && sc.summary_text && (
              <p className="scene-preview muted">{sc.summary_text.length > 120 ? sc.summary_text.slice(0, 120) + "…" : sc.summary_text}</p>
            )}
            {sc.id === activeSceneId && <SceneSummaryEditor scene={sc} />}
            {sc.id === activeSceneId && <SceneCfEditor scene={sc} />}
            {sc.id === activeSceneId && <SceneTestRoller chaosFactor={sc.chaos_factor} />}
          </li>
        ))}
      </ul>
      {scenes.length === 0 && <p className="muted">No scenes yet.</p>}

      {/* ── Plot Threads ─────────────────────────────────────────── */}
      <div style={{ marginTop: "1rem" }}>
        <button className="muted" onClick={() => setShowThreads(!showThreads)} style={{ fontSize: "0.85rem" }}>
          {showThreads ? "▼" : "▶"} Plot Threads
        </button>
        {showThreads && <ThreadsPanel />}
      </div>

      {/* ── NPC Characters ───────────────────────────────────────── */}
      <div style={{ marginTop: "0.75rem" }}>
        <button className="muted" onClick={() => setShowNpcs(!showNpcs)} style={{ fontSize: "0.85rem" }}>
          {showNpcs ? "▼" : "▶"} NPC Characters
        </button>
        {showNpcs && <NpcCharactersPanel />}
      </div>

      {/* ── Doom Clocks ──────────────────────────────────────────── */}
      <div style={{ marginTop: "0.75rem" }}>
        <button className="muted" onClick={() => setShowClocks(!showClocks)} style={{ fontSize: "0.85rem" }}>
          {showClocks ? "▼" : "▶"} Doom Clocks
        </button>
        {showClocks && <DoomClocksPanel />}
      </div>
    </section>
  );
}

function SceneSummaryEditor({ scene }: { scene: { id: string; summary_text?: string | null; title: string } }) {
  const [text, setText] = useState(scene.summary_text ?? "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await backend.updateSceneSummary(scene.id, text.trim() || null);
    } catch {
      // best-effort
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="sheet">
      <textarea
        className="summary-input"
        value={text}
        onChange={(e) => setText(e.currentTarget.value)}
        placeholder={`Describe what's happening in "${scene.title}"...`}
        rows={3}
      />
      <button onClick={() => void save()} disabled={saving}>
        {saving ? "Saving…" : "Save Summary"}
      </button>
    </div>
  );
}

function SceneCfEditor({ scene }: { scene: { id: string; chaos_factor: number } }) {
  const [cf, setCf] = useState(scene.chaos_factor);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await backend.updateSceneChaosFactor(scene.id, cf);
    } catch {
      // best-effort
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="sheet cf-editor">
      <label className="attr">
        <span>CF</span>
        <input
          type="number"
          min={1}
          max={9}
          value={cf}
          onChange={(e) => setCf(Number(e.currentTarget.value))}
        />
      </label>
      <button onClick={() => void save()} disabled={saving || cf === scene.chaos_factor}>
        {saving ? "Saving…" : "Update CF"}
      </button>
    </div>
  );
}

function SceneTestRoller({ chaosFactor }: { chaosFactor: number }) {
  const showToast = useStore((s) => s.showToast);
  const [result, setResult] = useState<{ outcome: string; event?: { meaning: { action: string; subject: string; descriptor: string; focus: string }; acting_npc?: string | null; suggested_npc_name?: string | null; remove_thread_id?: string | null } | null } | null>(null);
  const [rolling, setRolling] = useState(false);

  const roll = async () => {
    setRolling(true);
    try {
      const resp = await backend.sceneTest(chaosFactor);
      setResult(resp);
      const label = resp.outcome === "as_expected" ? "As Expected" : resp.outcome === "altered" ? "Altered" : "Interrupted";
      showToast(`Scene Test: ${label}`);
    } catch (e) {
      showToast(`Error: ${e}`);
    } finally {
      setRolling(false);
    }
  };

  return (
    <div className="sheet" style={{ marginTop: "0.4rem" }}>
      <div className="card-row">
        <button onClick={() => void roll()} disabled={rolling}>
          {rolling ? "Rolling…" : "Scene Test (d10 vs CF " + chaosFactor + ")"}
        </button>
        {result && (
          <span className={`badge ${result.outcome === "as_expected" ? "" : result.outcome === "altered" ? "disp-friendly" : "disp-hostile"}`}>
            {result.outcome === "as_expected" ? "As Expected" : result.outcome === "altered" ? "Altered" : "Interrupted"}
          </span>
        )}
      </div>
      {result?.event && (
        <div style={{ marginTop: "0.4rem", padding: "0.4rem", background: "rgba(255,255,255,0.03)", borderRadius: "4px", fontSize: "0.85rem" }}>
          <strong>Random Event:</strong> {result.event.meaning.action} / {result.event.meaning.subject} — {result.event.meaning.descriptor} {result.event.meaning.focus}
          {result.event.acting_npc && <span className="muted"> — NPC: {result.event.acting_npc}</span>}
          {result.event.suggested_npc_name && <span className="muted"> — New NPC: {result.event.suggested_npc_name}</span>}
          {result.event.remove_thread_id && <span className="muted"> — Thread at risk</span>}
        </div>
      )}
    </div>
  );
}

function ThreadsPanel() {
  const threads = useStore((s) => s.plotThreads);
  const addThread = useStore((s) => s.addThread);
  const resolveThread = useStore((s) => s.resolveThread);
  const abandonThread = useStore((s) => s.abandonThread);
  const deleteThread = useStore((s) => s.deleteThread);
  const [desc, setDesc] = useState("");

  const openThreads = threads.filter((t) => t.status === "open");
  const closedThreads = threads.filter((t) => t.status !== "open");

  return (
    <div className="sheet" style={{ marginTop: "0.5rem" }}>
      <form
        className="row"
        onSubmit={(e) => { e.preventDefault(); if (desc.trim()) { void addThread(desc.trim()); setDesc(""); } }}
      >
        <input
          value={desc}
          onChange={(e) => setDesc(e.currentTarget.value)}
          placeholder="New plot thread..."
          style={{ flex: 1 }}
        />
        <button type="submit" disabled={!desc.trim()}>Add Thread</button>
      </form>

      {openThreads.length === 0 && closedThreads.length === 0 && (
        <p className="muted" style={{ marginTop: "0.25rem" }}>No threads yet.</p>
      )}

      {openThreads.length > 0 && (
        <div style={{ marginTop: "0.5rem" }}>
          <span className="muted" style={{ fontSize: "0.8rem" }}>Open ({openThreads.length})</span>
          <ul className="card-list" style={{ marginTop: "0.25rem" }}>
            {openThreads.map((t) => (
              <li key={t.id} className="card" style={{ padding: "0.4rem 0.6rem" }}>
                <div className="card-row">
                  <span>{t.description}</span>
                  <button className="muted" style={{ fontSize: "0.75rem" }} onClick={() => void resolveThread(t.id)}>Resolve</button>
                  <button className="muted" style={{ fontSize: "0.75rem" }} onClick={() => void abandonThread(t.id)}>Abandon</button>
                  <button className="danger" style={{ fontSize: "0.75rem" }} onClick={() => void deleteThread(t.id)}>×</button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {closedThreads.length > 0 && (
        <div style={{ marginTop: "0.5rem" }}>
          <span className="muted" style={{ fontSize: "0.8rem" }}>Closed ({closedThreads.length})</span>
          <ul className="card-list" style={{ marginTop: "0.25rem" }}>
            {closedThreads.map((t) => (
              <li key={t.id} className="card" style={{ padding: "0.3rem 0.6rem", opacity: 0.6 }}>
                <div className="card-row">
                  <span style={{ textDecoration: "line-through" }}>{t.description}</span>
                  <span className="badge">{t.status}</span>
                  <button className="danger" style={{ fontSize: "0.75rem" }} onClick={() => void deleteThread(t.id)}>×</button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function NpcCharactersPanel() {
  const npcs = useStore((s) => s.npcCharacters);
  const addNpcCharacter = useStore((s) => s.addNpcCharacter);
  const updateNpcDisposition = useStore((s) => s.updateNpcDisposition);
  const updateNpcLocation = useStore((s) => s.updateNpcLocation);
  const updateNpcNotes = useStore((s) => s.updateNpcNotes);
  const addNpcKnowledge = useStore((s) => s.addNpcKnowledge);
  const removeNpcKnowledge = useStore((s) => s.removeNpcKnowledge);
  const markNpcDead = useStore((s) => s.markNpcDead);
  const deleteNpcCharacter = useStore((s) => s.deleteNpcCharacter);
  const scenes = useStore((s) => s.scenes);

  const [name, setName] = useState("");
  const [disposition, setDisposition] = useState<Disposition>("neutral");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editLocation, setEditLocation] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [newFact, setNewFact] = useState("");

  const sceneTitle = (id?: string) => scenes.find((s) => s.id === id)?.title ?? "unknown";

  const handleAdd = () => {
    if (!name.trim()) return;
    void addNpcCharacter(name.trim(), disposition);
    setName("");
  };

  const startEdit = (npc: typeof npcs[0]) => {
    setExpandedId(npc.id);
    setEditLocation(npc.location ?? "");
    setEditNotes(npc.notes ?? "");
  };

  return (
    <div className="sheet" style={{ marginTop: "0.5rem" }}>
      <form
        className="row"
        onSubmit={(e) => { e.preventDefault(); handleAdd(); }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.currentTarget.value)}
          placeholder="NPC name"
          style={{ flex: 1 }}
        />
        <select value={disposition} onChange={(e) => setDisposition(e.currentTarget.value as Disposition)}>
          {DISPOSITIONS.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        <button type="submit" disabled={!name.trim()}>Add NPC</button>
      </form>

      {npcs.length === 0 && <p className="muted" style={{ marginTop: "0.25rem" }}>No NPC characters yet.</p>}

      <ul className="card-list" style={{ marginTop: "0.5rem" }}>
        {npcs.map((npc) => (
          <li key={npc.id} className="card" style={{ padding: "0.5rem 0.6rem" }}>
            <div className="card-row">
              <strong style={{ opacity: npc.alive ? 1 : 0.5 }}>
                {npc.name} {!npc.alive && <span className="muted">(dead)</span>}
              </strong>
              <span className={`badge disp-${npc.disposition}`}>{npc.disposition}</span>
              {npc.location && <span className="muted" style={{ fontSize: "0.8rem" }}>@ {npc.location}</span>}
              <button className="muted" style={{ fontSize: "0.75rem" }} onClick={() => expandedId === npc.id ? setExpandedId(null) : startEdit(npc)}>
                {expandedId === npc.id ? "Close" : "Edit"}
              </button>
              {!npc.alive && (
                <button className="danger" style={{ fontSize: "0.75rem" }} onClick={() => void deleteNpcCharacter(npc.id)}>×</button>
              )}
              {npc.alive && (
                <button className="danger" style={{ fontSize: "0.75rem" }} onClick={() => { if (confirm(`Mark ${npc.name} as dead?`)) void markNpcDead(npc.id); }}>Kill</button>
              )}
            </div>

            {npc.last_seen_scene_id && (
              <p className="muted" style={{ fontSize: "0.75rem", margin: "0.2rem 0" }}>
                Last seen: {sceneTitle(npc.last_seen_scene_id)}
              </p>
            )}

            {npc.knows.length > 0 && (
              <div style={{ fontSize: "0.8rem", margin: "0.2rem 0" }}>
                <span className="muted">Knows: </span>
                {npc.knows.map((k, i) => (
                  <span key={i} className="badge" style={{ marginRight: "0.2rem", display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
                    {k.text}
                    {k.scene_id && <span className="muted" style={{ fontSize: "0.65rem" }}>@{sceneTitle(k.scene_id)}</span>}
                    {k.timestamp && <span className="muted" style={{ fontSize: "0.65rem" }}>{new Date(k.timestamp).toLocaleDateString()}</span>}
                    <button
                      className="muted"
                      style={{ fontSize: "0.6rem", padding: 0, lineHeight: 1, cursor: "pointer" }}
                      onClick={() => void removeNpcKnowledge(npc.id, i)}
                      title="Remove knowledge"
                    >×</button>
                  </span>
                ))}
              </div>
            )}

            {expandedId === npc.id && (
              <div style={{ marginTop: "0.4rem", display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                <div className="row">
                  <label style={{ fontSize: "0.8rem" }}>
                    Disposition
                    <select value={npc.disposition} onChange={(e) => void updateNpcDisposition(npc.id, e.currentTarget.value as Disposition)}>
                      {DISPOSITIONS.map((d) => <option key={d} value={d}>{d}</option>)}
                    </select>
                  </label>
                </div>
                <div className="row">
                  <label style={{ fontSize: "0.8rem" }}>
                    Location
                    <input
                      value={editLocation}
                      onChange={(e) => setEditLocation(e.currentTarget.value)}
                      onBlur={() => { if (editLocation !== (npc.location ?? "")) void updateNpcLocation(npc.id, editLocation); }}
                      placeholder="Where are they?"
                    />
                  </label>
                </div>
                <div className="row">
                  <label style={{ fontSize: "0.8rem" }}>
                    Notes
                    <textarea
                      value={editNotes}
                      onChange={(e) => setEditNotes(e.currentTarget.value)}
                      onBlur={() => { if (editNotes !== (npc.notes ?? "")) void updateNpcNotes(npc.id, editNotes); }}
                      placeholder="DM notes about this NPC..."
                      rows={2}
                    />
                  </label>
                </div>
                <div className="row">
                  <input
                    value={newFact}
                    onChange={(e) => setNewFact(e.currentTarget.value)}
                    placeholder="Add knowledge..."
                    style={{ flex: 1, fontSize: "0.8rem" }}
                  />
                  <button
                    style={{ fontSize: "0.75rem" }}
                    onClick={() => { if (newFact.trim()) { void addNpcKnowledge(npc.id, newFact.trim()); setNewFact(""); } }}
                    disabled={!newFact.trim()}
                  >
                    Add Fact
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function DoomClocksPanel() {
  const doomClocks = useStore((s) => s.doomClocks);
  const addDoomClock = useStore((s) => s.addDoomClock);
  const tickDoomClock = useStore((s) => s.tickDoomClock);
  const advanceDoomClock = useStore((s) => s.advanceDoomClock);
  const resetDoomClock = useStore((s) => s.resetDoomClock);
  const deleteDoomClock = useStore((s) => s.deleteDoomClock);

  const [label, setLabel] = useState("");
  const [maxTicks, setMaxTicks] = useState(6);
  const [consequence, setConsequence] = useState("");

  const add = () => {
    if (!label.trim() || !consequence.trim()) return;
    void addDoomClock(label.trim(), maxTicks, consequence.trim());
    setLabel("");
    setConsequence("");
  };

  return (
    <div style={{ marginTop: "1rem" }}>
      <h4>Doom Clocks</h4>
      <div className="row" style={{ marginBottom: "0.5rem" }}>
        <input value={label} onChange={(e) => setLabel(e.currentTarget.value)} placeholder="Clock label…" style={{ flex: 2 }} />
        <input type="number" value={maxTicks} onChange={(e) => setMaxTicks(Math.max(1, parseInt(e.currentTarget.value) || 6))} min={1} max={20} style={{ width: "3rem", flex: 0 }} />
        <input value={consequence} onChange={(e) => setConsequence(e.currentTarget.value)} placeholder="Consequence…" style={{ flex: 3 }} />
        <button onClick={add} disabled={!label.trim() || !consequence.trim()}>Add</button>
      </div>
      {doomClocks.length === 0 && <p className="muted" style={{ fontSize: "0.85rem" }}>No doom clocks.</p>}
      <ul className="card-list">
        {doomClocks.map((clock) => (
          <li key={clock.id} className="card" style={{ opacity: clock.current === 0 ? 0.6 : 1 }}>
            <div className="card-row">
              <strong>{clock.label}</strong>
              <span className={clock.current === 0 ? "exceptional" : clock.current <= 2 ? "fury" : ""} style={{ fontFamily: "monospace", fontSize: "1.1rem" }}>
                {clock.current}/{clock.max}
              </span>
              <div style={{ display: "flex", gap: "0.2rem" }}>
                <button onClick={() => void tickDoomClock(clock.id)} disabled={clock.current === 0} title="Tick 1">+1</button>
                <button onClick={() => void advanceDoomClock(clock.id, 1)} disabled={clock.current === 0} title="Advance 1">-1</button>
                <button onClick={() => void resetDoomClock(clock.id)} title="Reset">↺</button>
                <button className="danger" onClick={() => void deleteDoomClock(clock.id)} title="Delete">×</button>
              </div>
            </div>
            <p className="muted" style={{ fontSize: "0.8rem", margin: "0.2rem 0 0" }}>
              When expired: {clock.consequence}
            </p>
            {clock.current === 0 && (
              <div className="exceptional" style={{ fontSize: "0.85rem", marginTop: "0.3rem", fontWeight: "bold" }}>
                ⚠ CLOCK EXPIRED — {clock.consequence}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
