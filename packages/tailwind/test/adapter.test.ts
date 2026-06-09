import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildSourceDirective,
  computeSafelistTokens,
  detectTailwindMajor,
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
