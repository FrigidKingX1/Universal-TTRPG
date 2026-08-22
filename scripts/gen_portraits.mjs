// Generates deterministic heraldic-sigil portraits for every monster key in
// src/presets/bestiary.ts plus class crests from src/presets/classes.ts.
// Pure Node (zlib + manual PNG chunks), no dependencies. All output art is
// original procedural work authored by this project; treat it as CC0.
//   node scripts/gen_portraits.mjs
import { deflateSync } from "node:zlib";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const SIZE = 64;
let CRC_TABLE;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xff];
  return ~crc >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePng(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function hsl(hDeg, sPct, lPct) {
  const c = (1 - Math.abs((2 * lPct) / 100 - 1)) * (sPct / 100);
  const hp = ((((hDeg % 360) + 360) % 360) / 60);
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const rgb = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.floor(hp)] || [0, 0, 0];
  const m = lPct / 100 - c / 2;
  return rgb.map((v) => Math.round(Math.max(0, Math.min(255, (v + m) * 255))));
}

const TYPE_HUES = {
  humanoid: [215, 45], undead: [95, 270], dragon: [355, 45], fiend: [315, 275],
  aberration: [265, 185], construct: [40, 200], elemental: [25, 195], fey: [140, 300],
  giant: [210, 30], monstrosity: [285, 40], ooze: [85, 160], plant: [120, 80],
  swarm: [55, 20], celestial: [50, 220], beast: [30, 90],
};
const SHAPES = ["diamond", "ring", "chevron", "trident", "star", "twin"];

function drawTile(seedKey, baseHue, accentHue, shape) {
  const w = SIZE, h = SIZE;
  const px = Buffer.alloc(w * h * 4);
  const bgA = hsl(baseHue, 38, 14), bgB = hsl(baseHue, 45, 27);
  const acc = hsl(accentHue, 70, 58), accDim = hsl(accentHue, 50, 34);
  const cx = (w - 1) / 2, cy = (h - 1) / 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (x - cx) / cx, dy = (y - cy) / cy;
      const t = y / (h - 1);
      let c = [
        bgA[0] + (bgB[0] - bgA[0]) * t,
        bgA[1] + (bgB[1] - bgA[1]) * t,
        bgA[2] + (bgB[2] - bgA[2]) * t,
      ];
      const ad = Math.abs(dx) + Math.abs(dy);
      const rd = Math.sqrt(dx * dx + dy * dy);
      let ink = null;
      if (shape === "diamond") { if (Math.abs(ad - 0.62) < 0.07 || (ad < 0.62 && rd > 0.55 && Math.abs(ad - 0.31) < 0.05)) ink = acc; else if (ad < 0.24) ink = accDim; }
      else if (shape === "ring") { if (Math.abs(rd - 0.6) < 0.08) ink = acc; else if (rd < 0.22) ink = acc; }
      else if (shape === "chevron") { const v = Math.abs(dy) + Math.abs(dx) * 0 - Math.abs(dx); if (Math.abs(dy + Math.abs(dx)) < 0.14 && dy < 0.3) ink = acc; else if (Math.abs(dy + Math.abs(dx) - 0.42) < 0.06 && dy < 0.2) ink = accDim; }
      else if (shape === "trident") { if ((Math.abs(dx) > 0.52 && dy < 0.35 && dy > -0.45) || (rd < 0.16)) ink = acc; else if (dy < 0.5 && dy > 0.38) ink = accDim; }
      else if (shape === "star") { const ang = Math.atan2(dy, dx); const k = 0.34 + 0.26 * Math.cos(5 * ang); if (Math.abs(rd - k) < 0.07) ink = acc; else if (rd < k * 0.4) ink = accDim; }
      else { if (Math.abs(Math.abs(dx) - 0.34) < 0.09 && Math.abs(dy) < 0.5) ink = acc; else if (rd < 0.12) ink = accDim; }
      // border frame
      const edge = Math.min(x, y, w - 1 - x, h - 1 - y);
      if (edge === 0) c = [10, 9, 8];
      else if (edge <= 2) { c = [c[0] * 0.55, c[1] * 0.55, c[2] * 0.55]; }
      if (ink) c = edge <= 2 ? ink.map(v => v * 0.8) : ink;
      const o = (y * w + x) * 4;
      px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = 255;
    }
  }
  return encodePng(w, h, px);
}

// Extract monster keys+types from bestiary.ts
const bestiarySrc = readFileSync("src/presets/bestiary.ts", "utf8");
const typeOf = new Map();
for (const m of bestiarySrc.matchAll(/qm\("([^"]+)", "[^"]+", [^,]+, "([^"]+)"/g)) typeOf.set(m[1], m[2]);
for (const m of bestiarySrc.matchAll(/monster\("([^"]+)", "[^"]+", [^(]*\{\s*size: [^,]+,\s*type: "([^"]+)"/g)) typeOf.set(m[1], m[2]);

mkdirSync("public/assets/monsters", { recursive: true });
let n = 0;
for (const [key, type] of typeOf) {
  const h = hash(key);
  const hues = TYPE_HUES[type] ?? [220, 60];
  const shape = SHAPES[h % SHAPES.length];
  const jitter = (h >>> 8) % 25;
  writeFileSync(`public/assets/monsters/${key}.png`,
    drawTile(key, (hues[0] + jitter) % 360, hues[1], shape));
  n++;
}

// Class crests
mkdirSync("public/assets/icons", { recursive: true });
const classesSrc = readFileSync("src/presets/classes.ts", "utf8");
const classIds = [...classesSrc.matchAll(/id: "([a-z]+)"/g)].map((m) => m[1]);
const CLASS_HUES = { fighter: 210, barbarian: 15, rogue: 280, ranger: 120, cleric: 50, wizard: 260, paladin: 45, monk: 170, sorcerer: 340, warlock: 305, bard: 25, druid: 95, warlord: 200, swashbuckler: 330, runecarver: 30, necromancer: 100, shaman: 160, psion: 190, alchemist: 75, tinkerer: 50, reaver: 0, brawler: 35, wildspeaker: 110, shadowblade: 250, stormcaller: 220, witch: 290, summoner: 240, gunslinger: 20, dragoon: 350, blackguard: 285, banisher: 55, jester: 42, spellblade: 265, chirurgeon: 185, elementalist: 130, cavalier: 230 };
for (const id of classIds) {
  const hue = CLASS_HUES[id] ?? hash(id) % 360;
  writeFileSync(`public/assets/icons/class_${id}.png`, drawTile(id, hue, (hue + 180) % 360, "diamond"));
}
console.log(`wrote ${n} monster portraits and ${classIds.length} class crests`);
