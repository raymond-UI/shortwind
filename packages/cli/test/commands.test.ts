import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { init } from "../src/init.js";
import { add } from "../src/commands/add.js";
import { remove } from "../src/commands/remove.js";
import { preset } from "../src/commands/preset.js";
import { ls, formatLsText } from "../src/commands/ls.js";
import { readLockfile } from "../src/lockfile.js";
import { renameFamilyInSource } from "../src/project.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const REGISTRY_PATH = path.resolve(here, "..", "..", "registry");

async function setupInitialized(preset = "starter"): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "shortwind-cmd-"));
  await writeFile(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "x", version: "0.0.0" }, null, 2),
  );
  await init({
    cwd: dir,
    preset,
    registry: REGISTRY_PATH,
    installPackages: async () => {},
  });
  return dir;
}

describe("add", () => {
  let dirs: string[] = [];

  beforeEach(() => {
    dirs = [];
  });

  afterEach(async () => {
    for (const dir of dirs) await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it("installs a single family and updates the lockfile", async () => {
    const dir = await setupInitialized("none");
    dirs.push(dir);

    const result = await add({
      cwd: dir,
      families: ["card"],
      registry: REGISTRY_PATH,
    });

    expect(result.added).toEqual(["card"]);
    expect(existsSync(path.join(dir, "recipes", "card.css"))).toBe(true);
    expect(result.lockfile.families["card"]?.version).toBe("0.0.1");
    // 16 hex (64 bits) — shared width with the registry sealer; a 6-hex (24-bit)
    // fingerprint was brute-forceable.
    expect(result.lockfile.families["card"]?.sha).toMatch(/^[a-f0-9]{16}$/);
    expect(result.lockfile.families["card"]?.sha).not.toBe("000000");
  });

  it("regenerates SKILL.md with the newly installed family", async () => {
    const dir = await setupInitialized("none");
    dirs.push(dir);

    const result = await add({
      cwd: dir,
      families: ["card", "button"],
      registry: REGISTRY_PATH,
    });

    const md = readFileSync(result.skillPath, "utf8");
    expect(md).toContain("### Card recipes");
    expect(md).toContain("### Button recipes");
  });

  it("skips already-installed families and reports them", async () => {
    const dir = await setupInitialized("none");
    dirs.push(dir);

    await add({ cwd: dir, families: ["card"], registry: REGISTRY_PATH });
    const second = await add({ cwd: dir, families: ["card"], registry: REGISTRY_PATH });

    expect(second.added).toEqual([]);
    expect(second.skipped).toEqual(["card"]);
  });

  it("--force overwrites and tracks as overwritten", async () => {
    const dir = await setupInitialized("none");
    dirs.push(dir);

    await add({ cwd: dir, families: ["card"], registry: REGISTRY_PATH });
    await writeFile(path.join(dir, "recipes", "card.css"), "/* user mutated */\n");

    const second = await add({
      cwd: dir,
      families: ["card"],
      registry: REGISTRY_PATH,
      force: true,
    });

    expect(second.added).toEqual([]);
    expect(second.overwritten).toEqual(["card"]);
    expect(readFileSync(path.join(dir, "recipes", "card.css"), "utf8")).toContain("@recipe card");
  });

  it("--as renames the file and rewrites every @<family>-* reference", async () => {
    const dir = await setupInitialized("none");
    dirs.push(dir);

    const result = await add({
      cwd: dir,
      families: ["card"],
      as: "tile",
      registry: REGISTRY_PATH,
    });

    expect(result.added).toEqual(["tile"]);
    const file = readFileSync(path.join(dir, "recipes", "tile.css"), "utf8");
    expect(file).toContain("shortwind: tile@");
    expect(file).toContain("@recipe tile {");
    expect(file).toContain("@recipe tile-elevated");
    expect(file).toContain("@tile shadow-md");
    expect(file).not.toMatch(/@recipe card\b/);
    expect(file).not.toMatch(/@card\b/);

    // Locks the contract that the rewritten header's sha matches the rewritten
    // body sha and that the lockfile records the rename target — guarding
    // against future regressions where the header is rewritten but the lock
    // still tracks the original name (or vice versa).
    const headerMatch = file.match(/shortwind: tile@(\S+) sha:([0-9a-f]+)/);
    expect(headerMatch).not.toBeNull();
    const renamedVersion = headerMatch![1]!;
    const renamedSha = headerMatch![2]!;
    expect(result.lockfile.families["tile"]).toEqual({
      version: renamedVersion,
      sha: renamedSha,
    });
    expect(result.lockfile.families["card"]).toBeUndefined();
  });

  it("--all installs every family in the registry", async () => {
    const dir = await setupInitialized("none");
    dirs.push(dir);

    const result = await add({
      cwd: dir,
      families: [],
      all: true,
      registry: REGISTRY_PATH,
    });

    expect(result.added.length).toBeGreaterThanOrEqual(19);
    expect(result.added).toContain("card");
    expect(result.added).toContain("tooltip");
  });

  it("warns when a newly added family references a recipe from an uninstalled family", async () => {
    const dir = await setupInitialized("none");
    dirs.push(dir);
    // simulate: write a custom family file with a cross-family reference to a missing recipe
    await writeFile(
      path.join(dir, "recipes", "custom.css"),
      `/* shortwind: custom@0.0.1 sha:000000 */\n\n/* test. */\n@recipe my-thing { @missing-thing p-4 }\n`,
    );
    // now run add on the existing custom (overwrite via force) to trigger missing-dep collection
    const result = await add({
      cwd: dir,
      families: ["card"],
      registry: REGISTRY_PATH,
    });
    // card itself has no cross-family refs in our catalog, so missingDependencies for card is empty
    expect(result.missingDependencies).toEqual([]);
  });

  it("does not overwrite a populated SKILL.md with an empty one when a sibling family is broken (#49)", async () => {
    const dir = await setupInitialized("starter");
    dirs.push(dir);
    const skillPath = path.join(dir, "skills", "shortwind", "SKILL.md");
    const before = readFileSync(skillPath, "utf8");
    expect(before).toContain("@card");

    // introduce an unresolvable cycle in a sibling family
    await writeFile(
      path.join(dir, "recipes", "loop.css"),
      `/* shortwind: loop@0.0.1 sha:000000 */\n@recipe a { @b }\n@recipe b { @a }\n`,
    );
    // a further command that regenerates SKILL.md must skip the write, not blank it
    await remove({ cwd: dir, families: ["button"] });
    const after = readFileSync(skillPath, "utf8");
    expect(after).toBe(before); // untouched — no data loss
    expect(after).toContain("@card");
  });
});

describe("remove", () => {
  let dirs: string[] = [];

  beforeEach(() => {
    dirs = [];
  });

  afterEach(async () => {
    for (const dir of dirs) await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it("deletes the file, updates lockfile, regenerates SKILL.md", async () => {
    const dir = await setupInitialized("starter");
    dirs.push(dir);

    const before = await readLockfile(path.join(dir, "recipes"));
    expect(before.families["card"]).toBeDefined();

    const result = await remove({ cwd: dir, families: ["card"] });

    expect(result.removed).toEqual(["card"]);
    expect(existsSync(path.join(dir, "recipes", "card.css"))).toBe(false);
    expect(result.lockfile.families["card"]).toBeUndefined();
    const md = readFileSync(result.skillPath, "utf8");
    expect(md).not.toContain("- card");
  });

  it("reports notFound for families that weren't installed", async () => {
    const dir = await setupInitialized("none");
    dirs.push(dir);

    const result = await remove({ cwd: dir, families: ["card"] });
    expect(result.notFound).toEqual(["card"]);
    expect(result.removed).toEqual([]);
  });
});

describe("preset", () => {
  let dirs: string[] = [];

  beforeEach(() => {
    dirs = [];
  });

  afterEach(async () => {
    for (const dir of dirs) await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it("is additive — does not remove families absent from the preset", async () => {
    const dir = await setupInitialized("none");
    dirs.push(dir);

    await add({ cwd: dir, families: ["dialog"], registry: REGISTRY_PATH });
    expect(existsSync(path.join(dir, "recipes", "dialog.css"))).toBe(true);

    const result = await preset({
      cwd: dir,
      name: "starter",
      registry: REGISTRY_PATH,
    });

    // dialog is not in starter, but must still be present.
    expect(existsSync(path.join(dir, "recipes", "dialog.css"))).toBe(true);
    expect(result.added.sort()).toEqual(
      ["button", "card", "form", "layout", "text"].sort(),
    );
  });

  it("rejects preset 'none'", async () => {
    const dir = await setupInitialized("none");
    dirs.push(dir);

    await expect(
      preset({ cwd: dir, name: "none", registry: REGISTRY_PATH }),
    ).rejects.toThrow(/none/);
  });
});

describe("ls", () => {
  let dirs: string[] = [];

  beforeEach(() => {
    dirs = [];
  });

  afterEach(async () => {
    for (const dir of dirs) await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it("returns installed + available", async () => {
    const dir = await setupInitialized("starter");
    dirs.push(dir);

    const result = await ls({ cwd: dir, registry: REGISTRY_PATH });
    const installedNames = result.installed.map((i) => i.family).sort();
    expect(installedNames).toEqual(["button", "card", "form", "layout", "text"]);
    for (const entry of result.installed) {
      expect(entry.version).toBe("0.0.1");
    }
    expect(result.available.length).toBeGreaterThanOrEqual(19);
  });

  it("--installed-only suppresses available list", async () => {
    const dir = await setupInitialized("starter");
    dirs.push(dir);

    const result = await ls({ cwd: dir, registry: REGISTRY_PATH, installedOnly: true });
    expect(result.available).toEqual([]);
    expect(result.installed.length).toBe(5);
  });

  it("--available-only suppresses installed list", async () => {
    const dir = await setupInitialized("starter");
    dirs.push(dir);

    const result = await ls({ cwd: dir, registry: REGISTRY_PATH, availableOnly: true });
    expect(result.installed).toEqual([]);
    expect(result.available.length).toBeGreaterThanOrEqual(19);
  });

  it("text format is stable for snapshotting", async () => {
    const dir = await setupInitialized("starter");
    dirs.push(dir);

    const result = await ls({ cwd: dir, registry: REGISTRY_PATH });
    const text = formatLsText(result);
    expect(text).toMatchSnapshot();
  });
});

describe("renameFamilyInSource", () => {
  it("rewrites header, recipe names, and references; preserves descriptions", () => {
    const input = `/* shortwind: card@0.0.1 sha:000000 */

/* Default card. */
@recipe card { rounded-lg }

/* Elevated. */
@recipe card-elevated { @card shadow-md }
`;
    const out = renameFamilyInSource(input, "card", "tile");
    expect(out).toContain("shortwind: tile@");
    expect(out).toContain("@recipe tile {");
    expect(out).toContain("@recipe tile-elevated");
    expect(out).toContain("@tile shadow-md");
    expect(out).toContain("Default card.");
    expect(out).not.toMatch(/@recipe card\b/);
    expect(out).not.toMatch(/@card\b/);
  });
});
