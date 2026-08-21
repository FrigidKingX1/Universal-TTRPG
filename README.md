# Auto-DM

A universal TTRPG engine and autonomous Game Master desktop application.
Deterministic rules math in Rust (dice, Mythic-style oracle, combat) drives a
React + Zustand UI; a local Ollama LLM narrates outcomes (with a deterministic
stub fallback so the app always works offline).

![License](https://img.shields.io/badge/license-MIT-blue.svg)

## Architecture

```
core/          auto-dm-core — pure logic crate (no Tauri/sqlx deps)
  models.rs    system-agnostic JSON-schema-mirror types (character, action, stat block)
  dice.rs      expression parser/evaluator (1d20+kh, @path refs) on seeded ChaCha8Rng
  oracle.rs    Mythic-style Fate Check (Chaos Factor, Fate Chart, Meaning Tables)
  engine.rs    Combatant, execute_attack round-trip, damage/healing, initiative
  intent.rs    GameIntent parsing of constrained LLM output (JSON-schema guided)
  llm.rs       LlmBackend trait + deterministic StubLlmBackend + OllamaLlmBackend + DmPipeline
  memory.rs    CampaignMemory ring buffer for DM context
  ollama.rs    Ollama HTTP client (generate + tags endpoints)
src-tauri/     auto-dm — Tauri v2 shell
  src/db.rs    async sqlx SqlitePool (WAL), Repository trait, migrations
  src/commands.rs  async #[tauri::command]s + Tauri event emission
  src/lib.rs   app setup: app_data_dir, open_pool, run_migrations, manage AppState
src/           React 19 + Zustand
  store.ts     global store + Tauri event subscription (log:new, combat:outcome, …)
  components/  Scenes, Characters, Bestiary, Combat, Tools, CampaignWizard,
               NarrativeStream, PlayerCommandDeck, TacticalMatrix, ZoneMap,
               CommandPalette, SettingsPanel, and more
```

The DM loop (`DmPipeline`) runs a Fate Check for each player action, rolls a
Meaning on random events, then narrates via the configured `LlmBackend`.
LLM responses are parsed into structured `GameIntent`s (narration, dice roll,
NPC speech, scene delta, …) with graceful degradation to narration.

## Requirements

- **Ollama** running locally on port 11434 (`ollama serve`), with a model such
  as `llama3.2` pulled. The app attempts to start Ollama itself; if it is not
  available it falls back to the deterministic stub backend.
- Windows 10+ (NSIS installer target).

## Development

Prerequisites: Rust (stable, MSVC toolchain), Node 20+, VS 2022 Build Tools.

```bash
npm install
npm run tauri dev
```

Checks:

```bash
cargo test --workspace          # core + tauri tests
cargo clippy --workspace -- -D warnings
npx tsc --noEmit                # typecheck
npm test                        # vitest (store logic)
npm run build                   # tsc + vite build
```

On first launch the app seeds starter data into `campaign_data.db` (in the
OS app-data directory) when the vault is empty: a hero, a goblin, weapon
actions, and an opening scene.

## Launchers

- `launch-autodm.bat` — starts the built release exe; offers to build one if
  none exists (falls back to debug exe).
- `launch-autodm-silent.vbs` — same, without a console window. Never compiles.

## Versioning

Versions are synchronized across `package.json`, `src-tauri/tauri.conf.json`,
`src-tauri/Cargo.toml`, and `core/Cargo.toml`:

```bash
npm run bump -- 0.2.0
```

## Persistence

SQLite (WAL) via `sqlx::SqlitePool` behind the `Repository` trait, so an
encrypted `SQLCipher` backend can be swapped in later without touching domain
or UI code. Tables: `characters`, `action_definitions`, `stat_blocks`,
`campaign_scenes`, `log_entries`, `loot_entries`, `npc_notes`, `combat_state`,
`plot_threads`, `npc_characters`, `campaign_settings`, `doom_clocks`,
`exploration_zones`, `exploration_nodes`.

## Legal posture

Clean-room mechanics only. No proprietary game text is reproduced; the shipped
Meaning Tables use original wording, and sample data is SRD-aligned mechanics.

## License

MIT — see [LICENSE](LICENSE).
