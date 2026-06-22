/**
 * The Shortwind **home** — where the recipe palette, lockfile, and cloud
 * credentials live (PRD §5.2 / §5.5).
 *
 * Resolution is the standard git/npm precedence:
 *
 *   1. a local repo `recipes/` folder (walking up from cwd) — a power-user
 *      override and a natural blast-radius containment scope (§5.5); else
 *   2. the singular global `~/.shortwind/` home (§5.2).
 *
 * `SHORTWIND_HOME` is a hard pin: when set it selects the global home at that
 * path and bypasses local-`recipes/` discovery entirely. Tests point it at a
 * temp dir so init-global/login never touch the real `~/.shortwind`; an
 * operator can use it to relocate the home deterministically.
 *
 * The global home is bound to whichever cloud account is currently logged in.
 * Multiple accounts can be stored on one machine; `shortwind login` adds + makes
 * active, and {@link switchAccount} flips the active pointer (gh-auth-switch
 * semantics). The active account's token is what `publish` (CLOUD-25) reads from
 * here alongside the lockfile.
 *
 * This is the CLI (a Node process), so `node:fs`/`node:os`/`node:path` IO is
 * fine here — unlike core, which stays pure.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import type { Lockfile } from "../../shared/src/lockfile-diff.js";
import type { DeviceToken } from "./device-flow.js";

// ---------------------------------------------------------------------------
// Layout constants — the on-disk names. Kept here so init-global, login, and
// publish (CLOUD-25) all agree on the tree without re-deriving paths.
// ---------------------------------------------------------------------------

/** The global home directory under `$HOME` (i.e. `~/.shortwind`). */
export const HOME_DIRNAME = ".shortwind";

/** The recipe palette directory inside a home (`recipes/`). */
export const RECIPES_DIRNAME = "recipes";

/**
 * The lockfile filename — identical to `packages/cli`'s and the CLOUD-03
 * `Lockfile` shape so a home-written lockfile diffs against the cloud's stored
 * one without translation. Lives *inside* the palette dir, mirroring the local
 * repo layout (`recipes/.shortwind-lock.json`).
 */
export const LOCK_FILENAME = ".shortwind-lock.json";

/** The multi-account credentials store filename, at the home root. */
export const CREDENTIALS_FILENAME = "credentials.json";

/**
 * Owner-only permission bits for secret-bearing paths. `credentials.json` holds
 * bearer + refresh tokens, so the home dir is created `0700` (owner rwx) and the
 * file written `0600` (owner rw). The process umask clears mode bits at create
 * time, so callers MUST `chmodSync` after writing to guarantee these bits land.
 * No-ops on Windows (where POSIX mode is unreliable) — see `applyMode`.
 */
export const SECRET_DIR_MODE = 0o700;
export const SECRET_FILE_MODE = 0o600;

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
  /** The credentials store path (at the home root). */
  credentials: string;
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
 * Derive the palette / lockfile / credentials paths under a home root. Pure.
 */
export function homePaths(root: string): HomePaths {
  const recipesDir = path.join(root, RECIPES_DIRNAME);
  return {
    root,
    recipesDir,
    lockfile: path.join(recipesDir, LOCK_FILENAME),
    credentials: path.join(root, CREDENTIALS_FILENAME),
  };
}

/** Resolve the user's `$HOME`, honoring an explicit env, then OS default. */
function userHome(env: HomeEnv): string {
  return env.HOME ?? env.USERPROFILE ?? homedir();
}

/** The global home root, respecting the `SHORTWIND_HOME` override. */
export function globalHomeRoot(env: HomeEnv): string {
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
// Credentials store — multi-account, with an active-account pointer.
//
// A single home is bound to whichever account is active, but several accounts
// can be stored so `login` can switch between them like `gh auth switch`. The
// store is keyed by a stable account id; the active pointer names one of them.
// ---------------------------------------------------------------------------

/** One stored account: its id, a human label, and the device-flow token. */
export interface Account {
  /** Stable account id (the cloud account the token is bound to). */
  id: string;
  /** Human-readable label (email / handle) for `gh auth status`-style lists. */
  label: string;
  /** The minted device-flow token (CLOUD-01 {@link DeviceToken}). */
  token: DeviceToken;
  /** Granted scopes, if the server narrowed/echoed them. */
  scopes?: string[];
  /** ISO timestamp the credential was stored/refreshed. */
  addedAt?: string;
}

/** The `credentials.json` document: every account + the active pointer. */
export interface Credentials {
  version: number;
  /** The active account id, or null when no account is logged in. */
  active: string | null;
  /** All stored accounts, keyed by {@link Account.id}. */
  accounts: Record<string, Account>;
}

/** Schema version of the credentials document. */
export const CREDENTIALS_VERSION = 1;

function emptyCredentials(): Credentials {
  return { version: CREDENTIALS_VERSION, active: null, accounts: {} };
}

/**
 * Load the credentials store for a home root. A missing OR corrupt file is
 * treated as empty rather than throwing — a half-written/garbage credentials
 * file must never wedge the CLI; the next `login` rewrites it cleanly.
 */
export function loadCredentials(homeRoot: string): Credentials {
  const file = homePaths(homeRoot).credentials;
  if (!existsSync(file)) return emptyCredentials();
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return emptyCredentials();
  }
  if (typeof raw !== "object" || raw === null) return emptyCredentials();
  const r = raw as Record<string, unknown>;
  const accounts: Record<string, Account> = {};
  if (r["accounts"] && typeof r["accounts"] === "object") {
    for (const [id, entry] of Object.entries(r["accounts"] as Record<string, unknown>)) {
      if (typeof entry !== "object" || entry === null) continue;
      const e = entry as Record<string, unknown>;
      const token = e["token"];
      if (typeof token !== "object" || token === null) continue;
      const t = token as Record<string, unknown>;
      if (typeof t["accessToken"] !== "string") continue;
      accounts[id] = {
        id: typeof e["id"] === "string" ? e["id"] : id,
        label: typeof e["label"] === "string" ? e["label"] : id,
        token: {
          accessToken: t["accessToken"],
          tokenType: typeof t["tokenType"] === "string" ? t["tokenType"] : "bearer",
          ...(typeof t["refreshToken"] === "string" ? { refreshToken: t["refreshToken"] } : {}),
          ...(typeof t["expiresIn"] === "number" ? { expiresIn: t["expiresIn"] } : {}),
          ...(typeof t["scope"] === "string" ? { scope: t["scope"] } : {}),
        },
        ...(Array.isArray(e["scopes"]) ? { scopes: (e["scopes"] as unknown[]).filter((s): s is string => typeof s === "string") } : {}),
        ...(typeof e["addedAt"] === "string" ? { addedAt: e["addedAt"] } : {}),
      };
    }
  }
  const active =
    typeof r["active"] === "string" && accounts[r["active"]] ? r["active"] : null;
  return { version: CREDENTIALS_VERSION, active, accounts };
}

