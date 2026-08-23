import { readFileSync } from "node:fs";
const cls = readFileSync("src/presets/classes.ts", "utf8");
const eq = readFileSync("src/presets/equipment.ts", "utf8");
const catalogNames = new Set([...eq.matchAll(/name: "([^"]+)", category/g)].map((m) => m[1]));
const classItems = [...new Set([...cls.matchAll(/name: "([^"]+)", quantity/g)].map((m) => m[1]))];
const missing = classItems.filter((n) => !catalogNames.has(n));
console.log("missing from catalog:", missing.length);
for (const n of missing) console.log(`  - ${n}`);
