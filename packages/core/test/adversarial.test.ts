import { describe, expect, it } from "vitest";
import { parseRecipeFile } from "../src/parser.js";
import { buildRegistry } from "../src/resolver.js";
import { expand, expandClassList } from "../src/expander.js";
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

describe("quote-bearing tokens (#47)", () => {
  it("rejects a recipe token containing a double-quote at resolve time", () => {
    const result = buildRegistry([recipe("glow", ['x"onload=alert(1)', "p-4"], "glow.css")]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.code === "resolve/unsafe-token")).toBe(true);
  });

  it("re-quotes a single-quoted host attribute when the expansion contains a single quote", () => {
    // content-['→'] is a legitimate Tailwind value; expanded into class='...'
    // it would break out, so the host switches to double quotes.
    const built = buildRegistry([recipe("ico", ["before:content-['→']", "inline-block"], "ico.css")]);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const out = expand(`<i class='@ico'></i>`, built.value, { mode: "html" });
    expect(out).toContain(`before:content-['→']`);
    // no broken/unbalanced single-quote attribute
    expect(out).not.toMatch(/class='[^']*'[^>]*'/);
    expect(out).toContain(`class="before:content-['→'] inline-block"`);
  });
});

describe("html-mode expansion correctness (#46)", () => {
  const built = buildRegistry([recipe("card", ["rounded-lg", "border"], "card.css")]);
  const registry = built.ok ? built.value : { families: {}, flattened: {} };

  it("does not rewrite class assignments or strings inside a <script> block", () => {
    const src = `<script>obj.class = "px-2 p-4"; const s = 'class="@card"';</script><div class="@card"></div>`;
    const out = expand(src, registry, { mode: "html" });
    // script untouched verbatim, template div expanded
    expect(out).toContain(`obj.class = "px-2 p-4"; const s = 'class="@card"'`);
    expect(out).toContain(`<div class="rounded-lg border"></div>`);
  });

  it("masks an Astro `---` frontmatter fence from attribute rewriting", () => {
    const src = `---\nconst klass = "p-2 p-4";\n---\n<div class="@card"></div>`;
    const out = expand(src, registry, { mode: "html" });
    expect(out).toContain(`const klass = "p-2 p-4";`);
    expect(out).toContain(`<div class="rounded-lg border"></div>`);
  });

  it("expands cva()/tv() in html mode when callExpanders are passed (#46.3)", () => {
    const src = `<script>const v = cva("@card");</script>`;
    const out = expand(src, registry, { mode: "html", callExpanders: ["cva", "tv"] });
    expect(out).toContain(`cva("rounded-lg border")`);
  });

  it("does not let a commented-out <script> swallow following markup", () => {
    const src = `<!-- <script> --><div class="@card"></div>`;
    const out = expand(src, registry, { mode: "html" });
    // the div after the commented script must still expand
    expect(out).toContain(`<div class="rounded-lg border"></div>`);
  });

  it("masks an UNCLOSED <script> to EOF so its JS isn't corrupted", () => {
    const src = `<div class="@card"></div><script>obj.class = "p-2 p-4"`;
    const out = expand(src, registry, { mode: "html" });
    expect(out).toContain(`<div class="rounded-lg border"></div>`);
    // the truncated script's JS is left byte-identical
    expect(out).toContain(`obj.class = "p-2 p-4"`);
  });

  it("does not let an unclosed <script> mask static recipes downstream (#60)", () => {
    // Adapter inputs (Astro compiled modules) can contain a `<script` whose
    // closing tag is not a literal in the same chunk. The EOF fallback must
    // not blackhole the rest of the document: the script's own JS stays
    // untouched, but a downstream element with a class attribute still expands.
    const src = `<script>obj.class = "p-2 p-4";\n\${$$renderHead($$result)}</head><main class="@card">x</main>`;
    const out = expand(src, registry, { mode: "html" });
    expect(out).toContain(`obj.class = "p-2 p-4";`);
    expect(out).toContain(`<main class="rounded-lg border">x</main>`);
  });

  it("does not expand cva() sitting in template prose, only in <script>", () => {
    const src = `<p>call cva("@card") to make a button</p><script>const v = cva("@card");</script>`;
    const out = expand(src, registry, { mode: "html", callExpanders: ["cva", "tv"] });
    // prose left untouched
    expect(out).toContain(`<p>call cva("@card") to make a button</p>`);
    // script's cva expanded
    expect(out).toContain(`const v = cva("rounded-lg border");`);
  });

  it("survives source that contains the mask sentinel itself (collision defense)", () => {
    // Prose that happens to look like the placeholder (docs about shortwind,
    // this very test file) must never be rewritten into stash content on
    // restore — the masker grows its sentinel until it's not present in input.
    const src = `<p>__SHORTWIND_MASK_0__</p><script>const a = 1;</script><div class="@card"></div>`;
    const out = expand(src, registry, { mode: "html" });
    expect(out).toContain(`<p>__SHORTWIND_MASK_0__</p>`);
    expect(out).toContain(`<script>const a = 1;</script>`);
    expect(out).toContain(`<div class="rounded-lg border"></div>`);
  });

  it("collision defense holds for the grown sentinel too", () => {
    const src = `<p>__SHORTWIND_MASK_0__ and __SHORTWIND_MASKX_1__</p><script>const a = 1;</script>`;
    const out = expand(src, registry, { mode: "html" });
    expect(out).toContain(`<p>__SHORTWIND_MASK_0__ and __SHORTWIND_MASKX_1__</p>`);
    expect(out).toContain(`<script>const a = 1;</script>`);
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

  it("keeps the newline count stable when a multi-line class value collapses (#48)", () => {
    const out = expandClassList("@card\n  p-2", registry, true);
    expect(out).toContain("rounded");
    // the one newline the collapse removed is preserved, so downstream lines
    // don't shift
    expect((out.match(/\n/g) ?? []).length).toBe(1);
  });

  it("does not shift subsequent source lines after a multi-line expansion (#48)", () => {
    const src = `<div class="@card\n  p-2"></div>\n<span>next</span>`;
    const out = expand(src, registry, { mode: "html" });
    expect((out.match(/\n/g) ?? []).length).toBe((src.match(/\n/g) ?? []).length);
  });
});
