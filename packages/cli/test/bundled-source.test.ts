import { describe, expect, it } from "vitest";
import { bundledSource, resolvePresetFamilies, BUNDLED_ORIGIN } from "../src/registry-source.js";
import { parseRecipeFile } from "@shortwind/core";

describe("bundledSource", () => {
  const src = bundledSource();

  it("resolves presets, families, and recipes with no network", async () => {
    expect(src.origin).toBe(BUNDLED_ORIGIN);
    const presets = await src.loadPresets();
    const all = await src.listAllFamilies();
    expect(all.length).toBeGreaterThanOrEqual(19);
    expect(all).toContain("surface");
    expect(resolvePresetFamilies("starter", presets, all)).toEqual([
      "card",
      "button",
      "layout",
      "text",
      "form",
    ]);
  });

  it("returns sealed, versioned recipe CSS that parses", async () => {
    const css = await src.loadFamily("surface");
    const parsed = parseRecipeFile(css, "surface.css");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    // the bundle ships the built (sealed) recipes — real sha, post-rename names
    expect(parsed.value.header?.version).toBe("0.0.2");
    expect(parsed.value.header?.sha).not.toBe("000000");
    expect(parsed.value.recipes.some((r) => r.name === "wrapper")).toBe(true);
    expect(parsed.value.recipes.some((r) => r.name === "container")).toBe(false);
  });

  it("throws on an unknown family", async () => {
    await expect(src.loadFamily("nope")).rejects.toThrow();
  });
});
