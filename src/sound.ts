/**
 * Tiny sound-effect helper. Audio lives under `public/assets/audio/`
 * so Vite serves it at `/assets/audio/...` and Tauri bundles it into
 * the app. Missing files fail silently — the app never breaks on audio.
 */
const base = import.meta.env.BASE_URL || "/";

const cache = new Map<string, HTMLAudioElement>();

function play(file: string): void {
  try {
    let el = cache.get(file);
    if (!el) {
      el = new Audio(`${base}assets/audio/${file}`);
      cache.set(file, el);
    }
    el.currentTime = 0;
    void el.play().catch(() => {});
  } catch {
    /* audio unsupported — ignore */
  }
}

/** Play the bundled dice-roll clatter (no-op if unavailable/blocked). */
export function playDiceSound(): void {
  play("dice_roll.wav");
}

export type CombatSfx = "hit" | "miss" | "heal";

/** Play an outcome-appropriate combat sting for an attack resolution. */
export function playCombatSfx(sfx: CombatSfx): void {
  play(
    sfx === "hit" ? "attack_hit.wav" : sfx === "miss" ? "attack_miss.wav" : "heal_chime.wav",
  );
}

/** Pick the right sting from an attack outcome payload. */
export function sfxForOutcome(outcome: { heal_amount?: number; damage_dealt?: number; attack_result?: string }): CombatSfx {
  if ((outcome.heal_amount ?? 0) > 0) return "heal";
  if (outcome.attack_result === "MISS" || outcome.attack_result === "BLOCKED") return "miss";
  return "hit";
}
