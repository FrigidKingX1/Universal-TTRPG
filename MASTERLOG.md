# Auto-DM — TTRPG Masterlog

## Project Overview

Auto-DM is a desktop TTRPG (tabletop role-playing game) dungeon master assistant built with Tauri v2 + React/TypeScript. It combines a custom Rust core engine for dice, combat, oracles, and intent parsing with a local LLM backend (Ollama) for narrative generation.

**Status:** Active development — fully functional core loop, hosted multiplayer, multi-agent DM crew, and an MCP server surface. Tests: 172 Rust (130 core + 25 engine + 7 mcp + 5+5 server lib/bin) + 105 frontend ≈ 277 passing.

> **Note:** This log mixes historical design decisions with state snapshots.
> For the authoritative current state, prefer `git log` and `README.md`.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   React Frontend                     │
│  Zustand store · 6-tab UI · 10+ components           │
│  Characters · Bestiary · Combat · Scenes · Map ·     │
│  Tools · src/presets content library                 │
├─────────────────────────────────────────────────────┤
│              Tauri v2 Bridge (IPC)                    │
│  commands.rs — 40+ invoke commands                   │
│  crew-first DM resolve with pipeline fallback        │
│  lib.rs — Ollama lifecycle, panic hook, app init     │
├─────────────────────────────────────────────────────┤
│               Core Engine (Rust)                      │
│  dice.rs    — Expression parser, d20/d6/d100/etc     │
│  engine.rs  — Combat, HP, AC, slots, concentration   │
│  oracle.rs  — Mythic GM Emulator (Fate Chart + IE)   │
│  intent.rs  — GameIntent parser + campaign repair    │
│  llm.rs     — DmPipeline, LlmBackend trait           │
│  ollama.rs  — Ollama backend, model auto-fallback    │
│  memory.rs  — CampaignMemory ring buffer              │
│  memory_vec.rs — hybrid recall (TF-IDF + embeddings) │
│  vector_store.rs — sqlite-vec-shaped store            │
│  agents.rs  — five-role CrewOrchestrator              │
│  models.rs  — Profiles, StatBlocks, NPCs, zones       │
├─────────────────────────────────────────────────────┤
│         Engine Crate (auto-dm-engine)                 │
│  state.rs   — SqliteRepository, GameState, migrations│
│  session.rs — apply_session_effects, resolve, rewind │
│  combat.rs/events.rs/crew.rs/error.rs                │
├──────────────────────┬──────────────────────────────┤
│  Axum Multiplayer    │  MCP Server (stdio)           │
│  server/ — sessions, │  mcp-server/ — rmcp 3.x       │
│  WS events, resync,  │  11 deterministic tools:      │
│  map sync, preset    │  dice · oracle · intent ·     │
│  seeding (112 acts,  │  presets (112 actions,        │
│  376 monsters)       │  376 monsters) · lore_recall  │
└──────────────────────┴──────────────────────────────┘
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop shell | Tauri v2 |
| Frontend | React 19 + TypeScript + Vite |
| State | Zustand (single store) |
| Styling | Vanilla CSS (dark theme) |
| Core engine | Rust (auto_dm_core crate) |
| Persistence | SQLite via sqlx (async SqlitePool, WAL) |
| LLM backend | Ollama (local HTTP API) |
| Build | Cargo + npm |

---

## Source Tree

