# VTT & Multi-Agent AI TTRPG — Research for Universal TTRPG

> **Purpose:** What Fantasy Grounds does brilliantly, what open-source VTTs do differently, and how the new wave of **multi-agent AI Dungeon Masters** splits the old monolithic LLM call into cooperating specialists — and what Universal TTRPG should steal from each.

---

## 1. Fantasy Grounds Unity — Architecture Lessons

**Fantasy Grounds** (SmiteWorks, 2004-2026, Unity, free-to-play since 2024) is the most automated VTT for crunchy systems (D&D 5e/Pathfinder). Three ideas matter for us:

### 1.1 Ruleset layering (CoreRPG → child rulesets)

- A *ruleset* = XML (UI + data schema) + Lua scripts + art/fonts/tokens. Every player client downloads the host's ruleset at join (host version wins).
- `CoreRPG` is the base; D&D 5e, Pathfinder 2e, Daggerheart, Starfinder etc. are **children that inherit** and override. Extensions stack on top with a declared dependency order.
- **Takeaway:** Presets as *system packs* is the right direction. Right now `src/presets/` is hardcoded 5e-ish. Extract the schema (attributes, resource pools, action resolution) so a `sw5e-pack.json` or `pf2e-pack.json` swaps in without code changes — exactly how FG avoids forking the app per system.

### 1.2 Combat Tracker as state machine

- Separate tracker object holds initiative, HP/temp HP, conditions, effects with duration ticks, + automation for saves/damage. Not just a sorted list.
- Dynamic LoS, lighting, vision, and dice tower.
- **Takeaway:** Our engine already has the *data* (initiativeOrder, combatantStates, conditions, deathSaves, concentration). What's missing in UI is a single persistent tracker panel that survives tab switches.

### 1.3 Modules & Forge

- Campaigns/adventures are exportable **modules** (`.mod`, essentially zip) that any table can import. The Forge (marketplace) lets third parties sell rulesets/modules.
- Our campaign export/import is 80% there — add an "adventure module" bundle that includes `mapBackground` + `mapTokens` per scene so maps travel with scenes.

