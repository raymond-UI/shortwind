/**
 * The Shortwind **home** — where the recipe palette and lockfile live
 * (PRD §5.2 / §5.5).
 *
 * Resolution is the standard git/npm precedence:
 *
 *   1. a local repo `recipes/` folder (walking up from cwd) — a power-user
 *      override and a natural blast-radius containment scope (§5.5); else
 *   2. the singular global `~/.shortwind/` home (§5.2).
 *
 * `SHORTWIND_HOME` is a hard pin: when set it selects the global home at that
 * path and bypasses local-`recipes/` discovery entirely. Tests point it at a
 * temp dir so nothing touches the real `~/.shortwind`; an operator can use it
 * to relocate the home deterministically.
 *
 * This is the CLI (a Node process), so `node:fs`/`node:os`/`node:path` IO is
 * fine here — unlike core, which stays pure.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
// The home is the CLI's shared palette/lockfile store, so it draws the
// canonical lockfile shape + constants from the top-level `lockfile.ts` instead
// of re-declaring them (one definition; the home's lockfile IS the local
// lockfile).
import { LOCK_FILENAME, LOCK_VERSION, type Lockfile } from "./lockfile.js";

// Re-export the lockfile name so importers of it from `home.js` keep resolving
// against the single source in `lockfile.ts`. `LOCK_VERSION` is used internally
// here but not re-exported: `lockfile.ts` is its one public home.
export { LOCK_FILENAME };

// ---------------------------------------------------------------------------
// Layout constants — the on-disk names. Kept here so every caller agrees on the
// tree without re-deriving paths.
// ---------------------------------------------------------------------------

/** The global home directory under `$HOME` (i.e. `~/.shortwind`). */
export const HOME_DIRNAME = ".shortwind";

/** The recipe palette directory inside a home (`recipes/`). */
export const RECIPES_DIRNAME = "recipes";

// ---------------------------------------------------------------------------
// Resolved-home + path shapes — plain serializable data.
// ---------------------------------------------------------------------------

/** Where a home lives and the paths derived from it. */
export interface HomePaths {
  /** The home root: a repo root (local) or the global `~/.shortwind`. */
  root: string;
  /** The recipe palette directory. */
  recipesDir: string;
  /** The lockfile path (inside the palette dir). */
  lockfile: string;
}

/** A resolved active home, tagged with which precedence rule selected it. */
export interface ResolvedHome extends HomePaths {
  /** `local` = a repo `recipes/` override; `global` = `~/.shortwind/`. */
  kind: "local" | "global";
}

/** The subset of process env {@link resolveHome} reads (injected for tests). */
export interface HomeEnv {
  HOME?: string | undefined;
  USERPROFILE?: string | undefined;
  SHORTWIND_HOME?: string | undefined;
}

export interface ResolveHomeInput {
  /** Directory the agent is operating in (defaults to `process.cwd()`). */
  cwd?: string;
  /** Environment overrides (defaults to `process.env`). */
  env?: HomeEnv;
}

/**
 * Derive the palette / lockfile paths under a home root. Pure.
 */
export function homePaths(root: string): HomePaths {
  const recipesDir = path.join(root, RECIPES_DIRNAME);
  return {
    root,
    recipesDir,
    lockfile: path.join(recipesDir, LOCK_FILENAME),
  };
}

/** Resolve the user's `$HOME`, honoring an explicit env, then OS default. */
function userHome(env: HomeEnv): string {
  return env.HOME ?? env.USERPROFILE ?? homedir();
}

/** The global home root, respecting the `SHORTWIND_HOME` override. */
function globalHomeRoot(env: HomeEnv): string {
  if (env.SHORTWIND_HOME && env.SHORTWIND_HOME.length > 0) {
    return path.resolve(env.SHORTWIND_HOME);
  }
  return path.join(userHome(env), HOME_DIRNAME);
}

/**
 * Walk up from `cwd` looking for a directory that contains a `recipes/` folder.
 * Returns that directory (the repo root for resolution purposes) or null.
 */
function findLocalRecipesRoot(cwd: string): string | null {
  let dir = path.resolve(cwd);
  // Stop at the filesystem root: path.dirname("/") === "/".
  for (;;) {
    if (existsSync(path.join(dir, RECIPES_DIRNAME))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Resolve the active Shortwind home per §5.2 precedence: a local repo
 * `recipes/` (walking up from cwd) wins; otherwise the global `~/.shortwind/`
 * (or `SHORTWIND_HOME`). Pure-ish — reads only directory existence.
 */
export function resolveHome(input: ResolveHomeInput = {}): ResolvedHome {
  const cwd = input.cwd ?? process.cwd();
  const env = input.env ?? (process.env as HomeEnv);

  // SHORTWIND_HOME is an explicit pin: it bypasses local discovery so the home
  // is deterministic (tests; operator relocation).
  if (env.SHORTWIND_HOME && env.SHORTWIND_HOME.length > 0) {
    return { kind: "global", ...homePaths(globalHomeRoot(env)) };
  }

  const localRoot = findLocalRecipesRoot(cwd);
  if (localRoot) {
    return { kind: "local", ...homePaths(localRoot) };
  }
  return { kind: "global", ...homePaths(globalHomeRoot(env)) };
}

// ---------------------------------------------------------------------------
// Lockfile IO — the {@link Lockfile} shape (from `lockfile.ts`), written into
// the palette dir. The SAME document as the local `.shortwind-lock.json`.
// `LOCK_VERSION` is imported from `lockfile.ts` (single source) above.
// ---------------------------------------------------------------------------

/** An empty lockfile bound to a registry origin (no families yet). */
function emptyLockfile(registry: string): Lockfile {
  return { version: LOCK_VERSION, registry, families: {} };
}

/** Read the home's lockfile, or an empty one when absent. */
export function readHomeLockfile(homeRoot: string, registry = ""): Lockfile {
  const file = homePaths(homeRoot).lockfile;
  if (!existsSync(file)) return emptyLockfile(registry);
  let raw: Lockfile;
  try {
    raw = JSON.parse(readFileSync(file, "utf8")) as Lockfile;
  } catch {
    // A corrupt/half-written lockfile must yield a friendly error, not a raw
    // SyntaxError stack — tell the operator which file to fix or delete.
    throw new Error(
      `corrupt lockfile at ${file} — it is not valid JSON; delete it to regenerate or restore a good copy`,
    );
  }
  return {
    version: typeof raw.version === "number" ? raw.version : LOCK_VERSION,
    registry: typeof raw.registry === "string" ? raw.registry : registry,
    families: raw.families ?? {},
  };
}

/** Write the home's lockfile (families sorted for deterministic output). */
export function writeHomeLockfile(homeRoot: string, lock: Lockfile): void {
  const recipesDir = homePaths(homeRoot).recipesDir;
  mkdirSync(recipesDir, { recursive: true });
  const sorted: Lockfile = {
    version: lock.version || LOCK_VERSION,
    registry: lock.registry,
    families: Object.fromEntries(
      Object.entries(lock.families).sort(([a], [b]) => a.localeCompare(b)),
    ),
  };
  writeFileSync(homePaths(homeRoot).lockfile, JSON.stringify(sorted, null, 2) + "\n");
}
