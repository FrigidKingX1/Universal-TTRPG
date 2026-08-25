# Round 3 — From Crew Definitions to Shipping Code

> Deep-dive on *how* multi-agent AI TTRPGs actually wire their agents,
> plus the most forkable open-source code to steal from. Builds directly
> on `VTT_AND_MULTI_AGENT_STUDY.md` (Round 1) and `MULTI_AGENT_ROUND2.md`.

---

## TL;DR for Universal TTRPG

Round 1 proved *why* to split the DM. Round 2 proved *who* those agents
should be. Round 3 shows *how* to write them so they run on your
already-shipped `qwen2.5:7b` / `llama3.2` without adding Python.

**Recommendation hasn't changed:** stay Rust-native sequential first.
This round gives you the actual prompt skeletons and tool contracts to do it.

---

## 1. What CrewAI Projects Really Look Like Inside

### The YAML you actually write

Fetched live CrewAI docs (Aug 2026) show the current pattern is **JSONC**,
not YAML, but the shape is identical:

```jsonc
// agents/researcher.jsonc
{
  "role": "{topic} Senior Data Researcher",
  "goal": "Uncover cutting-edge developments in {topic}",
  "backstory": "You're a seasoned researcher ...",
  "tools": ["SerperDevTool"],
  "verbose": true
}
```

```jsonc
// crew.jsonc — which agents are in the crew
{ "agents": ["researcher", "reporting_analyst"] }
```

Translate to TTRPG:

```jsonc
// agents/npc_actor.jsonc  (for Universal TTRPG)
{
  "role": "NPC Actor — {npc_name}",
  "goal": "Speak as {npc_name} consistently with their memory and goals",
  "backstory": "You are {npc_name}, {personality}. You remember: {memory_slice}.",
  "tools": ["recall_npc_memory", "update_relationship"],
  "llm": "qwen2.5:7b"
}
```

**Lesson:** SohamDeep's 5-agent TTRPG uses exactly this shape; each TTRPG
sub-role is one `agents/*.jsonc` file. Copy the shape, not the framework.

### The task file you pair it with

```yaml
# tasks.yaml — SohamDeep pattern
RetrieveMemory:
  description: "Fetch relevant lore for player input: {player_input}"
  expected_output: "Top-3 memory chunks with citations"
  agent: RetrieveMemory
GenerateResponse:
  description: "Produce narrative using the retrieved memories"
  expected_output: "2-3 paragraphs + next choices"
  agent: GenerateResponse
```

Our equivalent is `core/src/prompts/tasks.jsonc` — keeps the DM's checklist
auditable.

---

## 2. Three Codebases Worth Opening in Your Editor

### 2.1 `matluz1/lorekit` — read `cruncher/` and `guidelines/`

- **File to read first:** `guidelines/GM_GUIDE.md` — the GM agent's constitution.
  Copy the *idea*: one Markdown file per agent that is checked into git and
  loaded as the system prompt. We should add `core/src/prompts/GM_GUIDE.md`
  etc. verbatim.
- **File to copy pattern from:** `cruncher/system_pack.py` — loads `systems/pf2e/system.json`
  into a topo-sorted stat engine. Our `engine/src/state.rs` + `core/src/models.rs`
  already does this; LoreKit adds a `test_config.json` per pack so `pytest`
  can run the *same* combat through every system. Add `systems/test_config.json`
  and a `cargo test --test system_packs` harness.

### 2.2 `datashaman/ai-ttrpg` — read the boundary, not the framework

Tagline: *"Code owns truth. The LLM proposes; the engine disposes."*

```
Player → Utterance Classifier → Scene Controller
            ↓         ↓        ↓
        Retrieval  Rules  Oracles
            ↓         ↓        ↓
        Command Planner → Deterministic Runtime → Validated Events
                                                 ↙        ↘
                                          Event Store   Event Bus → LLM Narrator
```

- **Event-sourcing + Timeline branches** (`support/checkpoint.py`) — branching
  save/load with deltas. We have `engine/src/state.rs` SQLite + `branch` in
  name only; their `checkpoint.py` compression+delta approach is directly
  portable to our `engine/src/session.rs`.
- **Rule Authoring pipeline** (Rule Source → Candidate → Review → Executable
  Package) — overkill for us today, but the *citation* idea is gold: every
  generated fact keeps `stableId + source + visibility + inclusion reason`.
  We already do this for `world_knowledge` → add it to `CampaignMemory` entries.
- Notable: **no Python agent framework** — they use a stateless OpenAI adapter
  with `store: false` and per-task `Model Task` scopes. Proves you don't need
  CrewAI to do multi-agent; plain HTTP + strict JSON is enough.

### 2.3 `mnmatos/ai-gamemaster` — the pragmatic FastAPI you can deploy tonight

