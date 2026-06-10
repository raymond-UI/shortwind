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
