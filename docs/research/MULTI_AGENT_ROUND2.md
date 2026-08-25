# Round 2 — Multi-Agent AI TTRPG Deep Dive

> Follow-up to `VTT_AND_MULTI_AGENT_STUDY.md`. This round looks *inside* three
> open-source codebases that actually ship multi-agent TTRPGs, to extract
> reusable architecture and concrete assets for **Universal TTRPG** (auto-dm).

---

## What changed since Round 1

Round 1 established the landscape (Fantasy Grounds rulesets, MapTool/PlanarAlly
patterns, framework comparison CrewAI/LangGraph/AutoGen/OMA). Round 2 opens the
hood on three repos that *are* the thing:

| Repo | Language | Stars | Why it matters here |
|---|---|---|---|
| **[matluz1/lorekit](https://github.com/matluz1/lorekit)** | Python 3.13 + TS/React | 9 | The most rigorous model: **MCP server + deterministic `cruncher` engine + system packs as JSON + 1010 tests**. Closest to auto-dm's core/engine split. |
| **[mnmatos/ai-gamemaster](https://github.com/mnmatos/ai-gamemaster)** | Python (FastAPI) + React 19 | 0 | Pragmatic full-stack: **LangChain + ChromaDB RAG + Ollama/Bedrock switch + tactical combat** (`campaign_logic.py`, `combat_logic.py`, `protocol_logic.py`). |
| **[asibul-islam/multi-agent-dungeon-master](https://github.com/asibul-islam/multi-agent-dungeon-master)** | Python | 1 | **Rule-based precursor** that explores multi-agent concepts *without an LLM at all* — pure world-model + state sync. Perfect for bootstrapping. |

---

## 1. LoreKit — the gold standard for deterministic-first design

**Repo shape** (`pyproject.toml` / `Makefile` / 414 commits):

```
cruncher/               # pip install lorekit-cruncher — zero-dep rules engine
  formulas.py / stacking.py / system_pack.py / engine.py / build.py / dice.py
src/lorekit/
  server.py             # MCP server — 51 tools for the GM agent
  providers/claude/     # AgentProvider abstraction (Claude CLI today, Codex/Gemini planned)
  orchestrator.py       # GameSession — the public Python API
  npc/memory.py         # Park+ACT-R memory scoring
  support/recall.py     # Hybrid semantic+keyword search
  support/vectordb.py   # sqlite-vec embeddings
systems/pf2e, mm3e      # Pure JSON system packs (ORC / OGL 1.0a)
guidelines/GM_GUIDE.md  # The GM agent's constitution
```

**Design decisions we should copy:**

1. **`cruncher` is a separate pip package.** It knows *nothing* about LLMs, HTTP, or SQLite — only formulas, stacking, build, dice. Our `core/` already does this; LoreKit proves the split scales to 1000+ tests. Keep it.
2. **System packs are pure JSON.** LoreKit ships Pathfinder 2e Remaster + d20 Hero SRD as JSON, loaded by `system_pack.py`. Our `src/presets/` is the same idea but still TS. Convert to `systems/*.json` so the Rust engine can load them without TS → JSON export dance (or keep the export, but document the JSON as the source of truth).
3. **MCP server with 51 tools.** `server.py` exposes the engine as tools the LLM calls (roll, startEncounter, moveInZone, spawnNpcAgent…). Our `backend.rollDice` / `combatAttack` HTTP endpoints are the same pattern over Tauri commands — we should enumerate them as an MCP surface too (future: expose auto-dm engine as an MCP server so Claude Code / Cursor can DM).
4. **NPCs as independent agents** (`src/lorekit/npc/`). Each major NPC gets its own context, `memory.py` (Park+ACT-R scoring), `combat.py` for decisions, `reflect.py` for LLM reflection, and `prefetch.py`/`postprocess.py` for deterministic context assembly. Our NPC notes are a single table — LoreKit shows how to give each NPC a life.
5. **Guidelines as code.** `guidelines/GM_GUIDE.md` is read by the GM agent at session start. We should do the same: `core/src/prompts/GM_GUIDE.md` checked into git, versioned.
6. **Hybrid recall.** `support/recall.py` does semantic + keyword hybrid search over `support/vectordb.py` (sqlite-vec). Our `CampaignMemory` is a ring buffer; adding a tiny embedding step (even TF-IDF to start) directly mirrors LoreKit.
7. **Test discipline.** `tests/` is split `unit/` vs `integration/` and system packs ship `test_config.json` so the parametrized harness exercises combat/rest/initiative/HUD for *each* system. We can copy this: `systems/test_config.json` per pack.

**Reusable asset (MIT-friendly):** The *system pack test harness pattern* — parametrized pytest that loads each `system.json` + `test_config.json` and runs the full combat flow. Portable to `cargo test` with `serde_json` fixtures. No code copy needed, just the pattern.

---

## 2. mnmatos/ai-gamemaster — the pragmatic full-stack

```
FastAPI backend
  campaign_logic.py / session_logic.py / combat_logic.py
  narrative_logic.py (LangChain) / protocol_logic.py (parse LLM)
  schemas.py / config.py
ChromaDB (vector DB) + Ollama (or Bedrock) + campaign JSON files
React 19 + Vite frontend (GameChat, BattleMap, CampaignList)
```

**Lessons:**

- **Explicit `protocol_logic.py`.** LLM output is parsed by a dedicated module that extracts JSON and validates it — exactly the same job as our `core/src/intent.rs` repair layer (19 tests). Theirs is LangChain-based; ours is pure Rust serde. Keep ours — ours is offline and faster.
- **RAG via ChromaDB** over `data/rules.md` + campaign files. Our ChromaDB is missing; LoreKit's `sqlite-vec` is the lighter fit (no Docker needed).
- **Campaigns as JSON** (`title`, `introduction`, `setting_description`, `runtime_defaults` with `scene_mode`, `focus`, `player` hp/ac/attack_bonus/damage). Very close to our `campaign_data.db` shape — validates our seed schema.
- **LangChain as the escape hatch.** They can flip Ollama ↔ Bedrock (`google.gemma-3-27b-it`) per campaign via the frontend. Our `ollama.rs` → `resolve_effective_model` fallback is the same instinct; we could add a Bedrock adapter the same way `LlmBackend` already abstracts.
- **UX pattern:** campaign selection + LLM config screen before chat starts — we do this in `PlayerPanel` + `SettingsPanel`, but theirs is a dedicated wizard. Worth borrowing the wizard flow for hosted sessions.

**Reusable asset:** The `campaign_logic.py` + `schemas.py` campaign JSON shape — we can ingest their `goblin_cave.json` as a test fixture to ensure our engine handles the same structure.

---

## 3. asibul-islam/multi-agent-dungeon-master — the rule-based scaffolding

> *"Instead of functioning as a simple chatbot, the project models persistent world memory, environment-aware reasoning, inventory state management, navigation systems, conditional perception, structured world representation, action validation and rule checking."* — README

```
Player Input → Intent Parsing → Game Master Logic → World State Reasoning → State Update → Narrative Response
world.py       → Location objects with exits/metadata
game_state.py  → JSON save/load
game_master.py → rule-based action validation
```

**Why it matters:** It proves you can get 70% of the *feel* of a multi-agent system with **zero LLM calls** — just a graph of rooms, a lit/unlit flag (torch), and `take torch` / `turn on torch` rules. This is the perfect fallback when Ollama is unreachable (our stub backend today just fails). We should keep a rule-based `stub` that can still move players between locations and track inventory when the LLM is down, exactly like this repo.

Planned evolution in their README maps 1-to-1 to our roadmap:
`NPC memory → Multi-agent orchestration → Dynamic quests → LLM storytelling → Tool-using agents`

---

## 4. Synthesis — What Universal TTRPG Should Do Next

### Already aligned (keep it)

- **Deterministic engine owns math** (core/engine) — LoreKit's cruncher, ai-gamemaster's combat_logic, and asibul's world.py all agree.
- **Tauri + Axum self-host** — matches the Docker self-host story of mnmatos and PlanarAlly.

### Concrete next steps (ordered, smallest first)

1. **Port the LoreKit test-harness pattern.** Add `systems/*/test_config.json` and a parametrized `cargo test` that loads each system pack through `cruncher`-style formulas, stacking, build, and dice. Our drift-guard (`preset_export.test.ts`) is a start; this makes it per-system.

2. **Split the DM prompt into the 5-agent crew (no new deps).** Adopt the SohamDeep/Inferensys role split with *our* engine as the tool layer:
   - Narrator (atmosphere), Rules Arbiter (calls `engine::execute_attack`), Lorekeeper (vector recall), NPC Actor (per-NPC voice + memory), Combat Director (initiative/turn gating). Five `OllamaLlmBackend::complete` calls per turn with different system prompts, handoff via `CampaignMemory` + `CrewState` struct. This is the Inferensys architecture (Narrative State Manager → Character Agent Pool → Rules Agent) without LangGraph.

3. **Add hybrid recall to `CampaignMemory`.** Start with TF-IDF over `support/vectordb.py` pattern; swap in a tiny embedding later (same sqlite-vec LoreKit uses). Gives Lorekeeper something to retrieve.

4. **Serve a rule-based stub.** When `ollama::reachable()` is false, asibul-style `world.py` logic keeps the game playable (move, look, inventory) instead of erroring.

5. **Expose an MCP surface.** LoreKit's 51-tool MCP server is the model: expose our 8-10 Tauri commands (`rollDice`, `combatAttack`, `createCharacter`, `saveStatBlock`, …) as MCP tools so Claude/Cursor can DM directly. The Rust code already exists; it's a thin `rmcp` wrapper.

### Assets you can copy today (license-safe)

| Asset | Source | License | Where it lands in auto-dm |
|---|---|---|---|
| System pack JSON test harness (system.json + test_config.json) | LoreKit `systems/pf2e` | ORC (system data) / Apache-2.0 (harness) | `systems/` + `cargo test` |
| Hybrid recall (semantic+keyword) skeleton | LoreKit `support/recall.py` | Apache-2.0 | `core/src/memory_vec.rs` (TF-IDF stub) |
| Campaign JSON example (`goblin_cave.json`) | mnmatos/campaigns | (no license file — treat as example, re-author) | `test/fixtures/` |
| Structured world (Location graph, light/dark) | asibul `world.py` | no license → reimplement pattern, don't copy verbatim | `engine/src/world.rs` (optional stub) |
| Token frame art | RPTools MapTool | Apache-2.0 | Already in `public/assets/tokens/frames/` pipeline |

---

*Round 2 study — 2026-08-25. Codebases inspected via GitHub webfetch: LoreKit (414 commits, 1010 tests, MCP+cruncher), mnmatos/ai-gamemaster (FastAPI/LangChain/ChromaDB/React 19), asibul-islam/multi-agent-dungeon-master (rule-based world model). Prior round covered Fantasy Grounds + MapTool/PlanarAlly vs Fari. Combined recommendation remains: **Rust-native sequential crew first, no Python sidecar**, because it runs on the qwen2.5:7b + llama3.2 you already ship.*
