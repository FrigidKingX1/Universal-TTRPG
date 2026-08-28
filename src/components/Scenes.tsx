import { useEffect, useState } from "react";
import { backend } from "../backend";
import { useStore } from "../store";
import { useConfirmDialog } from "../hooks/useConfirmDialog";
import type { Disposition, Scene } from "../types";
import { ZoneMap } from "./ZoneMap";

const DISPOSITIONS: Disposition[] = ["hostile", "unfriendly", "neutral", "friendly", "helpful"];
const ZONE_TYPES = ["hex", "point", "dungeon"] as const;

export function Scenes() {
  const scenes = useStore((s) => s.scenes);
  const activeSceneId = useStore((s) => s.activeSceneId);
  const createScene = useStore((s) => s.createScene);
  const setActiveScene = useStore((s) => s.setActiveScene);
  const deleteScene = useStore((s) => s.deleteScene);
  const completeScene = useStore((s) => s.completeScene);
  const episodeSummaries = useStore((s) => s.episodeSummaries);
  const summarizeScene = useStore((s) => s.summarizeScene);
  const { confirm, dialog } = useConfirmDialog();
  const [title, setTitle] = useState("");
  const [cf, setCf] = useState(5);
  const [showThreads, setShowThreads] = useState(false);
  const [showNpcs, setShowNpcs] = useState(false);
  const [showClocks, setShowClocks] = useState(false);
  const [showExploration, setShowExploration] = useState(false);
  const [completingScene, setCompletingScene] = useState<Scene | null>(null);

  const requestDeleteScene = async (id: string, name: string) => {
    if (await confirm({ title: "Delete Scene", message: `Delete scene "${name}"? This cannot be undone.` })) {
      void deleteScene(id);
    }
  };

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
                <button className="complete-scene-btn" onClick={() => setCompletingScene(sc)}>
                  Complete
                </button>
              )}
              {sc.id !== activeSceneId && (
                <button onClick={() => void setActiveScene(sc.id)}>Set active</button>
              )}
              <button className="danger" onClick={() => void requestDeleteScene(sc.id, sc.title)}>
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

      {/* ── Exploration ──────────────────────────────────────────── */}
      <div style={{ marginTop: "0.75rem" }}>
        <button className="muted" onClick={() => setShowExploration(!showExploration)} style={{ fontSize: "0.85rem" }}>
          {showExploration ? "▼" : "▶"} Exploration
        </button>
        {showExploration && <ExplorationPanel />}
      </div>

      {/* ── Episodic Summaries ─────────────────────────────────── */}
      {activeSceneId && (
        <div style={{ marginTop: "0.75rem" }}>
          <div className="row" style={{ alignItems: "center", gap: "0.5rem" }}>
            <span style={{ fontSize: "0.85rem", opacity: 0.7 }}>Episodic Summaries</span>
            <button
              className="btn btn-secondary"
              style={{ fontSize: "0.75rem" }}
              onClick={() => void summarizeScene(activeSceneId)}
            >
              Generate Summary
            </button>
          </div>
          {episodeSummaries.filter((s) => s.scene_id === activeSceneId).length > 0 && (
            <div style={{ marginTop: "0.4rem", display: "flex", flexDirection: "column", gap: "0.4rem" }}>
              {episodeSummaries
                .filter((s) => s.scene_id === activeSceneId)
                .map((ep) => (
                  <div key={ep.id} style={{ fontSize: "0.8rem", padding: "0.4rem", background: "var(--bg-secondary, #1a1a2e)", borderRadius: "4px" }}>
                    <div style={{ fontSize: "0.7rem", opacity: 0.5, marginBottom: "0.2rem" }}>
                      {new Date(ep.created_at).toLocaleString()}
                    </div>
                    <div style={{ whiteSpace: "pre-wrap" }}>{ep.summary}</div>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}

      {dialog}

      {completingScene && (
        <div className="modal-overlay" onClick={() => setCompletingScene(null)} role="dialog" aria-modal="true" aria-labelledby="complete-scene-title">
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 id="complete-scene-title">Complete Scene #{completingScene.scene_number}: {completingScene.title}</h3>
            <p className="muted">How did the scene resolve? This adjusts the Chaos Factor.</p>
            <div className="row" style={{ justifyContent: "center", gap: "0.5rem", flexWrap: "wrap" }}>
              <button className="btn btn-primary" onClick={() => { void completeScene("favor"); setCompletingScene(null); }}>
                In player's favor (CF −1)
              </button>
              <button className="btn btn-danger" onClick={() => { void completeScene("against"); setCompletingScene(null); }}>
                Against them (CF +1)
              </button>
              <button className="btn btn-secondary" onClick={() => { void completeScene(undefined); setCompletingScene(null); }}>
                No CF change
              </button>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setCompletingScene(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function SceneSummaryEditor({ scene }: { scene: { id: string; summary_text?: string | null; title: string } }) {
  const [text, setText] = useState(scene.summary_text ?? "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const summary = text.trim() || null;
      await backend.updateSceneSummary(scene.id, summary);
      useStore.setState((s) => ({
        scenes: s.scenes.map((sc) => sc.id === scene.id ? { ...sc, summary_text: summary ?? undefined } : sc),
      }));
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

  useEffect(() => { setCf(scene.chaos_factor); }, [scene.chaos_factor]);

  const save = async () => {
    setSaving(true);
    try {
      await backend.updateSceneChaosFactor(scene.id, cf);
      useStore.setState((s) => ({
        scenes: s.scenes.map((sc) => sc.id === scene.id ? { ...sc, chaos_factor: cf } : sc),
      }));
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
          onChange={(e) => {
            // Clamp on input — the number spinner's min/max isn't enforced
            // for typed values, and saving an out-of-range CF is nonsensical.
            const v = Number(e.currentTarget.value);
            const clamped = Number.isFinite(v) ? Math.min(9, Math.max(1, v)) : 1;
            setCf(clamped);
          }}
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
  const { confirm, dialog } = useConfirmDialog();
  const [desc, setDesc] = useState("");

  const requestAbandon = async (id: string, d: string) => {
    if (await confirm({ title: "Abandon Thread", message: `Abandon "${d}"? You can still delete it after.` })) void abandonThread(id);
  };
  const requestDelete = async (id: string, d: string) => {
    if (await confirm({ title: "Delete Thread", message: `Delete thread "${d}"? This cannot be undone.` })) void deleteThread(id);
  };

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
        <div className="fantasy-empty" style={{ padding: "0.6rem", marginTop: "0.4rem" }}>
          <span>No threads yet — every tale needs a hook.</span>
        </div>
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
                  <button className="muted" style={{ fontSize: "0.75rem" }} onClick={() => void requestAbandon(t.id, t.description)}>Abandon</button>
                  <button className="danger" style={{ fontSize: "0.75rem" }} onClick={() => void requestDelete(t.id, t.description)}>×</button>
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
                  <button className="danger" style={{ fontSize: "0.75rem" }} onClick={() => void requestDelete(t.id, t.description)}>×</button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      {dialog}
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
  const updateNpcPillars = useStore((s) => s.updateNpcPillars);
  const revealNpcFlaw = useStore((s) => s.revealNpcFlaw);
  const scenes = useStore((s) => s.scenes);
  const { confirm: confirmNpc, dialog: npcDialog } = useConfirmDialog();

  const requestKillNpc = async (id: string, name: string) => {
    if (await confirmNpc({ title: "Kill NPC", message: `Mark ${name} as dead?` })) {
      void markNpcDead(id);
    }
  };

  const [name, setName] = useState("");
  const [disposition, setDisposition] = useState<Disposition>("neutral");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editLocation, setEditLocation] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editDrive, setEditDrive] = useState("");
  const [editLeverage, setEditLeverage] = useState("");
  const [editFlaw, setEditFlaw] = useState("");
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
    setEditDrive(npc.drive ?? "");
    setEditLeverage(npc.leverage ?? "");
    setEditFlaw(npc.flaw ?? "");
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
                <button className="danger" style={{ fontSize: "0.75rem" }} onClick={() => void requestKillNpc(npc.id, npc.name)}>Kill</button>
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

            {(npc.drive || npc.leverage || npc.flaw) && (
              <div style={{ fontSize: "0.8rem", margin: "0.3rem 0", display: "flex", flexDirection: "column", gap: "0.15rem" }}>
                {npc.drive && (
                  <span><span className="muted">Drive:</span> {npc.drive}</span>
                )}
                {npc.leverage && (
                  <span><span className="muted">Leverage:</span> {npc.leverage}</span>
                )}
                {npc.flaw && (
                  npc.flaw_revealed
                    ? <span><span className="muted">Flaw:</span> {npc.flaw}</span>
                    : <span><span className="muted">Flaw:</span> <em>hidden</em>
                        <button
                          className="muted"
                          style={{ fontSize: "0.7rem", marginLeft: "0.3rem" }}
                          onClick={() => void revealNpcFlaw(npc.id)}
                          title="Reveal flaw (e.g. Insight check passed)"
                        >reveal</button>
                      </span>
                )}
              </div>
            )}

            {!npc.drive && !npc.leverage && !npc.flaw && expandedId !== npc.id && (
              <button
                className="muted"
                style={{ fontSize: "0.7rem", textAlign: "left" }}
                onClick={() => startEdit(npc)}
              >+ Add drive / leverage / flaw</button>
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
                      onBlur={() => { if (expandedId === npc.id && editLocation !== (npc.location ?? "")) void updateNpcLocation(npc.id, editLocation); }}
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
                      onBlur={() => { if (expandedId === npc.id && editNotes !== (npc.notes ?? "")) void updateNpcNotes(npc.id, editNotes); }}
                      placeholder="DM notes about this NPC..."
                      rows={2}
                    />
                  </label>
                </div>
                <div className="row">
                  <label style={{ fontSize: "0.8rem" }}>
                    Drive (what they want)
                    <input
                      value={editDrive}
                      onChange={(e) => setEditDrive(e.currentTarget.value)}
                      onBlur={() => { if (expandedId === npc.id) void updateNpcPillars(npc.id, editDrive || undefined, editLeverage || undefined, editFlaw || undefined); }}
                      placeholder="e.g. Protect my family at any cost"
                    />
                  </label>
                </div>
                <div className="row">
                  <label style={{ fontSize: "0.8rem" }}>
                    Leverage (what they offer/threaten)
                    <input
                      value={editLeverage}
                      onChange={(e) => setEditLeverage(e.currentTarget.value)}
                      onBlur={() => { if (expandedId === npc.id) void updateNpcPillars(npc.id, editDrive || undefined, editLeverage || undefined, editFlaw || undefined); }}
                      placeholder="e.g. Knows the smugglers' tunnel layout"
                    />
                  </label>
                </div>
                <div className="row">
                  <label style={{ fontSize: "0.8rem" }}>
                    Flaw / secret (hidden until revealed)
                    <input
                      value={editFlaw}
                      onChange={(e) => setEditFlaw(e.currentTarget.value)}
                      onBlur={() => { if (expandedId === npc.id) void updateNpcPillars(npc.id, editDrive || undefined, editLeverage || undefined, editFlaw || undefined); }}
                      placeholder="e.g. Addicted to hush money — won't resist a bribe"
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
      {npcDialog}
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
  const { confirm, dialog } = useConfirmDialog();
  const requestDelete = async (id: string, label: string) => {
    if (await confirm({ title: "Delete Doom Clock", message: `Delete "${label}"? This cannot be undone.` })) void deleteDoomClock(id);
  };

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
      {doomClocks.length === 0 && (
        <div className="fantasy-empty" style={{ padding: "0.6rem" }}>
          <span>No doom clocks — the hour is calm.</span>
        </div>
      )}
      <ul className="card-list">
        {doomClocks.map((clock) => (
          <li key={clock.id} className="card" style={{ opacity: clock.current === 0 ? 0.6 : 1 }}>
            <div className="card-row">
              <strong>{clock.label}</strong>
              <span className={clock.current === 0 ? "exceptional" : clock.current <= 2 ? "fury" : ""} style={{ fontFamily: "monospace", fontSize: "1.1rem" }}>
                {clock.current}/{clock.max}
              </span>
              <div style={{ display: "flex", gap: "0.2rem" }}>
                <button onClick={() => void tickDoomClock(clock.id)} disabled={clock.current === 0} title="Advance 1 toward doom">Advance 1</button>
                <button onClick={() => void advanceDoomClock(clock.id, 5)} disabled={clock.current === 0} title="Advance 5 toward doom">Advance 5</button>
                <button onClick={() => void resetDoomClock(clock.id)} title="Reset">↺</button>
                <button className="danger" onClick={() => void requestDelete(clock.id, clock.label)} title="Delete">×</button>
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
      {dialog}
    </div>
  );
}

export function ExplorationPanel() {
  const zones = useStore((s) => s.explorationZones);
  const nodes = useStore((s) => s.explorationNodes);
  const activeZoneId = useStore((s) => s.activeZoneId);
  const currentNodeId = useStore((s) => s.currentNodeId);
  const travelLog = useStore((s) => s.travelLog);
  const setActiveZone = useStore((s) => s.setActiveZone);
  const addExplorationZone = useStore((s) => s.addExplorationZone);
  const deleteExplorationZone = useStore((s) => s.deleteExplorationZone);
  const addExplorationNode = useStore((s) => s.addExplorationNode);
  const updateExplorationNode = useStore((s) => s.updateExplorationNode);
  const deleteExplorationNode = useStore((s) => s.deleteExplorationNode);
  const startExpedition = useStore((s) => s.startExpedition);
  const travelToNode = useStore((s) => s.travelToNode);
  const endExpedition = useStore((s) => s.endExpedition);

  const [zoneName, setZoneName] = useState("");
  const [zoneType, setZoneType] = useState<string>("hex");
  const [zoneDesc, setZoneDesc] = useState("");
  const [nodeName, setNodeName] = useState("");
  const [nodeDesc, setNodeDesc] = useState("");
  const [expandedNodeId, setExpandedNodeId] = useState<string | null>(null);
  const [editContents, setEditContents] = useState("");
  const [editNotes, setEditNotes] = useState("");

  const { confirm, dialog } = useConfirmDialog();
  const requestDeleteZone = async (id: string, name: string) => {
    if (await confirm({ title: "Delete Zone", message: `Delete zone "${name}" and all its nodes? This cannot be undone.` })) void deleteExplorationZone(id);
  };
  const requestDeleteNode = async (id: string, name: string) => {
    if (await confirm({ title: "Delete Node", message: `Delete node "${name}"?` })) void deleteExplorationNode(id);
  };

  const addZone = () => {
    if (!zoneName.trim()) return;
    void addExplorationZone(zoneName.trim(), zoneType, zoneDesc.trim() || undefined);
    setZoneName(""); setZoneDesc("");
  };

  const addNode = (zid: string) => {
    if (!nodeName.trim()) return;
    void addExplorationNode(zid, nodeName.trim(), nodeDesc.trim() || undefined);
    setNodeName(""); setNodeDesc("");
  };

  const startEditNode = (n: typeof nodes[0]) => {
    setExpandedNodeId(n.id);
    setEditContents(n.contents.join(", "));
    setEditNotes(n.notes ?? "");
  };

  return (
    <div className="sheet" style={{ marginTop: "0.5rem" }}>
      <h4 style={{ margin: "0 0 0.4rem" }}>Exploration Zones</h4>
      <form className="row" onSubmit={(e) => { e.preventDefault(); addZone(); }}>
        <input value={zoneName} onChange={(e) => setZoneName(e.currentTarget.value)} placeholder="Zone name" style={{ flex: 1 }} />
        <select value={zoneType} onChange={(e) => setZoneType(e.currentTarget.value)}>
          {ZONE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <input value={zoneDesc} onChange={(e) => setZoneDesc(e.currentTarget.value)} placeholder="Description" style={{ flex: 1 }} />
        <button type="submit" disabled={!zoneName.trim()}>Add Zone</button>
      </form>

      {zones.length === 0 && (
        <div className="fantasy-empty" style={{ padding: "0.7rem", marginTop: "0.4rem" }}>
          <span>No zones yet — chart your first region.</span>
        </div>
      )}

      <ul className="card-list" style={{ marginTop: "0.5rem" }}>
        {zones.map((z) => {
          const zNodes = nodes.filter((n) => n.zone_id === z.id);
          return (
          <li key={z.id} className="card" style={{ padding: "0.5rem 0.6rem" }}>
            <div className="card-row">
              <strong
                style={{ cursor: "pointer", textDecoration: activeZoneId === z.id ? "underline" : "none" }}
                onClick={() => setActiveZone(activeZoneId === z.id ? null : z.id)}
              >{z.name}</strong>
              <span className="badge">{z.zone_type}</span>
              {z.danger_level > 0 && <span className="badge" style={{ background: "#a33" }}>Danger {z.danger_level}</span>}
              {z.mapped && <span className="badge" style={{ background: "#3a3" }}>Mapped</span>}
              <button className="danger" style={{ fontSize: "0.75rem" }} onClick={() => void requestDeleteZone(z.id, z.name)}>×</button>
            </div>
            {z.description && <p className="muted" style={{ fontSize: "0.75rem", margin: "0.15rem 0" }}>{z.description}</p>}

            {activeZoneId === z.id && (
              <div style={{ marginTop: "0.4rem" }}>
                <ZoneMap
                  zone={z}
                  nodes={zNodes}
                  currentNodeId={currentNodeId}
                  onTravel={(nid) => void travelToNode(nid)}
                />
                <form className="row" onSubmit={(e) => { e.preventDefault(); addNode(z.id); }}>
                  <input value={nodeName} onChange={(e) => setNodeName(e.currentTarget.value)} placeholder="Node name" style={{ flex: 1 }} />
                  <input value={nodeDesc} onChange={(e) => setNodeDesc(e.currentTarget.value)} placeholder="Description" style={{ flex: 1 }} />
                  <button type="submit" disabled={!nodeName.trim()}>Add Node</button>
                </form>

                {zNodes.length === 0 && (
                  <div className="fantasy-empty" style={{ padding: "0.5rem", fontSize: "0.75rem" }}>
                    <span>No nodes yet — add locations to this zone.</span>
                  </div>
                )}

                {!currentNodeId && zNodes.length > 0 && (
                  <p className="muted" style={{ fontSize: "0.75rem" }}>Click a node to start an expedition.</p>
                )}
                {currentNodeId && (
                  <div style={{ fontSize: "0.75rem", margin: "0.3rem 0", padding: "0.3rem 0.5rem", background: "var(--accent-bg, #1a2a3a)", borderRadius: "4px" }}>
                    <strong>Expedition active</strong> — at: {zNodes.find((n) => n.id === currentNodeId)?.name ?? "unknown"}
                    <button style={{ fontSize: "0.7rem", marginLeft: "0.5rem" }} onClick={() => void endExpedition()}>End Expedition</button>
                  </div>
                )}

                {travelLog.length > 1 && (
                  <div style={{ fontSize: "0.7rem", margin: "0.2rem 0" }}>
                    <span className="muted">Trail: </span>
                    {travelLog.map((e, i) => (
                      <span key={i}>
                        {i > 0 && " → "}
                        <span style={{ color: e.encounter ? "#e44" : undefined }}>{e.nodeName}</span>
                      </span>
                    ))}
                  </div>
                )}

                <ul className="card-list" style={{ marginTop: "0.3rem" }}>
                  {zNodes.map((n) => (
                    <li key={n.id} className="card" style={{ padding: "0.3rem 0.5rem", border: currentNodeId === n.id ? "1px solid var(--accent, #4a8)" : undefined }}>
                      <div className="card-row">
                        <strong style={{ fontSize: "0.8rem", opacity: n.discovered ? 1 : 0.5 }}>
                          {n.name} {!n.discovered && <span className="muted">(hidden)</span>}
                        </strong>
                        {n.safe && <span className="badge" style={{ fontSize: "0.65rem", background: "#3a3" }}>safe</span>}
                        {!n.safe && <span className="badge" style={{ fontSize: "0.65rem", background: "#a33" }}>danger</span>}
                        {currentNodeId && currentNodeId !== n.id && zNodes.find((c) => c.id === currentNodeId)?.connections.includes(n.id) && (
                          <button
                            style={{ fontSize: "0.7rem", fontWeight: "bold" }}
                            onClick={() => void travelToNode(n.id)}
                          >Travel here</button>
                        )}
                        {!currentNodeId && (
                          <button
                            style={{ fontSize: "0.7rem" }}
                            onClick={() => startExpedition(n.id)}
                          >Start</button>
                        )}
                        <button
                          style={{ fontSize: "0.7rem" }}
                          onClick={() => void updateExplorationNode(n.id, { discovered: true })}
                          disabled={n.discovered}
                        >Discover</button>
                        <button
                          style={{ fontSize: "0.7rem" }}
                          onClick={() => expandedNodeId === n.id ? setExpandedNodeId(null) : startEditNode(n)}
                        >{expandedNodeId === n.id ? "Close" : "Edit"}</button>
                        <button
                          className="danger"
                          style={{ fontSize: "0.7rem" }}
                          onClick={() => void requestDeleteNode(n.id, n.name)}
                        >×</button>
                      </div>
                      {n.description && <p className="muted" style={{ fontSize: "0.7rem", margin: "0.1rem 0" }}>{n.description}</p>}
                      {n.contents.length > 0 && (
                        <p style={{ fontSize: "0.7rem", margin: "0.1rem 0" }}>
                          <span className="muted">Contents: </span>
                          {n.contents.map((c, i) => <span key={i} className="badge" style={{ fontSize: "0.65rem", marginRight: "0.2rem" }}>{c}</span>)}
                        </p>
                      )}
                      {expandedNodeId === n.id && (
                        <div style={{ marginTop: "0.3rem", display: "flex", flexDirection: "column", gap: "0.2rem" }}>
                          <label style={{ fontSize: "0.75rem" }}>
                            Safe?
                            <select value={n.safe ? "true" : "false"} onChange={(e) => void updateExplorationNode(n.id, { safe: e.currentTarget.value === "true" })}>
                              <option value="true">Safe</option>
                              <option value="false">Dangerous</option>
                            </select>
                          </label>
                          <div style={{ fontSize: "0.75rem" }}>
                            <span className="muted">Connections: </span>
                            {zNodes.filter((o) => o.id !== n.id).map((o) => (
                              <label key={o.id} style={{ marginRight: "0.4rem", cursor: "pointer" }}>
                                <input
                                  type="checkbox"
                                  checked={n.connections.includes(o.id)}
                                  onChange={() => {
                                    const newConns = n.connections.includes(o.id)
                                      ? n.connections.filter((c) => c !== o.id)
                                      : [...n.connections, o.id];
                                    void updateExplorationNode(n.id, { connections: newConns });
                                  }}
                                /> {o.name}
                              </label>
                            ))}
                          </div>
                          <input
                            value={editContents}
                            onChange={(e) => setEditContents(e.currentTarget.value)}
                            placeholder="Contents (comma-separated)"
                            style={{ fontSize: "0.75rem" }}
                            onBlur={() => {
                              if (expandedNodeId === n.id) {
                                const newContents = editContents.split(",").map((s) => s.trim()).filter(Boolean);
                                void updateExplorationNode(n.id, { contents: newContents });
                              }
                            }}
                          />
                          <textarea
                            value={editNotes}
                            onChange={(e) => setEditNotes(e.currentTarget.value)}
                            placeholder="Notes..."
                            rows={2}
                            style={{ fontSize: "0.75rem" }}
                            onBlur={() => { if (expandedNodeId === n.id) void updateExplorationNode(n.id, { notes: editNotes }); }}
                          />
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </li>
          );
        })}
      </ul>
      {dialog}
    </div>
  );
}

