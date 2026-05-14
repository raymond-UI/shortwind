import { describe, it, expect } from "vitest";
import { buildRegistry } from "../src/resolver.js";
import { loadResolverFixtures } from "./run-fixtures.js";

describe("buildRegistry (fixtures)", () => {
  for (const fx of loadResolverFixtures()) {
    it(fx.name, () => {
      const result = buildRegistry(fx.input);
      const actual = result.ok
        ? {
            ok: true,
            flattened: result.value.flattened,
            families: Object.fromEntries(
              Object.entries(result.value.families).map(([fam, recipes]) => [
                fam,
                recipes.map((r) => r.name),
              ]),
            ),
          }
        : { ok: false, errors: result.errors };
      expect(actual).toEqual(fx.expected);
    });
  }
});

describe("buildRegistry (registry shape)", () => {
  it("families maps each family name to its full Recipe[] (not just names)", () => {
    const result = buildRegistry([
      {
        name: "card",
        description: null,
        tokens: ["rounded-lg"],
        references: [],
        sourceFile: "card.css",
        sourceLine: 1,
      },
      {
        name: "btn",
        description: null,
        tokens: ["px-4"],
        references: [],
        sourceFile: "button.css",
        sourceLine: 1,
      },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.value.families).sort()).toEqual(["button", "card"]);
    expect(result.value.families["card"]).toEqual([
      {
        name: "card",
        description: null,
        tokens: ["rounded-lg"],
        references: [],
        sourceFile: "card.css",
        sourceLine: 1,
      },
    ]);
  });

  it("returns an empty registry for empty input", () => {
    const result = buildRegistry([]);
    expect(result).toEqual({
      ok: true,
      value: { flattened: {}, families: {} },
    });
  });
});
