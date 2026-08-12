import { existsSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { HomeEnv } from "./home.js";

/**
 * Remove the cloud SKILL this CLI used to install into `~/.claude/skills/`.
 *
 * The install was a discovery hack: `shortwind cloud skill` could *emit* a
 * SKILL, but an agent had to already know to run it, so `login` dropped one
 * into the machine's agent-discovery path where Claude Code lists it unprompted.
 * It worked. It was also Claude Code only, only reached people who had already
 * installed the CLI, and wrote into a home directory uninvited.
 *
 * An Agent Plugin supersedes all three: it is portable across clients, it is
 * installed deliberately, and it reaches people who have never heard of this
 * CLI. So the injection is retired rather than ported, and this module exists
 * only to clean up after it.
 *
 * **This module deliberately lives outside `cloud/`, and must stay there.** The
 * cloud namespace is leaving this CLI, and it would take a cleanup shim living
 * inside it along on the way out — stranding the directory it was written to
 * delete on every machine that already has one. So the carrier is `run()` in
 * `cli.ts`, which cannot be deleted while the CLI exists, and which reaches
 * every user rather than only the ones who still type `shortwind cloud`. The
 * guards in `skill-retire.test.ts` fail if either half of that drifts.
 */
const CLOUD_SKILL_NAME = "shortwind-cloud";

/** Where the retired capability lives now. */
const REPLACEMENT_URL = "https://github.com/raymond-UI/emits-plugin";

/** Resolve the user's `$HOME`, honoring an injected env, then the OS default. */
function userHome(env: HomeEnv): string {
  return env.HOME ?? env.USERPROFILE ?? homedir();
}

/** The `~/.claude/skills/shortwind-cloud/` directory the SKILL installed to. */
export function cloudSkillDir(env: HomeEnv): string {
  return path.join(userHome(env), ".claude", "skills", CLOUD_SKILL_NAME);
}

/** The `SKILL.md` inside {@link cloudSkillDir}. */
export function cloudSkillPath(env: HomeEnv): string {
  return path.join(cloudSkillDir(env), "SKILL.md");
}

/** Sidecar recording which CLI version wrote the installed SKILL. */
export function cloudSkillStampPath(env: HomeEnv): string {
  return path.join(cloudSkillDir(env), ".shortwind-cli-version");
}

/**
 * Whether the directory at {@link cloudSkillDir} is one WE wrote.
 *
 * This matters because the alternative is a CLI that deletes a directory in
 * someone's home because it liked the name. Two proofs are accepted: the
 * version stamp, which only the installer wrote, or a SKILL.md that documents
 * this CLI's own verb. Anything else — an empty directory, a hand-written skill
 * that happens to be called `shortwind-cloud` — is left alone forever.
 */
function isOurs(env: HomeEnv): boolean {
  if (existsSync(cloudSkillStampPath(env))) return true;
  try {
    return readFileSync(cloudSkillPath(env), "utf8").includes("shortwind cloud");
  } catch {
    return false;
  }
}

/**
 * Delete the installed SKILL directory if this CLI put it there.
 *
 * Returns the removed path, or `null` when there was nothing to remove or the
 * directory could not be proven ours. Never throws: this runs before every
 * command, and a read-only `~/.claude` must not take the CLI down with it.
 *
 * Idempotent by construction. Once the directory is gone the first check exits
 * early, so the cost on every subsequent invocation is one `existsSync`.
 */
export function retireCloudSkill(env: HomeEnv = process.env as HomeEnv): string | null {
  try {
    const dir = cloudSkillDir(env);
    if (!existsSync(dir)) return null;
    if (!isOurs(env)) return null;
    rmSync(dir, { recursive: true, force: true });
    return dir;
  } catch {
    return null;
  }
}

/**
 * The one-time notice shown when {@link retireCloudSkill} actually removed
 * something.
 *
 * Removing a file from someone's home directory silently is worse than having
 * put it there. It names the path so the change is auditable, and points at the
 * replacement so the capability that vanished from their agent's skill list is
 * recoverable rather than merely gone.
 *
 * It points at the plugin and nothing else on purpose. An earlier draft also
 * offered `shortwind cloud skill` as an escape hatch, which is true today and
 * will not be: this text has to survive the removal of the namespace it was
 * describing, or the cleanup ends up advertising a command that no longer runs.
 */
export function retirementNotice(removed: string): string {
  return (
    `removed ${removed}\n` +
    `  The auto-installed skill is retired. Agent support now ships as a ` +
    `portable plugin, installed deliberately: ${REPLACEMENT_URL}\n`
  );
}
