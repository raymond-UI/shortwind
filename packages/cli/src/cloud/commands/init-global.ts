import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  RECIPES_DIRNAME,
  emptyLockfile,
  globalHomeRoot,
  homePaths,
  writeHomeLockfile,
  type HomeEnv,
} from "../../home.js";

/**
 * `init --global` — one-time setup of the singular global Shortwind home
 * (PRD §5.2). Creates `~/.shortwind/` with:
 *
 *   - `recipes/`            the recipe palette directory (empty to start; the
 *                           agent grows it — §5.4)
 *   - `recipes/.shortwind-lock.json`  the CLOUD-03 lockfile (empty families)
 *   - `SKILL.md`            agent-facing instructions for the global home
 *
 * Idempotent: a second run is a no-op (`created: false`) and never clobbers an
 * existing home. `--force` overwrites the tree.
 *
 * Adapts the `packages/cli/src/init.ts` copy/lock/render flow, but writes to the
 * global home instead of `./recipes/` and skips the per-project bundler/IDE
 * wiring (a global home has no project to wire). No network: the palette starts
 * empty and fills on first `publish`/recipe edit.
 */
export interface InitGlobalOptions {
  /** Cloud API origin recorded for later verbs. */
  endpoint?: string;
  /** Overwrite an existing home. */
  force?: boolean;
  /** Registry origin recorded in the lockfile (defaults to the cloud palette). */
  registry?: string;
}

/** Injected IO surface — tests pass a sandboxed `env`. */
export interface InitGlobalContext {
  env?: HomeEnv;
}

export interface InitGlobalResult {
  /** Whether this run created (or `--force`-rewrote) the home. */
  created: boolean;
  /** The resolved global home root. */
  home: string;
  /** Paths written (or that already existed). */
  recipesDir: string;
  lockfile: string;
  skillPath: string;
  /** The endpoint recorded, or null. */
  endpoint: string | null;
  /** The registry origin written into the lockfile. */
  registry: string;
}

/** The default cloud palette registry origin recorded in a fresh lockfile. */
export const DEFAULT_REGISTRY = "https://shortwind.dev";

export async function initGlobal(
  opts: InitGlobalOptions,
  ctx: InitGlobalContext = {},
): Promise<InitGlobalResult> {
  const env = ctx.env ?? (process.env as HomeEnv);
  const root = globalHomeRoot(env);
  const paths = homePaths(root);
  const skillPath = path.join(root, "SKILL.md");
  const registry = opts.registry ?? DEFAULT_REGISTRY;

  const lockExists = existsSync(paths.lockfile);
  const alreadyInitialized = lockExists && existsSync(skillPath);

  // Idempotent: an initialized home is left exactly as-is unless --force.
  if (alreadyInitialized && !opts.force) {
    return {
      created: false,
      home: root,
      recipesDir: paths.recipesDir,
      lockfile: paths.lockfile,
      skillPath,
      endpoint: opts.endpoint ?? null,
      registry,
    };
  }

  // Create the palette dir (mkdir -p) and seal the tree.
  mkdirSync(path.join(root, RECIPES_DIRNAME), { recursive: true });
  writeHomeLockfile(root, emptyLockfile(registry));
  writeFileSync(skillPath, renderHomeSkill(root));

  return {
    created: true,
    home: root,
    recipesDir: paths.recipesDir,
    lockfile: paths.lockfile,
    skillPath,
    endpoint: opts.endpoint ?? null,
    registry,
  };
}

/**
 * The agent-facing SKILL.md for a global home. Self-authored (no catalog/network
 * dependency at init time): it tells an agent where the palette lives, that
 * recipe edits flow up on the next `publish`, and how to use the local override
 * for containment (§5.4 / §5.5).
 */
function renderHomeSkill(root: string): string {
  return `# Shortwind global home

This is your machine-wide Shortwind home at \`${root}\`.

## Layout

- \`recipes/\` — the recipe palette. Each \`*.css\` file is a recipe family with a
  fingerprint header (version + content hash). The agent is the primary editor:
  notice a repeated pattern, author a \`@recipe\`, and it versions up to the cloud
  on the next publish.
- \`recipes/.shortwind-lock.json\` — the lockfile pinning family versions + shas.
- \`credentials.json\` — your cloud account binding(s); the active account is the
  one publishes go to. \`shortwind cloud login\` switches accounts.

## Resolution

Any directory you work in resolves recipes from this global home, with **zero**
per-project setup. A local repo \`recipes/\` folder (if present) overrides this
home for that directory — use it to scope recipe edits to one project without
machine-wide consequences.

## Publishing

\`shortwind cloud publish ./page.html\` is the only action you need. It reads the
lockfile + fingerprints from this home and carries any locally-touched recipe
bodies with the page — the publish *is* the sync. There is no watcher and no
separate sync command. Published pages are frozen; a recipe edit only affects
the next publish that carries it.
`;
}
