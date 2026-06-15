import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { realpathSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { withShortwind, shortwindLoader } from "../src/index.js";
import { clearRegistryCache } from "../src/loader.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const REGISTRY = path.resolve(here, "..", "..", "registry");
const CARD_CSS = readFileSync(path.join(REGISTRY, "recipes", "card.css"), "utf8");

async function makeProject(recipes: Record<string, string> = {}): Promise<string> {
  const raw = await mkdtemp(path.join(tmpdir(), "shortwind-next-"));
  const dir = realpathSync(raw);
  await writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "x" }, null, 2));
  const recipesDir = path.join(dir, "recipes");
  await mkdir(recipesDir, { recursive: true });
  for (const [name, body] of Object.entries(recipes)) {
    await writeFile(path.join(recipesDir, name), body);
  }
  return dir;
}

describe("withShortwind", () => {
  let dirs: string[] = [];
  beforeEach(() => {
    dirs = [];
    clearRegistryCache();
  });
  afterEach(async () => {
    for (const d of dirs) await rm(d, { recursive: true, force: true }).catch(() => {});
  });

  it("wraps an existing Next config and adds a webpack hook", async () => {
    const dir = await makeProject();
    dirs.push(dir);
    const wrapped = withShortwind({ cwd: dir })({ reactStrictMode: true });
    expect(wrapped.reactStrictMode).toBe(true);
    expect(typeof wrapped.webpack).toBe("function");
  });

  it("re-exports expandClassList + loadRegistryFromDir for the server-side rc() pattern (#63)", async () => {
    const mod = await import("../src/index.js");
    expect(typeof mod.expandClassList).toBe("function");
    expect(typeof mod.loadRegistryFromDir).toBe("function");
    const dir = await makeProject({ "card.css": CARD_CSS });
    dirs.push(dir);
    const registry = mod.loadRegistryFromDir(path.join(dir, "recipes"));
    const expanded = mod.expandClassList("@card p-6", registry, true);
    expect(expanded).not.toMatch(/@card\b/);
    expect(expanded).toContain("p-6");
  });

  it("the documented snippet shape yields a plain config object, not a function (#61)", async () => {
    // Mirrors the README / CLI snippet: export default withShortwind()(nextConfig)
    const dir = await makeProject();
    dirs.push(dir);
    const nextConfig = { reactStrictMode: true };
    const wrapped = withShortwind({ cwd: dir })(nextConfig);
    expect(typeof wrapped).toBe("object");
    expect(typeof wrapped).not.toBe("function");
    expect(wrapped.reactStrictMode).toBe(true);
  });

  it("writes the safelist to a sibling file and injects one @import into the entry CSS (#73)", async () => {
    const dir = await makeProject({ "card.css": CARD_CSS });
    dirs.push(dir);
    const globals = path.join(dir, "app", "globals.css");
    const safelist = path.join(dir, "app", "globals.shortwind.css");
    await mkdir(path.dirname(globals), { recursive: true });
    await writeFile(globals, `@import "tailwindcss";\n`);

    withShortwind({ cwd: dir })({});

    // Entry CSS gets one managed import; no `@source inline(` clutter.
    const css = readFileSync(globals, "utf8");
    expect(css).toContain(`@import "./globals.shortwind.css";`);
    expect(css).not.toContain("@source inline(");
    // The safelist itself lives in the sibling file. A utility that exists only
    // inside the card recipe body — the exact candidate Tailwind could never
    // discover by scanning files on disk.
    const safelistCss = readFileSync(safelist, "utf8");
    expect(safelistCss).toContain("@source inline(");
    expect(safelistCss).toContain("bg-card");
    // Idempotent: wrapping again must not change either file.
    withShortwind({ cwd: dir })({});
    expect(readFileSync(globals, "utf8")).toBe(css);
    expect(readFileSync(safelist, "utf8")).toBe(safelistCss);
  });

  it("loader refreshes the on-disk safelist when recipes change mid-session (#73)", async () => {
    const dir = await makeProject({ "card.css": CARD_CSS });
    dirs.push(dir);
    const globals = path.join(dir, "app", "globals.css");
    const safelist = path.join(dir, "app", "globals.shortwind.css");
    await mkdir(path.dirname(globals), { recursive: true });
    await writeFile(globals, `@import "tailwindcss";\n`);
    withShortwind({ cwd: dir })({});
    expect(readFileSync(safelist, "utf8")).not.toContain("bg-emerald-100");

    // A custom recipe authored while `next dev` is running.
    await writeFile(
      path.join(dir, "recipes", "hero.css"),
      `@recipe hero {\n  bg-emerald-100 rounded-xl\n}\n`,
    );
    clearRegistryCache();
    const ctx = {
      getOptions: () => ({
        recipesDir: path.join(dir, "recipes"),
        entryCss: [globals],
      }),
      resourcePath: path.join(dir, "src", "App.tsx"),
    };
    shortwindLoader.call(ctx, `export const El = () => <div className="@hero" />;\n`);
    expect(readFileSync(safelist, "utf8")).toContain("bg-emerald-100");
  });

  it("webpack hook prepends a pre-loader rule for source files", async () => {
    const dir = await makeProject();
    dirs.push(dir);
    const wrapped = withShortwind({ cwd: dir })({});
    const cfg = wrapped.webpack!({ module: { rules: [{ existing: true }] } }, {
      dev: false,
      isServer: false,
    });
    const rules = cfg.module?.rules as Array<Record<string, unknown>>;
    expect(rules?.length).toBe(2);
    const first = rules[0]!;
    expect(first["enforce"]).toBe("pre");
    expect(String((first["test"] as RegExp).source)).toContain("tsx?");
    const use = first["use"] as Array<{ loader: string; options: { recipesDir: string } }>;
    expect(use[0]?.loader).toMatch(/loader\.js$/);
    expect(use[0]?.options.recipesDir).toBe(path.join(dir, "recipes"));
  });

  it("preserves a caller-supplied webpack function", async () => {
    const dir = await makeProject();
    dirs.push(dir);
    const calls: string[] = [];
    const userWebpack = (config: { module?: { rules?: unknown[] } }) => {
      calls.push("user");
      config.module ??= { rules: [] };
      (config.module.rules as unknown[]).push({ userRule: true });
      return config;
    };
    const wrapped = withShortwind({ cwd: dir })({ webpack: userWebpack });
    const cfg = wrapped.webpack!(
      { module: { rules: [] } },
      { dev: false, isServer: false },
    );
    expect(calls).toEqual(["user"]);
    const rules = cfg.module?.rules as Array<Record<string, unknown>>;
    // user rule got appended, our rule got unshifted at index 0
    expect(rules[0]?.["enforce"]).toBe("pre");
    expect(rules.find((r) => r["userRule"] === true)).toBeTruthy();
  });

  it("registers a turbopack rule for source extensions", async () => {
    const dir = await makeProject();
    dirs.push(dir);
    const wrapped = withShortwind({ cwd: dir })({});
    const rules = (wrapped.turbopack?.rules ?? {}) as Record<string, unknown>;
    const key = Object.keys(rules).find((k) => k.includes("tsx"));
    expect(key).toBeTruthy();
    expect(rules[key!]).toMatchObject({
      loaders: [{ loader: expect.stringMatching(/loader\.js$/), options: { recipesDir: path.join(dir, "recipes") } }],
    });
  });

  it("preserves caller-supplied turbopack rules", async () => {
    const dir = await makeProject();
    dirs.push(dir);
    const wrapped = withShortwind({ cwd: dir })({
      turbopack: { rules: { "*.svg": { loaders: ["custom-svg"] } } },
    });
    const rules = wrapped.turbopack?.rules ?? {};
    expect(rules["*.svg"]).toBeTruthy();
    expect(Object.keys(rules).some((k) => k.includes("tsx"))).toBe(true);
  });

  it("strict loader errors the module on a residual token reached via a variable (#67)", async () => {
    const dir = await makeProject({ "card.css": CARD_CSS });
    dirs.push(dir);
    const errors: Error[] = [];
    const ctx = {
      getOptions: () => ({ recipesDir: path.join(dir, "recipes"), strict: true }),
      resourcePath: path.join(dir, "src", "App.tsx"),
      emitError: (e: Error) => errors.push(e),
    };
    const src = `const cfg = { recipe: "@card" };\nexport const El = () => <div className={cfg.recipe} />;\n`;
    shortwindLoader.call(ctx, src);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toMatch(/unexpanded recipe @card[\s\S]*strict mode/);
  });

  it("strict never trips on node_modules files under Turbopack (#75)", async () => {
    // The catalog ships an @link recipe; Next's own dist contains JSDoc
    // `{@link …}` mentions. Turbopack rules can't exclude node_modules, so
    // the loader itself must skip vendored paths.
    const dir = await makeProject({
      "link.css": "/* shortwind: link@0.0.1 sha:000000 */\n\n/* link. */\n@recipe link { underline }\n",
    });
    dirs.push(dir);
    const errors: Error[] = [];
    const vendored = path.join(
      dir,
      "node_modules",
      "next",
      "dist",
      "esm",
      "server",
      "ppr.js",
    );
    const src = `/** See {@link checkIsRoutePPREnabled} for details. */\nexport const x = 1;\n`;
    const ctx = {
      getOptions: () => ({ recipesDir: path.join(dir, "recipes"), strict: true }),
      resourcePath: vendored,
      emitError: (e: Error) => errors.push(e),
    };
    const out = shortwindLoader.call(ctx, src);
    expect(errors).toHaveLength(0);
    expect(out).toBe(src);
  });

  it("strict still trips on a real residual token in project code (#75)", async () => {
    const dir = await makeProject({
      "link.css": "/* shortwind: link@0.0.1 sha:000000 */\n\n/* link. */\n@recipe link { underline }\n",
    });
    dirs.push(dir);
    const errors: Error[] = [];
    const ctx = {
      getOptions: () => ({ recipesDir: path.join(dir, "recipes"), strict: true }),
      resourcePath: path.join(dir, "src", "Nav.tsx"),
      emitError: (e: Error) => errors.push(e),
    };
    const src = `const cfg = { recipe: "@link" };\nexport const El = () => <a className={cfg.recipe} />;\n`;
    shortwindLoader.call(ctx, src);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.message).toMatch(/unexpanded recipe @link/);
  });

  it("strict composes with the expandClassList/rc escape hatch (#75)", async () => {
    const dir = await makeProject({ "card.css": CARD_CSS });
    dirs.push(dir);
    const errors: Error[] = [];
    const ctx = {
      getOptions: () => ({ recipesDir: path.join(dir, "recipes"), strict: true }),
      resourcePath: path.join(dir, "src", "Badge.tsx"),
      emitError: (e: Error) => errors.push(e),
    };
    const src = [
      `import { expandClassList, loadRegistryFromDir } from "@shortwind/next";`,
      `const registry = loadRegistryFromDir("recipes");`,
      `const rc = (s: string) => expandClassList(s, registry, true);`,
      // Outside any className attribute, so the build-time transform can't
      // reach the literals — only the runtime expanders will.
      `const elevated = rc("@card-elevated");`,
      `const plain = expandClassList("@card", registry, true);`,
      `export const El = ({ on }: { on: boolean }) => <div className={on ? elevated : plain} />;`,
    ].join("\n");
    shortwindLoader.call(ctx, src);
    expect(errors).toHaveLength(0);
  });

  it("default loader emits a webpack warning for a class-value leftover (#67)", async () => {
    const dir = await makeProject({ "card.css": CARD_CSS });
    dirs.push(dir);
    const warnings: Error[] = [];
    const ctx = {
      getOptions: () => ({ recipesDir: path.join(dir, "recipes") }),
      resourcePath: path.join(dir, "src", "Page.astro"),
      emitWarning: (e: Error) => warnings.push(e),
    };
    shortwindLoader.call(ctx, `<a class:list={["@card"]}>x</a>`);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message).toContain("@card");
  });

  it("withShortwind forwards strict into the loader options (#67)", async () => {
    const dir = await makeProject();
    dirs.push(dir);
    const wrapped = withShortwind({ cwd: dir, strict: true })({});
    const cfg = wrapped.webpack!({ module: { rules: [] } }, { dev: false, isServer: false } as never);
    const rules = (cfg as { module?: { rules?: Array<{ use?: Array<{ options?: { strict?: boolean } }> }> } })
      .module?.rules;
    expect(rules?.[0]?.use?.[0]?.options?.strict).toBe(true);
  });

  it("loader expands @recipe tokens in source", async () => {
    const dir = await makeProject({ "card.css": CARD_CSS });
    dirs.push(dir);
    const ctx = {
      getOptions: () => ({ recipesDir: path.join(dir, "recipes") }),
      resourcePath: path.join(dir, "src", "App.tsx"),
    };
    const out = shortwindLoader.call(ctx, `<div className="@card"></div>`);
    expect(out).not.toMatch(/@card\b/);
    expect(out).toContain("rounded-lg");
  });

  it("loader invalidates its cache when a recipe file changes on disk", async () => {
    const dir = await makeProject({ "card.css": CARD_CSS });
    dirs.push(dir);
    const ctx = {
      getOptions: () => ({ recipesDir: path.join(dir, "recipes") }),
      resourcePath: path.join(dir, "src", "App.tsx"),
    };
    const first = shortwindLoader.call(ctx, `<div className="@card"></div>`);
    expect(first).toContain("rounded-lg");

    // Force a distinct mtime — some filesystems have second granularity.
    const cardPath = path.join(dir, "recipes", "card.css");
    await new Promise((r) => setTimeout(r, 20));
    await writeFile(
      cardPath,
      "/* shortwind: card@0.0.1 sha:000000 */\n\n/* card. */\n@recipe card { glow }\n",
    );
    const future = Date.now() / 1000 + 1;
    (await import("node:fs/promises")).utimes(cardPath, future, future);

    const fresh = shortwindLoader.call(ctx, `<div className="@card"></div>`);
    expect(fresh).toContain("glow");
    expect(fresh).not.toContain("rounded-lg");
  });

  it("loader registers each recipe file as a webpack dependency", async () => {
    const dir = await makeProject({ "card.css": CARD_CSS });
    dirs.push(dir);
    const recipesDir = path.join(dir, "recipes");
    const deps: string[] = [];
    const ctxDeps: string[] = [];
    const ctx = {
      getOptions: () => ({ recipesDir }),
      resourcePath: path.join(dir, "src", "App.tsx"),
      addDependency: (f: string) => deps.push(f),
      addContextDependency: (d: string) => ctxDeps.push(d),
    };
    shortwindLoader.call(ctx, `<div className="@card"></div>`);
    expect(deps).toContain(path.join(recipesDir, "card.css"));
    expect(ctxDeps).toContain(recipesDir);
  });
});
