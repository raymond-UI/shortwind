import { existsSync } from "node:fs";
import path from "node:path";
import { build, BuildError, type BuildResult } from "./build.js";
import { readConfig } from "../project.js";
import { resolveHome, readActiveAccount } from "../home.js";
import {
  publishFromFile,
  InvalidSlugError,
  BundleTooLargeError,
  type PublishOptions,
  type PublishRun,
} from "../cloud/commands/publish.js";
import { ApiError, resolveBaseUrl } from "../cloud/api-client.js";

/**
 * Thrown when deploy runs without a logged-in account. Deploy preflights this
 * (against the shared `~/.shortwind` home, #170) BEFORE building, so the most
 * common first-run failure is a clean one-liner — not a wasted rebuild followed
 * by a raw stack from deep in the publish path.
 */
export class NotLoggedInError extends Error {
  constructor() {
    super(
      "not logged in — run `shortwind cloud login` to authenticate, then re-run `shortwind deploy`",
    );
    this.name = "NotLoggedInError";
  }
}

/**
 * `shortwind deploy <file>` — the one-command golden path from a local recipe
 * project to a live URL (#172). It is the seam where the two former CLIs meet:
 * the LOCAL recipe build (`build`) and the CLOUD publish (`publishFromFile`) run
 * back-to-back under the single `shortwind` binary.
 *
 * Why build first: publish sends the page's recipe palette for the server to
 * expand, so a clean local build is the natural "are my recipes valid?" gate
 * before shipping. The build is skipped when the project has no `recipes/` dir
 * (you can deploy a plain HTML file) and can be turned off with `--no-build`.
 *
 * Split into a pure-ish orchestrator ({@link runDeploy}, returns a structured
 * result; IO only through injected/real `build` + `publish`) and the thin
 * stderr/exit reporter ({@link reportDeployError}), so tests drive it with fakes
 * and never touch the network.
 */

export interface DeployOptions extends PublishOptions {
  /** Cloud API origin override (mirrors `cloud publish --endpoint`). */
  endpoint?: string;
  /** `--no-build` sets this false; default (undefined/true) rebuilds recipes. */
  build?: boolean;
  /** Working directory (defaults to process.cwd()). */
  cwd?: string;
}

export interface DeployDeps {
  /** Recipe build step (defaults to the real {@link build}). */
  build?: (opts: { cwd: string }) => Promise<BuildResult>;
  /** Cloud publish step (defaults to the real {@link publishFromFile}). */
  publish?: typeof publishFromFile;
  /** Predicate: does the project have a recipes dir? (defaults to a config read). */
  recipesDirExists?: (cwd: string) => boolean | Promise<boolean>;
  /** Is an account logged in? (defaults to reading the shared home credentials). */
  isLoggedIn?: () => boolean;
}

/** Is an account logged into the shared `~/.shortwind` home? */
function defaultIsLoggedIn(): boolean {
  return readActiveAccount(resolveHome().root) !== null;
}

export interface DeployRun {
  /** Human one-liner about the build step, or null when it was skipped. */
  buildSummary: string | null;
  /** The publish outcome (url/version or 409 conflict). */
  publish: PublishRun;
}

/** Does the project at `cwd` have a recipes dir (honoring shortwind.config.json)? */
async function defaultHasRecipes(cwd: string): Promise<boolean> {
  const config = await readConfig(cwd);
  return existsSync(path.join(cwd, config.recipesDir));
}

/**
 * Orchestrate deploy: (optionally) rebuild recipes, then publish `file`. Returns
 * a structured result; throws {@link BuildError} on invalid recipes (deploy must
 * not ship a broken palette) and the publish errors on a failed publish.
 */
export async function runDeploy(
  file: string,
  opts: DeployOptions = {},
  deps: DeployDeps = {},
): Promise<DeployRun> {
  const cwd = opts.cwd ?? process.cwd();
  const buildFn = deps.build ?? build;
  const publishFn = deps.publish ?? publishFromFile;
  const hasRecipes = deps.recipesDirExists ?? defaultHasRecipes;
  const isLoggedIn = deps.isLoggedIn ?? defaultIsLoggedIn;

  // Fail fast on the most common first-run error, before spending a rebuild.
  if (!isLoggedIn()) throw new NotLoggedInError();

  let buildSummary: string | null = null;
  // Default-on: only --no-build (opts.build === false) opts out.
  if (opts.build !== false && (await hasRecipes(cwd))) {
    const result = await buildFn({ cwd });
    const n = result.families.length;
    buildSummary = result.changed
      ? `built ${n} recipe ${n === 1 ? "family" : "families"}`
      : `recipes up to date (${n} ${n === 1 ? "family" : "families"})`;
  }

  const publish = await publishFn(file, opts, {
    baseUrl: resolveBaseUrl(opts.endpoint),
  });
  return { buildSummary, publish };
}

/**
 * Translate a deploy failure into a single stderr line + exit code. A
 * {@link BuildError} fails the deploy before publish (exit 2, like
 * `shortwind build`); publish-side errors mirror `cloud publish` (exit 1).
 * Anything else re-throws to bin.ts's top-level handler.
 */
export function reportDeployError(err: unknown): void {
  if (err instanceof BuildError) {
    process.stderr.write(err.message + "\n");
    process.exitCode = 2;
    return;
  }
  if (
    err instanceof NotLoggedInError ||
    err instanceof ApiError ||
    err instanceof InvalidSlugError ||
    err instanceof BundleTooLargeError
  ) {
    const suffix = err instanceof ApiError ? ` (${err.kind})` : "";
    process.stderr.write(`error: ${err.message}${suffix}\n`);
    process.exitCode = 1;
    return;
  }
  throw err;
}
