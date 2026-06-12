import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { wireAgentsInstructions } from "../src/agents-file.js";

async function project(files: Record<string, string> = {}): Promise<string> {
  const dir = realpathSync(await mkdtemp(path.join(tmpdir(), "shortwind-agents-")));
  for (const [rel, body] of Object.entries(files)) {
    await writeFile(path.join(dir, rel), body);
  }
  return dir;
}

const SKILL = (dir: string) => path.join(dir, "skills", "shortwind", "SKILL.md");

describe("wireAgentsInstructions", () => {
  let dirs: string[] = [];
  beforeEach(() => {
    dirs = [];
  });
  afterEach(async () => {
    for (const d of dirs) await rm(d, { recursive: true, force: true }).catch(() => {});
  });

  it("creates AGENTS.md with a one-line pointer when none exists", async () => {
    const dir = await project();
    dirs.push(dir);
    const result = await wireAgentsInstructions(dir, SKILL(dir));
    expect(result.action).toBe("created");
    expect(existsSync(path.join(dir, "AGENTS.md"))).toBe(true);
    const md = await readFile(path.join(dir, "AGENTS.md"), "utf8");
    expect(md).toContain("skills/shortwind/SKILL.md");
    expect(md).toContain("@recipe");
  });

  it("appends to an existing CLAUDE.md without clobbering it", async () => {
    const dir = await project({ "CLAUDE.md": "# Project\n\nExisting instructions.\n" });
    dirs.push(dir);
    const result = await wireAgentsInstructions(dir, SKILL(dir));
    expect(result.action).toBe("appended");
    expect(result.path).toContain("CLAUDE.md");
    const md = await readFile(path.join(dir, "CLAUDE.md"), "utf8");
    expect(md).toContain("Existing instructions.");
    expect(md).toContain("skills/shortwind/SKILL.md");
    // didn't create a stray AGENTS.md
    expect(existsSync(path.join(dir, "AGENTS.md"))).toBe(false);
  });

  it("surfaces the rc()/expandClassList helper and strict mode (#81)", async () => {
    const dir = await project();
    dirs.push(dir);
    await wireAgentsInstructions(dir, SKILL(dir));
    const md = await readFile(path.join(dir, "AGENTS.md"), "utf8");
    expect(md).toContain("expandClassList");
    expect(md).toContain("strict: true");
  });

  it("adds the dynamic-classes guidance to a file that predates it (#81)", async () => {
    // An AGENTS.md written by an older init: pointer line only.
    const dir = await project({
      "AGENTS.md":
        "# AGENTS.md\n\nFor UI, prefer Shortwind `@recipe` class names — full catalog in `skills/shortwind/SKILL.md`.\n",
    });
    dirs.push(dir);
    const result = await wireAgentsInstructions(dir, SKILL(dir));
    expect(result.action).toBe("appended");
    const md = await readFile(path.join(dir, "AGENTS.md"), "utf8");
    expect(md).toContain("expandClassList");
    // The original pointer was not duplicated.
    expect(md.match(/full catalog in/g)).toHaveLength(1);
  });

  it("is idempotent — re-running does not duplicate the pointer", async () => {
    const dir = await project();
    dirs.push(dir);
    await wireAgentsInstructions(dir, SKILL(dir));
    const second = await wireAgentsInstructions(dir, SKILL(dir));
    expect(second.action).toBe("skipped");
    const md = await readFile(path.join(dir, "AGENTS.md"), "utf8");
    expect(md.match(/skills\/shortwind\/SKILL\.md/g)).toHaveLength(1);
  });
});
