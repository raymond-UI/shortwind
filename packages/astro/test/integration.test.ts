import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { realpathSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import shortwind from "../src/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const REGISTRY = path.resolve(here, "..", "..", "registry");
const CARD_CSS = readFileSync(path.join(REGISTRY, "recipes", "card.css"), "utf8");

async function makeProject(recipes: Record<string, string> = {}): Promise<string> {
  const raw = await mkdtemp(path.join(tmpdir(), "shortwind-astro-"));
  const dir = realpathSync(raw);
  await writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "x" }, null, 2));
  const recipesDir = path.join(dir, "recipes");
  await mkdir(recipesDir, { recursive: true });
  for (const [name, body] of Object.entries(recipes)) {
    await writeFile(path.join(recipesDir, name), body);
  }
  return dir;
}

type CapturedConfig = { vite: { plugins: { name: string }[] } };

function runSetup(integration: ReturnType<typeof shortwind>, root: string | URL): CapturedConfig {
  const captured: CapturedConfig[] = [];
  integration.hooks["astro:config:setup"]({
    config: { root: root as URL },
    updateConfig: (cfg) => captured.push(cfg as CapturedConfig),
  });
  if (captured.length === 0) throw new Error("updateConfig was not called");
  return captured[0]!;
}

describe("astro integration", () => {
  let dirs: string[] = [];
  beforeEach(() => {
    dirs = [];
  });
  afterEach(async () => {
    for (const d of dirs) await rm(d, { recursive: true, force: true }).catch(() => {});
  });

  it("returns an AstroIntegration with the expected name and hook", () => {
    const integration = shortwind();
    expect(integration.name).toBe("@shortwind/astro");
    expect(typeof integration.hooks["astro:config:setup"]).toBe("function");
  });

  it("calls updateConfig with the vite shortwind plugins on setup", async () => {
    const dir = await makeProject({ "card.css": CARD_CSS });
    dirs.push(dir);
    const integration = shortwind({ cwd: dir });
    const config = runSetup(integration, new URL(`file://${dir}/`));
    const names = config.vite.plugins.map((p) => p.name).sort();
    expect(names).toEqual(
      [
        "shortwind:transform",
        "shortwind:css-source",
        "shortwind:recipe-neutralize",
        "shortwind:registry-module",
        "shortwind:watcher",
      ].sort(),
    );
  });

  it("ships the recipe-neutralize plugin so Astro dev doesn't compile @recipe at-rules (#65)", async () => {
    const dir = await makeProject({ "card.css": CARD_CSS });
    dirs.push(dir);
    const integration = shortwind({ cwd: dir });
    const config = runSetup(integration, new URL(`file://${dir}/`));
    const neutralize = config.vite.plugins.find(
      (p) => p.name === "shortwind:recipe-neutralize",
    ) as { load?: (id: string) => string | null } | undefined;
    expect(neutralize).toBeTruthy();
    const loaded = neutralize!.load?.(path.join(dir, "recipes", "card.css"));
    expect(typeof loaded).toBe("string");
    expect(loaded).not.toContain("@recipe");
  });

  it("re-exports expandClassList so the rc() helper resolves from the adapter (#63)", async () => {
    const mod = await import("../src/index.js");
    expect(typeof mod.expandClassList).toBe("function");
    const registry = { families: {}, flattened: { card: ["rounded-lg", "border"] } };
    expect(mod.expandClassList("@card p-6", registry, true)).toBe("rounded-lg border p-6");
  });

  it("forwards strict so a residual token fails the Astro build (#67)", async () => {
    const dir = await makeProject({ "card.css": CARD_CSS });
    dirs.push(dir);
    const integration = shortwind({ cwd: dir, strict: true });
    const config = runSetup(integration, new URL(`file://${dir}/`));
    const transformPlugin = config.vite.plugins.find(
      (p) => p.name === "shortwind:transform",
    ) as { transform?: (code: string, id: string) => unknown } | undefined;
    expect(() =>
      transformPlugin!.transform!.call(
        {},
        `<a class:list={["@card"]}>x</a>`,
        path.join(dir, "src", "Page.astro"),
      ),
    ).toThrow(/unexpanded recipe @card[\s\S]*strict mode/);
  });

  it("derives recipesDir from astro project root when not specified", async () => {
    const dir = await makeProject({ "card.css": CARD_CSS });
    dirs.push(dir);
    const integration = shortwind();
    const config = runSetup(integration, new URL(`file://${dir}/`));
    const transformPlugin = config.vite.plugins.find(
      (p) => p.name === "shortwind:transform",
    ) as { transform?: (code: string, id: string) => unknown };
    expect(transformPlugin).toBeTruthy();
    const result = transformPlugin.transform!(
      `<div class="@card"></div>`,
      path.join(dir, "src", "Page.astro"),
    );
    const code = typeof result === "string" ? result : (result as { code: string } | null)?.code;
    expect(code).not.toMatch(/@card\b/);
    expect(code).toContain("rounded");
  });
});
