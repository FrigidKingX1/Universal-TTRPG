// Repairs the 17 misplaced loot injections (line-exact) then refills the
// true owners using block-bounded matching (entry closes at "\n  }),").
import { readFileSync, writeFileSync } from "node:fs";

const FILE = "src/presets/bestiary.ts";
const lines = readFileSync(FILE, "utf8").split("\n");

// 1. Line-exact revert of stolen slots.
const badLines = [
  [1585, "Ghoul Claw"], [1755, "Pocket Change"], [1783, "Worg Pelt"],
  [1811, "Travel Rations"], [1830, "Gem Eyes"], [1848, "Mimic Hoard"],
  [1857, "Snake Skin"], [1868, "Werewolf Pelt"], [1877, "Loose Spikes"],
  [1922, "Hell Hound Fang"], [1931, "Petrified Eye"], [1940, "Wailing Hair Locket"],
  [1985, "Cloaker Hide"], [2066, "Slaad Egg"], [2259, "Ape Hide"],
  [2590, "Pocket Change"], [2679, "Coin Purse"],
];
for (const [ln, marker] of badLines) {
  const i = ln - 1;
  if (!lines[i].includes(marker)) { console.error(`line ${ln} no longer holds ${marker}`); process.exit(1); }
  lines[i] = "    loot_table: [],";
}

// 2. Refill true owners, bounded to their own entry block.
const REFILL = {
  ghoul: [{ name: "Ghoul Claw (alchemic)", quantity_formula: "1", chance: 25 }],
  guard: [{ name: "Pocket Change", quantity_formula: "1d6", chance: 40 }],
  worg: [{ name: "Worg Pelt", quantity_formula: "1", chance: 25 }],
  scout: [{ name: "Travel Rations", quantity_formula: "1d4", chance: 45 }],
  gargoyle: [{ name: "Gem Eyes", quantity_formula: "2", chance: 20 }],
  mimic: [{ name: "Mimic Hoard", quantity_formula: "4d6", chance: 70 }],
  "constrictor-snake": [{ name: "Snake Skin", quantity_formula: "1", chance: 30 }],
  werewolf: [{ name: "Werewolf Pelt", quantity_formula: "1", chance: 30 }],
  manticore: [{ name: "Loose Spikes", quantity_formula: "1d4", chance: 40 }],
  "hell-hound": [{ name: "Hell Hound Fang", quantity_formula: "1", chance: 30 }],
  basilisk: [{ name: "Petrified Eye", quantity_formula: "1", chance: 25 }],
  banshee: [{ name: "Wailing Hair Locket", quantity_formula: "1", chance: 35 }],
  cloaker: [{ name: "Cloaker Hide", quantity_formula: "1", chance: 30 }],
  slaad_red: [{ name: "Slaad Egg", quantity_formula: "1", chance: 20 }],
  ape: [{ name: "Ape Hide", quantity_formula: "1", chance: 20 }],
};
let refilled = 0;
for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(/^  monster\("([^"]+)"/);
  const key = m?.[1];
  if (!key || !REFILL[key]) continue;
  // Entry ends at the next line that is exactly "  }),".
  let end = i;
  while (end < lines.length && lines[end] !== "  }),") end++;
  for (let j = i; j <= end; j++) {
    const idx = lines[j].indexOf("loot_table: [],");
    if (idx !== -1) {
      lines[j] = lines[j].replace(
        "loot_table: [],",
        `loot_table: ${JSON.stringify(REFILL[key])},`,
      );
      refilled++;
      break;
    }
  }
}
console.log(`reverted ${badLines.length} misplaced lines, refilled ${refilled} owners`);
if (refilled !== Object.keys(REFILL).length) {
  console.error("NOT ALL OWNERS REFILLED");
  process.exit(1);
}
writeFileSync(FILE, lines.join("\n"));
