import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { retireCloudGuidance, wireAgentsInstructions } from "./agents-file.js";

// `wireAgentsInstructions` nudges coding agents from the project's
// agent-instructions file: the recipe palette, and the dynamic-class trap.

let dir: string;
const SKILL = "skills/shortwind/SKILL.md";

// The line beta.20 through beta.26 wrote into users' repos, verbatim. It names
// three verbs this CLI no longer has.
const STALE =
  "To host a page at a live URL, run `shortwind cloud publish <file.html>` — " +
  "`shortwind cloud find` locates existing pages first (the account is the only memory), " +
  "and `shortwind cloud skill` prints the full hosting verb reference.";

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "sw-agents-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("wireAgentsInstructions", () => {
  it("creates AGENTS.md with the recipe and dynamic-class pointers", async () => {
    const result = await wireAgentsInstructions(dir, path.join(dir, SKILL));
    expect(result.action).toBe("created");
    expect(result.path).toBe(path.join(dir, "AGENTS.md"));
    const body = readFileSync(path.join(dir, "AGENTS.md"), "utf8");
    expect(body).toContain("@recipe");
    expect(body).toContain("expandClassList");
  });

  it("names no retired hosting namespace", async () => {
    // This file writes into the USER's repo, where the line outlives the CLI
    // that wrote it and gets read by an agent that will try to run it. The
    // hosting verbs are gone, so nothing here may name them.
    await wireAgentsInstructions(dir, path.join(dir, SKILL));
    const body = readFileSync(path.join(dir, "AGENTS.md"), "utf8");
    expect(body).not.toContain("shortwind cloud");
    expect(body).not.toContain("shortwind deploy");
  });

  it("is idempotent — a fully-pointed file is left untouched", async () => {
    await wireAgentsInstructions(dir, path.join(dir, SKILL));
    const first = readFileSync(path.join(dir, "AGENTS.md"), "utf8");
    const result = await wireAgentsInstructions(dir, path.join(dir, SKILL));
    expect(result.action).toBe("skipped");
    expect(readFileSync(path.join(dir, "AGENTS.md"), "utf8")).toBe(first);
  });

  it("appends ONLY the missing pointer to a file that predates it", async () => {
    // An AGENTS.md carrying the older recipe pointer but not the dynamic one.
    const existing =
      `# AGENTS.md\n\n` +
      `For UI, prefer Shortwind \`@recipe\` class names — full catalog in \`${SKILL}\`.\n`;
    writeFileSync(path.join(dir, "AGENTS.md"), existing);
    const result = await wireAgentsInstructions(dir, path.join(dir, SKILL));
    expect(result.action).toBe("appended");
    const body = readFileSync(path.join(dir, "AGENTS.md"), "utf8");
    // The pre-existing line is preserved exactly once, and the missing one added.
    expect(body.startsWith(existing)).toBe(true);
    expect(body).toContain("expandClassList");
    // Did not duplicate the recipe pointer.
    expect(body.match(/full catalog in/g)?.length).toBe(1);
  });

  it("prefers CLAUDE.md when no AGENTS.md exists", async () => {
    writeFileSync(path.join(dir, "CLAUDE.md"), "# Project\n");
    const result = await wireAgentsInstructions(dir, path.join(dir, SKILL));
    expect(result.action).toBe("appended");
    expect(result.path).toBe(path.join(dir, "CLAUDE.md"));
    expect(existsSync(path.join(dir, "AGENTS.md"))).toBe(false);
    expect(readFileSync(path.join(dir, "CLAUDE.md"), "utf8")).toContain("expandClassList");
  });
});

// Not writing the line any more only helps people who have not run the old CLI.
// Five published betas put it in real repos, where it is committed to git and
// read by an agent on every task. `retireCloudGuidance` takes it back out.
describe("retireCloudGuidance", () => {
  const POINTER = `For UI, prefer Shortwind \`@recipe\` class names — full catalog in \`${SKILL}\`.`;

  it("removes the retired line and reports the file", async () => {
    const file = path.join(dir, "AGENTS.md");
    writeFileSync(file, `# AGENTS.md\n\n${POINTER}\n${STALE}\n`);
    const cleaned = await retireCloudGuidance(dir);
    expect(cleaned).toEqual([file]);
    const body = readFileSync(file, "utf8");
    expect(body).not.toContain("shortwind cloud");
    // Everything else survives byte-for-byte, including the trailing newline.
    expect(body).toBe(`# AGENTS.md\n\n${POINTER}\n`);
  });

  it("cleans every candidate file, not just the first", async () => {
    // wireAgentsInstructions writes to whichever files exist, so a repo can
    // carry the line in both.
    writeFileSync(path.join(dir, "AGENTS.md"), `${POINTER}\n${STALE}\n`);
    writeFileSync(path.join(dir, "CLAUDE.md"), `${POINTER}\n${STALE}\n`);
    const cleaned = await retireCloudGuidance(dir);
    expect(cleaned).toEqual([path.join(dir, "AGENTS.md"), path.join(dir, "CLAUDE.md")]);
    for (const name of ["AGENTS.md", "CLAUDE.md"]) {
      expect(readFileSync(path.join(dir, name), "utf8")).not.toContain("shortwind cloud");
    }
  });

  it("leaves no doubled blank line where the removed line stood alone", async () => {
    // The older CLI appended with a blank-line separator when the file did not
    // end in one, so the retired line can sit in its own paragraph.
    const file = path.join(dir, "AGENTS.md");
    writeFileSync(file, `# AGENTS.md\n\n${STALE}\n\n${POINTER}\n`);
    await retireCloudGuidance(dir);
    expect(readFileSync(file, "utf8")).toBe(`# AGENTS.md\n\n${POINTER}\n`);
  });

  it("touches nothing when the line is absent", async () => {
    const file = path.join(dir, "AGENTS.md");
    const body = `# AGENTS.md\n\n${POINTER}\n`;
    writeFileSync(file, body);
    const cleaned = await retireCloudGuidance(dir);
    expect(cleaned).toEqual([]);
    expect(readFileSync(file, "utf8")).toBe(body);
  });

  it("is idempotent", async () => {
    const file = path.join(dir, "AGENTS.md");
    writeFileSync(file, `${POINTER}\n${STALE}\n`);
    await retireCloudGuidance(dir);
    const after = readFileSync(file, "utf8");
    expect(await retireCloudGuidance(dir)).toEqual([]);
    expect(readFileSync(file, "utf8")).toBe(after);
  });

  it("never creates a file", async () => {
    expect(await retireCloudGuidance(dir)).toEqual([]);
    expect(existsSync(path.join(dir, "AGENTS.md"))).toBe(false);
    expect(existsSync(path.join(dir, "CLAUDE.md"))).toBe(false);
  });

  it("does not throw on an unreadable project", async () => {
    // This runs before every command in whatever directory the user is in. A
    // missing or read-only tree must not take the CLI down.
    await expect(
      retireCloudGuidance(path.join(dir, "does", "not", "exist")),
    ).resolves.toEqual([]);
  });

  it("removes only the line carrying the marker", async () => {
    const file = path.join(dir, "AGENTS.md");
    writeFileSync(file, `Run \`shortwind lint\` before pushing.\n${STALE}\nDeploy with fly.\n`);
    await retireCloudGuidance(dir);
    expect(readFileSync(file, "utf8")).toBe(
      "Run `shortwind lint` before pushing.\nDeploy with fly.\n",
    );
  });
});
