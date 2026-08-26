# auto-dm

An automated tabletop RPG game master: a deterministic rules engine, an
LLM-optional narrative layer, and a hosted multiplayer server — packaged
as a Tauri desktop app.

## Feature highlights

- **Combat engine** (Rust, seeded dice): attack rolls with advantage,
  crits, resist/vuln/immune damage typing, temp HP, systemic shock,
  death saves, initiative turns.
- **Spell system**: tiered spell-slot costs, concentration enforcement
  (CON saves on damage, one spell at a time), heal-outcome actions that
  revive and clamp at max HP.
- **36 classes** with level-gated features, resource pools/unlocks, and
  **dual-classing** (half-die HP, shared pool stacking).
- **376-monster bestiary** with loot tables, traits, and auto-generated
  heraldic portraits — drop in real token packs and they replace the
  placeholders automatically.
- **Multiplayer**: Axum + WebSocket host/join sessions; every session DB
  ships pre-seeded with the full content library. Players create classed
  characters and cast from their own panel.
- **DM toolkit**: Mythic-style Oracle (/ask), doom clocks, plot threads,
  NPC relationship notes, scene log with episodic summaries.

## Quick start

```bash
npm install
npm run dev          # Tauri dev server on :1420
npm run tauri dev    # full desktop shell (optional)
```

Hosted multiplayer server:

```bash
cd server && cargo run -- --dir ./data
```

## Commands

| Task | Command |
| --- | --- |
| Typecheck | `npm run typecheck` |
| Lint | `npm run lint` |
| Frontend tests | `npm test` |
| Everything pre-push | `npm run verify` |
| Rust tests | `cargo test --workspace` |

Rust workspace commands on Windows may need the WinSDK tools on PATH —
see [AGENTS.md](AGENTS.md).

## Architecture

```
core/        rules engine: dice, stat blocks, combat resolution (no IO)
engine/      repositories (SQLite), game state, events, DM pipeline glue
server/      Axum host: sessions, WebSocket resync, embedded seed content
mcp-server/  stdio MCP server: dice, oracle, intent, presets, recall
src-tauri/   desktop shell + local command bridge
src/         React frontend (zustand store, components, presets)
```

The content library lives in `src/presets/` and is the single source of
truth: a build script exports it to JSON which the hosted server embeds
at compile time, so local and multiplayer play always share the same
bestiary. See AGENTS.md for the regeneration pipeline and repo gotchas.

## MCP server & remote play

Any MCP client (Claude Desktop, Cursor) can drive the deterministic
engine over stdio:

```json
{ "mcpServers": { "auto-dm": { "command": "target/debug/mcp-server.exe" } } }
```

11 tools ship today: `roll_dice`, `oracle_fate_check`,
`oracle_random_event`, `scene_test`, `parse_intent`,
`repair_campaign_json`, `campaign_json_schema`, `list_preset_actions`,
`get_preset_action`, `get_preset_monster`, `lore_recall`.

To play with friends over the internet without port forwarding, see
[docs/HOSTING.md](docs/HOSTING.md) (Cloudflare Tunnel + one-command
launch script).

## Content & assets

All monsters, classes, spells, and equipment are clean-room archetypes.
Placeholder art is original procedural work (CC0); drop free token packs
into `public/assets/incoming/` and run `node scripts/map_tokens.mjs` to
upgrade — licensing notes live in [ASSETS.md](ASSETS.md).
