# Phase D Roadmap — Tactical Utility AI & Local Voice

Status: **design only — nothing here is implemented.** This doc captures
the agreed direction so it survives context resets. Scope was chosen
deliberately: these two features *extend* Auto-DM's "deterministic engine
decides, LLM narrates" architecture instead of replacing its foundations.

## Non-goals (explicitly out of scope, revisit never-by-default)

- WebGPU/PixiJS 2.5D canvas, GPU shadowcasting, vision polygons
- Multi-ruleset virtualization (PF2e / CoC / PbtA / dice-pool DSL)
- Protobuf binary WS deltas, Hermite interpolation
- Procedural map generation (BSP / cellular automata / Voronoi)

These solve problems a grid-and-tokens VTT has; Auto-DM's map is a
free-position token board and its rules are 5e-shaped by design.

---

## D1 — Deterministic Utility AI for monster tactics

**Principle.** Exactly the same discipline as dice/oracle/combat: when a
monster must choose an action on its turn, a pure scoring function picks
the action — never the LLM. The crew's Narrator only ever describes what
already mechanically happened.

**Home.** `auto_dm_engine::utility_ai` (new module; engine stays
LLM-free). Consumed by `session.rs` combat flow and surfaced to clients
via existing `GameEvent`s plus a new `monster_acted` payload carrying the
chosen action id, targets, and roll summary for the narrator to style.

### Scoring

For each candidate action `A` (from the combatant's stat-block actions,
slot-gated like player actions) and each living target `T`:

```
U(A, T) = BaseWeight(A) × ∏ Cᵢ(context) − Cost(A)
```

Considerations `Cᵢ ∈ [0,1]`, all deterministic, all unit-testable:

| Consideration | Formula (v1) | Notes |
|---|---|---|
| Focus fire `C_hp` | `1 − hp_ratio²` | Squashing favors finishing wounded PCs |
| Range fit `C_rng` | `1` if dist ≤ range else `max(0, 1 − (dist−range)/range)` | Straight-line distance; **no pathfinding in v1** (map is position-free, no collision grid) |
| AoE clustering `C_aoe` | `min(1, clustered_count / 3)` where clustered = enemies within effect radius of best center | Only for `shape: sphere/burst` actions |
| Slot economy `C_slot` | `1 − tier_fraction × urgency` | Urgency high when party HP low; discourages burning L3 slots turn 1 |
| Self-preservation `C_safe` | downweights actions that put self ≤ 25% HP exposure vs. ranged threat count | v1 heuristic |

`BaseWeight(A)` comes from the action's existing damage/dice budget
(normalized), so content authors tune behavior purely through the
stat blocks they already write — no new authoring surface.

Tie-break: higher damage expectation, then lower action index
(deterministic across seeds).

### Execution pipeline

1. Engine collects candidate `(A, T)` pairs for the active monster.
2. Score → pick `A*`.
3. Run `A*` through the **existing** attack resolution (prereqs, slots,
   concentration, resistance/vulnerability) — identical code path as
   player attacks.
4. Emit mechanical events; package `ActionOutcome` (hit/miss, damage,
   conditions, dice detail string) into the crew request.
5. Narrator renders prose grounded in that outcome; guardrails already
   prevent inventing mechanics.

### Tests

- Seeded-RNG (`DiceEngine::with_seed`) golden tests: known board → known
  chosen action for focus-fire, range-fit, and slot-economy scenarios.
- Property test: scoring never selects an unaffordable/ungated action.
- Integration: monster turn via session produces same events as a player
  taking the identical attack.

### Risks / notes

- Distance without pathfinding can overvalue unreachable melee targets;
  acceptable v1, note in UI ("charges" flavor from Narrator).
- Keep the consideration set closed — resist adding curve types until a
  real encounter demands one.

---

## D2 — Local voice loop (STT + TTS, zero cloud)

**Principle.** Same local-first identity as Ollama: speech runs on the
player's machine, no API keys, no SaaS fees. Additive — nothing existing
changes to ship it.

**Homes.** New `auto_dm_core::voice` for orchestration traits + clause
splitting; native capture/synthesis lives behind Tauri (cpal) because
core stays deterministic and UI-free.

### Inbound: speak your action

1. **Capture** — `cpal`, 16 kHz mono f32→i16 PCM ring buffer.
2. **VAD** — Silero VAD ONNX via `ort` (onnxruntime); emits speech
   segments ≥ ~300 ms with ~200 ms hangover.
3. **STT** — `whisper-rs` on each segment; model file user-provided
   (`ggml-base.en` default; document download + size).
4. **Intent** — transcript flows into the existing
   `auto_dm_core::intent` parser unchanged (text is text).

### Outbound: hear the table

1. **Clause split** — Narrator output split at sentence boundaries
   (reuse `salvage_truncated`-style robustness for abbreviations).
2. **TTS** — Piper (fast, CPU-friendly) first; Kokoro-82M as quality
   option later. Both via `ort` ONNX; stream PCM chunks.
3. **Playback** — cpal output queue per clause; UI shows a speaking
   indicator.
4. **Barge-in** — if Silero flags mic speech during playback, flush the
   output queue immediately (this is why VAD owns both directions).

### Rollout slices

- D2a: capture + VAD + STT → text box (read-only proof of loop).
- D2b: wire transcript into intent parse (parity with typed input).
- D2c: TTS playback + barge-in.

### Tests

- Clause splitter: golden tests incl. "Mr." / ellipses / fenced JSON
  passthrough.
- Voice loop itself is hardware-bound — manual QA checklist in this doc
  once D2a lands; CI only covers the pure pieces (splitter, segment
  buffer math, PCM conversion).

### Risks / notes

- Model downloads (~75 MB Whisper base, ~60 MB Piper voice) need a
  first-run UX decision (bundle vs. prompt).
- Windows mic permission prompts; cpal device selection UI needed.
- `ort` pulls onnxruntime — check NSIS installer size impact before
  merging into release builds; consider cargo feature gate `voice`.

---

## D3 — Deferred: heavier memory (GraphRAG-in-spirit)

The blueprint's sqlite-vec + temporal-graph + asymmetric-perception
subsystem is acknowledged as the eventual upgrade path for lore recall
and NPC metagaming prevention — but only when the shipped simple version
shows real limits (TF-IDF misses paraphrases in long campaigns; nothing
today tracks who-knows-what). When that day comes, start from the
existing `Embedder`/`VectorStore` seams; do not build preemptively.
