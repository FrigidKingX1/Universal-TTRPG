import { describe, it, expect } from "vitest";
import {
  slugify,
  normalizeBasename,
  matchFile,
  loadMonsters,
  type MonsterEntry,
} from "../../scripts/map_tokens.mjs";

/**
 * Unit coverage for the token-pack matcher. These rules are what let a
 * DM drop a raw itch.io pack into public/assets/incoming and have every
 * file land on the right monster portrait.
 */
const MONSTERS: MonsterEntry[] = [
  { key: "goblin", name: "Goblin", slug: "goblin" },
  { key: "hobgoblin", name: "Hobgoblin", slug: "hobgoblin" },
  { key: "ancient_red_dragon", name: "Ancient Red Dragon", slug: "ancient_red_dragon" },
  // Legacy key kept for backwards compatibility with earlier saves.
  { key: "young-green-dragon", name: "Young Green Dragon", slug: "young_green_dragon" },
];

describe("normalizeBasename", () => {
  it("strips extension, case, and separators", () => {
    expect(normalizeBasename("Goblin.PNG")).toBe("goblin");
    expect(normalizeBasename("Ancient_Red_Dragon.jpg")).toBe("ancient_red_dragon");
  });

  it("strips token/portrait/mini/vtt markers", () => {
    expect(normalizeBasename("goblin_token.png")).toBe("goblin");
    expect(normalizeBasename("Ancient_Red_Dragon_Portrait.jpg")).toBe("ancient_red_dragon");
    expect(normalizeBasename("hobgoblin-mini.webp")).toBe("hobgoblin");
    expect(normalizeBasename("goblin vtt.png")).toBe("goblin");
  });

  it("strips trailing size suffixes", () => {
    expect(normalizeBasename("goblin_40.png")).toBe("goblin");
    expect(normalizeBasename("Young Green Dragon - Token 40px.png")).toBe("young_green_dragon");
  });
});

describe("matchFile", () => {
  it("prefers exact keys", () => {
    const r = matchFile("goblin", MONSTERS)!;
    expect(r.monster.key).toBe("goblin");
    expect(r.how).toBe("exact key");
  });

  it("falls back to name slugs (legacy dashed keys included)", () => {
    const r = matchFile("young_green_dragon", MONSTERS)!;
    expect(r.monster.key).toBe("young-green-dragon");
    expect(r.how).toBe("name slug");
  });

  it("never lets a shorter key eat a longer one", () => {
    const r = matchFile("hobgoblin_token", MONSTERS)!;
    expect(r.monster.key).toBe("hobgoblin");
  });

  it("returns null when nothing matches", () => {
    expect(matchFile("mystery_beast", MONSTERS)).toBeNull();
  });

  it("matches containment inside noisier filenames", () => {
    const r = matchFile("token_pack_ancient_red_dragon_variant2", MONSTERS)!;
    expect(r.monster.key).toBe("ancient_red_dragon");
    expect(r.how).toBe("contains key");
  });
});

describe("slugify", () => {
  it("lowercases and snake-cases display names", () => {
    expect(slugify("Ancient Red Dragon")).toBe("ancient_red_dragon");
    expect(slugify("Young Green Dragon")).toBe("young_green_dragon");
  });
});

describe("loadMonsters", () => {
  it("parses every compact and verbose entry from the live bestiary", async () => {
    const monsters = await loadMonsters();
    expect(monsters.length).toBeGreaterThanOrEqual(376);
    expect(monsters.some((m) => m.name === "Ancient Red Dragon")).toBe(true);
  });
});
