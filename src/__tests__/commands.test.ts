import { describe, it, expect, vi } from "vitest";
import { parseCommand, runSlashCommand, type SlashContext } from "../commands";

/** Collect every say() line so assertions read like a transcript. */
function makeCtx(overrides: Partial<SlashContext> = {}) {
  const said: Array<{ speaker: string; role: string; text: string }> = [];
  const ctx: SlashContext = {
    say: (speaker, role, text) => said.push({ speaker, role, text }),
    rollDice: vi.fn().mockResolvedValue({ expression: "1d20", total: 15, detail: "[1d20] = 15" }),
    fateCheck: vi.fn().mockResolvedValue({
      roll: 55, target: 50, chaos_factor: 5, odds: "fifty_fifty",
      outcome: "Yes" as const, exceptional: false, random_event: false,
      interpretation: "Yes",
    }),
    playDiceSound: vi.fn(),
    getActiveCharacter: () => null,
    getChaosFactor: () => 5,
    ...overrides,
  };
  return { ctx, said };
}

describe("parseCommand", () => {
  it("returns null for non-commands", () => {
    expect(parseCommand("Open the door")).toBeNull();
  });

  it("splits command and args case-insensitively", () => {
    expect(parseCommand("/ROLL 2d6")).toEqual({ cmd: "/roll", args: "2d6" });
    expect(parseCommand("/check")).toEqual({ cmd: "/check", args: "" });
  });
});

describe("runSlashCommand routing", () => {
  it("returns false for non-commands and says nothing", async () => {
    const { ctx, said } = makeCtx();
    expect(await runSlashCommand("Talk to the innkeeper", ctx)).toBe(false);
    expect(said).toEqual([]);
  });

  it("/roll emits a Dice entry with the expression, total, and detail", async () => {
    const { ctx, said } = makeCtx();
    expect(await runSlashCommand("/roll 2d6+3 fire", ctx)).toBe(true);
    expect(ctx.rollDice).toHaveBeenCalledWith("2d6+3 fire");
    expect(ctx.playDiceSound).toHaveBeenCalled();
    expect(said[0]).toMatchObject({
      speaker: "Dice",
      role: "combat",
      text: "2d6+3 fire → 15 ([1d20] = 15)",
    });
  });

  it("/r is an alias for /roll", async () => {
    const { ctx } = makeCtx();
    expect(await runSlashCommand("/r 1d4", ctx)).toBe(true);
    expect(ctx.rollDice).toHaveBeenCalledWith("1d4");
  });

  it("/roll without args prints usage and never rolls", async () => {
    const { ctx, said } = makeCtx();
    await runSlashCommand("/roll", ctx);
    expect(ctx.rollDice).not.toHaveBeenCalled();
    expect(said[0].text).toContain("Usage: /roll");
  });

  it("/roll failure surfaces an error line", async () => {
    const { ctx, said } = makeCtx({
      rollDice: vi.fn().mockRejectedValue(new Error("bad dice")),
    });
    await runSlashCommand("/roll 99d99", ctx);
    expect(said[0]).toMatchObject({ speaker: "System", text: "Roll failed: Error: bad dice" });
  });

  it("/check rolls 1d20 + derived modifier with DC 10 verdict", async () => {
    const { ctx, said } = makeCtx({
      getActiveCharacter: () => ({
        identity: { name: "Grimm" },
        attributes: { STR: { base_value: 16, derived_modifier: 3 } },
      }),
    });
    // total 15 >= DC 10 -> SUCCESS
    await runSlashCommand("/check str", ctx);
    expect(ctx.rollDice).toHaveBeenCalledWith("1d20+3");
    expect(said[0]).toMatchObject({
      speaker: "Check",
      text: "Grimm STR check: 15 vs DC 10 — SUCCESS ([1d20] = 15)",
    });
  });

  it("/check falls back to computed modifier when derived is absent", async () => {
    const { ctx } = makeCtx({
      getActiveCharacter: () => ({
        identity: { name: "Grimm" },
        attributes: { DEX: { base_value: 8 } }, // (8-10)/2 = -1
      }),
    });
    await runSlashCommand("/check dex", ctx);
    expect(ctx.rollDice).toHaveBeenCalledWith("1d20+-1");
  });

  it("/check without a character explains the problem", async () => {
    const { ctx, said } = makeCtx();
    await runSlashCommand("/check STR", ctx);
    expect(said[0].text).toBe(
      'No active character or unknown attribute "STR". Select a character first.',
    );
  });

  it("/ask consults the Oracle with the scene chaos factor", async () => {
    const { ctx, said } = makeCtx({ getChaosFactor: () => 7 });
    await runSlashCommand('/ask Is the door locked?', ctx);
    expect(ctx.fateCheck).toHaveBeenCalledWith("fifty_fifty", 7);
    expect(said[0]).toMatchObject({
      speaker: "Oracle",
      role: "narrator",
      text: '"Is the door locked?" — Yes (rolled 55 vs 50)',
    });
  });

  it("/help lists every command", async () => {
    const { ctx, said } = makeCtx();
    await runSlashCommand("/help", ctx);
    for (const cmd of ["/roll", "/check", "/ask", "/help"]) {
      expect(said[0].text).toContain(cmd);
    }
  });

  it("unknown slash commands hint at /help instead of reaching the DM", async () => {
    const { ctx, said } = makeCtx();
    expect(await runSlashCommand("/frobnicate now", ctx)).toBe(true);
    expect(said[0].text).toBe('Unknown command "/frobnicate". Try /help.');
  });
});
