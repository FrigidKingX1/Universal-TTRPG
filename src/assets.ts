/**
 * Helpers for resolving monster art from the local asset convention.
 *
 * Drop a file named after the monster's stable key into `assets/monsters/`
 * (e.g. `assets/monsters/goblin.png`) and it will auto-load on the card
 * without setting the explicit `portrait` field. An explicit `portrait`
 * (URL or path) always wins.
 */
export const MONSTER_ASSET_BASE = "assets/monsters/";

export interface PortraitSource {
  portrait?: string | null;
  key?: string | null;
}

/** Resolve a monster's art to a URL rooted at the app base (e.g. /assets/monsters/goblin.png). */
export function resolvePortrait(block: PortraitSource): string | null {
  if (block.portrait && block.portrait.trim()) return block.portrait.trim();
  if (block.key && block.key.trim()) {
    const base = import.meta.env.BASE_URL || "/";
    return `${base}${MONSTER_ASSET_BASE}${block.key.trim()}.png`;
  }
  return null;
}
