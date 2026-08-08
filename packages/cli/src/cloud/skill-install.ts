import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { globalHomeRoot, homePaths, type HomeEnv } from "../home.js";
import { cliVersion } from "../init.js";
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
 * Sidecar recording which CLI version wrote the installed SKILL.
 *
 * It is a dotfile BESIDE the SKILL rather than a line inside it: the rendered
 * bytes are golden-tested and depend only on the palette, so stamping the
 * version into SKILL.md itself would churn the fixtures on every release. Agents
 * ignore dotfiles when listing a skills directory.
 */
export function cloudSkillStampPath(env: HomeEnv): string {
  return path.join(path.dirname(cloudSkillPath(env)), ".shortwind-cli-version");
}

/** The CLI version that wrote the installed SKILL, or `null` if unknown. */
export function installedSkillVersion(env: HomeEnv): string | null {
  try {
    return readFileSync(cloudSkillStampPath(env), "utf8").trim() || null;
  } catch {
    return null;
  }
}

/** This CLI's own version, as stamped. Unknowable ⇒ `"0.0.0"` (always stale). */
function currentVersion(): string {
  return cliVersion() ?? "0.0.0";
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
export function installCloudSkill(
  env: HomeEnv = process.env as HomeEnv,
  version: string = currentVersion(),
): string {
  const recipesDir = homePaths(globalHomeRoot(env)).recipesDir;
  const file = cloudSkillPath(env);
  writeSkillFiles(file, renderCloudSkillFiles(loadHomePalette(recipesDir)));
  writeFileSync(cloudSkillStampPath(env), version + "\n");
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

/**
 * Rewrite an ALREADY-INSTALLED SKILL when a different CLI version wrote it.
 *
 * Upgrading the CLI does not touch `~/.claude/skills/`, so before this a machine
 * kept whatever SKILL its last `login` produced — indefinitely, since nobody logs
 * in twice. A SKILL that documents a command wrongly is worse than no SKILL (see
 * the beta.25 `login --scope domains:bind` advice, which destroyed the caller's
 * publishing token), so every `shortwind cloud` invocation self-heals a stale one.
 *
 * Deliberately does NOT install for someone who never logged in: `login` /
 * `init-global` remain the only commands that put the SKILL on a machine the
 * first time. Returns the refreshed path, or `null` when nothing was written.
 * Never throws — discovery is a convenience, never a gate.
 */
export function refreshCloudSkillIfStale(
  env: HomeEnv = process.env as HomeEnv,
  version: string = currentVersion(),
): string | null {
  try {
    if (!existsSync(cloudSkillPath(env))) return null;
    if (installedSkillVersion(env) === version) return null;
    return installCloudSkill(env, version);
  } catch {
    return null;
  }
}
