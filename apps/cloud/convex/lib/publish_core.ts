/**
 * The thick publish path (CLOUD-23, PRD §6.2) as a PURE orchestration function.
 *
 * Architecture (CLAUDE.md + the CLOUD-23 brief): Convex actions can do the R2
 * network write but have no `ctx.db`; mutations have `ctx.db` but cannot do
 * network IO. Neither boundary is testable offline. So ALL business logic lives
 * here as a pure function over plain serializable data, with the IO expressed as
 * injected PORTS (plain interfaces). The Convex `pages.ts` adapter builds the
 * real ports over `ctx`; the tests build in-memory ports. No Convex types leak
 * into this module — it imports only the pure shared helpers and `expandPage`.
 *
 * The pipeline, in PRD §6.2 order:
 *
 *   auth result in
 *     → resolve / validate slug
 *     → idempotency check (same key → cached result, no dup)
 *     → slug-collision check (existing page at slug → 409 { existingId })
 *     → diff incoming lockfile vs stored
 *     → select touched recipes (body sha diverged from header seal)
 *     → version each touched recipe (recipeVersions) + emit recipeEditEvent
 *       + a DISTINCT auditLog "recipe.edit" entry (PRD §5.4)
 *     → resolve the recipe set
 *     → expandPage (frozen Tailwind + hash) — CLOUD-20
 *     → ASSEMBLE the complete self-contained served document
 *     → writeArtifact to R2 (storage port)
 *     → create page + first pageVersion
 *     → store the lockfile snapshot
 *     → invalidate the edge cache for the URL
 *     → audit "page.publish"
 *     → return { id, url, version }
 *
 * `runUpdate` is the same spine on an existing page id: it bumps the version,
 * retains the prior version row (PRD §5.6 — old versions are frozen, never
 * rebuilt), keeps the SAME url, and re-points `currentVersion*`.
 */

import {
  diffLockfiles,
  type Lockfile,
  type LockfileDiff,
} from "../../shared/src/lockfile-diff.js";
import {
  selectTouchedRecipes,
  type TouchedRecipe,
} from "../../shared/src/fingerprint.js";
import {
  deriveSlug,
  slugCollision,
  validateSlug,
  type ExistingPageRef,
} from "../../shared/src/slug.js";
import { expandPage, type RecipeSource } from "../expand.js";

// ---------------------------------------------------------------------------
// Plain-data inputs / outputs. No Convex types, no class instances, no closures.
// ---------------------------------------------------------------------------

/** The resolved identity from the auth guard (CLOUD-12), as plain data. */
export interface Actor {
  accountId: string;
  /** Acting token id, or null for an unauthenticated/internal caller. */
  tokenId: string | null;
}

/** A recipe carried up on a publish: family + its full sealed source file. */
export interface IncomingRecipe {
  family: string;
  /** Full sealed `@recipe` file (header line + body). */
  source: string;
}

/** Input to {@link runPublish}. All fields plain serializable data. */
export interface PublishInput {
  actor: Actor;
  /** The page's shorthand HTML (recipe tokens in `class=`/`className=`). */
  html: string;
  /**
   * Desired stable handle. When omitted, a slug is derived from `title` (or, as
   * a last resort, the html). A client-supplied slug is validated, not rewritten.
   */
  slug?: string;
  /** Optional human title used to derive a slug when `slug` is omitted. */
  title?: string;
  /** The full recipe set carried on this publish (page + touched bodies). */
  recipes: readonly IncomingRecipe[];
  /** The incoming `.shortwind-lock.json` snapshot (family → {version, sha}). */
  lockfile: Lockfile;
  /** Discovery tags for `find` (CLOUD-24). Defaults to none. */
  tags?: readonly string[];
  /** Page visibility. Defaults to `public`. */
  visibility?: "public" | "unlisted" | "private";
  /** Client idempotency key — a retry with the same key returns the same id. */
  idempotencyKey?: string;
  /** Optional scoped-CSS preamble / theme override stored with the artifact. */
  css?: string;
}

/** Input to {@link runUpdate} — same as publish but targets an existing page. */
export interface UpdateInput extends Omit<PublishInput, "slug" | "title"> {
  /** The page id to update. The slug (URL) is retained from the page record. */
  pageId: string;
}

/** The result of a successful publish/update (PRD §4: `{ id, url, version }`). */
export interface PublishResult {
  id: string;
  url: string;
  version: number;
}

