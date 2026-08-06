import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { toArray, type StubResult } from "./stub.js";
import {
  resolveHome,
  readActiveCloudAccount,
  readHomeLockfile,
  updateAccountToken,
  type ResolvedHome,
} from "../../home.js";
import { type CandidateRecipe } from "../contract/fingerprint.js";
import { htmlTitle, validateSlug } from "../contract/slug.js";
import type { Lockfile } from "../contract/lockfile-diff.js";
import {
  ApiError,
  createApiClient,
  refreshAuthConfig,
  resolveBaseUrl,
  type ApiClient,
  type BundleFilePayload,
  type BundlePayload,
  type BundleResult,
  type PublishPayload,
  type PublishResult,
  type RecipePayload,
} from "../api-client.js";

/**
 * `publish <file>` — POST /v1/pages: create a page from an HTML file
 * (+ lockfile, + touched recipes). Idempotency-keyed (PRD §4). Returns
 * id, url, version when implemented.
 *
 * `--tag` is repeatable; `--domain` sets the desired subdomain/slug;
 * `--visibility` mirrors the `visibility` verb's levels.
 *
 * {@link publish} is the retained CLOUD-04 parse stub (cli.test.ts). The REAL
 * behavior is split into testable units:
 *   - {@link assemblePublishPayload} — pure: HTML + lockfile + ONLY the touched
 *     recipe BODIES (via CLOUD-03 `selectTouchedRecipes`) + flags.
 *   - {@link renderPublish} — output rendering, incl. the 409 → `update` hint.
 *   - {@link runPublish} — drives an injected api-client (no network in tests).
 *   - {@link publishFromFile} — the IO shell (read file, resolve home).
 * STATELESS: the returned id is printed, never persisted locally (PRD §4).
 * CLOUD-30 wires `publishFromFile` into cli.ts once the base URL/env exists.
 */
export interface PublishOptions {
  domain?: string;
  tag?: string | string[];
  visibility?: string;
  idempotencyKey?: string;
  json?: boolean;
  /**
   * CLOUD-50 (additive): publish `file`'s DIRECTORY as a linked multi-file
   * bundle, with `file` as the entry point. The other `.html` files in the
   * directory become linked siblings; cross-file relative links resolve to the
   * served siblings (link-before-deploy, done server-side). Single-file publish
   * behavior is unchanged when this flag is absent.
   */
  bundle?: boolean;
}

export function publish(file: string, opts: PublishOptions): StubResult {
  return {
    verb: "publish",
    implementedBy: "CLOUD-25",
    parsed: {
      file,
      domain: opts.domain ?? null,
      tags: toArray(opts.tag),
      visibility: opts.visibility ?? null,
      idempotencyKey: opts.idempotencyKey ?? null,
      json: Boolean(opts.json),
      bundle: Boolean(opts.bundle),
    },
  };
}

/** Thrown when `--domain <slug>` is malformed (caught client-side, pre-network). */
export class InvalidSlugError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidSlugError";
  }
}

/**
 * Assert a `--domain` slug is well-formed BEFORE any network call, so a bad
 * handle fails fast locally instead of round-tripping (and, for bundles, before
 * walking the directory). Reuses the shared {@link validateSlug} grammar.
 */
function assertValidSlug(slug: string | undefined): void {
  if (slug === undefined) return;
  const result = validateSlug(slug);
  if (!result.ok) {
    throw new InvalidSlugError(`invalid --domain "${slug}": ${result.error}`);
  }
}

/** The four page-visibility levels, validated before they hit the wire. */
const VISIBILITIES = new Set(["public", "unlisted", "private"]);

/** Coerce a raw `--visibility` flag, or `undefined` for "server default". */
export function normalizeVisibility(
  value: string | undefined,
): "public" | "unlisted" | "private" | undefined {
  if (value === undefined) return undefined;
  if (!VISIBILITIES.has(value)) {
    throw new Error(
      `invalid --visibility "${value}" (expected public | unlisted | private)`,
    );
  }
  return value as "public" | "unlisted" | "private";
}

