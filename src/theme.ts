export interface ThemeSettings {
  accent: string;
  fontSize: number;
  density: "comfortable" | "compact";
}

export const ACCENT_PRESETS: { name: string; value: string }[] = [
  { name: "Gilded Rune", value: "#c9a86a" },
  { name: "Ember Forge", value: "#ff7a45" },
  { name: "Moss & Thorn", value: "#4ade80" },
  { name: "Crimson Sigil", value: "#e05a4f" },
  { name: "Arcane Amethyst", value: "#9b8ec4" },
  { name: "Frostglass", value: "#7dcfff" },
  { name: "Tokyo Blue", value: "#7aa2f7" },
];

const STORAGE_KEY = "autodm.theme";

export const DEFAULT_THEME: ThemeSettings = {
  accent: "#c9a86a",
  fontSize: 14,
  density: "comfortable",
};

function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function lighten(hex: string, amount: number): string {
  const clean = hex.replace("#", "");
  const num = parseInt(clean, 16);
  const r = Math.min(255, ((num >> 16) & 0xff) + amount);
  const g = Math.min(255, ((num >> 8) & 0xff) + amount);
  const b = Math.min(255, (num & 0xff) + amount);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

export function applyTheme(settings: ThemeSettings): void {
  const root = document.documentElement;
  root.style.setProperty("--accent", settings.accent);
  root.style.setProperty("--accent-hover", lighten(settings.accent, 24));
  root.style.setProperty(
    "--sidebar-active-bg",
    hexToRgba(settings.accent, 0.15),
  );
  root.style.setProperty("font-size", `${settings.fontSize}px`);
  root.dataset.density = settings.density;
}

export function loadTheme(): ThemeSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_THEME;
    const parsed = JSON.parse(raw) as Partial<ThemeSettings>;
    return { ...DEFAULT_THEME, ...parsed };
  } catch {
    return DEFAULT_THEME;
  }
}

export function saveTheme(settings: ThemeSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // localStorage unavailable; theme applies for session only
  }
}
