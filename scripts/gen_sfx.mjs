// One-off generator for combat SFX: hit impact, miss whoosh, heal chime.
// 16-bit PCM mono WAV @ 44.1kHz. Run with: node scripts/gen_sfx.mjs
import { writeFileSync } from "node:fs";

const sr = 44100;

function toWav(samples) {
  const n = samples.length;
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(samples[i]));
  const gain = peak > 0 ? 0.9 / peak : 1;
  const buffer = Buffer.alloc(44 + n * 2);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + n * 2, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sr, 24);
  buffer.writeUInt32LE(sr * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] * gain));
    buffer.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  return buffer;
}

// ── Hit: low thud + bright crack ──────────────────────────────────────
{
  const dur = 0.22;
  const n = Math.floor(sr * dur);
  const s = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const env = Math.exp(-t / 0.05);
    const thud = Math.sin(2 * Math.PI * 90 * t) * env;
    const crack = (Math.random() * 2 - 1) * Math.exp(-t / 0.012) * 0.8;
    s[i] = thud * 0.9 + crack;
  }
  writeFileSync("public/assets/audio/attack_hit.wav", toWav(s));
}

// ── Miss: airy whoosh (noise swell with falling tone) ─────────────────
{
  const dur = 0.3;
  const n = Math.floor(sr * dur);
  const s = new Float32Array(n);
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const env = Math.sin(Math.PI * Math.min(1, t / dur)); // rise then fall
    lp += ((Math.random() * 2 - 1) - lp) * 0.08; // crude lowpass = air
    s[i] = lp * env * 1.6;
  }
  writeFileSync("public/assets/audio/attack_miss.wav", toWav(s));
}

// ── Heal: ascending two-note chime with shimmer ───────────────────────
{
  const dur = 0.6;
  const n = Math.floor(sr * dur);
  const s = new Float32Array(n);
  const notes = [[523.25, 0.0], [783.99, 0.12]]; // C5 → G5
  for (const [freq, start] of notes) {
    const begin = Math.floor(start * sr);
    for (let i = begin; i < n; i++) {
      const t = (i - begin) / sr;
      const env = Math.exp(-t / 0.18);
      const tone =
        Math.sin(2 * Math.PI * freq * t) +
        Math.sin(2 * Math.PI * freq * 2 * t) * 0.25 +
        Math.sin(2 * Math.PI * freq * 3.01 * t) * 0.08;
      s[i] += tone * env * 0.45;
    }
  }
  writeFileSync("public/assets/audio/heal_chime.wav", toWav(s));
}

console.log("wrote attack_hit.wav, attack_miss.wav, heal_chime.wav");