/**
 * Apply an owner-only POSIX mode to a path, swallowing failures on platforms
 * (Windows) where `chmod` is a no-op or unsupported. The `mode` option on
 * `mkdirSync`/`writeFileSync` is masked by the process umask, so an explicit
 * `chmodSync` is the only way to guarantee the bits land.
 */
function applyMode(target: string, mode: number): void {
  if (process.platform === "win32") return;
  try {
    chmodSync(target, mode);
  } catch {
    // Best-effort: a chmod failure must not wedge login on exotic filesystems.
  }
}

/**
 * Persist a credentials store, creating the home root if needed. The store holds
 * bearer + refresh tokens, so the home dir is locked to `0700` and the file to
 * `0600` (owner-only) — created with those modes AND `chmod`ed afterward, since
 * the umask clears mode bits at create time. Atomic enough for a CLI (single writer).
 */
export function saveCredentials(homeRoot: string, creds: Credentials): void {
  mkdirSync(homeRoot, { recursive: true, mode: SECRET_DIR_MODE });
  applyMode(homeRoot, SECRET_DIR_MODE);
  const sorted: Credentials = {
    version: CREDENTIALS_VERSION,
    active: creds.active,
    accounts: Object.fromEntries(
      Object.entries(creds.accounts).sort(([a], [b]) => a.localeCompare(b)),
    ),
  };
  const file = homePaths(homeRoot).credentials;
  writeFileSync(file, JSON.stringify(sorted, null, 2) + "\n", {
    mode: SECRET_FILE_MODE,
  });
  applyMode(file, SECRET_FILE_MODE);
}

/** Input to {@link addAccount} — an account binding from a successful login. */
export interface AddAccountInput {
  id: string;
  label: string;
  token: DeviceToken;
  scopes?: string[];
  /** Clock injection for deterministic `addedAt` in tests. */
  now?: () => Date;
}

/**
 * Add (or update) an account and make it active — the `login` / gh-auth-switch
 * semantics: logging in to an account always activates it, whether it is new or
 * a re-auth of an existing one. Returns the updated store.
 */
export function addAccount(homeRoot: string, input: AddAccountInput): Credentials {
  const creds = loadCredentials(homeRoot);
  const now = input.now ?? (() => new Date());
  creds.accounts[input.id] = {
    id: input.id,
    label: input.label,
    token: input.token,
    ...(input.scopes ? { scopes: input.scopes } : {}),
    addedAt: now().toISOString(),
  };
  creds.active = input.id;
  saveCredentials(homeRoot, creds);
  return creds;
}

/**
 * Switch the active account to an already-stored one (gh auth switch). Throws
 * if the id is unknown — switching to an account that was never logged in is a
 * caller bug, not a recoverable state.
 */
export function switchAccount(homeRoot: string, id: string): Credentials {
  const creds = loadCredentials(homeRoot);
  if (!creds.accounts[id]) {
    const known = Object.keys(creds.accounts);
    throw new Error(
      `cannot switch to unknown account "${id}"` +
        (known.length ? ` — logged-in accounts: ${known.join(", ")}` : " — no accounts logged in"),
    );
  }
  creds.active = id;
  saveCredentials(homeRoot, creds);
  return creds;
}

/** The currently-active account for a home, or null when none is logged in. */
export function readActiveAccount(homeRoot: string): Account | null {
  const creds = loadCredentials(homeRoot);
  if (!creds.active) return null;
  return creds.accounts[creds.active] ?? null;
}

// ---------------------------------------------------------------------------
// Lockfile IO — the CLOUD-03 {@link Lockfile} shape, written into the palette
// dir. Identical document to `packages/cli`'s `.shortwind-lock.json` so the
// cloud publish path (CLOUD-25) diffs it with `diffLockfiles` untranslated.
// ---------------------------------------------------------------------------

/** Lockfile schema version (matches `packages/cli`'s `LOCK_VERSION`). */
export const LOCK_VERSION = 1;

/** An empty lockfile bound to a registry origin (no families yet). */
export function emptyLockfile(registry: string): Lockfile {
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
