import { homedir } from "node:os";
import path from "node:path";
import { globalHomeRoot, homePaths, type HomeEnv } from "../home.js";
import { loadHomePalette, renderCloudSkillFiles, writeSkillFiles } from "./commands/skill.js";

/**
 * Auto-install the cloud SKILL into the machine's agent-discovery path
 * (PRD §7.3 "works-today" discovery, taken one hop further).
 *
 * `shortwind cloud skill` can *emit* the SKILL, but an agent has to already know
 * to run it — which is the whole discovery problem. Claude Code (and compatible
 * agents) surface every SKILL under `~/.claude/skills/<name>/` in each session's
 * skill listing, unprompted. Dropping the cloud SKILL there on `login` /
 * `init-global` is the missing hop: after one login, any agent on the machine
 * sees `shortwind-cloud` in its skills and knows Cloud exists without being told.
 *
 * The written bytes are the SAME `renderCloudSkillFiles` output as the `skill`
 * command — SKILL.md plus its `references/` — rendered against the GLOBAL home's
 * palette (not `resolveHome`): the install is machine-global, so a repo-local
 * `recipes/` the login happened to run inside must not leak into it.
 */
export const CLOUD_SKILL_NAME = "shortwind-cloud";

/** Resolve the user's `$HOME`, honoring an injected env, then the OS default. */
function userHome(env: HomeEnv): string {
  return env.HOME ?? env.USERPROFILE ?? homedir();
}

/** The `~/.claude/skills/shortwind-cloud/SKILL.md` path the SKILL installs to. */
export function cloudSkillPath(env: HomeEnv): string {
  return path.join(userHome(env), ".claude", "skills", CLOUD_SKILL_NAME, "SKILL.md");
}

/**
 * Render the cloud SKILL from the active account's global palette and write the
 * whole directory to the agent-discovery path. Idempotent: always writes the
 * current bytes. Returns the SKILL.md path (what callers report to the user).
 *
 * Discovery is a convenience, never a gate — a login must not fail because
 * `~/.claude` is missing or unwritable. Callers wrap this and treat a thrown
 * error as "skill not installed" (returning `null`), not as a login failure.
 */
export function installCloudSkill(env: HomeEnv = process.env as HomeEnv): string {
  const recipesDir = homePaths(globalHomeRoot(env)).recipesDir;
  const file = cloudSkillPath(env);
  writeSkillFiles(file, renderCloudSkillFiles(loadHomePalette(recipesDir)));
  return file;
}

/**
 * {@link installCloudSkill} that never throws: returns the written path, or
 * `null` if discovery-dir writes failed. The non-fatal entry point for `login`
 * and `init-global`.
 */
export function tryInstallCloudSkill(env: HomeEnv = process.env as HomeEnv): string | null {
  try {
    return installCloudSkill(env);
  } catch {
    return null;
  }
}
