import { readFileSync, realpathSync, statSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { init } from "../src/init.js";
import { build, BuildError } from "../src/commands/build.js";
import { dev, type DevStatus } from "../src/commands/dev.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const REGISTRY_PATH = path.resolve(here, "..", "..", "registry");

async function setupProject(preset = "starter"): Promise<string> {
  const raw = await mkdtemp(path.join(tmpdir(), "shortwind-build-"));
  const dir = realpathSync(raw);
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

describe("build", () => {
  let dirs: string[] = [];

  beforeEach(() => {
    dirs = [];
  });

  afterEach(async () => {
    for (const dir of dirs) await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it("regenerates SKILL.md from ./recipes", async () => {
    const dir = await setupProject("starter");
    dirs.push(dir);

    // delete SKILL.md so build has to recreate it
    const skillPath = path.join(dir, "skills", "shortwind", "SKILL.md");
    await rm(skillPath);

    const result = await build({ cwd: dir });
    expect(result.changed).toBe(true);
    expect(result.families.sort()).toEqual(
      ["button", "card", "form", "layout", "text"].sort(),
    );
    const md = readFileSync(result.skillPath, "utf8");
    for (const fam of result.families) {
      const cap = fam[0]!.toUpperCase() + fam.slice(1);
      expect(md).toContain(`### ${cap} recipes`);
    }
  });

  it("is a no-op when SKILL.md is already current", async () => {
    const dir = await setupProject("starter");
    dirs.push(dir);

    // first build to ensure SKILL.md is current after init
    const first = await build({ cwd: dir });
    const mtimeAfterFirst = statSync(first.skillPath).mtimeMs;

    // wait a tick so any rewrite would produce a later mtime
    await new Promise((r) => setTimeout(r, 20));

    const second = await build({ cwd: dir });
    expect(second.changed).toBe(false);
    expect(statSync(second.skillPath).mtimeMs).toBe(mtimeAfterFirst);
  });

  it("throws BuildError with diagnostics on parse error", async () => {
    const dir = await setupProject("none");
    dirs.push(dir);
    await writeFile(
      path.join(dir, "recipes", "broken.css"),
      `/* shortwind: broken@0.0.1 sha:000000 */\n@recipe { missing-name }\n`,
    );

    await expect(build({ cwd: dir })).rejects.toBeInstanceOf(BuildError);
  });

  it("throws BuildError on cycle", async () => {
    const dir = await setupProject("none");
    dirs.push(dir);
    await writeFile(
      path.join(dir, "recipes", "a.css"),
      `/* shortwind: a@0.0.1 sha:000000 */\n\n/* a. */\n@recipe a { @b p-1 }\n`,
    );
    await writeFile(
      path.join(dir, "recipes", "b.css"),
      `/* shortwind: b@0.0.1 sha:000000 */\n\n/* b. */\n@recipe b { @a p-2 }\n`,
    );

    await expect(build({ cwd: dir })).rejects.toBeInstanceOf(BuildError);
  });
});

describe("dev", () => {
  let dirs: string[] = [];
  let stoppers: (() => Promise<void>)[] = [];

  beforeEach(() => {
    dirs = [];
    stoppers = [];
  });

  afterEach(async () => {
    for (const s of stoppers) await s().catch(() => {});
    for (const dir of dirs) await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  it("rebuilds on recipe change", async () => {
    const dir = await setupProject("none");
    dirs.push(dir);

    const events: DevStatus[] = [];
    const { stop } = await dev({
      cwd: dir,
      debounceMs: 10,
      onStatus: (s) => events.push(s),
    });
    stoppers.push(stop);

    // wait for ready
    await waitFor(() => events.some((e) => e.kind === "ready"));

    // copy a recipe in
    const sourceCss = readFileSync(
      path.join(REGISTRY_PATH, "recipes", "card.css"),
      "utf8",
    );
    await writeFile(path.join(dir, "recipes", "card.css"), sourceCss);

    await waitFor(() =>
      events.some(
        (e) => e.kind === "rebuilt" && e.families.includes("card") && e.changed === true,
      ),
    );

    const skill = readFileSync(
      path.join(dir, "skills", "shortwind", "SKILL.md"),
      "utf8",
    );
    expect(skill).toContain("card");
  });

  it("emits error status on parse error but keeps watching", async () => {
    const dir = await setupProject("none");
    dirs.push(dir);

    const events: DevStatus[] = [];
    const { stop } = await dev({
      cwd: dir,
      debounceMs: 10,
      onStatus: (s) => events.push(s),
    });
    stoppers.push(stop);

    await waitFor(() => events.some((e) => e.kind === "ready"));

    await writeFor(
      path.join(dir, "recipes", "bad.css"),
      `@recipe { not-valid }\n`,
    );

    await waitFor(() => events.some((e) => e.kind === "error"));

    // then fix it — should keep working
    await writeFor(
      path.join(dir, "recipes", "bad.css"),
      `/* shortwind: bad@0.0.1 sha:000000 */\n\n/* bad. */\n@recipe bad { p-4 }\n`,
    );

    await waitFor(() =>
      events.some((e) => e.kind === "rebuilt" && e.families.includes("bad")),
    );
  });
});

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 20));
  }
}

async function writeFor(p: string, body: string): Promise<void> {
  await writeFile(p, body);
}
