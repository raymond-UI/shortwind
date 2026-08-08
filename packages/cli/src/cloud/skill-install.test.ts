import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  cloudSkillPath,
  cloudSkillStampPath,
  installCloudSkill,
  installedSkillVersion,
  refreshCloudSkillIfStale,
  tryInstallCloudSkill,
} from "./skill-install.js";
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

/** The installed `references/recipes.md`, where the palette actually lives. */
function readRecipesReference(): string {
  return readFileSync(
    path.join(path.dirname(cloudSkillPath(env())), "references", "recipes.md"),
    "utf8",
  );
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

  it("installs the on-demand references beside the SKILL", () => {
    const root = path.dirname(installCloudSkill(env()));
    expect(existsSync(path.join(root, "references", "publishing.md"))).toBe(true);
    expect(existsSync(path.join(root, "references", "recipes.md"))).toBe(true);
  });

  it("reflects the account's current recipe palette in the recipes reference", () => {
    seedPalette("/* shortwind: ui@0.0.1 sha:000000 */\n@recipe ui-card {\n  rounded-lg border p-4\n}\n");
    installCloudSkill(env());
    expect(readRecipesReference()).toMatch(/ui-card/);
  });

  it("keeps the palette OUT of the always-loaded SKILL.md", () => {
    // An empty or unfamiliar palette must never read as "publishing unavailable",
    // so SKILL.md carries no palette listing at all.
    seedPalette("/* shortwind: ui@0.0.1 sha:000000 */\n@recipe ui-card {\n  rounded-lg border p-4\n}\n");
    const skill = readFileSync(installCloudSkill(env()), "utf8");
    expect(skill).not.toMatch(/ui-card/);
    expect(skill).toContain("references/recipes.md");
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
      installCloudSkill(env());
      expect(readRecipesReference()).not.toMatch(/leakonly/);
    } finally {
      process.chdir(cwd);
    }
  });
});

describe("refreshCloudSkillIfStale — self-heal an out-of-date install", () => {
  it("stamps the writing CLI version beside the SKILL", () => {
    installCloudSkill(env(), "1.2.3");
    expect(readFileSync(cloudSkillStampPath(env()), "utf8")).toBe("1.2.3\n");
    expect(installedSkillVersion(env())).toBe("1.2.3");
    // A dotfile, so an agent listing the skills dir never sees it as content.
    expect(path.basename(cloudSkillStampPath(env())).startsWith(".")).toBe(true);
  });

  it("rewrites the SKILL when an older CLI installed it", () => {
    installCloudSkill(env(), "0.1.0-beta.25");
    // Simulate the stale bytes a previous release wrote.
    writeFileSync(cloudSkillPath(env()), "stale advice\n");

    expect(refreshCloudSkillIfStale(env(), "0.1.0-beta.26")).toBe(cloudSkillPath(env()));
    expect(readFileSync(cloudSkillPath(env()), "utf8")).toMatch(/shortwind cloud publish/);
    expect(installedSkillVersion(env())).toBe("0.1.0-beta.26");
  });

  it("rewrites when the stamp is missing (installed before stamping existed)", () => {
    installCloudSkill(env(), "0.1.0-beta.25");
    rmSync(cloudSkillStampPath(env()));
    expect(refreshCloudSkillIfStale(env(), "0.1.0-beta.25")).toBe(cloudSkillPath(env()));
  });

  it("does nothing when the installed SKILL is already current", () => {
    installCloudSkill(env(), "1.2.3");
    const before = readFileSync(cloudSkillPath(env()), "utf8");
    writeFileSync(cloudSkillPath(env()), before + "hand edit\n");
    // Same version ⇒ no write at all, so even a hand edit survives.
    expect(refreshCloudSkillIfStale(env(), "1.2.3")).toBeNull();
    expect(readFileSync(cloudSkillPath(env()), "utf8")).toContain("hand edit");
  });

  it("never installs for a machine that never logged in", () => {
    // login / init-global are the only commands that put the SKILL on a machine
    // the first time; a bare `shortwind cloud find` must not create one.
    expect(refreshCloudSkillIfStale(env(), "1.2.3")).toBeNull();
    expect(existsSync(cloudSkillPath(env()))).toBe(false);
  });

  it("returns null instead of throwing when the rewrite fails", () => {
    const skill = installCloudSkill(env(), "1.2.3");
    // A read-only SKILL.md: the rewrite hits EACCES mid-flight.
    chmodSync(skill, 0o400);
    try {
      expect(refreshCloudSkillIfStale(env(), "9.9.9")).toBeNull();
    } finally {
      chmodSync(skill, 0o600);
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
