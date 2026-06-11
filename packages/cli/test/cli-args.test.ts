import { describe, expect, it } from "vitest";
import { DEFAULT_PRESET, resolveInitPreset } from "../src/cli.js";

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