/** A 409 collision: a page already occupies the stable handle (PRD §3.2). */
export interface CollisionResult {
  status: 409;
  /** The id of the page already at the slug — "did you mean update?". */
  existingId: string;
}

/** Either the publish succeeded, or it collided with an existing handle. */
export type PublishOutcome =
  | { ok: true; result: PublishResult }
  | { ok: false; collision: CollisionResult };

// ---------------------------------------------------------------------------
// Ports — the injected IO surface. Plain async interfaces; no Convex types.
// ---------------------------------------------------------------------------

/** A minimal page record the core reads back after find/insert. */
export interface PageRecord {
  id: string;
  accountId: string;
  slug: string;
  /**
   * CLOUD-SUBDOMAIN: the page's globally-unique subdomain label. May be absent on
   * legacy rows created before the field landed; the update path falls back to the
   * slug for the URL when so.
   */
  subdomain?: string;
  currentVersion: number;
}

/** A persisted recipe version row (latest per family) the core reads. */
export interface StoredRecipeVersion {
  family: string;
  version: string;
  bodySha: string;
}

/** Fields for a new page version row. */
export interface NewPageVersion {
  pageId: string;
  accountId: string;
  version: number;
  artifactKey: string;
  expandedHash: string;
  sourceHash: string;
  lockfile: Record<string, string>;
}

/** A recipe-version write request (forward-only; never overwrites). */
export interface RecipeVersionWrite {
  accountId: string;
  family: string;
  version: string;
  body: string;
  bodySha: string;
}

/** A recipe-edit audit event (PRD §5.4 — recorded distinctly). */
export interface RecipeEditEventWrite {
  accountId: string;
  family: string;
  fromVersion: string | null;
  toVersion: string;
  bodySha: string;
  actorTokenId: string | null;
}

/** A generic audit-log entry. */
export interface AuditWrite {
  accountId: string;
  action: string;
  targetId: string | null;
  actorTokenId: string | null;
  metadata: Record<string, unknown>;
}

/**
 * The transactional data port. In production every method maps to a `ctx.db`
 * read/write inside one Convex mutation; in tests it is an in-memory store.
 */
export interface PublishDataPort {
  /** Find the account's page at `slug`, or null if the handle is free. */
  findPageBySlug(accountId: string, slug: string): Promise<PageRecord | null>;
  /** Load a page by id (update path), or null if it does not exist. */
  getPage(pageId: string): Promise<PageRecord | null>;
  /**
   * CLOUD-SUBDOMAIN: is `label` already taken as a subdomain by ANY page across
   * ALL accounts? Backs the global-uniqueness check that decides whether a page
   * gets the bare `<slug>` or the disambiguated `<slug>-<id>` label.
   */
  subdomainTaken(label: string): Promise<boolean>;
  /**
   * Insert a new page shell (no current version yet). The globally-unique
   * subdomain is derived + re-probed INSIDE this insert's transaction
   * (audit #6 / #155): Convex mutations are serializable, so two concurrent
   * publishes of the same slug can no longer both read "free" and both insert the
   * same label (TOCTOU). The authoritative subdomain that was actually committed
   * is returned alongside the new id — the caller must use it (not a pre-derived
   * guess) for the URL + edge route.
   */
  insertPage(page: {
    accountId: string;
    slug: string;
    visibility: "public" | "unlisted" | "private";
    tags: string[];
  }): Promise<{ id: string; subdomain: string }>;
  /** Re-point a page's current version + bump its counter. */
  patchPageCurrentVersion(
    pageId: string,
    currentVersionId: string,
    currentVersion: number,
  ): Promise<void>;
  /** Insert an immutable page version → its new id. */
  insertPageVersion(version: NewPageVersion): Promise<string>;

  /** The latest recorded version of a family, or null if never versioned. */
  latestRecipeVersion(
    accountId: string,
    family: string,
  ): Promise<StoredRecipeVersion | null>;
  /** Append a new recipe version (forward-only). */
  insertRecipeVersion(write: RecipeVersionWrite): Promise<string>;
  /** Emit a recipe-edit event (audit-grade, PRD §5.4). */
  insertRecipeEditEvent(write: RecipeEditEventWrite): Promise<string>;
  /** Append a generic audit-log entry. */
  insertAudit(write: AuditWrite): Promise<string>;

  /** The stored lockfile snapshot for a page (null before the first publish). */
  getStoredLockfile(pageId: string): Promise<Lockfile | null>;
  /** Overwrite the stored lockfile snapshot for a page. */
  putStoredLockfile(pageId: string, lockfile: Lockfile): Promise<void>;

