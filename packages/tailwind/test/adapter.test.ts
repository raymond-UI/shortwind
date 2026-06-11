import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse } from "@babel/parser";
import { buildRegistry, type Recipe } from "@shortwind/core";
import {
  buildSourceDirective,
  computeSafelistTokens,
  detectTailwindMajor,
  findResidualRecipeTokens,
  findUnexpandedRecipes,
  hasTailwindImport,
  injectSourceDirective,
  loadRegistryFromDir,
  shortwindPlugin,
  SHORTWIND_INJECT_MARKER,
  TailwindAdapterError,
  transformContent,
} from "../src/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const REGISTRY_RECIPES = path.resolve(here, "..", "..", "registry", "recipes");

async function makeProject(opts: {
  tailwindVersion?: string;
  recipes?: Record<string, string>;
}): Promise<string> {
  const raw = await mkdtemp(path.join(tmpdir(), "shortwind-tw-"));
  const dir = realpathSync(raw);
  const pkg: { name: string; version: string; devDependencies?: Record<string, string> } = {
    name: "fixture",
    version: "0.0.0",
  };
  if (opts.tailwindVersion) {
    pkg.devDependencies = { tailwindcss: opts.tailwindVersion };
  }
  await writeFile(path.join(dir, "package.json"), JSON.stringify(pkg, null, 2));
  if (opts.recipes) {
    const recipesDir = path.join(dir, "recipes");
    await import("node:fs/promises").then((m) => m.mkdir(recipesDir, { recursive: true }));
    for (const [name, body] of Object.entries(opts.recipes)) {
      await writeFile(path.join(recipesDir, name), body);
    }
  }
  return dir;
}

describe("detectTailwindMajor", () => {
  let dirs: string[] = [];
  beforeEach(() => {
    dirs = [];
  });
  afterEach(async () => {
    for (const d of dirs) await rm(d, { recursive: true, force: true }).catch(() => {});
  });

  it("returns 3 for ^3.x", async () => {
    const dir = await makeProject({ tailwindVersion: "^3.4.0" });
    dirs.push(dir);
    expect(detectTailwindMajor(dir)).toBe(3);
  });

  it("returns 4 for ^4.x", async () => {
    const dir = await makeProject({ tailwindVersion: "^4.0.0" });
    dirs.push(dir);
    expect(detectTailwindMajor(dir)).toBe(4);
  });

  it("returns null when tailwindcss is missing", async () => {
    const dir = await makeProject({});
    dirs.push(dir);
    expect(detectTailwindMajor(dir)).toBeNull();
  });

  it("returns null when package.json is missing", async () => {
    const raw = await mkdtemp(path.join(tmpdir(), "shortwind-tw-bare-"));
    const dir = realpathSync(raw);
    dirs.push(dir);
    expect(detectTailwindMajor(dir)).toBeNull();
  });
});

describe("loadRegistryFromDir", () => {
  it("loads the bundled card+button recipes from the registry", () => {
    const registry = loadRegistryFromDir(REGISTRY_RECIPES);
    expect(Object.keys(registry.families)).toContain("card");
    expect(Object.keys(registry.families)).toContain("button");
    expect(registry.flattened["card"]).toBeTruthy();
  });

  it("returns an empty registry when the directory does not exist", () => {
    const registry = loadRegistryFromDir("/nonexistent/shortwind/recipes");
    expect(registry).toEqual({ families: {}, flattened: {} });
  });
});

