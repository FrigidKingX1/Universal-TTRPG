# Auto-DM — TTRPG Masterlog

## Project Overview

Auto-DM is a desktop TTRPG (tabletop role-playing game) dungeon master assistant built with Tauri v2 + React/TypeScript. It combines a custom Rust core engine for dice, combat, oracles, and intent parsing with a local LLM backend (Ollama) for narrative generation.

**Status:** Active development — 16 commits, 56 passing tests, fully functional core loop.

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   React Frontend                     │
│  Zustand store · 5-tab UI · 8 components             │
│  Characters · Bestiary · Combat · Scenes · Tools     │
├─────────────────────────────────────────────────────┤
│              Tauri v2 Bridge (IPC)                    │
│  commands.rs — 15+ invoke commands                    │
│  db.rs — SQLite persistence (AppState)               │
│  lib.rs — Ollama lifecycle, app init                  │
├─────────────────────────────────────────────────────┤
│               Core Engine (Rust)                      │
│  dice.rs    — Expression parser, d20/d6/d100/etc     │
│  engine.rs  — Combat engine, HP, AC, prerequisites   │
│  oracle.rs  — Mythic GM Emulator (Fate Chart + IE)   │
│  intent.rs  — GameIntent parser (7 intent types)     │
│  llm.rs     — DmPipeline, LlmBackend trait           │
│  ollama.rs  — OllamaLlmBackend (HTTP + JSON mode)    │
│  memory.rs  — CampaignMemory ring buffer              │
│  models.rs  — CharacterProfile, EncounterStatBlock    │
└─────────────────────────────────────────────────────┘
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
| Persistence | SQLite via rusqlite |
| LLM backend | Ollama (local HTTP API) |
| Build | Cargo + npm |

---

## Source Tree

```
auto-dm/
├── core/src/
│   ├── dice.rs         — Dice expression parser & evaluator
│   ├── engine.rs       — Combat engine (attack, damage, initiative)
│   ├── intent.rs       — GameIntent enum + LLM JSON parser
│   ├── llm.rs          — DmPipeline + LlmBackend trait
│   ├── memory.rs       — CampaignMemory ring buffer
│   ├── models.rs       — CharacterProfile, EncounterStatBlock
│   ├── ollama.rs       — OllamaLlmBackend (HTTP client)
│   ├── oracle.rs       — Mythic Oracle (Fate Chart + Meaning Tables)
│   └── lib.rs          — crate re-exports
├── src-tauri/src/
│   ├── commands.rs     — 15+ Tauri invoke commands
│   ├── db.rs           — SQLite repository + AppState
│   ├── lib.rs          — App builder, Ollama lifecycle
│   └── main.rs         — entry point
├── src/
│   ├── App.tsx          — Tab layout, toast, badges
│   ├── App.css          — All styles (dark theme)
│   ├── store.ts         — Zustand store (40+ state fields)
│   ├── backend.ts       — Tauri invoke wrappers
│   ├── types.ts         — TypeScript type mirrors
│   └── components/
│       ├── Characters.tsx — Character list, editors, quick rolls
│       ├── Bestiary.tsx   — Monster list, stat block editor, clone
│       ├── Combat.tsx     — Turn tracker, HP, conditions, rests
│       ├── Scenes.tsx     — Scene CRUD, summary, CF editing
│       └── Tools.tsx      — Dice roller, Oracle, DM panel, Logs
├── Cargo.toml           — Workspace root
├── core/Cargo.toml      — Core engine crate
└── package.json         — Frontend dependencies
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

---

## Core Engine Tests

56 tests total: 54 in core modules + 2 integration tests in db.rs. All pass clean.

```
dice::tests          — 11 tests (expressions, refs, parens, caps, edge cases)
engine::tests        — 9 tests (combat, healing, initiative, prerequisites)
intent::tests        — 5 tests (narration, dice, NPC speech, garbage input)
intent::stripped_json — 4 tests (code fences, empty input)
llm::tests           — 9 tests (pipeline, dice roll DC, DC clamping, events, stub)
memory::tests        — 4 tests (ring buffer, context, zero max)
oracle::tests        — 10 tests (fate chart, chaos, events, meaning table)
db::tests            — 2 tests (migrations, CRUD)
```

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
- Healing: clamped to max HP
- Prerequisite checks before actions (skill checks with DC)
- Status effects: Poisoned, Stunned, Frightened, etc.
- Initiative: d20 + modifier per combatant, sorted descending

### Oracle (`core/src/oracle.rs`)
- Mythic GM Emulator Fate Chart (10 odds levels)
- Random Event generation (doubles below chaos factor)
- Chaos Factor: 1-9 scale
- Exceptional results (Yes+ or No-)
- 73 Action words + 61 Subject words for event meaning tables

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
  - `num_predict: 256` for fast responses
  - `reachable()` health check

### Memory (`core/src/memory.rs`)
- Ring buffer of recent events (default: 40 entries)
- `to_context()` for LLM prompt injection
- Speaker + content timestamps

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
- **Rest mechanic**: Short Rest (half HP) and Long Rest (full HP) buttons
- **Mini combat log**: toggleable, newest first

### Scenes Tab
- Scene CRUD (create with title + chaos factor)
- **Summary editor**: textarea for scene description
- **CF editor**: adjustable chaos factor (1-9)
- **Scene preview**: truncated summary on inactive scenes
- **Complete Scene**: logs summary, marks done
- Active scene badge

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

---

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| LLM Backend | Ollama (local) | Privacy, no API keys, works offline |
| State Management | Zustand (single store) | Simple, no boilerplate, great devtools |
| Persistence | SQLite via rusqlite | Zero-config, single-file, proven |
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
| Core engine (Rust) | 9 | ~1,400 |
| Tauri backend (Rust) | 4 | ~700 |
| Frontend (TS/TSX) | 10 | ~2,000 |
| CSS | 1 | ~900 |
| **Total source** | **24** | **~5,000** |

---

## Current State (as of df3ef8d)

- 56 tests passing (54 core + 2 integration)
- Clippy clean (zero warnings)
- TS + Vite build clean
- All core gameplay loops functional:
  - Create scenes → populate characters/monsters → run combat → rest → complete scenes
  - Oracle fate checks and random events
  - DM narrative resolution via Ollama (or stub)
  - Session logging with search
  - Full stat management for characters and monsters