/**
 * Assemble the publish request body. PURE (no IO): the caller supplies the HTML,
 * the home lockfile, and the candidate recipe palette; this selects ONLY the
 * touched family bodies (CLOUD-03 rule — body sha diverges from the seal) and
 * attaches their source. The whole palette is NEVER sent — the wire carries the
 * page + lockfile + just the recipes the agent edited (PRD §5.3).
 */
export async function assemblePublishPayload(input: {
  html: string;
  lockfile: Lockfile;
  candidates: readonly CandidateRecipe[];
  domain?: string | undefined;
  /**
   * Human name for the page, used ONLY to derive a slug when `--domain` is
   * omitted (see {@link publishTitle}). Sending it keeps the server from having
   * to name the page itself.
   */
  title?: string | undefined;
  tags?: string[] | undefined;
  visibility?: string | undefined;
  idempotencyKey?: string | undefined;
}): Promise<PublishPayload> {
  // Carry the FULL local palette (every candidate), not just the edited/touched
  // subset — the server merges these into the expansion registry, so a page
  // using an UNEDITED recipe still expands. (The server's applyTouchedRecipes
  // re-runs the touched filter, so carrying unedited families writes no
  // recipe.edit events.)
  const recipes: RecipePayload[] = input.candidates.map((c) => ({
    family: c.family,
    source: c.source,
  }));
  const visibility = normalizeVisibility(input.visibility);
  return {
    html: input.html,
    lockfile: input.lockfile,
    recipes,
    ...(input.domain ? { slug: input.domain } : {}),
    ...(input.title ? { title: input.title } : {}),
    ...(input.tags && input.tags.length > 0 ? { tags: input.tags } : {}),
    ...(visibility ? { visibility } : {}),
    ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
  };
}

/**
 * The human name to send with a publish: the document's `<title>`, else the
 * file's base name. Only ever used to derive a slug when `--domain` is omitted.
 *
 * Both beat the alternative the server would otherwise be left with. Publishing
 * `action-items-review-round2.html` used to mint
 * `doctype-html-html-lang-en-data-appearance-dark-head-meta-charse` because the
 * whole document was the seed; the file name alone would have been right.
 */
export function publishTitle(file: string, html: string): string {
  return htmlTitle(html) ?? path.basename(file).replace(/\.[a-z0-9]+$/i, "");
}

/**
 * Render a publish outcome. On success prints `{ url, version }` (and `id` so
 * the agent can immediately `update` it in this same session WITHOUT persisting
 * anything to disk). `--json` emits the raw result envelope.
 */
export function renderPublishResult(
  result: PublishResult,
  json: boolean,
): string {
  if (json) return JSON.stringify(result, null, 2);
  return [
    `published ${result.url}`,
    `id:      ${result.id}`,
    `version: v${result.version}`,
  ].join("\n");
}

/**
 * Render the 409 conflict: the slug/handle is already taken. Tells the agent
 * the existing id and that it should `update` it instead of publishing anew —
 * the stateless find-before-publish loop's recovery path (PRD §4).
 */
export function renderConflict(existingId: string | undefined, json: boolean): string {
  const id = existingId ?? "(unknown)";
  if (json) {
    return JSON.stringify(
      { error: { code: "CONFLICT", existingId: existingId ?? null } },
      null,
      2,
    );
  }
  return [
    `a page with this handle already exists (id: ${id})`,
    `run: shortwind cloud update ${id} <file>`,
  ].join("\n");
}

/** The result of a publish attempt: either rendered output, or a conflict. */
export interface PublishRun {
  /** True on a 2xx publish; false on a 409 conflict. */
  ok: boolean;
  /** The rendered, ready-to-print output. */
  output: string;
  /** The created/conflicting page id (never persisted — for the caller's flow). */
  id: string | undefined;
}

/**
 * Run `publish` against an injected api-client. Maps the 409 conflict to a
 * graceful, non-throwing {@link PublishRun} carrying the `update` hint; any
 * other ApiError propagates. STATELESS — returns the id but stores nothing.
 */
