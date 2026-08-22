// One-off generator for a short, royalty-free dice-roll "clatter" sound.
// Produces 16-bit PCM mono WAV at 44.1kHz. Run with: node scripts/gen_dice_sound.mjs
import { writeFileSync } from "node:fs";

const sr = 44100;
const dur = 0.5;
const n = Math.floor(sr * dur);
const data = new Float32Array(n);

// A few short noise "clicks" at increasing timestamps, like dice tumbling.
const clicks = [0.02, 0.06, 0.11, 0.17, 0.24, 0.33];
const amps = [0.9, 0.8, 0.7, 0.6, 0.5, 0.4];
clicks.forEach((t0, i) => {
  const start = Math.floor(t0 * sr);
  const len = Math.floor(0.06 * sr);
  for (let j = 0; j < len && start + j < n; j++) {
    const env = Math.exp(-j / (len * 0.35));
    // Band-limited-ish: mix noise with a tiny tonal "clack".
    const noise = (Math.random() * 2 - 1);
    const clack = Math.sin(2 * Math.PI * (900 + i * 120) * (j / sr)) * 0.4;
    data[start + j] += (noise * 0.7 + clack * 0.3) * env * amps[i];
  }
});

// Soft low "thock" under the first impact.
const thockStart = Math.floor(0.02 * sr);
for (let j = 0; j < Math.floor(0.08 * sr) && thockStart + j < n; j++) {
  const env = Math.exp(-j / (Math.floor(0.08 * sr) * 0.4));
  data[thockStart + j] += Math.sin(2 * Math.PI * 160 * (j / sr)) * env * 0.5;
}

// Normalize to int16 with a touch of headroom.
let peak = 0;
for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(data[i]));
const gain = peak > 0 ? 0.9 / peak : 1;

const bytesPerSample = 2;
const blockAlign = bytesPerSample;
const byteRate = sr * blockAlign;
const buffer = Buffer.alloc(44 + n * bytesPerSample);
buffer.write("RIFF", 0);
buffer.writeUInt32LE(36 + n * bytesPerSample, 4);
buffer.write("WAVE", 8);
buffer.write("fmt ", 12);
buffer.writeUInt32LE(16, 16);
buffer.writeUInt16LE(1, 20); // PCM
buffer.writeUInt16LE(1, 22); // mono
buffer.writeUInt32LE(sr, 24);
buffer.writeUInt32LE(byteRate, 28);
buffer.writeUInt16LE(blockAlign, 32);
buffer.writeUInt16LE(16, 34);
buffer.write("data", 36);
buffer.writeUInt32LE(n * bytesPerSample, 40);
let off = 44;
for (let i = 0; i < n; i++) {
  const s = Math.max(-1, Math.min(1, data[i] * gain));
  buffer.writeInt16LE(Math.round(s * 32767), off);
  off += 2;
}

writeFileSync("public/assets/audio/dice_roll.wav", buffer);
console.log("wrote public/assets/audio/dice_roll.wav", buffer.length, "bytes");