**Sources:** [Fantasy Grounds site](http://www.fantasygrounds.com/), [Ruleset Overview](https://fantasygroundsunity.atlassian.net/wiki/spaces/FGCP/pages/996644412/Creating%20a%20Ruleset%20-%20Overview), [Extensions ordering](https://www.fantasygrounds.com/modguide/extensions.xcp)

---

## 2. Open-Source VTTs — What to Study & What to Steal

| Project | License | Stack | Stars | What to steal for auto-dm |
|---|---|---|---|---|
| **[MapTool](https://github.com/RPTools/maptool)** | Apache-2.0 | Java | **VBL (Vision Blocking Layer):** walls as polygons clipping a light mesh — the canonical LoS algorithm. Layer stack (map / token / object / GM) + macro scripting for automating any roll. 20yr mature server protocol. |
| **[PlanarAlly](https://github.com/Kruptein/PlanarAlly)** | MIT | Python + TS | **Build vs Play mode** split (DM preps in Build, runs in Play), multi-floor scenes, lightweight scope discipline: "the battlemap that talks to your existing tools." Docker self-host guide is a model for our server. |
| **[FoundryVTT](https://foundryvtt.com)** | Proprietary ($50) | Node.js | **System-module API** + **compendium packs** (content as data, not code) + canvas lighting/walls — the modern UX benchmark. Patterns are documented even though code is closed. |
| **[Fari App](https://github.com/farirpgs/fari-app)** | MIT | TS/React | Free, offline-first, delightfully simple character sheets + oracles. Good inspiration for our /ask Oracle presentation. |
| **[DungeonClub](https://github.com/doodlezucc/dungeonclub)** | MIT | TS | Shared maps + fog + tokens in a few thousand lines — the minimal VTT to read end-to-end in an evening. |
| **[AboveVTT](https://github.com/cybernetically/AboveVTT)** (AboveVTT) | GPL | JS | Chrome extension that injects a VTT *into* D&D Beyond — clever zero-backend interop trick. |
| **[AirBoardGame](https://github.com/jrmi/airboardgame)** | MIT | JS | Generic board-game VTT — useful for the "any board game" token physics we don't want to reinvent. |

**Pattern that recurs:** *All* of them treat the map as the primary object you manipulate; everything else (sheets, pools, narrative) orbits it. Our recent map tab (Phase 1) puts us on the right side of this.

**License-safe assets from these repos:** MapTool's default token frames (Apache-2.0) and PlanarAlly's fog-of-war SVG helpers (MIT) are directly reusable. Foundry's art is not.

**Sources:** [MapTool](https://github.com/RPTools/maptool) · [PlanarAlly](https://github.com/Kruptein/PlanarAlly) · [Fari](https://github.com/farirpgs/fari-app) · [DungeonClub](https://github.com/doodlezucc/dungeonclub) · [MapTool vs Foundry vs PlanarAlly comparison](https://www.pistack.xyz/posts/2026-06-06-self-hosted-virtual-tabletop-rpg-maptool-foundryvtt-planarally)

---

## 3. Multi-Agent AI TTRPGs — The New Wave

The monolithic "one LLM call = the whole DM" is giving way to **crews of specialist agents** that talk to each other.

### 3.1 The canonical example — CrewAI + TTRPG

**[`SohamDeep2026/AI_Dungeon_Master`](https://github.com/SohamDeep2026/AI_Dungeon_Master)** is the closest public analog to what auto-dm wants to become:

```
Player Input → RetrieveMemory → GenerateResponse → SummarizeSession → StoreMemory
         each step = a CrewAI agent with its own role/backstory/tools
```

- 5 agents, each with *role, goal, backstory, tools* (CrewAI's core abstraction).
- **RetrieveMemory** = RAG over a vector store (past sessions, NPCs, lore).
- **GenerateResponse / NPC Actor** produces narrative, then **SummarizeSession** condenses.
- Built on **LangGraph** or a fallback sequential graph; Ollama (`qwen2.5:14b` local, Groq `llama-3.3-70b` cloud) is explicitly supported.
- Deployed on Streamlit in the demo — easy to run offline-first like us.

**Why it matters:** It proves the pipeline works on the *same models we already ship* (qwen2.5) and on free Groq. The vector-store + memory loop is the piece our current engine lacks — we store structured state (campaign memory ring buffer) but not semantic retrieval.

### 3.2 The simple end of the spectrum

**`omervaner/ai-dungeon-master`** — two tiny Python files, one for Groq, one for Ollama, pure system-prompt craft. Good for learning Ollama integration patterns (like our `core/src/ollama.rs`) but has no multi-agent structure or engine.

### 3.3 The UCSD "Talking DM" research

PEARLS Lab, UCSD — **"I Cast Detect Thoughts: Learning to Converse and Guide with Intents and Theory-of-Mind in D&D"** — models the DM as a *guiding* agent that keeps player personas consistent, tracks inter-character relationships, and steers toward a global goal while letting players be chaotic. Useful framing: the DM has *its own* hidden goal state, not just next-token prediction.

### 3.4 Frameworks that make this tractable (2026 landscape)

| Framework | Paradigm | Language | Why it fits TTRPG | Stars |
|---|---|---|---|---|
| **[CrewAI](https://github.com/crewAIInc/crewAI)** | Role-based crews | Python | Lowest barrier: `role/goal/backstory/tools` maps 1-to-1 to DM sub-roles. MIT. | 57k |
| **[LangGraph](https://github.com/langchain-ai/langgraph)** | Graph state machines | Py/JS | Best when you need durable state, branching, human-in-the-loop (combat turn order is a graph). | 25k |
| **[AutoGen](https://github.com/microsoft/autogen)** (now **Microsoft Agent Framework**) | Group-chat manager | Py/.NET | Richest conversation patterns (debate, critic, round-robin). Now maintenance-mode — avoid for new work. | 50k |
| **[Open Multi-Agent (OMA)](https://github.com/open-multi-agent/open-multi-agent)** | Dynamic DAG planner | TS | **TypeScript-native** — coordinator plans the task DAG at runtime on any LLM (Claude/ChatGPT/Gemini). Our Tauri frontend is already TS. | 6.8k |
| **[Agno (Phidata)](https://github.com/agno-agi/agno)** | Lightweight + RAG | Python | RAG + observability + agent UI in one package — good middle ground if CrewAI feels heavy. | growing |

**Recommendation for auto-dm:** Stay **offline-first and Rust+TypeScript-native**. That rules out CrewAI's Python sidecar for production. Two viable paths:

1. **Lightweight (recommended v1):** Keep single Ollama binary, add a Rust-native **sequential crew** — five `OllamaLlmBackend::complete_streaming` calls per DM turn with *different system prompts* (Narrator, Rules Arbiter, Lorekeeper, NPC Actor, Combat Director) and a shared `CampaignMemory` as the handoff artifact. No new dependency, runs on qwen2.5:7b + llama3.2 exactly as today. This is what the SohamDeep project *becomes* when stripped of Python.
2. **Heavier (later):** Adopt **LangGraph-JS** or **OMA (TS)** if we need parallel subtasks (e.g. three NPCs debating while combat resolves). Keep Python out of the release binary.

**Sources:** [SohamDeep AI_Dungeon_Master](https://github.com/SohamDeep2026/AI_Dungeon_Master) · [omervaner/ai-dungeon-master](https://github.com/omervaner/ai-dungeon-master) · [PEARLS D&D AI](https://pearls-lab.github.io/projects/aidnd/) · [CrewAI vs LangGraph vs AutoGen (OpenAgents, 2026)](https://openagents.org/blog/posts/2026-02-23-open-source-ai-agent-frameworks-compared) · [RunPod multi-agent orchestration guide](https://www.runpod.io/articles/guides/multi-agent-orchestration-and-architecture) · [OMA docs](https://github.com/open-multi-agent/open-multi-agent)

---

## 4. Concrete Proposal for Universal TTRPG

### 4.1 Immediate wins (no engine rewrite)

- **Semantic memory:** Add a `core/src/memory_vec.rs` companion to the existing `CampaignMemory` — same API, but embed the last N turns with a tiny local embedding model (or even TF-IDF to start) so `RetrieveMemory` actually does retrieval, not just ring-buffer truncation.
- **Prompt specialization:** Split `CAMPAIGN_GENERATION_PROMPT` / DM narrator prompt into 5 role prompts stored under `core/src/prompts/` (one file per agent). The current repair/salvage layer in `core/src/intent.rs` stays as the validator for the final `GameIntent` JSON.
- **Port a UX idea from Fari:** Session oracles shown as cards, not log lines — we already have an Oracle panel, but Fari's visual treatment is worth copying.

### 4.2 Multi-agent crew (Rust-native, sequential first)

```
crates/agents/
  narrator.rs      — atmosphere & pacing, never touches dice
  rules_arbiter.rs — calls engine::execute_attack, validates moves, enforces slots/concentration
  lorekeeper.rs    — reads/writes the vector memory + doom clocks/threads
  npc_actor.rs     — voices NPCs via per-NPC voice prompts (reuses PlayerPanel portraits)
  combat_director.rs — owns initiative, turn gating, encounter difficulty
```

Orchestrator (`engine/src/agents/mod.rs`) runs them in order per player input, passing a `CrewState { memory_slice, engine_snapshot, intent }` along. Each agent's output is appended to a shared transcript that becomes the final DM response. Streaming is preserved: Narrator streams tokens to the UI; other agents contribute short prefix blocks.

No Python, no Docker, no LangGraph dependency in v1 — just five system prompts + one shared-memory struct. Promote to LangGraph-JS/OMA later if we need fan-out.

### 4.3 Assets to import (license-safe)

- **PlanarAlly's** `wall.py` / `lighting.ts` helpers for the Phase 3 fog-of-war work (MIT — copy with attribution).
- **MapTool's** token-state SVGs (Apache-2.0) as alternate token frames — drop into `public/assets/tokens/frames/`.
- **Fari's** oracle/category icons (MIT) for our Ashworth tables.

### 4.4 Reuse checklist (next time you say "Execute")

- [ ] Scaffold `core/src/agents/` with the five role prompts + `orchestrator.rs` (sequential crew, offline-first)
- [ ] Add `core/src/memory_vec.rs` (tiny embedding + cosine KNN over `CampaignMemory`)
- [ ] Replace the single `DmPipeline::complete_streaming` call in `engine/src/agents/mod.rs` with the crew's handoff
- [ ] Keep the intent repair layer as the final validator — do not remove it
- [ ] Update `AGENTS.md` with the crew table and the new `core/src/prompts/` layout

---

*Study conducted 2026-08-25. Fantasy Grounds insights from its Unity docs (XML/Lua, CoreRPG, extensions, modules). Open-source VTT set from RPTools/PlanarAlly/Fari/DungeonClub + Pistack comparison. Multi-agent lineage from SohamDeep's CrewAI TTRPG, the PEARLS D&D guiding-DM paper, and the 2026 framework comparison (CrewAI/LangGraph/AutoGen/OMA). The recommendation is intentionally biased toward what runs on the models you already have pulled (`qwen2.5:7b`, `llama3.2`) in the binary you already ship.*