```
auto-dm/
├── core/src/
│   ├── dice.rs         — Dice expression parser & evaluator
│   ├── engine.rs       — Combat engine (attack, damage, slots, concentration)
│   ├── intent.rs       — GameIntent enum + LLM JSON parser + campaign repair
│   ├── llm.rs          — DmPipeline + LlmBackend trait
│   ├── memory.rs       — CampaignMemory ring buffer
│   ├── memory_vec.rs   — Hybrid recall: TF-IDF + optional nomic-embed-text cosine
│   ├── vector_store.rs — sqlite-vec-shaped VectorStore wrapper
│   ├── agents.rs       — CrewOrchestrator (5 roles, embedder-aware)
│   ├── prompts/*.md    — narrator/rules_arbiter/lorekeeper/npc_actor/combat_director
│   ├── models.rs       — CharacterProfile, EncounterStatBlock, NPCs, zones, clocks
│   ├── ollama.rs       — OllamaLlmBackend + resolve_effective_model
│   ├── oracle.rs       — Mythic Oracle (Fate Chart + Meaning Tables)
│   └── lib.rs          — crate re-exports
├── engine/src/
│   ├── state.rs        — SqliteRepository, GameState, open_pool/migrations
│   ├── session.rs      — apply_session_effects, entity resolution, rewind, idle clocks
│   ├── combat.rs       — Combatant conversion helpers
│   ├── events.rs       — GameEvent schema (+Healed, MapUpdated)
│   ├── crew.rs         — run_crew_turn bridge into engine state
│   └── error.rs        — DbError/EngineError
├── server/src/          — Axum hosted multiplayer (lib+bin)
│   ├── main.rs         — HTTP/WS routes incl. POST /sessions/{id}/map
│   ├── session.rs      — Session registry, broadcast, resync
│   ├── presets.rs      — Embedded 112 actions + 376 monsters, idempotent seeding
│   └── lib.rs          — preset re-exports for MCP
├── mcp-server/src/      — stdio MCP server (rmcp 3.1.4)
│   ├── lib.rs          — TtrpgMcpServer handler + run_stdio
│   ├── tools.rs        — 11-tool catalog + dispatch (pure/deterministic)
│   └── bin/mcp-server.rs
├── src-tauri/src/
│   ├── commands.rs     — 40+ Tauri invoke commands, crew-first DM path
│   ├── db.rs           — SQLite repository + AppState
│   ├── lib.rs          — App builder, Ollama lifecycle, panic hook
│   └── main.rs
├── src/                 — React frontend
│   ├── App.tsx / App.css / store.ts (~2200 lines) / backend.ts / types.ts
│   ├── commands.ts     — slash-command router
│   ├── assets.ts/sound.ts — portrait resolver, SFX playback
│   ├── presets/        — bestiary(376) actions(112) classes(36) equipment(216)
│   ├── multiplayer/    — client/store/types (WS sync, mapDragGuard)
│   ├── components/     — Characters Bestiary Combat Scenes MapPanel PlayerPanel …
│   └── __tests__/      — 105 Vitest tests across 8 suites
├── scripts/            — export_presets, gen_portraits/sfx/dice_sound, map_tokens
├── init-models.sh/.ps1 — pull llama3.2 + nomic-embed-text
├── MASTERLOG.md · AGENTS.md · README.md · ASSETS.md
└── Cargo.toml          — workspace: core, engine, server, src-tauri, mcp-server
```

---

## Commit History

| Hash | Message |
|------|---------|
| `8e2bf28` | P0: scaffold Tauri v2 + React/TS workspace |
| `286e5b4` | P1: core engine crate (models, dice, oracle, combat) |
| `623e0c3` | P2: data layer + commands (SQLite repo, CRUD, dice/oracle/combat) |
| `06313ec` | P3: frontend (Zustand store, Tauri event wiring, tabbed UI) |
| `18c9de2` | P4: LLM abstraction + StubLlmBackend (DmPipeline, dm_resolve) |
| `a7ee29e` | P5: seed defaults + README |
| `9da3d19` | feat(backend): integrate A.L.I.S.O.N. local LLM via ZMQ |
| `aeef7a0` | feat(backend): replace A.L.I.S.O.N. with Ollama (HTTP + JSON mode) |
| `77b3445` | Bugfix, QA, and QoL update (Round 1) |
| `0080a3b` | Bugfix, QA, and QoL upgrade (Round 2) |
| `414c6cf` | Flesh out frontend: full editors, HP bars, DM narrative panel |
| `32cfbc2` | Flesh out: history tracking, HP adjust, delete confirmations, tab badges |
| `5754717` | Flesh out: Ollama model selector, scene CF editing, DM auto-summary |
| `b139bc2` | Flesh out Round 6: combat tracker, quick rolls, DM suggestions |
| `d575335` | Flesh out Round 7: toast, combat conditions, clone monster, dice presets |
| `df3ef8d` | Flesh out Round 8: rest mechanic, remove combatant, HP roll, scene complete |
| `ce9afb2` | Flesh out Round 9: 13 Vitest tests, export/import, death saves, undo HP |
| `c357f25` | Flesh out Round 10: combat persistence, loot, NPC notes, keyboard shortcuts |
| `dd232a6` | Flesh out Round 11: SQLite persistence for loot/notes/combat, batch HP, loot tables, combat summary |
| `1d1ee88`+ | Layer 1-2: Plot Threads, NPC Characters, Oracle enrichment, Scene Tests, CF auto-adjust, Lines & Veils, Damage Types (see `git log`) |
| *(rounds…)* | Content presets (376 monsters / 36 classes / 112 actions / 216 gear), spell slots + concentration, heal path, bestiary search, hosted Axum multiplayer + map sync, campaign-JSON repair, Ollama model fallback, portraits/SFX/token pipeline, ESLint+CI, NSIS installer v0.1.0 — see `git log` |
| `300f34f` | feat: Phase 1 battle map — DOM board, spawnable tokens, initiative linkage |
| `2164cca` | feat(map): Phase 2 — live multiplayer sync, pick-image + grid size, persisted board |
| `067f784` | feat(lore): hybrid recall — TF-IDF baseline plus optional nomic-embed-text cosine |
| `c47a0c6` | feat(agents): five-role DM crew (narrator/rules/lore/npc/combat) wired through engine and tauri |
| `e65fa95` | feat(mcp): stdio MCP server exposing 11 deterministic engine tools (rmcp 3.x) |

