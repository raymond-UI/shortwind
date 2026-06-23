import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { wireAgentsInstructions } from "./agents-file.js";

// `wireAgentsInstructions` nudges coding agents from the project's
// agent-instructions file. #171 added a cloud-hosting pointer so the same guide
// names both the recipe palette AND `shortwind cloud` hosting.

let dir: string;
const SKILL = "skills/shortwind/SKILL.md";

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "sw-agents-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("wireAgentsInstructions", () => {
  it("creates AGENTS.md with the recipe, dynamic, and cloud-hosting pointers", async () => {
    const result = await wireAgentsInstructions(dir, path.join(dir, SKILL));
    expect(result.action).toBe("created");
    expect(result.path).toBe(path.join(dir, "AGENTS.md"));
    const body = readFileSync(path.join(dir, "AGENTS.md"), "utf8");
    expect(body).toContain("@recipe");
    expect(body).toContain("expandClassList");
    // The cloud-hosting capability is named, pointing at the real invocation.
    expect(body).toContain("shortwind cloud publish");
    expect(body).toContain("shortwind cloud skill");
  });

  it("is idempotent — a fully-pointed file is left untouched", async () => {
    await wireAgentsInstructions(dir, path.join(dir, SKILL));
    const first = readFileSync(path.join(dir, "AGENTS.md"), "utf8");
    const result = await wireAgentsInstructions(dir, path.join(dir, SKILL));
    expect(result.action).toBe("skipped");
    expect(readFileSync(path.join(dir, "AGENTS.md"), "utf8")).toBe(first);
  });

  it("appends ONLY the cloud pointer to a file that predates it", async () => {
    // An AGENTS.md carrying the older two pointers but not the cloud one.
    const existing =
      `# AGENTS.md\n\n` +
      `For UI, prefer Shortwind \`@recipe\` class names — full catalog in \`${SKILL}\`.\n` +
      `Never build a recipe name dynamically … use the \`rc()\`/\`expandClassList\` helper.\n`;
    writeFileSync(path.join(dir, "AGENTS.md"), existing);
    const result = await wireAgentsInstructions(dir, path.join(dir, SKILL));
    expect(result.action).toBe("appended");
    const body = readFileSync(path.join(dir, "AGENTS.md"), "utf8");
    // The pre-existing lines are preserved exactly once, and the cloud line is added.
    expect(body.startsWith(existing)).toBe(true);
    expect(body).toContain("shortwind cloud publish");
    // Did not duplicate the recipe pointer.
    expect(body.match(/full catalog in/g)?.length).toBe(1);
  });

  it("prefers CLAUDE.md when no AGENTS.md exists", async () => {
    writeFileSync(path.join(dir, "CLAUDE.md"), "# Project\n");
    const result = await wireAgentsInstructions(dir, path.join(dir, SKILL));
    expect(result.action).toBe("appended");
    expect(result.path).toBe(path.join(dir, "CLAUDE.md"));
    expect(existsSync(path.join(dir, "AGENTS.md"))).toBe(false);
    expect(readFileSync(path.join(dir, "CLAUDE.md"), "utf8")).toContain("shortwind cloud publish");
  });
});
