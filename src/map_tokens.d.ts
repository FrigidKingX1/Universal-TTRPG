declare module "*/map_tokens.mjs" {
  export interface MonsterEntry {
    key: string;
    name: string;
    slug: string;
  }
  export interface MatchResult {
    monster: MonsterEntry;
    how: "exact key" | "name slug" | "contains key" | "contains slug";
  }
  export function slugify(s: string): string;
  export function normalizeBasename(basename: string): string;
  export function matchFile(normalized: string, monsters: MonsterEntry[]): MatchResult | null;
  export function loadMonsters(srcPath?: string): Promise<MonsterEntry[]>;
  export const IMAGE_RE: RegExp;
}
