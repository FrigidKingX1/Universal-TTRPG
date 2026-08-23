# AGENTS.md — auto-dm working notes

Commands and pipeline facts for coding agents working in this repo.

## Project

Tauri desktop + Axum multiplayer server for an automated tabletop RPG
game master. Deterministic Rust engine (`core`, `engine`), React/TS
frontend, content library in `src/presets/`.

## Commands

| Task | Command |
| --- | --- |
| Typecheck | `npx tsc --noEmit` |
| Lint | `npm run lint` (eslint src --max-warnings=0) |
| Frontend tests | `npx vitest run` |
| Rust tests | `cargo test --workspace` (see PATH note) |
| Clippy | `cargo clippy --workspace` (same PATH note) |
| Production build | `npm run build` |
| Dev server | `npm run dev` (port 1420, Tauri-tailored) |

**PATH note:** `cargo test/clippy --workspace` needs the Windows SDK
tools on PATH first:

```powershell
$env:PATH = "C:\Program Files (x86)\Windows Kits\10\bin\10.0.22621.0\x64;" + $env:PATH
```

## Content pipeline (keep these in lockstep)

1. Edit presets in `src/presets/{bestiary,actions,classes,equipment}.ts`.
2. Regenerate the hosted-server seed (drift-guard tests will fail if you
   forget):

   ```bash
   npx esbuild scripts/export_presets.ts --bundle --platform=node --format=esm --outfile=.tmp-export/export.mjs
   node .tmp-export/export.mjs && rm -rf .tmp-export   # POSIX
   # PowerShell: Remove-Item -Recurse -Force .tmp-export
   ```

3. Regenerate placeholder art after adding monsters/classes:
   `node scripts/gen_portraits.mjs`
4. Optional SFX regeneration: `node scripts/gen_sfx.mjs`,
   `node scripts/gen_dice_sound.mjs`

Token packs for real art: drop into `public/assets/incoming/`, then
`node scripts/map_tokens.mjs [--dry-run] [--force]` — see ASSETS.md.

## Test layout

- `src/__tests__/store.test.ts` — store logic (combat gating, rests,
  concentration, death saves, dual-class, undo)
- `src/__tests__/presets.test.ts` — content invariants (slot-gate traps,
  loot shape, name uniqueness, class gear parity)
- `src/__tests__/assets.test.ts` — PNG/WAV binary signatures + counts
- `src/__tests__/map_tokens.test.ts` — token-pack matcher units
- `src/__tests__/preset_export.test.ts` — TS<->server-JSON drift guard
- `server/src/presets.rs` — embedded seed parse/idempotency tests

## Conventions & gotchas

- Engine crates (`core`, `engine`) stay deterministic and UI-free.
- Rust struct literals must list every field; adding a field to
  `EncounterStatBlock` / `ActionDefinition` / `SuccessOutcome` means
  updating literals in `core/src/engine.rs` tests and
  `src-tauri/src/commands.rs` seeds (serde defaults keep old JSON valid).
- The working tree uses LF; git warns about CRLF conversion on Windows.
  Node scripts that split lines should use `/\r?\n/` and preserve the
  detected EOL when writing back.
- Hosted clients may have an empty local action vault; resolve action
  ids against the local vault first, then `findPresetAction()` fallback.
- Vite splits `src/presets/**` into a `content` chunk via manualChunks;
  keep heavy game data inside `src/presets/` to benefit from it.
