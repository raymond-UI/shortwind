import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { cloudSkillPath, installCloudSkill, tryInstallCloudSkill } from "./skill-install.js";
import { globalHomeRoot, homePaths, type HomeEnv } from "../home.js";

let sandbox: string;
beforeEach(() => {
  sandbox = mkdtempSync(path.join(tmpdir(), "sw-skill-install-"));
});
afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function env(): HomeEnv {
  // HOME drives the ~/.claude/skills target; SHORTWIND_HOME pins the palette
  // source into the sandbox so nothing touches the developer's real home.
  return { HOME: sandbox, SHORTWIND_HOME: path.join(sandbox, ".shortwind") };
}

/** Seed a recipe family into the global home's palette. */
function seedPalette(source: string): void {
  const recipesDir = homePaths(globalHomeRoot(env())).recipesDir;
  mkdirSync(recipesDir, { recursive: true });
  writeFileSync(path.join(recipesDir, "ui.css"), source);
}

describe("installCloudSkill — agent-discovery drop", () => {
  it("writes the SKILL to ~/.claude/skills/shortwind-cloud/SKILL.md", () => {
    const written = installCloudSkill(env());
    expect(written).toBe(cloudSkillPath(env()));
    expect(written).toBe(
      path.join(sandbox, ".claude", "skills", "shortwind-cloud", "SKILL.md"),
    );
    expect(existsSync(written)).toBe(true);
  });

  it("emits a discoverable SKILL: frontmatter name + the cloud verbs", () => {
    const skill = readFileSync(installCloudSkill(env()), "utf8");
    expect(skill).toMatch(/^---\nname: shortwind-cloud\n/);
    expect(skill).toMatch(/shortwind cloud publish/);
    expect(skill).toMatch(/shortwind cloud find/);
  });

  it("reflects the account's current recipe palette", () => {
    seedPalette(
      "/* @recipe card version=1.0.0 */\n@recipe card { @apply rounded-lg border p-4; }\n",
    );
    const skill = readFileSync(installCloudSkill(env()), "utf8");
    expect(skill).toMatch(/card/);
  });

  it("is idempotent — a second run rewrites the same current bytes", () => {
    const first = readFileSync(installCloudSkill(env()), "utf8");
    const second = readFileSync(installCloudSkill(env()), "utf8");
    expect(second).toBe(first);
  });

  it("does not leak a repo-local recipes/ into the machine-wide skill", () => {
    // A local palette under cwd must be ignored: the install is machine-global.
    const repo = path.join(sandbox, "repo");
    const localRecipes = path.join(repo, "recipes");
    mkdirSync(localRecipes, { recursive: true });
    writeFileSync(
      path.join(localRecipes, "leak.css"),
      "/* @recipe leakonly version=1.0.0 */\n@recipe leakonly { @apply block; }\n",
    );
    const cwd = process.cwd();
    process.chdir(repo);
    try {
      const skill = readFileSync(installCloudSkill(env()), "utf8");
      expect(skill).not.toMatch(/leakonly/);
    } finally {
      process.chdir(cwd);
    }
  });
});

describe("tryInstallCloudSkill — non-fatal", () => {
  it("returns the written path on success", () => {
    expect(tryInstallCloudSkill(env())).toBe(cloudSkillPath(env()));
  });

  it("returns null when the discovery dir is unwritable, never throwing", () => {
    // Make ~/.claude a read-only file so the skills mkdir fails.
    const claude = path.join(sandbox, ".claude");
    writeFileSync(claude, "not a dir");
    chmodSync(claude, 0o400);
    expect(tryInstallCloudSkill(env())).toBeNull();
  });
});
