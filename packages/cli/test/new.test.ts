import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { newFamily, NewFamilyError } from "../src/commands/new.js";
import { parseRecipeFile, buildRegistry } from "@shortwind/core";

async function setupProject(): Promise<string> {
  const dir = realpathSync(await mkdtemp(path.join(tmpdir(), "shortwind-new-")));
  await writeFile(
    path.join(dir, "shortwind.config.json"),
    JSON.stringify({ recipesDir: "recipes", outputPath: "skills/shortwind/SKILL.md" }, null, 2),
  );
  return dir;
}

describe("shortwind new", () => {
  let dirs: string[] = [];
  beforeEach(() => {
    dirs = [];
  });
  afterEach(async () => {
    for (const d of dirs) await rm(d, { recursive: true, force: true }).catch(() => {});
  });

  it("scaffolds a valid, parseable family that resolves", async () => {
    const dir = await setupProject();
    dirs.push(dir);
    const result = await newFamily({ cwd: dir, family: "marketing" });
    expect(result.familyPath).toContain("recipes/marketing.css");

    const source = await readFile(result.familyPath, "utf8");
    const parsed = parseRecipeFile(source, "marketing.css");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.header?.family).toBe("marketing");
    expect(parsed.value.guidance).toBeTruthy();
    const built = buildRegistry(parsed.value.recipes);
    expect(built.ok).toBe(true);
  });

  it("includes the new family in the regenerated SKILL.md", async () => {
    const dir = await setupProject();
    dirs.push(dir);
    const result = await newFamily({ cwd: dir, family: "marketing" });
    const skill = await readFile(result.skillPath, "utf8");
    expect(skill).toContain("Marketing recipes");
    expect(skill).toContain("@marketing");
  });

  it("refuses to overwrite an existing family without --force", async () => {
    const dir = await setupProject();
    dirs.push(dir);
    await newFamily({ cwd: dir, family: "marketing" });
    await expect(newFamily({ cwd: dir, family: "marketing" })).rejects.toBeInstanceOf(NewFamilyError);
    // --force succeeds
    await expect(newFamily({ cwd: dir, family: "marketing", force: true })).resolves.toBeTruthy();
  });

  it("rejects an unsafe family name", async () => {
    const dir = await setupProject();
    dirs.push(dir);
    await expect(newFamily({ cwd: dir, family: "../evil" })).rejects.toThrow();
  });
});
