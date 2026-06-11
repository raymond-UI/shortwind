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
