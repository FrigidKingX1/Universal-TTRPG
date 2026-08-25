# Round 4 — From Patterns to Prompts: How the Best Open-Source Multi-Agent DMs Actually Implement Their Crews

> This is the build-ready follow-up to Round 1 (VTT UX) and Round 2 (framework comparison). Round 3 gave you the prompt skeletons; Round 4 opens the hood on three repos that *ship* and extracts the exact tool schemas, memory tricks, and evaluation harnesses you can copy into **Universal TTRPG** today.

---

## 0. What Round 3 Left on the Table

Round 3 delivered `core/src/prompts/*.md` skeletons (Narrator, Rules Arbiter, Lorekeeper, NPC Actor, Combat Director) and the recommendation to stay Rust-native sequential. What it didn't do is show:

* what a *real* `agents/*.jsonc` looks like for a TTRPG task,
* how a deterministic engine makes tool calls cheap (so the LLM never invents numbers),
* and how the teams *prove* their DMs work across updates.

Round 4 closes those gaps.

---

## 1. CrewAI in Practice — What an Agent File Actually Says

Fetched live CrewAI docs (Aug 2026) — the current way to define an agent is **JSONC**, via `crewai create crew <name>`:

```jsonc
// agents/npc_actor.jsonc — adapted for Universal TTRPG
{
  "role": "NPC Actor — {npc_name}",
  "goal": "Speak as {npc_name} with perfect memory of past interactions and pursuit of {goals}",
  "backstory": "You are {npc_name}, {personality}. You remember: {memory_slice}. You want: {goals}. Never break character.",
  "tools": ["recall_npc_memory", "update_relationship"],
  "llm": "qwen2.5:7b",
  "memory": true,
  "cache": true
}
```

Paired `tasks.jsonc`:

```yaml
RetrieveMemory:
  description: "Fetch top-3 lore chunks for player input: {player_input}"
  expected_output: "3 citations [sourceId]"
  agent: RetrieveMemory
GenerateResponse:
  description: "Produce 2-3 paragraphs of narration using the citations"
  expected_output: "Narrative + 3 choices"
  agent: GenerateResponse
```

**SohamDeep2026/AI_Dungeon_Master** (`main_v3.2.py` + `crew_config/agents_v2.yaml` + `tasks.yaml`)
uses exactly this split, but wired as `Player Input → RetrieveMemory → GenerateResponse → SummarizeSession → StoreMemory` over **ChromaDB** and **Ollama (qwen2.5:14b local) / Groq (llama-3.3-70b cloud)**. Their demo runs offline on the same `qwen2.5:7b` you already ship.

**Takeaway:** You don't need CrewAI the Python package to use the *pattern*. Five Markdown files in `core/prompts/` with `role/goal/backstory/tools` headers *are* the crew definition. Our orchestrator just cycles through them with `OllamaLlmBackend::complete`.

---

## 2. Three Codebases Worth Reading Line-by-Line

### 2.1 `matluz1/lorekit` — 414 commits, 1010 tests, 51 MCP tools

```
cruncher/               # pip install lorekit-cruncher — zero-dep
  formulas.py / stacking.py / system_pack.py / engine.py / build.py
  dice.py / types.py
src/lorekit/
  server.py             # MCP server — 51 tools the GM agent calls
  orchestrator.py       # GameSession async for event in session.send("I search...")
  npc/memory.py         # Park + ACT-R memory scoring (not just cosine!)
  support/recall.py     # Hybrid semantic + keyword search
  support/vectordb.py   # sqlite-vec (no Docker, no Chroma)
systems/pf2e, mm3e      # Pure JSON packs; each ships test_config.json
guidelines/GM_GUIDE.md  # The GM's constitution — read every session
```

**What to copy verbatim:**

* **`server.py` tool list as your MCP surface.** LoreKit's 51 tools are grouped: `roll_dice`, `start_encounter`, `resolve_attack`, `move_in_zone`, `spawn_npc_agent`, `update_relationship`, `advance_clock`, etc. Our 10 Tauri commands (`rollDice`, `combatAttack`, `createCharacter`…) are the same shape — wrap them as MCP tools with `rmcp` and Claude/Cursor can DM directly.
* **`cruncher/system_pack.py` → `engine/src/state.rs`.** LoreKit already proved system packs as topo-sorted formulas work; we added `systems/test_config.json`-style per-pack `cargo test` in Round 2. Keep it.
* **`guidelines/` as code.** Check `core/prompts/GM_GUIDE.md` into git; the orchestrator loads it every session. Version it.

### 2.2 `datashaman/ai-ttrpg` — the architecture diagram you should print

```
Player → Utterance Classifier → Scene Controller
                ↓         ↓        ↓
            Retrieval  Rules   Oracles
                ↓         ↓        ↓
            Command Planner → Deterministic Runtime → Validated Events
                                                 ↙        ↘
                                          Event Store   Event Bus → LLM Narrator
```

Principles (from their README + `docs/engine-implementation-plan.md`):