---

## Recent Rounds — Multiplayer, Content, Crew, MCP

### Hosted Multiplayer (`server/`)
- Axum HTTP + WebSocket server; session registry with broadcast channels
- `GameEvent` protocol incl. `Healed`, `MapUpdated`; full-state resync hydration (incl. map tokens/background)
- `POST /sessions/{id}/map` for battle-map pushes; client `mapDragGuard` suppresses echo of own drags
- Preset seeding embedded in the binary: 112 actions + 376 monsters, idempotent, name-aware (host imports win)
- Server split into lib + bin so MCP reuses the preset library

### Content Library (`src/presets/`)
- **376 monsters** via compact `qm()` builder with CR-tiered auto-loot and per-type nature traits
- **36 classes** (12 core + 24 expanded), each 5 features + pool unlocks; dual-classing via `mergeSecondaryClass()` + `growPoolsOnLevelUp`
- **~112 actions** with `slot_cost` tiers (l1/l2/l3), concentration set, monster attacks, class actions
- **~216 equipment** items across 6 categories; character-sheet datalist + weight autofill
- Export pipeline TS→JSON drift-guarded by Vitest + Rust tests both sides

### Rules Depth
- **Spell slots**: tiered pools, slot-gated attacks in store + Combat UI, rest recharge, level-up growth
- **Concentration**: single-instance rule, CON saves on damage, defeat/voluntary drop, combat badge
- **Healing**: `SuccessOutcome.heal` → engine `apply_healing` → `GameEvent::Healed`

### Battle Map
- Phase 1: DOM board, spawn/drag/remove tokens, initiative gold ring, grid size slider, background picker
- Phase 2: live multiplayer sync via MapUpdated events + resync, Tauri native image dialog

### Asset Pipeline
- `gen_portraits.mjs` — pure-Node PNG writer: 376 heraldic sigils + 36 class crests
- `gen_sfx.mjs`/`gen_dice_sound.mjs` — RIFF/PCM16 WAVs (dice, hit, miss, heal chime)
- `map_tokens.mjs` — batch art-pack matcher (slugify/noise-strip/precedence), unit-tested

### LLM Hardening
- Campaign JSON repair: fence stripping, truncation salvaging mid-string/mid-array, payload unwrap, key aliases
- Ollama 404s surface response body; `resolve_effective_model` auto-falls back to first installed model
- num_predict budget doubled to 8192 for campaign generation

### Multi-Agent Crew (`core/src/agents.rs` + `engine/src/crew.rs`)
- Five roles with compile-time prompts in `core/prompts/*.md`: Narrator, Rules Arbiter, Lorekeeper, NPC Actor, Combat Director
- Sequential handoff via `CrewState` (intent theory-of-mind field survives to Narrator)
- Lorekeeper runs deterministic recall (0 LLM calls); Combat Director only speaks when combat active
- Wired into src-tauri resolve path crew-first with single-pipeline fallback

### Hybrid Recall (`core/src/memory_vec.rs`)
- Sync TF-IDF `hybrid_recall(query, docs, k)` — signature stable, offline default
- `hybrid_recall_async` blends `0.7·cosine(nomic-embed-text) + 0.3·TF-IDF` via `Embedder` trait
  - `OllamaEmbedder` (`/api/embeddings`, configurable URL/model) + deterministic `StubEmbedder` for CI
  - Auto-fallback to TF-IDF when Ollama is down or the model isn't pulled
- `VectorStore` = sqlite-vec-shaped insert/search wrapper ready for extension swap-in
- Lorekeeper flipped to async hybrid (`CrewOrchestrator::new` defaults Ollama, `with_embedder` for tests)

### MCP Server (`mcp-server/`)
- rmcp **3.1.4**, stdio transport, stateless `TtrpgMcpServer`
- **11 tools**: roll_dice · oracle_fate_check · oracle_random_event · scene_test · parse_intent ·
  repair_campaign_json · campaign_json_schema · list_preset_actions · get_preset_action ·
  get_preset_monster · lore_recall
