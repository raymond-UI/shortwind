import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { wireAgentsInstructions } from "./agents-file.js";

// `wireAgentsInstructions` nudges coding agents from the project's
// agent-instructions file: the recipe palette, and the dynamic-class trap.

let dir: string;
const SKILL = "skills/shortwind/SKILL.md";

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