```
React 19 --REST--> FastAPI (campaign_logic / combat_logic / narrative_logic
                    / protocol_logic) --LangChain--> Ollama | Bedrock
                                         +--> ChromaDB  +--> campaign JSON
```

- `protocol_logic.py` is our `intent.rs` repair layer by another name.
- `combat_logic.py` is `engine/src/combat.rs` with dice parsing.
- Swappable `Ollama` ↔ `Bedrock` via `LlmBackend` trait — we already have
  `LlmBackend` + `StubLlmBackend`; adding `BedrockBackend` is one file.

### 2.4 The theory that makes it *guide* instead of just *respond*

**“I Cast Detect Thoughts” (ACL 2023, Zhou et al.)** — the DM is modeled as a
*teacher* with a hidden **intent** (e.g. "make players roll Perception for
goblins") and a **Theory-of-Mind** model that predicts the players' next
action. Training with PPO on intent→utterance→anticipated-action reward makes
the DM **3× more likely** to fulfill its intent than vanilla NLG.

**For us:** Before the Narrator speaks, run a tiny intent string through it:
`"DM intends players to make a Perception check for goblins"` — then let a
second cheap call (or the same model with a different system prompt)
predict the player's likely action. Log the pair; later fine-tune with the
same RL signal. No new infra, just two prompts.

---

## 3. Reusable Prompts You Can Paste Today

These are distilled from SohamDeep's `agents_v2.yaml`, Inferensys' three
orchestrator roles, and LoreKit's `guidelines/`:

```markdown
# core/src/prompts/narrator.md
You are the NARRATOR. Never roll dice, never change HP.
Given: scene + intent + lore slice, emit 2-3 paragraphs of present-tense
prose and exactly one open-ended question.

# core/src/prompts/rules_arbiter.md
You are the RULES ARBITER. Given player input + available actions,
return JSON { "action": "attack" | "cast" | "move" | "no_rule" | "needs_adjudication",
"target": ..., "tool": "roll_dice" | null } or no_rule.

# core/src/prompts/lorekeeper.md
You are the LOREKEEPER. Retrieve only. No invention. Given memory chunks,
answer with citations [sourceId].

# core/src/prompts/npc_actor.md
You are {npc_name}. Goals: {goals}. Memory: {memory_slice}.
Speak in voice. One turn only.

# core/src/prompts/combat_director.md
You own initiative, turn order, and encounter balance. Emit
{"command": "start_encounter" | "advance_turn" | "apply_damage", ...}
```

Per-model tuning (from our `qwen2.5:7b` fleet): `qwen` wants shorter system
prompts with the task at the end; `llama3.2` tolerates longer backstories.
Both benefit from `respect_context_window=True` (CrewAI flag) → in our case,
truncate `CampaignMemory` to ~4k tokens before the call.

---

## 4. What to Copy This Week vs Later

| Now (no new deps) | Later (when you feel pain) |
|---|---|
| Add `core/src/prompts/*.md` + `campaign_json_schema()` already landed in R7 | Add `sqlite-vec` hybrid recall (LoreKit `vectordb.py`) |
| `repair_campaign_json` + `extract_first_json_object` (shipped) | Branch: use LangGraph-JS for parallel NPC debate |
| `systems/test_config.json` harness per pack | AutoGen-style group-chat manager for 3+ NPCs arguing |
| Stub world model (`world.py` from asibul) as offline fallback | Full MCP surface (51 tools like LoreKit) |

---

## 5. Asset & Code Checklist (license-safe)

- [x] MapTool token frames → `public/assets/tokens/frames/` (Apache-2.0) — already in pipeline
- [ ] LoreKit `systems/pf2e/system.json` test harness pattern — copy the *test structure*, not the ORC data itself (system data stays under its own LICENSE)
- [ ] `mnmatos/campaigns/goblin_cave.json` as `test/fixtures/goblin_cave.json` — re-author the values, keep the shape for a parser test
- [ ] Inferensys `Narrative State Manager` graph → our `engine/src/agents/mod.rs` sequential crew (no code to copy, just the 5-role table)

All four sources are MIT/Apache-2.0 for the code we would actually copy; system data (PF2e ORC, Goblin Cave content) stays under its own license and we only copy the *shape*.

---

*Round 3 — 2026-08-25. Primary sources fetched live: CrewAI agents docs (JSONC crew, role/goal/backstory/tools), LoreKit README + ARCHITECTURE.md, datashaman/ai-ttrpg README + engine plan, mnmatos/ai-gamemaster README + structure, asibul/multi-agent-dungeon-master README + world model, plus the ACL paper “I Cast Detect Thoughts” (ToM+RL, 3× goal fulfillment). Round 1 covered VTT UX; Round 2 covered frameworks — this round is the prompts and tool contracts.*