describe("transformContent", () => {
  const registry = loadRegistryFromDir(REGISTRY_RECIPES);

  it("rewrites class= attributes so Tailwind JIT sees expanded utilities", () => {
    const before = `<div class="@card p-6"><a class="@btn-primary">Go</a></div>`;
    const after = transformContent(before, registry);
    const cardTokens = registry.flattened["card"] ?? [];
    const btnTokens = registry.flattened["btn-primary"] ?? [];
    expect(cardTokens.length).toBeGreaterThan(0);
    expect(btnTokens.length).toBeGreaterThan(0);
    // first expanded token from card and btn-primary should appear in the output
    expect(after).toContain(cardTokens[0]);
    expect(after).toContain(btnTokens[0]);
    // raw @card token should be gone
    expect(after).not.toMatch(/class="[^"]*@card[^"]*"/);
  });

  it("handles JSX className attributes", () => {
    const before = `<button className="@btn-primary">Go</button>`;
    const after = transformContent(before, registry);
    const tokens = registry.flattened["btn-primary"] ?? [];
    expect(after).toContain(tokens[0]);
  });

  it("leaves unrelated content untouched", () => {
    const input = "// just a comment with @card in it but not in a class attribute\n";
    const after = transformContent(input, registry);
    expect(after).toBe(input);
  });

  it("does not rewrite unrelated string literals in JSX mode", () => {
    const input = [
      `const label = "@card";`,
      `export const View = () => <div title="@card" className="plain" />;`,
      ``,
    ].join("\n");
    expect(transformContent(input, registry)).toBe(input);
  });

  it("rewrites string literals inside className expressions without touching comments", () => {
    const before = [
      `import clsx from "clsx";`,
      `// className="@card" should stay as comment text`,
      `export const View = ({ on }: { on: boolean }) => (`,
      `  <button className={clsx("@btn-primary", on && "@btn-ghost")}>Go</button>`,
      `);`,
      ``,
    ].join("\n");
    const after = transformContent(before, registry);
    expect(after).toContain(`// className="@card" should stay as comment text`);
    expect(after).not.toMatch(/"@btn-primary"/);
    expect(after).not.toMatch(/"@btn-ghost"/);
    expect(after).toContain("inline-flex");
  });

  it("rewrites only static portions of className template literals", () => {
    const before = [
      `export const View = ({ active }: { active: string }) => (`,
      "  <div className={`@card ${active} @stack-sm`} />",
      `);`,
      ``,
    ].join("\n");
    const after = transformContent(before, registry);
    expect(after).toContain("${active}");
    expect(after).not.toContain("@card");
    expect(after).not.toContain("@stack-sm");
  });

  it("expands recipe string literals inside template-literal interpolations", () => {
    const before = [
      `export const View = ({ on }: { on: boolean }) => (`,
      "  <button className={`@btn-base ${on ? '@btn-primary' : '@btn-ghost'}`}>Go</button>",
      `);`,
      ``,
    ].join("\n");
    const after = transformContent(before, registry);
    // both the quasi recipe and the recipes inside the ${...} ternary expand
    expect(after).not.toMatch(/'@btn-primary'/);
    expect(after).not.toMatch(/'@btn-ghost'/);
    expect(after).not.toContain("@btn-base");
    expect(after).toContain("inline-flex"); // a real expanded utility
  });

  it("expands literal-string ternary branches inside className={…} (#66)", () => {
    // The docs used to claim this does NOT expand — it does: the transform
    // visits the StringLiteral branches of the conditional.
    const before = [
      `export const Tab = ({ active }: { active: boolean }) => (`,
      `  <a className={active ? "@btn-primary" : "@btn-ghost"}>tab</a>`,
      `);`,
      ``,
    ].join("\n");
    const after = transformContent(before, registry);
    expect(after).not.toContain("@btn-primary");
    expect(after).not.toContain("@btn-ghost");
    expect(after).toContain("inline-flex");
  });

  it("does NOT expand a recipe that reaches className via a variable or prop (#66)", () => {
    // The real silent failure: the recipe text is a plain string by the time
    // it hits the attribute, so the transform never sees it — byte-identical
    // passthrough, no warning possible at this stage.
    const before = [
      `const cfg = { recipe: "@btn-primary" };`,
      `export const El = () => <a className={cfg.recipe}>go</a>;`,
      ``,
    ].join("\n");
    const after = transformContent(before, registry);
    expect(after).toBe(before);
  });

  it("rewrites configured class helper calls but leaves ordinary calls alone", () => {
    const before = [
      `const styles = cva("@btn-primary", { variants: { tone: { ghost: "@btn-ghost" } } });`,
      `const ordinary = make("@btn-primary");`,
      ``,
    ].join("\n");
    const after = transformContent(before, registry);
    expect(after).not.toMatch(/cva\("@btn-primary"/);
    expect(after).not.toMatch(/ghost: "@btn-ghost"/);
    expect(after).toContain(`const ordinary = make("@btn-primary");`);
  });

  it("allows custom class helper names", () => {
    const before = `const styles = styled("@btn-primary");`;
    const after = transformContent(before, registry, { callExpanders: ["styled"] });
    expect(after).not.toContain("@btn-primary");
    expect(after).toContain("inline-flex");
  });
});

describe("quote-bearing token escaping (#47)", () => {
  const recipe = (name: string, tokens: string[]): Recipe => ({
    name,
    description: null,
    tokens,
    references: [],
    sourceFile: `${name}.css`,
    sourceLine: 1,
  });
  const reg = (recipes: Recipe[]) => {
    const r = buildRegistry(recipes);
    if (!r.ok) throw new Error("registry build failed: " + JSON.stringify(r.errors));
    return r.value;
  };
  const reparses = (code: string): boolean => {
    try {
      parse(code, { sourceType: "module", plugins: ["jsx", "typescript"] });
      return true;
    } catch {
      return false;
    }
  };

  it("keeps a single-quoted className valid JS when expansion contains a single quote", () => {
    const registry = reg([recipe("icon", ["before:content-['x']", "inline-block"])]);
    const out = transformContent(`const C = () => <i className='@icon' />;`, registry);
    expect(reparses(out), `transform produced invalid JS: ${out}`).toBe(true);
    // bare JSX attribute → delimiter switched to ", single quotes kept literal
    expect(out).toContain(`"before:content-['x'] inline-block"`);
  });

  it("neutralizes a hostile breakout token inside cva() instead of emitting code", () => {
    // `x'};alert(1);//` would close the string + inject a statement if unescaped;
    // unescaped, `cva('x'};alert(1);//')` is itself a syntax error, so a passing
    // reparse proves the quote was escaped.
    const registry = reg([recipe("evil", ["x'};alert(1);//"])]);
    const out = transformContent(`const v = cva('@evil');`, registry);
    expect(reparses(out), `injection produced broken JS: ${out}`).toBe(true);
    expect(out).toContain("\\'"); // the quote was escaped, not left to break out
  });

  it("escapes an expansion spliced into a template-literal className", () => {
    const registry = reg([recipe("icon", ["before:content-['x']"])]);
    const out = transformContent("const C = () => <i className={`@icon base`} />;", registry);
    expect(reparses(out), out).toBe(true);
  });

  it("rejects a backtick-bearing token at the registry boundary", () => {
    const r = buildRegistry([recipe("tick", ["a`b"])]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.some((e) => e.code === "resolve/unsafe-token")).toBe(true);
  });
});

describe("findResidualRecipeTokens (#67)", () => {
  const registry = loadRegistryFromDir(REGISTRY_RECIPES);

  it("flags a known recipe ANYWHERE in transformed output, not just class values", () => {
    // The variable-indirection leak: the token sits at the assignment site,
    // which the class-value scan (findUnexpandedRecipes) never sees. All three
    // dogfooding builds shipped leaks a manual grep had to catch.
    const code = `const cfg = { recipe: "@card" };\nexport const El = () => <div className={cfg.recipe} />;`;
    expect(findResidualRecipeTokens(code, registry)).toEqual(["@card"]);
  });

  it("ignores @-tokens that are not recipe names", () => {
    const code = `// email me @cardholder\n<div className="@md:flex" />`;
    expect(findResidualRecipeTokens(code, registry)).toEqual([]);
  });

  it("returns nothing for fully-expanded output", () => {
    const out = transformContent(`<div className="@card" />`, registry);
    expect(findResidualRecipeTokens(out, registry)).toEqual([]);
  });
});

describe("findUnexpandedRecipes", () => {
  const registry = loadRegistryFromDir(REGISTRY_RECIPES);

  it("flags a known recipe left in a className value", () => {
    const code = `<div className="@card text-center" />`;
    expect(findUnexpandedRecipes(code, registry)).toEqual(["@card"]);
  });

  it("returns nothing once the transform has expanded everything", () => {
    const out = transformContent(`<div className="@card" />`, registry);
    expect(findUnexpandedRecipes(out, registry)).toEqual([]);
  });

  it("does not flag genuine Tailwind @-utilities that aren't recipe names", () => {
    // container-query variants like @md:/@max-lg: are real Tailwind, not recipes
    const code = `<div className="@md:flex @max-lg:hidden" />`;
    expect(findUnexpandedRecipes(code, registry)).toEqual([]);
  });

  it("catches a recipe stranded inside a dynamic className", () => {
    const code = "<button className={`@btn-base ${on ? '@btn-primary' : '@btn-ghost'}`} />";
    const found = findUnexpandedRecipes(code, registry);
    expect(found).toContain("@btn-primary");
    expect(found).toContain("@btn-ghost");
  });

  it("catches recipes inside an Astro class:list array directive", () => {
    const code = `<a class:list={[active ? "@nav-link-active" : "@nav-link"]}>Home</a>`;
    const found = findUnexpandedRecipes(code, registry);
    expect(found).toContain("@nav-link");
    expect(found).toContain("@nav-link-active");
  });

  it("catches a recipe inside an Astro class:list object directive", () => {
    const code = `<a class:list={{ "@nav-link": true }}>Home</a>`;
    expect(findUnexpandedRecipes(code, registry)).toContain("@nav-link");
  });

  it("does not mistake a single-class directive (class:name) for a class value", () => {
    // Svelte `class:active={cond}` toggles the literal class `active`; there's no
    // recipe string to miss, so it must not be scanned as a class value.
    const code = `<a class:active={isOn}>Home</a>`;
    expect(findUnexpandedRecipes(code, registry)).toEqual([]);
  });
});

describe("source directive injection", () => {
  const registry = loadRegistryFromDir(REGISTRY_RECIPES);

  it("collects unique sorted tokens across all flattened recipes", () => {
    const tokens = computeSafelistTokens(registry);
    expect(tokens.length).toBeGreaterThan(0);
    expect(new Set(tokens).size).toBe(tokens.length);
    expect([...tokens]).toEqual([...tokens].sort());
  });

  it("builds a single @source inline(...) directive listing every token", () => {
    const directive = buildSourceDirective(registry);
    expect(directive.startsWith('@source inline("')).toBe(true);
    expect(directive.endsWith('");')).toBe(true);
    const tokens = computeSafelistTokens(registry);
    for (const t of tokens) expect(directive).toContain(t);
  });

  it("returns empty string for an empty registry", () => {
    expect(buildSourceDirective({ families: {}, flattened: {} })).toBe("");
  });

  it("detects a tailwindcss import regardless of quote style", () => {
    expect(hasTailwindImport(`@import "tailwindcss";`)).toBe(true);
    expect(hasTailwindImport(`@import 'tailwindcss';`)).toBe(true);
    expect(hasTailwindImport(`@import "tailwindcss" source(none);`)).toBe(true);
    expect(hasTailwindImport(`@import "./other.css";`)).toBe(false);
  });

  it("injects the directive immediately after the tailwindcss import", () => {
    const before = `@import "tailwindcss";\n\n:root { --x: 1; }\n`;
    const after = injectSourceDirective(before, registry);
    expect(after).toContain(SHORTWIND_INJECT_MARKER);
    const importIdx = after.indexOf(`@import "tailwindcss"`);
    const markerIdx = after.indexOf(SHORTWIND_INJECT_MARKER);
    const rootIdx = after.indexOf(":root");
    expect(importIdx).toBeLessThan(markerIdx);
    expect(markerIdx).toBeLessThan(rootIdx);
  });

  it("is idempotent — re-injecting on already-injected CSS is a no-op", () => {
    const once = injectSourceDirective(`@import "tailwindcss";`, registry);
    const twice = injectSourceDirective(once, registry);
    expect(twice).toBe(once);
  });

  it("returns the input unchanged when there is no tailwindcss import", () => {
    const input = `:root { --x: 1; }`;
    expect(injectSourceDirective(input, registry)).toBe(input);
  });

  it("returns the input unchanged for an empty registry", () => {
    const input = `@import "tailwindcss";`;
    expect(injectSourceDirective(input, { families: {}, flattened: {} })).toBe(
      input,
    );
  });
});

describe("shortwindPlugin", () => {
  let dirs: string[] = [];
  beforeEach(() => {
    dirs = [];
  });
  afterEach(async () => {
    for (const d of dirs) await rm(d, { recursive: true, force: true }).catch(() => {});
  });

  it("returns a v3-shaped plugin in a v3 project", async () => {
    const dir = await makeProject({ tailwindVersion: "^3.4.0" });
    dirs.push(dir);
    const plugin = shortwindPlugin({ cwd: dir });
    expect(plugin.major).toBe(3);
    if (plugin.major === 3) {
      expect(typeof plugin.content.transform["html"]).toBe("function");
      expect(typeof plugin.content.transform["jsx"]).toBe("function");
    }
  });

  it("returns a v4-shaped plugin in a v4 project", async () => {
    const dir = await makeProject({ tailwindVersion: "^4.0.0" });
    dirs.push(dir);
    const plugin = shortwindPlugin({ cwd: dir });
    expect(plugin.major).toBe(4);
    expect(typeof plugin.transform).toBe("function");
  });

  it("throws TailwindAdapterError when tailwindcss is not in package.json", async () => {
    const dir = await makeProject({});
    dirs.push(dir);
    expect(() => shortwindPlugin({ cwd: dir })).toThrow(TailwindAdapterError);
    try {
      shortwindPlugin({ cwd: dir });
    } catch (err) {
      expect((err as Error).message).toMatch(/tailwindcss/);
    }
  });

  it("end-to-end: v4 plugin transform expands @recipe tokens", async () => {
    const dir = await makeProject({
      tailwindVersion: "^4.0.0",
      recipes: {
        "card.css":
          "/* shortwind: card@0.0.1 sha:000000 */\n\n/* card. */\n@recipe card { rounded-lg border p-4 }\n",
      },
    });
    dirs.push(dir);
    const plugin = shortwindPlugin({ cwd: dir, recipesDir: path.join(dir, "recipes") });
    const out = plugin.transform(`<div class="@card text-center"></div>`);
    expect(out).toContain("rounded-lg");
    expect(out).toContain("border");
    expect(out).toContain("p-4");
    expect(out).toContain("text-center");
    expect(out).not.toMatch(/@card\b/);
  });
});
