import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  detectTailwindMajor,
  loadRegistryFromDir,
  shortwindPlugin,
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