1. **Code owns truth. LLM proposes; engine disposes.** Deterministic code validates commands, resolves mechanics, records events.
2. **Events are canonical.** Current state is a projection of an append-only history. Our `engine/src/state.rs` + `SqliteRepository` already does this — add their `checkpoint.py` delta-compression for branching saves.
3. **Rules are data** (versioned Rule Source → Candidate → Review → Executable Package). We don't need the full workflow yet, but *keep citations*: every fact in `CampaignMemory` should carry `stableId + source + visibility` (we added this in Round 3 proposal — now implement it).
4. **Boundaries are replaceable** — models, DB, UI are adapters. Our `LlmBackend` trait already is.

### 2.3 `mnmatos/ai-gamemaster` — the pragmatic FastAPI you can deploy tonight

```
React 19 --REST--> FastAPI (campaign_logic / combat_logic / narrative_logic
                    / protocol_logic --LangChain--> Ollama | Bedrock
                                         +--> ChromaDB  +--> campaign JSON
```

`protocol_logic.py` *is* `core/src/intent.rs`. `campaign_logic.py` + `schemas.py` is `engine/src/state.rs`. Keep the names — when you adopt `sqlite-vec` hybrid recall, it slots into `protocol_logic`.

### 2.4 The research that makes it *guide* instead of *respond*

**"I Cast Detect Thoughts" (ACL 2023, Zhou et al.)** — models the DM as a *teacher* with a hidden **intent** ("make players roll Perception for goblins") and a **Theory-of-Mind** predictor of the player's next action. PPO on intent→utterance→anticipated-action makes the DM **3× more likely** to fulfill its intent than vanilla NLG.

**For Universal TTRPG:** Before the Narrator speaks, emit a tiny intent string. That's it — log `intent` + `predicted_action` per turn. Later, fine-tune with the same reward. Zero infra.

---

## 3. Reusable Prompts — Paste-Ready for `core/prompts/`

Distilled from SohamDeep's `agents_v2.yaml` + Inferensys' three orchestrators + LoreKit's guidelines:

```markdown
# core/prompts/narrator.md
You are the NARRATOR. Never roll dice, never change HP, never invent a rule.
Input: scene + intent + lore slice (max 3 citations). Output: 2-3 paragraphs
present tense + exactly one open-ended question. Cite sources as [id].

# core/prompts/rules_arbiter.md
You are the RULES ARBITER. Input: player utterance + available actions.
Output JSON { "action": "attack"|"cast"|"move"|"no_rule"|"needs_adjudication",
"target": string|null, "tool": "roll_dice"|null }. Never narrate.

# core/prompts/lorekeeper.md
You are the LOREKEEPER. Retrieve only. No invention. Input: query + memory.
Output: top-3 citations [sourceId] with verbatim quotes.

# core/prompts/npc_actor.md
You are {npc_name}. Goals: {goals}. Memory: {memory_slice} (Park+ACT-R scored).
Speak in voice. One turn only. End with an unresolved beat.

# core/prompts/combat_director.md
You own initiative, turn order, encounter balance. Output JSON
{ "command": "start_encounter"|"advance_turn"|"apply_damage", ... }.
Never narrate — Narrator will.
```

Per-model note from `qwen2.5:7b` fleet: `qwen` wants the task sentence *last*; `llama3.2` tolerates long backstories. Both benefit from `respect_context_window=True` → truncate `CampaignMemory` to ~4k tokens before the call (we already do).

---

## 4. What to Build This Week vs Later

| Now (no new deps) | Later (when pain appears) |
|---|---|
| `core/prompts/*.md` + `campaign_json_schema()` (shipped R7) | `sqlite-vec` hybrid recall (LoreKit `vectordb.py`) |
| `core/src/memory_vec.rs` TF-IDF stub over `CampaignMemory` | Swap TF-IDF for tiny embedding |
| `engine/src/agents/mod.rs` sequential crew (5 prompts, shared `CrewState`) | Fan-out with LangGraph-JS / OMA for 3+ NPCs debating |
| `systems/test_config.json` harness per pack | AutoGen group-chat manager for NPC council |
| `world.py`-style rule-based stub as offline fallback (asibul pattern) | Full MCP surface (51 tools) + `rmcp` wrapper |

---

## 5. Asset & Code Checklist (license-safe)

- [x] MapTool token frames → `public/assets/tokens/frames/` (Apache-2.0)
- [ ] LoreKit `systems/pf2e/system.json` test harness pattern — copy *structure*, not ORC data (ORC stays under its LICENSE)
- [ ] `mnmatos/campaigns/goblin_cave.json` as `test/fixtures/goblin_cave.json` — re-author values, keep shape
- [ ] Inferensys Narrative State Manager graph → `engine/src/agents/mod.rs` sequential crew

All four sources above are **MIT/Apache-2.0** for the code we would copy; system data stays under its own license.

---

*Round 4 — 2026-08-25. Codebases opened live: LoreKit README/ARCHITECTURE (51 tools, cruncher, 1010 tests), datashaman/ai-ttrpg README + engine plan (event-sourcing, boundaries), mnmatos/ai-gamemaster README (FastAPI/LangChain/ChromaDB/React19), asibul world model (room graph, torch light), plus CrewAI JSONC docs and the ACL ToM paper. Rounds 1-2 covered VTT UX + framework comparison; Round 3 gave the prompt skeletons — this round is the tool contracts.*
