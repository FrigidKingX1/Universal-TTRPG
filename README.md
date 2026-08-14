# Auto-DM

A universal TTRPG engine and autonomous Game Master desktop application.
Deterministic rules math in Rust (dice, Mythic-style oracle, combat) drives a
React + Zustand UI; a swappable LLM backend narrates outcomes.

## Architecture

```
core/          auto-dm-core — pure logic crate (no Tauri/sqlx deps)
  models.rs    system-agnostic JSON-schema-mirror types (character, action, stat block)
  dice.rs      expression parser/evaluator (1d20+kh, @path refs) on seeded ChaCha8Rng
  oracle.rs    Mythic-style Fate Check (Chaos Factor, Fate Chart, Meaning Tables)
  engine.rs    Combatant, execute_attack round-trip, damage/healing, initiative
  llm.rs       LlmBackend trait + deterministic StubLlmBackend + DmPipeline
src-tauri/     auto-dm — Tauri v2 shell
  src/db.rs    async sqlx SqlitePool (WAL), Repository trait, migrations, Scene/LogEntry
  src/commands.rs  async #[tauri::command]s + Tauri event emission
  src/lib.rs   app setup: app_data_dir, open_pool, run_migrations, manage AppState
src/           React 19 + Zustand
  store.ts     global store + Tauri event subscription (log:new, combat:outcome, …)
  components/  Scenes, Characters, Bestiary, Combat, Tools (DM panel / dice / oracle / log)
```

The DM loop (`DmPipeline`) runs a Fate Check for each player action, rolls a
Meaning on random events, then narrates via the configured `LlmBackend`
(`StubLlmBackend` for the MVP; real backends such as mistral.rs/Candle can be
added behind the trait without touching pipeline code).

## Legal posture

Clean-room mechanics only. No proprietary game text is reproduced; the shipped
Meaning Tables use original wording, and sample data is SRD-aligned mechanics.

## Development

Prerequisites: Rust (stable, MSVC toolchain), Node 20+, VS 2022 Build Tools.

```bash
npm install
npm run tauri dev
```

Checks:

```bash
cargo test --workspace          # 32 unit/integration tests
cargo clippy --workspace --all-targets
npm run build                   # tsc + vite build
```

On first launch the app seeds starter data into `campaign_data.db` (in the
OS app-data directory) when the vault is empty: a hero, a goblin, weapon
actions, and an opening scene.

## Persistence

SQLite (WAL) via `sqlx::SqlitePool` behind the `Repository` trait, so an
encrypted `SQLCipher` backend can be swapped in later without touching domain
or UI code. Tables: `characters`, `action_definitions`, `stat_blocks`,
`campaign_scenes`, `log_entries`.
