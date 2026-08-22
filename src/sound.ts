/**
 * Tiny sound-effect helper. Audio lives under `public/assets/audio/`
 * so Vite serves it at `/assets/audio/...` and Tauri bundles it into
 * the app. Missing files fail silently — the app never breaks on audio.
 */
const base = import.meta.env.BASE_URL || "/";

let diceAudio: HTMLAudioElement | null = null;

/** Play the bundled dice-roll clatter (no-op if unavailable/blocked). */
export function playDiceSound(): void {
  try {
    diceAudio ??= new Audio(`${base}assets/audio/dice_roll.wav`);
    diceAudio.currentTime = 0;
    void diceAudio.play().catch(() => {});
  } catch {
    /* audio unsupported — ignore */
  }
}