  /** Look up a cached idempotency result, or null. */
  getIdempotency(
    accountId: string,
    key: string,
  ): Promise<{ resultId: string; result: Record<string, unknown> } | null>;
  /** Record an idempotency result for future retries. */
  putIdempotency(
    accountId: string,
    key: string,
    resultId: string,
    result: Record<string, unknown>,
  ): Promise<void>;
}

/** The R2 storage port — the one true network write of the pipeline. */
export interface StoragePort {
  writeArtifact(
    key: string,
    html: string,
    meta: {
      expandedHash: string;
      version: number;
      accountId: string;
      pageId: string;
    },
  ): Promise<void>;
}

/** The edge port — cache invalidation + route registration (KV). */
export interface EdgePort {
  /** Purge the edge cache for a freshly-(re)published URL. */
  invalidate(url: string): Promise<void>;
  /** Register / refresh the hostname+path → page-version route in KV. */
  putRoute(args: {
    pageId: string;
    slug: string;
    /**
     * CLOUD-SUBDOMAIN: the page's subdomain label, so the edge can also register
     * the `<subdomain>.<root>/` route key (not just the legacy path-based one).
     */
    subdomain: string;
    version: number;
    artifactKey: string;
  }): Promise<void>;
}

/** Ambient knobs the core needs but does not compute (clock, base URL). */
export interface PublishEnv {
  /** Public origin used to render a page URL, e.g. "https://shortwind.app". */
  baseUrl: string;
  /**
   * CLOUD-SUBDOMAIN: the apex domain pages are served under as subdomains, e.g.
   * "shortwind.dev". The published URL is `https://<subdomain>.<rootDomain>`. When
   * omitted, the root domain is derived from `baseUrl`'s host (dropping a single
   * leading system label like `c.`), so existing callers need no change.
   */
  rootDomain?: string;
}

/** The full injected dependency bundle. */
export interface PublishDeps {
  data: PublishDataPort;
  storage: StoragePort;
  edge: EdgePort;
  env: PublishEnv;
}

// ---------------------------------------------------------------------------
// Pure helpers.
// ---------------------------------------------------------------------------

/** Build the canonical R2 artifact key (mirrors worker/src/r2.ts exactly). */
export function artifactKey(
  accountId: string,
  pageId: string,
  expandedHash: string,
): string {
  return `artifacts/${accountId}/${pageId}/${expandedHash}.html`;
}

