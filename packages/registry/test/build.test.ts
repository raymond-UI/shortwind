import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildRegistryPipeline } from "../build.js";

const CARD_CSS = `/* shortwind: card@0.0.1 sha:000000 */

/* Default card. */
@recipe card {
  rounded-lg border p-4
}

/* Elevated card. */
@recipe card-elevated {
  @card shadow-md
}
`;

const BUTTON_CSS = `/* shortwind: button@0.0.1 sha:000000 */

/* Primary action. */
@recipe button {
  inline-flex rounded bg-blue-600 px-4 py-2 text-white
}
`;

const BROKEN_CSS = `/* shortwind: broken@0.0.1 sha:000000 */
this is not a recipe block
`;

async function fixture(
  recipes: Record<string, string>,
  presets: unknown = { starter: ["card", "button"], all: "*" },
): Promise<{
  recipesDir: string;
  presetsFile: string;
  changelogsDir: string;
  outDir: string;
  cleanup: () => Promise<void>;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "shortwind-reg-"));
  const recipesDir = path.join(root, "recipes");
  const changelogsDir = path.join(root, "changelogs");
  const outDir = path.join(root, "public");
  await mkdir(recipesDir, { recursive: true });
  await mkdir(changelogsDir, { recursive: true });
  await mkdir(outDir, { recursive: true });
  for (const [name, body] of Object.entries(recipes)) {
    await writeFile(path.join(recipesDir, name), body);
  }
  const presetsFile = path.join(root, "presets.json");
  await writeFile(presetsFile, JSON.stringify(presets, null, 2));
  return {
    recipesDir,
    presetsFile,
    changelogsDir,
    outDir,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

describe("buildRegistryPipeline", () => {
  let cleanups: Array<() => Promise<void>> = [];
  beforeEach(() => {
    cleanups = [];
  });
  afterEach(async () => {
    for (const c of cleanups) await c().catch(() => {});
  });

  it("emits per-family CSS, versioned copies, manifest, and changelogs", async () => {
    const f = await fixture({ "card.css": CARD_CSS, "button.css": BUTTON_CSS });
    cleanups.push(f.cleanup);

    const result = buildRegistryPipeline({
      recipesDir: f.recipesDir,
      presetsFile: f.presetsFile,
      changelogsDir: f.changelogsDir,
      outDir: f.outDir,
      runtimeBundle: null,
      runtimeVersion: "0.0.1",
    });

    expect(result.manifest.families.map((x: { name: string }) => x.name)).toEqual([
      "button",
      "card",
    ]);

    const cardCss = await readFile(path.join(f.outDir, "registry", "card.css"), "utf8");
    expect(cardCss.startsWith("/* shortwind: card@0.0.1 sha:")).toBe(true);
    expect(cardCss).not.toContain("sha:000000");

    const cardImmutable = await readFile(
      path.join(f.outDir, "registry", "card@0.0.1.css"),
      "utf8",
    );
    expect(cardImmutable).toBe(cardCss);

    const manifest = JSON.parse(
      await readFile(path.join(f.outDir, "registry", "manifest.json"), "utf8"),
    );
    expect(manifest.families).toHaveLength(2);
    const card = manifest.families.find((x: { name: string }) => x.name === "card");
    expect(card.recipes.map((r: { name: string }) => r.name)).toEqual([
      "card",
      "card-elevated",
    ]);
    const cardElevated = card.recipes.find((r: { name: string }) => r.name === "card-elevated");
    expect(cardElevated.expansion).toContain("shadow-md");

    const presets = await readFile(path.join(f.outDir, "registry", "presets.json"), "utf8");
    expect(JSON.parse(presets)).toEqual({ starter: ["card", "button"], all: "*" });

    const changelog = await readFile(
      path.join(f.outDir, "registry", "card", "CHANGELOG.md"),
      "utf8",
    );
    expect(changelog).toContain("# card");
  });

  it("is deterministic — running twice produces byte-identical outputs", async () => {
    const f1 = await fixture({ "card.css": CARD_CSS, "button.css": BUTTON_CSS });
    const f2 = await fixture({ "card.css": CARD_CSS, "button.css": BUTTON_CSS });
    cleanups.push(f1.cleanup, f2.cleanup);

    buildRegistryPipeline({
      recipesDir: f1.recipesDir,
      presetsFile: f1.presetsFile,
      changelogsDir: f1.changelogsDir,
      outDir: f1.outDir,
      runtimeBundle: null,
      runtimeVersion: "0.0.1",
    });
    buildRegistryPipeline({
      recipesDir: f2.recipesDir,
      presetsFile: f2.presetsFile,
      changelogsDir: f2.changelogsDir,
      outDir: f2.outDir,
      runtimeBundle: null,
      runtimeVersion: "0.0.1",
    });

    const a = await readFile(path.join(f1.outDir, "registry", "manifest.json"), "utf8");
    const b = await readFile(path.join(f2.outDir, "registry", "manifest.json"), "utf8");
    expect(a).toBe(b);

    const cardA = await readFile(path.join(f1.outDir, "registry", "card.css"), "utf8");
    const cardB = await readFile(path.join(f2.outDir, "registry", "card.css"), "utf8");
    expect(cardA).toBe(cardB);
  });

  it("fails the build when a recipe file does not parse", async () => {
    const f = await fixture({ "broken.css": BROKEN_CSS });
    cleanups.push(f.cleanup);
    expect(() =>
      buildRegistryPipeline({
        recipesDir: f.recipesDir,
        presetsFile: f.presetsFile,
        changelogsDir: f.changelogsDir,
        outDir: f.outDir,
        runtimeBundle: null,
        runtimeVersion: "0.0.1",
      }),
    ).toThrow(/Failed to parse|Registry resolution failed/);
  });

  it("rejects a recipe whose name collides with a reserved Tailwind @-utility", async () => {
    const f = await fixture({
      "surface.css": `/* shortwind: surface@0.0.1 sha:000000 */\n\n/* wrapper */\n@recipe container {\n  mx-auto max-w-6xl\n}\n`,
    });
    cleanups.push(f.cleanup);
    expect(() =>
      buildRegistryPipeline({
        recipesDir: f.recipesDir,
        presetsFile: f.presetsFile,
        changelogsDir: f.changelogsDir,
        outDir: f.outDir,
        runtimeBundle: null,
        runtimeVersion: "0.0.1",
      }),
    ).toThrow(/reserved Tailwind @-utility/);
  });

  it("rejects presets that reference a missing family", async () => {
    const f = await fixture(
      { "card.css": CARD_CSS },
      { starter: ["card", "ghost"] },
    );
    cleanups.push(f.cleanup);
    expect(() =>
      buildRegistryPipeline({
        recipesDir: f.recipesDir,
        presetsFile: f.presetsFile,
        changelogsDir: f.changelogsDir,
        outDir: f.outDir,
        runtimeBundle: null,
        runtimeVersion: "0.0.1",
      }),
    ).toThrow(/preset "starter" references family "ghost"/);
  });

  it("uses a sibling .version file when present", async () => {
    const f = await fixture({ "card.css": CARD_CSS }, { all: "*" });
    cleanups.push(f.cleanup);
    await writeFile(path.join(f.recipesDir, "card.version"), "1.2.3\n");
    const result = buildRegistryPipeline({
      recipesDir: f.recipesDir,
      presetsFile: f.presetsFile,
      changelogsDir: f.changelogsDir,
      outDir: f.outDir,
      runtimeBundle: null,
      runtimeVersion: "0.0.1",
    });
    expect(result.manifest.families[0]!.version).toBe("1.2.3");
    const cardCss = await readFile(path.join(f.outDir, "registry", "card.css"), "utf8");
    expect(cardCss.startsWith("/* shortwind: card@1.2.3 sha:")).toBe(true);
  });

  it("copies the runtime bundle to expand.js and the versioned alias", async () => {
    const f = await fixture({ "card.css": CARD_CSS }, { all: "*" });
    cleanups.push(f.cleanup);
    const bundlePath = path.join(f.recipesDir, "..", "expand.js");
    await writeFile(bundlePath, "console.log('runtime');\n");

    buildRegistryPipeline({
      recipesDir: f.recipesDir,
      presetsFile: f.presetsFile,
      changelogsDir: f.changelogsDir,
      outDir: f.outDir,
      runtimeBundle: bundlePath,
      runtimeVersion: "0.0.2",
    });

    const expand = await readFile(path.join(f.outDir, "expand.js"), "utf8");
    const versioned = await readFile(path.join(f.outDir, "expand@0.0.2.js"), "utf8");
    expect(expand).toBe("console.log('runtime');\n");
    expect(versioned).toBe(expand);
  });
});
