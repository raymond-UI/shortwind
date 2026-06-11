import { describe, expect, it } from "vitest";
import { parseRecipeFile } from "../src/parser.js";
import { buildRegistry } from "../src/resolver.js";
import { expandClassList } from "../src/expander.js";
import type { Recipe, Registry } from "../src/types.js";

function recipe(name: string, tokens: string[], sourceFile = `${name}.css`): Recipe {
  return {
    name,
    description: null,
    tokens,
    references: tokens.filter((t) => t.startsWith("@")).map((t) => t.slice(1)),
    sourceFile,
    sourceLine: 1,
  };
}

// Hostile / malformed input must terminate and stay within the {ok,errors}
// contract — never hang, OOM, throw, or silently corrupt the registry. Each
// case maps to an audit finding (#39 parser, #40 proto-keys, #41 amplification,
// #43 passthrough).
describe("parser robustness (#39)", () => {
  it("terminates on `@recipe` followed by identifier chars instead of looping", () => {
    const start = performance.now();
    const result = parseRecipeFile("@recipex { p-4 }\n", "input.css");
    expect(performance.now() - start).toBeLessThan(500);
    expect(result.ok).toBe(false);
  });

  it("does not backtrack polynomially on an adversarial line-1 header comment", () => {
    // many `@`s, no `sha:` — the unbounded header regex would pin the parser.
    const body = "shortwind: " + "@".repeat(40_000);
    const start = performance.now();
    const result = parseRecipeFile(`/* ${body} */\n`, "input.css");
    expect(performance.now() - start).toBeLessThan(200);
    expect(result.ok).toBe(true);
  });
});

describe("resolver reference amplification (#41)", () => {
  it("rejects an exponential doubling chain without RangeError/OOM", () => {
    // a0 has 1 token; each a{n} doubles the previous → a20 would be 2^20 tokens.
    const recipes: Recipe[] = [recipe("a0", ["p-1"])];
    for (let n = 1; n <= 20; n++) {
      recipes.push(recipe(`a${n}`, [`@a${n - 1}`, `@a${n - 1}`]));
    }
    const start = performance.now();
    const result = buildRegistry(recipes);
    expect(performance.now() - start).toBeLessThan(1000);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.code === "resolve/expansion-too-large")).toBe(true);
  });

  it("rejects a pathologically deep non-branching chain without stack overflow", () => {
    const recipes: Recipe[] = [recipe("d0", ["p-1"])];
    for (let n = 1; n <= 5000; n++) recipes.push(recipe(`d${n}`, [`@d${n - 1}`]));
    // Resolve top-first so the walk recurses the full depth before any
    // bottom-up memoization kicks in (source order d0→d5000 would resolve in
    // O(n) with no deep recursion and never exercise the guard).
    recipes.reverse();
    const result = buildRegistry(recipes);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.code === "resolve/expansion-too-large")).toBe(true);
  });
});

describe("prototype-key names (#40)", () => {
  it("rejects proto-key recipe names with a diagnostic instead of corrupting the registry", () => {
    for (const bad of ["__proto__", "constructor", "prototype"]) {
      const result = buildRegistry([recipe(bad, ["p-4"], "x.css")]);
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.errors.some((e) => e.code === "resolve/reserved-name")).toBe(true);
    }
  });

  it("rejects a proto-key family name (e.g. constructor.css) instead of throwing", () => {
    const result = buildRegistry([recipe("safe", ["p-4"], "constructor.css")]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.code === "resolve/reserved-name")).toBe(true);
  });

  it("produces null-prototype registry containers so a proto-key class can't resolve an inherited member", () => {
    const result = buildRegistry([recipe("card", ["rounded", "border"], "card.css")]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.getPrototypeOf(result.value.flattened)).toBe(null);
    expect(Object.getPrototypeOf(result.value.families)).toBe(null);
    // `@constructor` / `@toString` resolve to no own property → pass through
    // literally, never spreading a non-iterable prototype member.
    expect(() => expandClassList("@constructor @toString", result.value, true)).not.toThrow();
    expect(expandClassList("@constructor @toString", result.value, true)).toBe(
      "@constructor @toString",
    );
  });
});

describe("expandClassList passthrough (#43)", () => {
  const registry: Registry = {
    flattened: Object.assign(Object.create(null), { card: ["rounded", "border", "p-4"] }),
    families: Object.create(null),
  };

  it("returns a recipe-free class list byte-identical (no twMerge rewrite)", () => {
    // twMerge would drop px-2 (p-4 wins) and collapse whitespace; installing a
    // recipe must not change recipe-free markup.
    expect(expandClassList("px-2 p-4 flex flex-col", registry, true)).toBe(
      "px-2 p-4 flex flex-col",
    );
    expect(expandClassList("p-4 p-6", registry, true)).toBe("p-4 p-6");
  });

  it("still merges conflicts once a recipe actually expands", () => {
    expect(expandClassList("@card p-6", registry, true)).toBe("rounded border p-6");
  });
});
