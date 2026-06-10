import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { init } from "../src/init.js";
import { verify } from "../src/commands/verify.js";
import { reseal } from "../src/commands/reseal.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const REGISTRY_PATH = path.resolve(here, "..", "..", "registry");

async function sealedProject(): Promise<string> {
  const dir = realpathSync(await mkdtemp(path.join(tmpdir(), "shortwind-reseal-")));
  await writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "x", version: "0.0.0" }, null, 2));
  await init({ cwd: dir, preset: "starter", registry: REGISTRY_PATH, installPackages: async () => {} });
  return dir;
}

describe("shortwind reseal", () => {
  let dirs: string[] = [];
  beforeEach(() => {
    dirs = [];
  });
  afterEach(async () => {
    for (const d of dirs) await rm(d, { recursive: true, force: true }).catch(() => {});
  });

  it("makes verify pass again after an intentional recipe edit", async () => {
    const dir = await sealedProject();
    dirs.push(dir);
    const cardPath = path.join(dir, "recipes", "card.css");

    // a fresh install verifies clean
    expect((await verify({ cwd: dir })).ok).toBe(true);

    // edit the recipe body — verify now fails (header sha + lockfile stale)
    const edited = (await readFile(cardPath, "utf8")).replace("@recipe card", "@recipe card\n  /* tweaked */");
    await writeFile(cardPath, edited);
    expect((await verify({ cwd: dir })).ok).toBe(false);

    // reseal blesses the edit
    const result = await reseal({ cwd: dir });
    expect(result.resealed).toContain("card");
    expect((await verify({ cwd: dir })).ok).toBe(true);
  });

  it("reports families that are already sealed as unchanged", async () => {
    const dir = await sealedProject();
    dirs.push(dir);
    const result = await reseal({ cwd: dir });
    expect(result.resealed).toEqual([]);
    expect(result.unchanged.length).toBeGreaterThan(0);
  });

  it("reports a requested family that isn't installed", async () => {
    const dir = await sealedProject();
    dirs.push(dir);
    const result = await reseal({ cwd: dir, families: ["nope"] });
    expect(result.notFound).toEqual(["nope"]);
  });
});
