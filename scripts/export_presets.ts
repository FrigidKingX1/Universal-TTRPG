// Export the TS preset content library to JSON for embedding in the Rust
// server binary (see server/src/presets.rs). Run via esbuild + node:
//   npx esbuild scripts/export_presets.ts --bundle --platform=node --format=esm --outfile=.tmp-export/export.mjs
//   node .tmp-export/export.mjs && rm -rf .tmp-export
import { writeFileSync, mkdirSync } from "node:fs";
import { ALL_PRESET_ACTIONS } from "../src/presets/actions";
import { PRESET_MONSTERS } from "../src/presets/bestiary";

// Give each monster a stable, deterministic id so re-seeding is naturally
// idempotent on the server side.
const monsters = PRESET_MONSTERS.map((m) => ({ ...m, id: `preset_${m.key}` }));

mkdirSync("server/assets", { recursive: true });
writeFileSync("server/assets/preset_actions.json", JSON.stringify(ALL_PRESET_ACTIONS, null, 1));
writeFileSync("server/assets/preset_monsters.json", JSON.stringify(monsters, null, 1));
console.log(`exported ${ALL_PRESET_ACTIONS.length} actions and ${monsters.length} monsters`);
