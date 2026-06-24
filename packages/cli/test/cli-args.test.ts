import { describe, expect, it } from "vitest";
import { DEFAULT_PRESET, resolveInitPreset, formatFatalError } from "../src/cli.js";

describe("formatFatalError — top-level handler (audit #156)", () => {
  it("prints only the message by default (no stack leak)", () => {
    const err = new Error("not logged in");
    err.stack = "Error: not logged in\n    at /Users/secret/path/home.ts:237:11";
    const out = formatFatalError(err, false);
    expect(out).toBe("not logged in");
    expect(out).not.toContain("/Users/secret/path");
    expect(out).not.toContain("home.ts");
  });

  it("includes the full stack when debug is on", () => {
    const err = new Error("boom");
    err.stack = "Error: boom\n    at somewhere.ts:1:1";
    expect(formatFatalError(err, true)).toContain("at somewhere.ts:1:1");
  });

  it("stringifies non-Error throwns", () => {
    expect(formatFatalError("plain string", false)).toBe("plain string");
    expect(formatFatalError({ code: 7 }, true)).toBe("[object Object]");
  });
});

describe("init preset resolution (#68)", () => {
  const neverPrompt = (): Promise<string> => {
    throw new Error("prompted — init must be scriptable without a TTY");
  };

  it("--yes picks the default preset without prompting", async () => {
    await expect(resolveInitPreset({ yes: true }, neverPrompt)).resolves.toBe(DEFAULT_PRESET);
  });

  it("--preset wins over --yes", async () => {
    await expect(resolveInitPreset({ preset: "app", yes: true }, neverPrompt)).resolves.toBe("app");
  });

  it("an explicit --preset never prompts", async () => {
    await expect(resolveInitPreset({ preset: "none" }, neverPrompt)).resolves.toBe("none");
  });

  it("prompts only when neither --preset nor --yes is given", async () => {
    let prompted = 0;
    const prompt = async (): Promise<string> => {
      prompted++;
      return "content";
    };
    await expect(resolveInitPreset({}, prompt)).resolves.toBe("content");
    expect(prompted).toBe(1);
  });
});