- Live-tested: initialize handshake ✓, tools/list ✓, `4d6kh3+2 → kept [4,2,1], total 9` ✓
- Binary: `target/debug/mcp-server.exe`
- **rmcp 3.x gotchas** (also in AGENTS.md):
  - feature is `transport-io` (not `-stdio`); error type is `ErrorData`
  - `call_tool` must return `CallToolResponse` (`.into()` from `CallToolResult`)
  - tool schemas are `Arc<JsonObject>` — wrap json! via the `schema()` helper
  - `#[non_exhaustive]` structs: build via `Default` + mutation, not literals
  - per-request calls need `_meta` carrying protocolVersion + clientCapabilities

### Ops
- `init-models.sh` / `init-models.ps1` pull `llama3.2` + `nomic-embed-text`
- CI: frontend lint+vitest job, Rust `cargo test --workspace` job
- Installer v0.1.0 published on GitHub Releases (updater plugin removed to fix startup panic)

---

## Core Engine Tests

109 tests total: 79 in Rust (75 core + 4 integration) + 30 frontend (Vitest). All pass clean.

```
dice::tests          — 13 tests (expressions, refs, parens, caps, edge cases, loot formulas)
engine::tests        — 17 tests (combat, healing, initiative, prerequisites, loot tables, damage types, resistance/vulnerability/immunity)
intent::tests        — 5 tests (parser, degradation, stripped JSON)
llm::tests           — 9 tests (pipeline, DC clamping, stub backend)
memory::tests        — 4 tests (ring buffer, context generation)
oracle::tests        — 14 tests (fate chart, IE, chaos adjustment, scene tests, enriched events)
models::tests        — 5 tests (thread serialization, NPC defaults, disposition labels)
db::tests            — 4 tests (migrations, CRUD, threads + NPC characters, settings CRUD)
```

### Frontend Tests (30)
- Characters, Bestiary, Combat, Scenes, Tools components
- Store: combat persistence, loot CRUD, NPC notes, character cloning
- Plot Threads: add, resolve, abandon, delete
- NPC Characters: add, update disposition, mark dead, add knowledge, delete
- num_predict clamping, multi-condition toggling, tab switching

---

## Feature Inventory

### Dice Engine (`core/src/dice.rs`)
- Full expression parser: `2d6+3`, `4d6kh3`, `2d20kh1` (advantage), `2d20kl1` (disadvantage)
- Supports: `+`, `-`, `*`, `/`, `()` parentheses, unary negation
- Variable references: `@attributes.STR.derived_modifier`
- Division-by-zero guard, dice count cap (100), max sides cap (1000)

### Combat Engine (`core/src/engine.rs`)
- Attack resolution: d20 + modifier vs target AC
- Damage: formula-based (e.g., `1d6+2`)
- **Damage Types**: 12 types (Slashing, Piercing, Bludgeoning, Fire, Cold, Lightning, Poison, Psychic, Necrotic, Radiant, Force, Thunder)
- **Resistance/Vulnerability/Immunity**: targets take half / double / zero damage per type
- Healing: clamped to max HP
- Prerequisite checks before actions (skill checks with DC)
- Status effects: Poisoned, Stunned, Frightened, etc.
- Initiative: d20 + modifier per combatant, sorted descending
- Loot tables: per-encounter loot with formula-based quantities and chance percentages

### Oracle (`core/src/oracle.rs`)
- Mythic GM Emulator Fate Chart (10 odds levels)
- Random Event generation (doubles below chaos factor)
- Chaos Factor: 1-9 scale
- Exceptional results (Yes+ or No-)
- 73 Action words + 61 Subject words for event meaning tables
- **Threads/Characters List integration** — EnrichedEvent references open threads and known NPCs
- **Scene Test** — d10 vs CF: AsExpected / Altered / Interrupted
- **OracleContext** — lightweight thread/NPC references for Random Event enrichment

### Intent Parser (`core/src/intent.rs`)
- Parses LLM JSON responses into 7 intent types:
  - Narration, SceneDelta, NpcSpeech, DiceRoll, RuleCheck, FateQuestion, Ooc
- Handles malformed JSON, code fences, missing fields
- Graceful degradation to Narration on parse failure

### LLM Pipeline (`core/src/llm.rs` + `core/src/ollama.rs`)
- `DmPipeline`: orchestrates memory → LLM → intent → fate → narrative
- `LlmBackend` trait: pluggable backends
- `OllamaLlmBackend`: HTTP client for local Ollama API
  - Structured JSON output mode (response_format)
  - Configurable model (switchable at runtime)
  - `num_predict: 512` default, configurable via UI (128-2048)
  - `reachable()` health check