/** Render the (legacy path-based) public URL for a page slug under the origin. */
export function pageUrl(baseUrl: string, slug: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${slug}`;
}

/**
 * CLOUD-SUBDOMAIN: the apex domain pages are served under as subdomains. Derived
 * from an explicit `rootDomain` when given, else from the `baseUrl` host with a
 * single leading system label stripped (`c.shortwind.dev` → `shortwind.dev`,
 * `shortwind.dev` → `shortwind.dev`). Always lowercase, no scheme/port.
 */
export function resolveRootDomain(env: PublishEnv): string {
  if (env.rootDomain && env.rootDomain.trim() !== "") {
    return env.rootDomain.toLowerCase();
  }
  let host = env.baseUrl;
  host = host.replace(/^[a-z]+:\/\//i, ""); // strip scheme
  host = host.replace(/\/.*$/, ""); // strip path
  host = host.replace(/:.*$/, ""); // strip port
  host = host.toLowerCase();
  const labels = host.split(".");
  // A 3+-label host with a single leading system label (the serve host, e.g.
  // `c.shortwind.dev`) collapses to its registrable apex `shortwind.dev`.
  if (labels.length >= 3) return labels.slice(1).join(".");
  return host;
}

/**
 * CLOUD-SUBDOMAIN: the page's canonical published URL — `https://<subdomain>.<root>`.
 * This is what publish/update now return (the Vercel-style per-page subdomain),
 * replacing the legacy `c.shortwind.dev/<slug>` form.
 */
export function subdomainUrl(rootDomain: string, subdomain: string): string {
  return `https://${subdomain}.${rootDomain}`;
}

/** Lockfile → the `{ family: version }` snapshot stored on a `PageVersion`. */
export function lockfileVersions(lockfile: Lockfile): Record<string, string> {
  const out: Record<string, string> = {};
  for (const family of Object.keys(lockfile.families).sort()) {
    out[family] = lockfile.families[family]!.version;
  }
  return out;
}

/** SHA-256 hex (Web Crypto) of a UTF-8 string — the page source hash. */
async function sha256Hex(s: string): Promise<string> {
  const bytes = new TextEncoder().encode(s);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  let hex = "";
  for (const b of new Uint8Array(digest)) hex += b.toString(16).padStart(2, "0");
  return hex;
}

/**
 * Bump a semantic version's minor (`0.4.0` → `0.5.0`), matching the PRD §5.4
 * example "agent modified @card (0.4.0 → 0.5.0)". A non-semver or null prior
 * starts the family at `0.1.0`.
 */
export function bumpRecipeVersion(prior: string | null): string {
  if (!prior) return "0.1.0";
  const m = prior.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return "0.1.0";
  const major = Number(m[1]);
  const minor = Number(m[2]);
  return `${major}.${minor + 1}.0`;
}

/**
 * Assemble the COMPLETE self-contained served document (PRD §6.1 — the serve
 * path stays dumb; it only streams this, never compiles).
 *
 * Two cases:
 *
 *  1. FULL-DOCUMENT PASSTHROUGH: when `expandedHtml` (trimmed) already starts with
 *     `<!doctype html` (case-insensitive) or `<html`, it IS a complete document —
 *     it carries its own `<head>`/`<title>`/styles/fonts. We return it VERBATIM:
 *     no wrapper, no injected `@tailwindcss/browser` script (it does not need the
 *     browser compiler — it brought its own CSS). This is how a self-contained
 *     standalone page (e.g. an author's hand-written HTML) is served unchanged.
 *
 *  2. FRAGMENT WRAP: otherwise the content is a fragment authored for the platform
 *     (recipe tokens already expanded server-side) that still needs the Tailwind
 *     browser compiler. We wrap it in the established Shortwind CDN artifact
 *     pattern: the frozen expanded HTML + the `@tailwindcss/browser@4` compile
 *     script + the scoped CSS preamble / theme vars in a
 *     `<style type="text/tailwindcss">` block. No `expand.js` runtime — the HTML
 *     is already expanded server-side (PRD §5.6).
 *
 * Deterministic output (stable bytes) so it is golden-fixture testable.
 */
export function assembleArtifact(expandedHtml: string, css: string): string {
  // Full-document passthrough: a complete `<!doctype html>` / `<html>` document
  // is served verbatim (it owns its own head/styles; don't double-wrap).
  const head = expandedHtml.trimStart().toLowerCase();
  if (head.startsWith("<!doctype html") || head.startsWith("<html")) {
    return expandedHtml;
  }
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>',
    '<style type="text/tailwindcss">',
    css,
    "</style>",
    "</head>",
    "<body>",
    expandedHtml,
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Shared spine: version touched recipes, expand, assemble, write artifact.
// ---------------------------------------------------------------------------

/**
 * Apply touched recipes: for each recipe whose body sha diverged from its seal
 * (PRD §5.3), append a forward-only `recipeVersion`, emit a distinct
 * `recipeEditEvent`, and write a `recipe.edit` audit row (PRD §5.4). Returns the
 * touched set so the caller can fold it into the publish audit metadata.
 */
async function applyTouchedRecipes(
  actor: Actor,
  recipes: readonly IncomingRecipe[],
  data: PublishDataPort,
): Promise<TouchedRecipe[]> {
  const touched = await selectTouchedRecipes(
    recipes.map((r) => ({ family: r.family, source: r.source })),
  );

  for (const t of touched) {
    const prior = await data.latestRecipeVersion(actor.accountId, t.family);
    const fromVersion = prior?.version ?? t.version ?? null;
    const toVersion = bumpRecipeVersion(fromVersion);
    // Persist the new body (the part after the seal line) verbatim.
    const body = bodyOf(recipes, t.family);

    await data.insertRecipeVersion({
      accountId: actor.accountId,
      family: t.family,
      version: toVersion,
      body,
      bodySha: t.bodySha,
    });
    await data.insertRecipeEditEvent({
      accountId: actor.accountId,
      family: t.family,
      fromVersion,
      toVersion,
      bodySha: t.bodySha,
      actorTokenId: actor.tokenId,
    });
    await data.insertAudit({
      accountId: actor.accountId,
      action: "recipe.edit",
      targetId: t.family,
      actorTokenId: actor.tokenId,
      metadata: { family: t.family, fromVersion, toVersion, bodySha: t.bodySha },
    });
  }

  return touched;
}

/** The body (post-seal) of a family's incoming recipe source, or "" if absent. */
function bodyOf(recipes: readonly IncomingRecipe[], family: string): string {
  const r = recipes.find((x) => x.family === family);
  if (!r) return "";
  const eol = r.source.indexOf("\n");
  return eol === -1 ? "" : r.source.slice(eol + 1);
}

/** Expand the page, assemble the served doc, and write it to R2. */
async function buildAndStore(
  pageId: string,
  actor: Actor,
  version: number,
  input: Pick<PublishInput, "html" | "recipes" | "css">,
  deps: PublishDeps,
): Promise<{ artifactKey: string; expandedHash: string; sourceHash: string }> {
  const recipeSources: RecipeSource[] = input.recipes.map((r) => ({
    filename: `${r.family}.css`,
    source: r.source,
  }));

  const expanded = await expandPage({
    html: input.html,
    recipes: recipeSources,
    css: input.css,
  });

  const document = assembleArtifact(expanded.expandedHtml, expanded.css);
  const key = artifactKey(actor.accountId, pageId, expanded.expandedHash);

  await deps.storage.writeArtifact(key, document, {
    expandedHash: expanded.expandedHash,
    version,
    accountId: actor.accountId,
    pageId,
  });

  const sourceHash = await sha256Hex(input.html);
  return { artifactKey: key, expandedHash: expanded.expandedHash, sourceHash };
}

// ---------------------------------------------------------------------------
// runPublish — create a new page (PRD §6.2).
// ---------------------------------------------------------------------------

export async function runPublish(
  input: PublishInput,
  deps: PublishDeps,
): Promise<PublishOutcome> {
  const acct = input.actor.accountId;

  // 1. Idempotency: a retry with the same key returns the same result, no dup.
  if (input.idempotencyKey) {
    const cached = await deps.data.getIdempotency(acct, input.idempotencyKey);
    if (cached) {
      return { ok: true, result: cached.result as unknown as PublishResult };
    }
  }

  // 2. Resolve / validate the slug.
  const slug = resolveSlug(input);
  if (!slug.ok) {
    throw new Error(`shortwind publish: ${slug.error}`);
  }

  // 3. Slug-collision → 409 with the existing id (PRD §3.2).
  const existing = await deps.data.findPageBySlug(acct, slug.value);
  const ref: ExistingPageRef | null = existing
    ? { id: existing.id, slug: existing.slug }
    : null;
  const collision = slugCollision(slug.value, ref);
  if (collision.collision) {
    return {
      ok: false,
      collision: { status: 409, existingId: collision.existingId },
    };
  }

  // 4. Insert the page shell. The globally-unique subdomain label (the bare slug
  //    when free across ALL accounts and not reserved, else `slug-<id>`) is
  //    derived + re-probed INSIDE the insert transaction (audit #6/#155) so two
  //    concurrent same-slug publishes can't both mint the same label (TOCTOU).
  //    The authoritative committed subdomain comes back from the insert.
  const inserted = await deps.data.insertPage({
    accountId: acct,
    slug: slug.value,
    visibility: input.visibility ?? "public",
    tags: [...(input.tags ?? [])],
  });
  const pageId = inserted.id;
  const subdomain = inserted.subdomain;

  // 5. Lockfile diff vs stored (none yet on create) + touched recipes ride up.
  const storedLock = await deps.data.getStoredLockfile(pageId);
  const diff = diffLockfiles(input.lockfile, storedLock);
  const touched = await applyTouchedRecipes(input.actor, input.recipes, deps.data);

  // 6. Expand → assemble → write artifact. First version is 1.
  const version = 1;
  const built = await buildAndStore(pageId, input.actor, version, input, deps);

  // 7. Audit the publish (distinct from any recipe.edit rows already written).
  //    Written before the version commit so an adapter can fold the audit row
  //    into the same atomic mutation as the version (see pages.ts).
  await deps.data.insertAudit({
    accountId: acct,
    action: "page.publish",
    targetId: pageId,
    actorTokenId: input.actor.tokenId,
    metadata: auditMetadata(version, diff, touched),
  });

  // 8. Create the immutable page version + point the page at it.
  const versionId = await deps.data.insertPageVersion({
    pageId,
    accountId: acct,
    version,
    artifactKey: built.artifactKey,
    expandedHash: built.expandedHash,
    sourceHash: built.sourceHash,
    lockfile: lockfileVersions(input.lockfile),
  });
  await deps.data.patchPageCurrentVersion(pageId, versionId, version);

  // 9. Persist the lockfile snapshot for the next publish's diff.
  await deps.data.putStoredLockfile(pageId, input.lockfile);

  // 10. Edge: register the route + invalidate the URL. The page's canonical URL
  //     is now the per-page subdomain (`https://<subdomain>.<root>`); the edge
  //     port carries both slug + subdomain so it can register the subdomain route
  //     key AND keep the legacy path-based one working.
  const url = subdomainUrl(resolveRootDomain(deps.env), subdomain);
  await deps.edge.putRoute({
    pageId,
    slug: slug.value,
    subdomain,
    version,
    artifactKey: built.artifactKey,
  });
  await deps.edge.invalidate(url);

  const result: PublishResult = { id: pageId, url, version };

  if (input.idempotencyKey) {
    await deps.data.putIdempotency(
      acct,
      input.idempotencyKey,
      pageId,
      result as unknown as Record<string, unknown>,
    );
  }

  return { ok: true, result };
}

// ---------------------------------------------------------------------------
// runUpdate — new version on an existing page (PRD §5.6: prior retained).
// ---------------------------------------------------------------------------

export async function runUpdate(
  input: UpdateInput,
  deps: PublishDeps,
): Promise<PublishOutcome> {
  const acct = input.actor.accountId;

  // Idempotency first (an update retry returns the same version).
  if (input.idempotencyKey) {
    const cached = await deps.data.getIdempotency(acct, input.idempotencyKey);
    if (cached) {
      return { ok: true, result: cached.result as unknown as PublishResult };
    }
  }

  const page = await deps.data.getPage(input.pageId);
  if (!page) {
    throw new Error(`shortwind update: page not found: ${input.pageId}`);
  }
  if (page.accountId !== acct) {
    throw new Error("shortwind update: page belongs to another account");
  }

  // Lockfile diff vs the page's stored snapshot + touched recipes ride up.
  const storedLock = await deps.data.getStoredLockfile(input.pageId);
  const diff = diffLockfiles(input.lockfile, storedLock);
  const touched = await applyTouchedRecipes(input.actor, input.recipes, deps.data);

  // Version bump — prior version row is left untouched (frozen, PRD §5.6).
  const version = page.currentVersion + 1;
  const built = await buildAndStore(input.pageId, input.actor, version, input, deps);

  // Audit before the version commit (an adapter folds it into the same mutation).
  await deps.data.insertAudit({
    accountId: acct,
    action: "page.update",
    targetId: input.pageId,
    actorTokenId: input.actor.tokenId,
    metadata: auditMetadata(version, diff, touched),
  });

  const versionId = await deps.data.insertPageVersion({
    pageId: input.pageId,
    accountId: acct,
    version,
    artifactKey: built.artifactKey,
    expandedHash: built.expandedHash,
    sourceHash: built.sourceHash,
    lockfile: lockfileVersions(input.lockfile),
  });
  await deps.data.patchPageCurrentVersion(input.pageId, versionId, version);
  await deps.data.putStoredLockfile(input.pageId, input.lockfile);

  // SAME url — both the slug AND the subdomain are retained from the page record
  //   (PRD §3.2 identity; the subdomain is stable once minted). Legacy rows with
  //   no stored subdomain fall back to the slug as the label.
  const subdomain = page.subdomain ?? page.slug;
  const url = subdomainUrl(resolveRootDomain(deps.env), subdomain);
  await deps.edge.putRoute({
    pageId: input.pageId,
    slug: page.slug,
    subdomain,
    version,
    artifactKey: built.artifactKey,
  });
  await deps.edge.invalidate(url);

  const result: PublishResult = { id: input.pageId, url, version };

  if (input.idempotencyKey) {
    await deps.data.putIdempotency(
      acct,
      input.idempotencyKey,
      input.pageId,
      result as unknown as Record<string, unknown>,
    );
  }

  return { ok: true, result };
}

// ---------------------------------------------------------------------------
// Local pure helpers.
// ---------------------------------------------------------------------------

function resolveSlug(input: PublishInput) {
  if (input.slug !== undefined) return validateSlug(input.slug);
  const seed = input.title ?? input.html;
  return deriveSlug(seed);
}

function auditMetadata(
  version: number,
  diff: LockfileDiff,
  touched: TouchedRecipe[],
): Record<string, unknown> {
  return {
    version,
    lockfileDiff: {
      added: diff.added.map((a) => a.family),
      changed: diff.changed.map((c) => c.family),
      removed: diff.removed.map((r) => r.family),
    },
    touchedRecipes: touched.map((t) => t.family),
  };
}
