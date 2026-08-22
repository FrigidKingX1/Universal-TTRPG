// Batch token mapper: drop a downloaded VTT token pack into a folder and
// this script renames/copies each file to public/assets/monsters/<key>.png
// so monster portraits auto-load via the portrait convention resolver.
//
// Usage:
//   node scripts/map_tokens.mjs [inputDir] [--dry-run] [--force]
//   inputDir defaults to "public/assets/incoming"
//
// Matching strategy per file (first hit wins):
//   1. normalized filename equals a monster key        ("ancient_red_dragon.png")
//   2. normalized filename equals the monster's name slug ("young green dragon" -> young_green_dragon)
//   3. filename contains the key or slug after stripping token noise
//      ("_token", sizes like "40px", variant suffixes)
import { readdir, copyFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const force = args.includes("--force");
const inputDir = args.find((a) => !a.startsWith("--")) ?? "public/assets/incoming";
const outDir = "public/assets/monsters";

const IMAGE_RE = /\.(png|jpe?g|webp)$/i;

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

/** Strip common token-pack noise from a basename before matching. */
function normalizeBasename(basename) {
  let s = basename.toLowerCase().replace(IMAGE_RE, "");
  s = s.replace(/[_\-\s]*(token|tokens|portrait|mini|miniature|vtt)[_\-\s]*/g, "_");
  s = s.replace(/[_\-\s]*\d+(px|pt)?$/g, ""); // trailing sizes: _40, -40px
  s = s.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return s;
}

async function loadMonsters() {
  const src = await readFile("src/presets/bestiary.ts", "utf8");
  const monsters = [];
  const re = /monster\(\s*"([^"]+)"\s*,\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const [, key, name] = m;
    monsters.push({ key, name, slug: slugify(name) });
  }
  return monsters;
}

function matchFile(normalized, monsters) {
  // 1. exact key
  let hit = monsters.find((mo) => mo.key === normalized);
  if (hit) return { monster: hit, how: "exact key" };
  // 2. exact name slug
  hit = monsters.find((mo) => mo.slug === normalized);
  if (hit) return { monster: hit, how: "name slug" };
  // 3. containment (longest key wins to avoid 'goblin' eating 'hobgoblin')
  const contains = monsters
    .filter((mo) => mo.key.length > 3 && normalized.includes(mo.key))
    .sort((a, b) => b.key.length - a.key.length)[0];
  if (contains) return { monster: contains, how: "contains key" };
  const slugHit = monsters
    .filter((mo) => mo.slug.length > 3 && normalized.includes(mo.slug))
    .sort((a, b) => b.slug.length - a.slug.length)[0];
  if (slugHit) return { monster: slugHit, how: "contains slug" };
  return null;
}

const monsters = await loadMonsters();
if (!existsSync(inputDir)) {
  console.error(`Input directory not found: ${inputDir}`);
  console.error("Create it and drop your downloaded token pack inside, then re-run.");
  process.exit(1);
}
await mkdir(outDir, { recursive: true });

const files = (await readdir(inputDir)).filter((f) => IMAGE_RE.test(f));
const matched = [];
const unmatched = [];
const claimed = new Set(); // one file per monster key

for (const file of files) {
  const normalized = normalizeBasename(file);
  const result = matchFile(normalized, monsters);
  if (!result || claimed.has(result.monster.key)) {
    unmatched.push(file);
    continue;
  }
  claimed.add(result.monster.key);
  matched.push({ file, ...result });
}

let copied = 0;
for (const { file, monster, how } of matched) {
  const ext = path.extname(file).toLowerCase();
  const dest = path.join(outDir, `${monster.key}${ext === ".jpeg" ? ".jpg" : ext}`);
  if (!dryRun) {
    if (!force && existsSync(dest)) {
      console.log(`skip (exists): ${file} -> ${dest}`);
      continue;
    }
    await copyFile(path.join(inputDir, file), dest);
  }
  copied++;
  console.log(`✓ ${file} -> ${monster.name} (${monster.key}) [${how}]`);
}

console.log(`\n${matched.length} matched, ${copied} copied${dryRun ? " (dry run)" : ""}, ${unmatched.length} unmatched`);
if (unmatched.length) {
  console.log("\nUnmatched files:");
  for (const f of unmatched) console.log(`  ? ${f}`);
}
const missing = monsters.filter((mo) => !claimed.has(mo.key));
console.log(`\n${missing.length}/${monsters.length} monsters still without art.`);