export async function runPublish(
  client: ApiClient,
  payload: PublishPayload,
  json: boolean,
): Promise<PublishRun> {
  try {
    const result = await client.publishPage(payload);
    return { ok: true, output: renderPublishResult(result, json), id: result.id };
  } catch (err) {
    if (err instanceof ApiError && err.kind === "conflict") {
      return {
        ok: false,
        output: renderConflict(err.existingId, json),
        id: err.existingId,
      };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// CLOUD-50 — `publish --bundle <entry-file>`: publish the entry file's directory
// as a linked multi-file bundle. ADDITIVE — single-file publish is unchanged.
//
// Split the same way as the single-file path: a PURE payload assembler
// (`assembleBundlePayload`), a render (`renderBundleResult`), a driver over an
// injected client (`runBundle`), and the IO shell (`publishBundleFromFile`) that
// reads the directory. The server does the link-rewrite (link-before-deploy);
// the CLI just ships the entry point + the sibling files + the touched recipes.
// ---------------------------------------------------------------------------

/** An {@link ApiClient} known to carry `publishBundle` (the bundle handler's seam). */
export type BundleCapableClient = ApiClient & {
  publishBundle(payload: BundlePayload): Promise<BundleResult>;
};

/**
 * Assemble the bundle publish body. PURE (no IO): the caller supplies the files
 * (entry + siblings), which one is the entry, the home lockfile, and the
 * candidate palette; this selects ONLY the touched family bodies (same CLOUD-03
 * rule as the single-file path) and attaches them once for the whole bundle.
 * The entry file is moved to the FRONT of `files` for a stable wire order.
 */
export async function assembleBundlePayload(input: {
  files: readonly BundleFilePayload[];
  entryPath: string;
  lockfile: Lockfile;
  candidates: readonly CandidateRecipe[];
  domain?: string | undefined;
  title?: string | undefined;
}): Promise<BundlePayload> {
  if (input.files.length === 0) {
    throw new Error("bundle has no files");
  }
  if (!input.files.some((f) => f.path === input.entryPath)) {
    throw new Error(
      `bundle entry "${input.entryPath}" is not one of the bundle files`,
    );
  }
  // Carry the FULL local palette (see assemblePublishPayload) so unedited
  // recipes expand server-side.
  const recipes: RecipePayload[] = input.candidates.map((c) => ({
    family: c.family,
    source: c.source,
  }));
  // Deterministic order: entry first, then the rest sorted by path.
  const entry = input.files.find((f) => f.path === input.entryPath)!;
  const rest = input.files
    .filter((f) => f.path !== input.entryPath)
    .sort((a, b) => a.path.localeCompare(b.path));
  return {
    files: [entry, ...rest],
    entryPath: input.entryPath,
    recipes,
    lockfile: input.lockfile,
    ...(input.domain ? { slug: input.domain } : {}),
    ...(input.title ? { title: input.title } : {}),
  };
}

/** Render a bundle publish outcome (or its `--json` envelope). */
export function renderBundleResult(result: BundleResult, json: boolean): string {
  if (json) return JSON.stringify(result, null, 2);
  const lines = [
    `published bundle ${result.url}`,
    `id:      ${result.bundleId}`,
    `version: v${result.version}`,
    `files:   ${result.files.length}`,
  ];
  for (const f of result.files) {
    lines.push(`  ${f.entry ? "→" : " "} ${f.path}`);
  }
  return lines.join("\n");
}

/**
 * Run `publish --bundle` against an injected api-client. Returns the rendered
 * output + the created bundle id. STATELESS — the id is printed, never stored.
 */
export async function runBundle(
  client: BundleCapableClient,
  payload: BundlePayload,
  json: boolean,
): Promise<PublishRun> {
  const result = await client.publishBundle(payload);
  return {
    ok: true,
    output: renderBundleResult(result, json),
    id: result.bundleId,
  };
}

// ---------------------------------------------------------------------------
// IO shell — read the recipe palette + the HTML file, resolve the active home.
// Kept thin and separate from the pure assembly/render above so the network
// path is the only un-unit-tested seam.
// ---------------------------------------------------------------------------

/**
 * Read every sealed recipe file in a home's `recipes/` dir into candidate
 * recipes (family = filename without extension). A missing palette ⇒ no
 * candidates. The `.shortwind-lock.json` and dotfiles are skipped.
 */
function readPaletteCandidates(home: ResolvedHome): CandidateRecipe[] {
  const dir = home.recipesDir;
  if (!existsSync(dir)) return [];
  const out: CandidateRecipe[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (entry.name.startsWith(".")) continue;
    const ext = path.extname(entry.name);
    if (ext !== ".css" && ext !== ".recipe" && ext !== ".txt") continue;
    const family = path.basename(entry.name, ext);
    out.push({
      family,
      source: readFileSync(path.join(dir, entry.name), "utf8"),
    });
  }
  out.sort((a, b) => a.family.localeCompare(b.family));
  return out;
}

/**
 * The full `publish <file>` flow: resolve the active home + token (CLOUD-11),
 * read the HTML file + lockfile + palette, assemble the payload (touched bodies
 * only), and POST it. Returns the rendered output. The api-client is injected
 * so even this shell can be exercised in tests with a fake client + temp home.
 */
/**
 * Bundle resource caps (CLOUD security hardening). A `--bundle` publish walks the
 * entry file's whole directory tree; without bounds a deep/large tree or a
 * symlink loop could exhaust memory or hang. We cap the file COUNT and the total
 * BYTES, and never follow symlinks (they could escape the bundle dir entirely).
 */
export const MAX_BUNDLE_FILES = 2000;
export const MAX_BUNDLE_BYTES = 50 * 1024 * 1024; // 50 MB

/** Thrown when a bundle exceeds {@link MAX_BUNDLE_FILES}/{@link MAX_BUNDLE_BYTES}. */
export class BundleTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BundleTooLargeError";
  }
}

/**
 * Read a bundle's files off disk: the entry `file` + every other `.html` file in
 * its directory (recursively), each as a `{ path, html }` with a bundle-relative
 * POSIX path. The entry's relative path is returned as `entryPath`. Pure-ish IO
 * (fs only) so the assembly above stays unit-testable without a directory.
 *
 * Bounded + symlink-safe: the walk caps the file count and total bytes (a
 * {@link BundleTooLargeError} on exceed) and SKIPS symlinks rather than following
 * them — `withFileTypes` reports the entry's own type, so a symlinked dir/file is
 * neither recursed into nor read.
 */
export function readBundleDir(file: string): {
  files: BundleFilePayload[];
  entryPath: string;
} {
  const dir = path.dirname(path.resolve(file));
  const entryPath = toPosix(path.relative(dir, path.resolve(file)));
  const files: BundleFilePayload[] = [];
  let totalBytes = 0;
  const add = (relPath: string, html: string): void => {
    if (files.length >= MAX_BUNDLE_FILES) {
      throw new BundleTooLargeError(
        `bundle exceeds the ${MAX_BUNDLE_FILES}-file limit — split it or publish fewer files`,
      );
    }
    totalBytes += Buffer.byteLength(html, "utf8");
    if (totalBytes > MAX_BUNDLE_BYTES) {
      throw new BundleTooLargeError(
        `bundle exceeds the ${MAX_BUNDLE_BYTES}-byte (${Math.round(MAX_BUNDLE_BYTES / (1024 * 1024))} MB) size limit`,
      );
    }
    files.push({ path: relPath, html });
  };
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      // Never follow symlinks — they can escape the bundle dir or loop forever.
      if (entry.isSymbolicLink()) continue;
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      if (path.extname(entry.name).toLowerCase() !== ".html") continue;
      add(toPosix(path.relative(dir, abs)), readFileSync(abs, "utf8"));
    }
  };
  walk(dir);
  if (!files.some((f) => f.path === entryPath)) {
    // The entry file itself may be non-.html (defensive) — include it explicitly.
    add(entryPath, readFileSync(path.resolve(file), "utf8"));
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, entryPath };
}

