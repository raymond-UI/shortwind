import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readConfig } from "../src/project.js";
import { add } from "../src/commands/add.js";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const REGISTRY_PATH = path.resolve(here, "..", "..", "registry");

describe("config & argument validation (#51)", () => {
  let dirs: string[] = [];
  beforeEach(() => {
    dirs = [];
  });
  afterEach(async () => {
    for (const d of dirs) await rm(d, { recursive: true, force: true }).catch(() => {});
  });

  async function withConfig(json: string): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), "shortwind-cfg-"));
    dirs.push(dir);
    await writeFile(path.join(dir, "shortwind.config.json"), json);
    return dir;
  }

  it("rejects a recipesDir/outputPath that escapes the project directory", async () => {
    const dir = await withConfig(JSON.stringify({ outputPath: "../../../etc/evil" }));
    await expect(readConfig(dir)).rejects.toThrow(/inside the project directory/);
    const dir2 = await withConfig(JSON.stringify({ recipesDir: "/etc" }));
    await expect(readConfig(dir2)).rejects.toThrow(/inside the project directory/);
  });

  it("rejects a non-string config field with a clear error", async () => {
    const dir = await withConfig(JSON.stringify({ recipesDir: 42 }));
    await expect(readConfig(dir)).rejects.toThrow(/"recipesDir" must be a string/);
  });

  it("rejects a non-object config payload", async () => {
    const dir = await withConfig("[1,2,3]");
    await expect(readConfig(dir)).rejects.toThrow(/expected a JSON object/);
  });

  it("accepts a valid in-project config", async () => {
    const dir = await withConfig(JSON.stringify({ recipesDir: "recipes", outputPath: "skills/x.md" }));
    const cfg = await readConfig(dir);
    expect(cfg.recipesDir).toBe("recipes");
    expect(cfg.outputPath).toBe("skills/x.md");
  });

  it("rejects an --as target that isn't a valid family name", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "shortwind-as-"));
    dirs.push(dir);
    await writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "x" }));
    await expect(
      add({ cwd: dir, families: ["card"], as: "../../escape", registry: REGISTRY_PATH }),
    ).rejects.toThrow(/invalid family name/);
  });
});
