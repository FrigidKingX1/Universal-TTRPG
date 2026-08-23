import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Binary asset integrity: catches truncated/corrupted generated art or
 * audio before it ships inside the app bundle.
 */
const ROOT = process.cwd();
const monstersDir = path.join(ROOT, "public/assets/monsters");
const iconsDir = path.join(ROOT, "public/assets/icons");
const audioDir = path.join(ROOT, "public/assets/audio");

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngDimensions(buf: Buffer): { w: number; h: number } {
  // IHDR starts at byte 16; width/height are big-endian u32s at +16/+20.
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

describe("Generated portrait assets", () => {
  const monsterPngs = readdirSync(monstersDir).filter((f) => f.endsWith(".png"));
  const crestPngs = readdirSync(iconsDir).filter((f) => f.startsWith("class_") && f.endsWith(".png"));

  it("covers every monster and class with a portrait", () => {
    expect(monsterPngs.length).toBeGreaterThanOrEqual(376);
    expect(crestPngs.length).toBeGreaterThanOrEqual(36);
  });

  it("every PNG has a valid signature and 64x64 IHDR", () => {
    let checked = 0;
    for (const dir of [monstersDir, iconsDir]) {
      for (const f of readdirSync(dir).filter((x) => x.endsWith(".png"))) {
        const head = readFileSync(path.join(dir, f)).subarray(0, 24);
        expect(head.subarray(0, 8).equals(PNG_SIG), `${f} signature`).toBe(true);
        const { w, h } = pngDimensions(head);
        expect(w, `${f} width`).toBe(64);
        expect(h, `${f} height`).toBe(64);
        checked++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(412);
  });

  it("portrait filenames match known monster keys", async () => {
    const { PRESET_MONSTERS } = await import("../presets/bestiary");
    const keys = new Set(PRESET_MONSTERS.map((m) => m.key));
    const orphans = monsterPngs.filter((f) => !keys.has(f.replace(/\.png$/, "")));
    expect(orphans, "portraits without a matching monster key").toEqual([]);
  });
});

describe("Sound effect assets", () => {
  const wavs = readdirSync(audioDir).filter((f) => f.endsWith(".wav"));
  const REQUIRED = ["dice_roll.wav", "attack_hit.wav", "attack_miss.wav", "heal_chime.wav"];

  it("all required SFX files exist", () => {
    for (const r of REQUIRED) expect(wavs, `${r} present`).toContain(r);
  });

  it("every WAV is RIFF/PCM16 mono 44.1kHz with data", () => {
    for (const f of wavs) {
      const buf = readFileSync(path.join(audioDir, f));
      expect(buf.subarray(0, 4).toString("ascii"), `${f} RIFF`).toBe("RIFF");
      expect(buf.subarray(8, 12).toString("ascii"), `${f} WAVE`).toBe("WAVE");
      expect(buf.readUInt16LE(20), `${f} PCM`).toBe(1); // format
      expect(buf.readUInt16LE(22), `${f} mono`).toBe(1); // channels
      expect(buf.readUInt32LE(24), `${f} sample rate`).toBe(44100);
      expect(buf.readUInt16LE(34), `${f} bits`).toBe(16);
      expect(buf.subarray(36, 40).toString("ascii"), `${f} data chunk`).toBe("data");
      // Data chunk length must fit inside the file.
      const dataLen = buf.readUInt32LE(40);
      expect(44 + dataLen, `${f} length coherent`).toBeLessThanOrEqual(buf.length);
    }
  });
});