/** Normalize an OS path to POSIX separators (bundle paths are always POSIX). */
function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

/**
 * The local inputs every publish-shaped flow needs: the lockfile + palette from
 * the resolved home, and an authenticated api-client for the target origin.
 *
 * Identity is machine-global (login writes the GLOBAL home) while the palette
 * and lockfile come from `home` (a repo-local `recipes/` when present): reading
 * the token from `home` would falsely fail when publishing from a recipe
 * project. Shared by publish, `publish --bundle` and update so the three shells
 * cannot drift on where identity, palette or base URL come from.
 */
export interface PublishContext {
  lockfile: Lockfile;
  candidates: CandidateRecipe[];
  client: ApiClient;
}

export function loadPublishContext(deps: {
  home?: ResolvedHome | undefined;
  client?: ApiClient | undefined;
  baseUrl?: string | undefined;
}): PublishContext {
  const home = deps.home ?? resolveHome();
  const account = readActiveCloudAccount();
  if (!account) {
    throw new Error(
      "not logged in — run `shortwind cloud login` (no active account in the Shortwind home)",
    );
  }
  const baseUrl = resolveBaseUrl(deps.baseUrl);
  return {
    lockfile: readHomeLockfile(home.root),
    candidates: readPaletteCandidates(home),
    client:
      deps.client ??
      createApiClient({
        baseUrl,
        ...refreshAuthConfig({
          baseUrl,
          accessToken: account.token.accessToken,
          refreshToken: account.token.refreshToken,
          onTokenRefreshed: (t) => updateAccountToken(account.id, t),
        }),
      }),
  };
}

