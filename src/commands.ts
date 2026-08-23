/**
 * Omnibar slash-command router, extracted from NarrativeStream so the DM's
 * primary input surface is unit-testable. Dependencies arrive via
 * {@link SlashContext}; the component wires them to the store and backend.
 */
import type { FateCheckResponse, RollResponse, StoryLogEntry } from "./types";

type Say = (speaker: string, role: StoryLogEntry["role"], content: string) => void;

export interface ActiveLike {
  identity: { name: string };
  attributes: Record<
    string,
    { base_value: number; current_value?: number; derived_modifier?: number }
  >;
}

export interface SlashContext {
  /** Append a line to the visible narrative stream. */
  say: Say;
  rollDice(expr: string): Promise<RollResponse>;
  fateCheck(odds: string, chaosFactor: number): Promise<FateCheckResponse>;
  playDiceSound(): void;
  /** The active character profile (or null) for /check. */
  getActiveCharacter(): ActiveLike | null;
  /** Current scene chaos factor for Oracle consults. */
  getChaosFactor(): number;
}

export interface ParsedCommand {
  cmd: string;
  args: string;
}

/** Split "/check STR" into { cmd: "/check", args: "STR" }; null if not a command. */
export function parseCommand(input: string): ParsedCommand | null {
  if (!input.startsWith("/")) return null;
  const spaceIdx = input.indexOf(" ");
  const cmd = (spaceIdx === -1 ? input : input.slice(0, spaceIdx)).toLowerCase();
  const args = spaceIdx === -1 ? "" : input.slice(spaceIdx + 1).trim();
  return { cmd, args };
}

const HELP_TEXT = [
  "Omnibar commands:",
  "  /roll <expr>   — roll dice, e.g. /roll 2d6+3 fire",
  "  /check <ATTR>  — ability check for the active character",
  "  /ask <question> — yes/no Oracle consultation",
  "  /help          — show this list",
  "Anything without a slash goes to the Dungeon Master.",
].join("\n");

/**
 * Execute one omnibar input. Returns false when the input is not a slash
 * command (the caller should send it to the DM); true when fully handled.
 */
export async function runSlashCommand(
  input: string,
  ctx: SlashContext,
): Promise<boolean> {
  const parsed = parseCommand(input);
  if (!parsed) return false;
  const { cmd, args } = parsed;

  switch (cmd) {
    case "/roll":
    case "/r": {
      if (!args) {
        ctx.say("System", "system", "Usage: /roll 1d20+5 [damage type] — e.g. /roll 2d6+3 fire");
        return true;
      }
      try {
        ctx.playDiceSound();
        const r = await ctx.rollDice(args);
        ctx.say("Dice", "combat", `${args} → ${r.total} (${r.detail})`);
      } catch (e) {
        ctx.say("System", "system", `Roll failed: ${String(e)}`);
      }
      return true;
    }

    case "/check": {
      if (!args) {
        ctx.say("System", "system", "Usage: /check STR|DEX|CON|INT|WIS|CHA — rolls 1d20 + modifier for the active character");
        return true;
      }
      const char = ctx.getActiveCharacter();
      const attrKey = args.toUpperCase();
      const attr = char?.attributes[attrKey];
      if (!char || !attr) {
        ctx.say("System", "system", `No active character or unknown attribute "${args}". Select a character first.`);
        return true;
      }
      const mod = attr.derived_modifier ?? Math.floor((attr.base_value - 10) / 2);
      try {
        ctx.playDiceSound();
        const r = await ctx.rollDice(`1d20+${mod}`);
        const success = r.total >= 10;
        ctx.say(
          "Check",
          "combat",
          `${char.identity.name} ${attrKey} check: ${r.total} vs DC 10 — ${success ? "SUCCESS" : "FAILURE"} (${r.detail})`,
        );
      } catch (e) {
        ctx.say("System", "system", `Check failed: ${String(e)}`);
      }
      return true;
    }

    case "/ask": {
      if (!args) {
        ctx.say("System", "system", 'Usage: /ask "Is the door locked?" — consults the Oracle');
        return true;
      }
      try {
        const f = await ctx.fateCheck("fifty_fifty", ctx.getChaosFactor());
        ctx.say("Oracle", "narrator", `"${args}" — ${f.interpretation} (rolled ${f.roll} vs ${f.target})`);
      } catch (e) {
        ctx.say("System", "system", `Oracle failed: ${String(e)}`);
      }
      return true;
    }

    case "/help": {
      ctx.say("System", "system", HELP_TEXT);
      return true;
    }

    default:
      // Unknown slash command — treat as DM intent but hint at /help.
      ctx.say("System", "system", `Unknown command "${cmd}". Try /help.`);
      return true;
  }
}
