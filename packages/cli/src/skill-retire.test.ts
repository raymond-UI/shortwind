import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  cloudSkillDir,
  cloudSkillPath,
  cloudSkillStampPath,
  retireCloudSkill,
  retirementNotice,
  type HomeEnv,
} from "./skill-retire.js";

/**
 * Retiring the `~/.claude/skills/shortwind-cloud/` injection (#21).
 *
 * The install these tests used to cover is gone; what is left is a delete that
 * runs before every `shortwind` command, in someone's home directory,
 * unattended. So the interesting cases are all about restraint: what it refuses
 * to touch, and what happens when it cannot — plus, at the bottom, the two
 * facts that keep the shim alive long enough to finish its job.
 */

let sandbox: string;
beforeEach(() => {
  sandbox = mkdtempSync(path.join(tmpdir(), "sw-skill-retire-"));
});
afterEach(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function env(): HomeEnv {
  // HOME drives the ~/.claude/skills target, kept inside the sandbox so nothing
  // touches the developer's real home.
  return { HOME: sandbox };
}

/** Recreate what an older CLI left behind: SKILL.md, references/, the stamp. */
function seedInstalledSkill(opts: { stamp?: boolean; body?: string } = {}): string {
  const dir = cloudSkillDir(env());
  mkdirSync(path.join(dir, "references"), { recursive: true });
  writeFileSync(cloudSkillPath(env()), opts.body ?? "# Cloud\n\nRun `shortwind cloud publish`.\n");
  writeFileSync(path.join(dir, "references", "recipes.md"), "# Recipes\n");
  if (opts.stamp !== false) writeFileSync(cloudSkillStampPath(env()), "0.1.0-beta.26\n");
  return dir;
}

describe("retireCloudSkill — remove what we installed", () => {
  it("deletes the whole directory, not just SKILL.md", () => {
    const dir = seedInstalledSkill();
    expect(retireCloudSkill(env())).toBe(dir);
    expect(existsSync(dir)).toBe(false);
  });

  it("recognizes an install whose version stamp was removed by hand", () => {
    // The stamp is a dotfile; a user tidying the directory may well have
    // deleted it. The SKILL's own text is the second proof.
    const dir = seedInstalledSkill({ stamp: false });
    expect(retireCloudSkill(env())).toBe(dir);
    expect(existsSync(dir)).toBe(false);
  });

  it("is a no-op when nothing was ever installed", () => {
    expect(retireCloudSkill(env())).toBeNull();
  });

  it("is idempotent, so every later invocation is free", () => {
    seedInstalledSkill();
    expect(retireCloudSkill(env())).not.toBeNull();
    expect(retireCloudSkill(env())).toBeNull();
    expect(retireCloudSkill(env())).toBeNull();
  });
});

describe("retireCloudSkill — restraint", () => {
  it("leaves a hand-written skill that merely shares the name", () => {
    // A CLI that deletes a directory in someone's home because it liked the
    // name is a worse bug than the injection this is cleaning up.
    const dir = cloudSkillDir(env());
    mkdirSync(dir, { recursive: true });
    writeFileSync(cloudSkillPath(env()), "# My own notes about hosting\n");

    expect(retireCloudSkill(env())).toBeNull();
    expect(existsSync(cloudSkillPath(env()))).toBe(true);
  });

  it("leaves a directory with no SKILL.md at all", () => {
    const dir = cloudSkillDir(env());
    mkdirSync(dir, { recursive: true });
    expect(retireCloudSkill(env())).toBeNull();
    expect(existsSync(dir)).toBe(true);
  });

  it("never throws when the skills tree is read-only", () => {
    // This runs before every command. A locked-down ~/.claude must not take
    // the CLI down with it.
    seedInstalledSkill();
    const skillsRoot = path.dirname(cloudSkillDir(env()));
    chmodSync(skillsRoot, 0o500);
    try {
      expect(retireCloudSkill(env())).toBeNull();
    } finally {
      chmodSync(skillsRoot, 0o700);
    }
  });
});

describe("retirementNotice", () => {
  it("names the path it removed and where the capability went", () => {
    const text = retirementNotice("/home/u/.claude/skills/shortwind-cloud");
    expect(text).toContain("/home/u/.claude/skills/shortwind-cloud");
    expect(text).toContain("https://github.com/raymond-UI/emits-plugin");
  });

  it("points at nothing that leaves with the cloud namespace", () => {
    // The notice outlives `shortwind cloud`. Telling someone to recover the
    // skill with a command that has since been deleted is worse than silence.
    expect(retirementNotice("/tmp/x")).not.toContain("shortwind cloud");
  });
});

/**
 * The shim can only run while it is reachable, and it is reachable for exactly
 * as long as two things hold. The cloud namespace has now been removed, so
 * these guard against the next deletion rather than that one: nothing this
 * module stands on may be deletable, and the call site may not quietly go.
 */
describe("surviving the removal of the cloud namespace", () => {
  const DIR = path.dirname(fileURLToPath(import.meta.url));
  const src = (f: string) => readFileSync(path.join(DIR, f), "utf8");

  it("stands on nothing in this tree", () => {
    // Stronger than "no import from cloud/", which can no longer fail now that
    // the directory is gone: the module imports node builtins only, so there is
    // no file in the repo whose deletion can take it down. `HomeEnv` is
    // declared inline for exactly this reason.
    expect(existsSync(path.join(DIR, "skill-retire.ts"))).toBe(true);
    const relative = [...src("skill-retire.ts").matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]!);
    expect(relative.filter((s) => !s.startsWith("node:"))).toEqual([]);
  });

  it("is called from the top-level run(), not from a cloud verb", () => {
    // Asserts the CALL, not the identifier: `cli.ts` names `retireCloudSkill`
    // in a comment too, so a bare `toContain` stays green if the call is
    // deleted. `cli.ts` survives any amount of deletion; a cloud verb did not.
    expect(src("cli.ts")).toMatch(/retireCloudSkill\(\)/);
  });

  it("carries the AGENTS.md cleanup on the same always-runs path", () => {
    // The other artifact an older CLI left in someone else's repo. It has the
    // same one-shot, must-not-be-orphaned shape, so it gets the same carrier.
    expect(src("cli.ts")).toMatch(/retireCloudGuidance\(/);
  });
});