/**
 * The `publish --bundle <entry-file>` flow: resolve the home + token, read the
 * entry file's directory as a bundle (entry + siblings), assemble the payload
 * (touched bodies only, shared across the bundle), and POST it to `/v1/bundles`.
 * The api-client is injected so the shell is exercisable with a fake + temp home.
 */
export async function publishBundleFromFile(
  file: string,
  opts: PublishOptions,
  deps: {
    home?: ResolvedHome | undefined;
    client?: BundleCapableClient | undefined;
    baseUrl?: string | undefined;
  } = {},
): Promise<PublishRun> {
  // Validate the slug locally first — fail fast before walking the directory.
  assertValidSlug(opts.domain);
  const { lockfile, candidates, client } = loadPublishContext(deps);
  const { files, entryPath } = readBundleDir(file);
  const payload = await assembleBundlePayload({
    files,
    entryPath,
    lockfile,
    candidates,
    domain: opts.domain,
    // Only the entry's <title>: with no title the server names the bundle from
    // the entry PATH, which is already a sane handle (unlike raw markup).
    title: htmlTitle(files.find((f) => f.path === entryPath)?.html ?? "") ?? undefined,
  });
  return runBundle(client as BundleCapableClient, payload, Boolean(opts.json));
}

export async function publishFromFile(
  file: string,
  opts: PublishOptions,
  deps: {
    home?: ResolvedHome;
    client?: ApiClient;
    baseUrl?: string;
  } = {},
): Promise<PublishRun> {
  // CLOUD-50: `--bundle` deploys the entry file's directory as a linked bundle.
  if (opts.bundle) {
    return publishBundleFromFile(file, opts, {
      home: deps.home,
      client: deps.client as BundleCapableClient | undefined,
      baseUrl: deps.baseUrl,
    });
  }
  // Validate the slug locally first — fail fast before reading the file/network.
  assertValidSlug(opts.domain);
  const { lockfile, candidates, client } = loadPublishContext(deps);
  const html = readFileSync(file, "utf8");
  const payload = await assemblePublishPayload({
    html,
    lockfile,
    candidates,
    domain: opts.domain,
    title: publishTitle(file, html),
    tags: toArray(opts.tag),
    visibility: opts.visibility,
    idempotencyKey: opts.idempotencyKey,
  });
  return runPublish(client, payload, Boolean(opts.json));
}