- **Lines & Veils**: safety settings injected into DM system prompt
  - Lines = hard bans (never generate these topics)
  - Veils = fade to black (implied off-screen, never depicted)

### Memory (`core/src/memory.rs`)
- Ring buffer of recent events (default: 40 entries)
- `to_context()` for LLM prompt injection
- Speaker + content timestamps

### Layer 2 — Oracle Coherence & Safety
- **Scene Test UI**: "Scene Test (d10 vs CF)" button on active scene, shows AsExpected/Altered/Interrupted
- **Random Event integration**: Altered/Interrupted outcomes auto-roll a Random Event using threads/NPCs as context
- **Chaos Factor auto-adjust**: Complete scene → prompt "favor" or "against" → CF ±1 (capped 1-9)
- **Lines & Veils safety**: UI panel in Tools tab for managing hard bans and fade-to-black topics
- **Lines & Veils injection**: Automatically injected into DM pipeline system prompt
- **Damage Types**: 12 standard d20 types with Display, parse, serde support
- **Combat damage modifiers**: Resistance (half), Vulnerability (double), Immunity (zero) applied per attack
- **EngineOutcome enrichment**: New `damage_type` and `damage_modifier` fields for frontend display

### Layer 3 — Doom Clocks
- **DoomClock model**: Tick-based countdown clock (current/max/consequence/active) with tick, advance, reset methods
- **SQLite persistence**: `doom_clocks` table with tick_current, tick_max, consequence, scene_id, active, created_at
- **Repository CRUD**: save, list, tick, advance, reset, delete operations via SqliteRepository
- **6 Tauri commands**: create_doom_clock, list_doom_clocks, tick_doom_clock, advance_doom_clock, reset_doom_clock, delete_doom_clock
- **Frontend**: DoomClock type, backend wrappers, Zustand store actions, DoomClocksPanel UI with add/tick/advance/reset/delete
- **5 model tests**: tick countdown, multi-tick advance, reset, inactive no-tick, serialization roundtrip
- **1 DB test**: full CRUD lifecycle (create → list → tick → tick → advance → reset → list → delete)
- **Column naming**: tick_current/tick_max to avoid SQLite reserved keyword conflicts

### Layer 4 — NPC Memory Enhancement
- **NpcKnowledge struct**: structured knowledge entries with `text`, `scene_id`, `timestamp` fields
- **Backward compat deserializer**: `deserialize_knows()` auto-converts old `["string"]` format to new structured format
- **Auto-tagging**: `addNpcKnowledge` automatically tags with active scene ID and ISO timestamp
- **Remove knowledge**: new `removeNpcKnowledge` action + UI button per entry
- **Frontend rendering**: knowledge badges show scene name + date, with per-entry delete button
- **2 model tests**: legacy format deserialization, structured format roundtrip

### Layer 5 — Exploration Zones & Nodes
- **ExplorationZone model**: hex/point/dungeon zone types with name, description, danger_level, mapped flag
- **ExplorationNode model**: locations within zones with discovered/safe flags, connections, contents, notes
- **ZoneType enum**: `from_str_opt()` and `Display` trait
- **SQLite persistence**: `exploration_zones` and `exploration_nodes` tables
- **Repository CRUD**: save, list, delete zones; save, list, update, delete nodes (cascading deletes)
- **7 Tauri commands**: create/list/delete zones, create/list/update/delete nodes
- **Frontend**: ZoneType enum, ExplorationZone/Node types, backend wrappers, Zustand store with activeZoneId
- **ExplorationPanel UI**: zone list with expand/collapse, node CRUD, discover/edit/delete, contents/notes editor
- **3 model tests**: ZoneType parse/display, zone roundtrip, node roundtrip
- **1 DB test**: full zone+node CRUD lifecycle with cascade delete

### Layer 6 — Expedition & Travel
- **Expedition state**: currentNodeId + travelLog tracking party position through exploration zones
- **startExpedition**: begin at a node, initialize travel log
- **travelToNode**: move to adjacent node (validates connections), auto-discovers target
- **Random encounter check**: d10 roll vs zone danger level on each move
- **endExpedition**: log travel summary to session log, clear state
- **Travel UI**: trail breadcrumb display, Travel Here buttons on connected nodes, Start/End expedition
- **Connection editor**: checkbox grid in node edit form to set connected nodes

### Bugfix, QA & QoL Pass
**Combat HP fixes:**
- Added `getMaxHp()` returning entity's maximum HP; `hpInfo` now uses it instead of current HP as max
- `quickHpAdjust` now updates `combatantStates` in-memory (was saving to backend only, causing stale UI)
- Combat summary shows counts ("3 hits, 1 defeated") instead of literal "target" strings

**State management fixes:**
- `longRest`/`shortRest` now read latest `combatantStates` from store each iteration (was using stale snapshot, only last character updated)
- `completeScene` now updates `scenes` array in state after CF adjustment (badge was stale)
- `undoLastHpChange` now calls `persistCombat()` (was not persisting to SQLite)
- `endCombat` now clears `deathSaves` (was carrying over between encounters)
- `removeCombatant` now clears entity's `deathSaves` entry (was orphaned)

**Event & toast fixes:**
- `combat:outcome` and `combatant:state` event listeners now call `persistCombat()` (was losing state on restart)
- Toast race condition fixed: timeout only clears toast if current toast matches the one that was scheduled

**UI/UX fixes:**
- DoomClock buttons relabeled to "Advance 1" / "Advance 5" (was confusing "+1"/"-1" for a countdown)
- NPC location/notes onBlur now checks `expandedId` matches NPC (was saving wrong NPC's data on switch)
- Exploration node contents/notes onBlur now checks `expandedNodeId` (same shared-state fix)
- `SceneCfEditor` now syncs with prop changes via `useEffect` (was stale on external update)
- `SceneSummaryEditor`/`SceneCfEditor` now update store's `scenes` array on save
- Initiative roll shows toast "Need at least 2 combatants" instead of silently doing nothing
- Death save buttons only shown for player characters (not stat blocks)
- `addNpcCharacter` now correctly parses legacy `string[]` knows into `NpcKnowledge[]` format

### Production Readiness (Items 1-5)
- **WAL mode** already enabled via `SqliteJournalMode::Wal`; added `PRAGMA synchronous = NORMAL` for safe-fast pairing
- **Pre-migration backup** via `backup_before_migrate()` — snapshots DB before schema changes
- **`tauri-plugin-single-instance`** — prevents multi-process SQLite corruption; focuses existing window on re-launch
- **`tauri-plugin-log`** — rotating diagnostic logs to `$LOCALAPPDATA` + stdout; replaces all `println!` in lib.rs
- **Rust panic hook** — logs `CRITICAL PANIC` with file/line/column to diagnostic log before process exit
- **CSP lockdown** — `connect-src` scoped to `'self'` + Ollama loopback (`127.0.0.1:11434`, `localhost:11434`)
- **NSIS installer** — `webviewInstallMode: downloadBootstrapper` ensures WebView2 is fetched if missing
- **Capabilities audit** — `default.json` grants `core:default`, `opener:default`, `log:default` only
- **Window size** — 1280x800 default (was 800x600)
- **Bundle targets** — narrowed from `"all"` to `["nsis"]`

### UX Polish
- **Native file dialogs** — Export/Import Campaign and Session Summary now use OS-native save/open dialogs via `@tauri-apps/plugin-dialog` + `@tauri-apps/plugin-fs` (replaced web-style Blob/download/input)
- **Window state persistence** — `tauri-plugin-window-state` remembers window size/position across launches
- **Settings store** — `tauri-plugin-store` available for future key-value persistence
- **Version bump script** — `scripts/bump-version.cjs` synchronizes version across `package.json`, `Cargo.toml`, and `tauri.conf.json` in one command

### Remaining Bugfix Pass
- **setActiveZone race condition** — staleness check prevents zone A's nodes overwriting zone B's when switching rapidly
- **LinesVeilPanel save ordering** — sequence counter prevents out-of-order saves from rapid add/remove clicks
- **CharacterSheet state desync** — `useEffect` syncs local editor state when profile updates externally (combat HP, long rest)

---

## UI Overhaul & Launcher Shortcut

### Launcher Shortcut
- **launch-autodm.bat** — Sets up Rust/Cargo path and invokes `npm run tauri dev`
- **launch-autodm-silent.vbs** — Silent launcher (no console window); double-click to start
- User can pin shortcut to Start Menu/Taskbar for one-click launching

### Modern Sidebar Navigation (App.tsx)
- Replaced top-tab navigation with collapsible sidebar (240px / 60px)
- **Ctrl+B** toggles sidebar collapse state
- **Keyboard shortcuts**: 1-5 switch sections, Esc dismisses errors
- Sidebar footer shows Ollama connectivity status (online/offline dot indicator)
- Top bar displays active scene badge (#number, title, CF)
- Settings icon button in top-right corner

### Modern Dark Theme (App.css)
- Complete color palette redesign with CSS variables:
  - `--bg: #0a0b0f` — deeper background
  - `--panel: #14161a` — slightly lighter for panels
  - `--sidebar-bg: #0f1115` — distinct sidebar background
  - Added accent hover states, shadow variables, transition timing
- App shell layout: fixed sidebar + scrollable main content
- Top bar with blur backdrop effect and sticky positioning
- Enhanced button styling: hover scale effect, focus rings, consistent transitions
- Improved panel styling: subtle hover border transitions
- Redesigned toast notifications with smoother animations
- Status dot indicator (green pulse for online, gray for offline)
- Keyboard shortcut hints in sidebar footer
- Font family tokens for monospace and sans-serif

---

## Frontend Features

### Characters Tab
- Full stat editor (STR/DEX/CON/INT/WIS/CHA with derived modifiers)
- HP management (current, max, temp)
- Inventory list with equipped/weight/tags
- Ability selection (linked to Actions)
- Quick attribute rolls (d20 + modifier per attribute)
- HP bar in card list view

### Bestiary Tab
- Full stat block editor (name, CR, size, type, alignment, AC, HP, speed)
- HP formula field with **Roll HP** button (rolls dice and applies result)
- Attribute editing (STR/DEX/CON/INT/WIS/CHA)
- Action assignment (linked to Actions from Characters tab)
- Clone button (copies with fresh HP)
- HP bar in card list view
- **Loot table editor**: per-monster loot entries (name, qty formula, chance %)

### Combat Tab
- **Initiative tracker**: roll initiative, sorted order
- **Turn tracker**: Round counter, current turn highlight, Next Turn button
- **Combat roster**: Grid of combatant cards with:
  - Initiative badge (#1, #2, etc.)
  - AC display
  - HP bar with color coding (healthy/wounded/critical/dead)
  - Quick HP adjust buttons (-5, -1, +1, +5)
  - Custom HP input (any amount)
  - **Condition system**: 8 toggleable conditions with tooltips
  - **Remove button** (individual combatant removal)
- **Attack system**: Attacker → Target → Action selection with filtered actions
- **HP Undo**: Undo last HP change on any combatant
- **Batch HP adjust**: Multi-select targets, apply damage/heal to all at once
- **Rest mechanic**: Short Rest (half HP) and Long Rest (full HP) buttons
- **Loot distribution**: Add items, assign to characters, full tracking
- **Combat summary**: Modal after fight ends (damage dealt, targets hit, defeated)
- **Mini combat log**: toggleable, newest first
- **Combat persistence**: SQLite-backed (initiative, HP, conditions, death saves survive restart)

### Scenes Tab
- Scene CRUD (create with title + chaos factor)
- **Summary editor**: textarea for scene description
- **CF editor**: adjustable chaos factor (1-9)
- **Scene preview**: truncated summary on inactive scenes
- **Complete Scene**: logs summary, marks done
- Active scene badge
- **Scene Test roller**: d10 vs CF, shows AsExpected/Altered/Interrupted
- **Plot Threads panel**: add/resolve/abandon threads per scene
- **NPC Characters panel**: add/track NPCs with disposition and knowledge
- **Doom Clocks panel**: add/tick/advance/reset/delete countdown clocks

### Tools Tab
- **Ollama Status**: online/offline indicator, model selector dropdown
- **DM Panel**: text input with suggestion chips (8 quick actions)
  - Auto-updates scene summary after each resolution
  - Displays narrative, fate result, mechanical events
  - DM response history
- **Dice Roller**: expression input, 11 presets (d4-d100, advantage, disadvantage)
- **Oracle Panel**: fate check (10 odds levels), random event
  - Collapsible meaning table reference (73 actions + 61 subjects)
  - Fate and event history
- **NPC Notes Panel**: Per-scene NPC relationship tracking
  - Add notes with categorized relations (Ally/Enemy/Neutral/Contact/Rival/Boss/Informant/Questgiver/Unknown)
  - Grouped by NPC name, delete individual notes
- **Session Summary**: Markdown digest of current scene logs
- **Export/Import**: Full campaign JSON with characters, bestiary, scenes, logs, loot, and notes
- **Session Log**: chronological log with:
  - Speaker color coding (player/combat/narrator/DM)
  - Search/filter by content or speaker
  - Match count
  - Auto-scroll to bottom

### Global Features
- **Toast notifications**: auto-fading feedback on actions (2.5s)
- **Tab badges**: count indicators on Scenes, Characters, Bestiary, Tools
- **Error banner**: dismissible error display
- **Dark theme**: custom CSS with accent colors
- **Keyboard shortcuts**: 1-5 switch tabs, Esc dismisses errors
- **Character duplication**: Clone button on character cards

---

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| LLM Backend | Ollama (local) | Privacy, no API keys, works offline |
| State Management | Zustand (single store) | Simple, no boilerplate, great devtools |
| Persistence | SQLite via sqlx | Async, compile-time-checked queries, WAL |
| Mutex Type | `tokio::sync::Mutex` for DM | Allows holding guard across `.await` |
| DC Resolution | LLM-specified | More flexible than static DCs |
| Target | Single EXE | Simplest distribution |
| Memory | Ring buffer (40 entries) | Bounded context, no disk bloat |

---

## Build Commands

```bash
# Rust build + test
set PATH=C:\Users\dgc12\.cargo\bin;%PATH%
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvarsall.bat" x64
cargo test --workspace
cargo clippy --workspace -- -D warnings
cargo fmt

# Frontend
npx tsc --noEmit
npx vite build
```

---

## File Statistics

| Category | Files | Lines (approx) |
|----------|-------|-----------------|
| Core engine (Rust) | 9 | ~1,800 |
| Tauri backend (Rust) | 4 | ~1,350 |
| Frontend (TS/TSX) | 10 | ~3,000 |
| CSS | 1 | ~1,000 |
| **Total source** | **24** | **~7,150** |

---

## Current State (as of latest commit `e65fa95`)

- **172 Rust tests** (130 core incl. agents/memory_vec/vector_store · 25 engine incl. crew · 7 mcp · 5+5 server lib/bin) + **105 frontend** ≈ 277 passing
- Clippy clean; `npm run lint` clean; TS + Vite build clean
- All core gameplay loops functional:
  - Create scenes → populate characters/monsters → run combat → rest → complete scenes
  - Oracle fate checks and random events
  - DM narrative resolution via Ollama (or stub)
  - Session logging with search
  - Full stat management for characters and monsters
  - Combat state persistence via SQLite (initiative, HP, conditions, death saves)
  - Loot distribution with assignment tracking
  - NPC relationship notes per scene
  - Monster loot table rolling on defeat
  - Batch HP adjust with multi-select
  - Combat summary modal after fight ends
  - Configurable num_predict dropdown
  - Character duplication (clone)
  - Keyboard shortcuts (1-5 tabs, Esc dismiss)
  - Export/Import campaign (JSON with loot + notes)
  - Session summary generator
  - **Plot Threads list** (Mythic Oracle — open/resolve/abandon)
  - **NPC Characters list** (disposition, knowledge, location tracking)
  - **Oracle enrichment** (Random Events reference Threads and Characters)
  - **Scene Tests** (Mythic scene-open test based on Chaos Factor)
  - **Chaos Factor auto-adjust** (favor/against after scene completion)
  - **Lines & Veils safety** (hard bans + fade-to-black, injected into DM prompt)
  - **Damage Types** (12 types, resistance/vulnerability/immunity modifiers)
- **Modern sidebar UI** — collapsible navigation with keyboard shortcuts (1-5, Esc, Ctrl+B)
- **Launcher shortcut** — .bat + .vbs for one-click app launching
- **Modern dark theme** — redesigned color palette with acrylic sidebar and top bar
  - **Doom Clocks** (tick-based countdown with tick/advance/reset/delete, SQLite-persisted)
- **Content library** — 376 monsters · 36 classes · ~112 actions · ~216 equipment (clean-room)
- **Spell slots + concentration** — tiered pools, slot-gated attacks, CON saves, single-instance rule
- **Hosted multiplayer** — Axum sessions over WebSocket, resync, live battle-map sync
- **Battle map** — DOM tokens, drag, grid/background picker, initiative ring, multiplayer push
- **Multi-agent DM crew** — 5 specialist roles, deterministic Lorekeeper recall, crew-first resolve
- **Hybrid lore recall** — TF-IDF baseline with optional `nomic-embed-text` cosine blend
- **MCP server** — 11 deterministic tools over stdio; any MCP client can drive the engine

### Next Up
1. Stateful MCP tools — async bridge over GameState/SqliteRepository (~10 more tools: apply_session_effects, combat CRUD, NPC/thread persistence). Verified signatures: `remember(&GameState,…)` async, `count_idle_trail(&[LogEntry])`, `tick_idle_clocks(&GameState,&str)`.
2. Claude Desktop / Cursor config snippet for the shipped MCP binary.
3. `systems/test_config.json` parametrized combat harness per system pack.
4. sqlite-vec swap-in behind `VectorStore`.
