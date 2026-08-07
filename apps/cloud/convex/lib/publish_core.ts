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
 *     → writeArtifact the IMMUTABLE hashed object to R2 (storage port)
 *     → create page + first pageVersion
 *     → writeArtifact the STABLE `current.html` — last, so nothing is public
 *       until the version it belongs to is committed (#232)
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
  htmlTitle,
  mintSubdomainId,
  slugCollision,
  validateSlug,
  type ExistingPageRef,
  type SlugResult,
} from "../../shared/src/slug.js";
// #232: the STABLE `current.html` serve key. Defined in `shared/src` — NOT here
// and NOT in the Worker — because both trees derive it and CLAUDE.md forbids
// either importing the other, so a per-tree copy would be undetectable drift.
import { currentArtifactKey } from "../../shared/src/artifact_keys.js";
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
   * Desired stable handle. When omitted, a slug is derived from `title`, then
   * the document's `<title>`, and failing both an opaque `page-<id>` handle
   * (see {@link resolveSlug}). A client-supplied slug is validated, not rewritten.
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
  /**
   * The account's full stored recipe palette — latest body per family, body-only
   * (no seal). Expansion merges this with the recipes carried on the publish so
   * an unedited standard recipe (seeded into the store) still expands even when
   * the request carries nothing. Carried recipes override per family.
   */
  loadPalette(accountId: string): Promise<{ family: string; body: string }[]>;
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

/**
 * The edge port — cache invalidation.
 *
 * #232: there is deliberately NO `putRoute` here anymore. The Worker's KV route
 * record is version-INDEPENDENT (worker/src/kv.ts `CachedRoute`), so a publish
 * has nothing to write into it: the record is populated lazily by the Worker's
 * read-through cold miss (`resolveRouteWithFallback`) and stays valid across
 * every republish. The previous `putRoute` was a documented no-op (`void route`)
 * that only made the publish path look like it maintained the cache — removed
 * rather than repurposed, because an eager KV write from Convex would take ≥60s
 * to propagate anyway (Cloudflare KV) and would buy nothing over the read-through.
 */
export interface EdgePort {
  /** Purge the edge cache for a freshly-(re)published URL. */
  invalidate(url: string): Promise<void>;
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

/**
 * What {@link buildAndStore} hands back: the version-row fields, plus the bytes
 * and metadata {@link publishStableArtifact} needs to write the stable copy
 * AFTER the version has been committed.
 */
interface BuiltArtifact {
  artifactKey: string;
  expandedHash: string;
  sourceHash: string;
  /** The assembled served document — identical bytes at both R2 keys. */
  document: string;
  /** R2 custom metadata, identical at both keys. */
  meta: {
    expandedHash: string;
    version: number;
    accountId: string;
    pageId: string;
  };
}

/**
 * Expand the page, assemble the served doc, and write the IMMUTABLE hashed
 * object to R2.
 *
 * It deliberately does NOT write the stable `current.html` — see
 * {@link publishStableArtifact} for why that has to happen after the commit.
 */
async function buildAndStore(
  pageId: string,
  actor: Actor,
  version: number,
  input: Pick<PublishInput, "html" | "recipes" | "css">,
  deps: PublishDeps,
): Promise<BuiltArtifact> {
  // Expand against the account's STORED palette merged with the recipes CARRIED
  // on this publish — carried wins per family (a local edit overrides the stored
  // body). This is what makes unedited standard recipes (seeded into the store)
  // expand on every pathway, even when the request carries nothing. Stored
  // bodies are seal-less; carried sources are sealed — both parse fine.
  const bySource = new Map<string, RecipeSource>();
  for (const s of await deps.data.loadPalette(actor.accountId)) {
    bySource.set(s.family, { filename: `${s.family}.css`, source: s.body });
  }
  for (const r of input.recipes) {
    bySource.set(r.family, { filename: `${r.family}.css`, source: r.source });
  }
  const recipeSources: RecipeSource[] = [...bySource.values()];

  const expanded = await expandPage({
    html: input.html,
    recipes: recipeSources,
    css: input.css,
  });

  const document = assembleArtifact(expanded.expandedHtml, expanded.css);
  const key = artifactKey(actor.accountId, pageId, expanded.expandedHash);
  const meta = {
    expandedHash: expanded.expandedHash,
    version,
    accountId: actor.accountId,
    pageId,
  };

  // The IMMUTABLE hashed object: history, rollback, dedup (PRD §5.6/§6.2).
  // Safe to write this early — it is content-addressed, so it is invisible until
  // some record points at it, and an abandoned one is inert (and re-used, not
  // rewritten, if the identical publish is retried).
  await deps.storage.writeArtifact(key, document, meta);

  const sourceHash = await sha256Hex(input.html);
  return {
    artifactKey: key,
    expandedHash: expanded.expandedHash,
    sourceHash,
    document,
    meta,
  };
}

/**
 * #232: publish the STABLE `artifacts/<accountId>/<pageId>/current.html` — the
 * same bytes as the hashed object, overwritten in place. This is what the serve
 * hot path streams, which is what makes a republish visible on the very next
 * request instead of after the 1h KV route TTL. A second COPY rather than a
 * pointer object: a pointer would cost two R2 reads per view.
 *
 * ORDERING — this MUST run after `patchPageCurrentVersion`. `current.html` is
 * public the instant it lands, so writing it before the version commit means any
 * failure between the two (a `pageVersions` insert that throws, a mutation that
 * is rolled back) leaves uncommitted content served to the world under a version
 * the database says was never published. Writing it last inverts the failure into
 * the safe direction: the page keeps serving its previous version, the new hashed
 * object sits unreferenced, and a retry is cheap because that object is already
 * durable. A failure here is therefore a PUBLISH failure and is allowed to
 * propagate (`writeArtifact` throws on a non-2xx).
 *
 * CONCURRENCY (known, deliberately unguarded — see
 * `shared/src/artifact_keys.ts`): two OVERLAPPING publishes of the same page race
 * on this key, and the loser's bytes can end up as the live copy while the DB
 * records the winner's version. Nothing self-corrects until the next publish. R2's
 * S3 API supports `If-Match`/`If-None-Match` on a PUT, but conditions cannot
 * target custom metadata, so ordering by version number would need a
 * read-modify-write CAS loop (an extra HEAD per publish, the ETag threaded
 * through `StoragePort`, and a retry on 412). Not built: no locking scheme until
 * a real user hits this.
 */
async function publishStableArtifact(
  pageId: string,
  accountId: string,
  built: BuiltArtifact,
  deps: PublishDeps,
): Promise<void> {
  await deps.storage.writeArtifact(
    currentArtifactKey(accountId, pageId),
    built.document,
    built.meta,
  );
}

/**
 * The result a previous call under this idempotency key produced, or `null` when
 * the call is new. Shared by publish and update: a retry must return the SAME
 * result rather than create a second page (publish) or version (update).
 */
async function replayIdempotent(
  acct: string,
  key: string | undefined,
  deps: PublishDeps,
): Promise<PublishOutcome | null> {
  if (!key) return null;
  const cached = await deps.data.getIdempotency(acct, key);
  return cached ? { ok: true, result: cached.result as unknown as PublishResult } : null;
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
  const replay = await replayIdempotent(acct, input.idempotencyKey, deps);
  if (replay) return replay;

  // 2. Resolve / validate the slug (a minted one comes back already free).
  const slug = await resolveSlug(input, acct, deps);

  // 3. Slug-collision → 409 with the existing id (PRD §3.2).
  const existing = await deps.data.findPageBySlug(acct, slug);
  const ref: ExistingPageRef | null = existing
    ? { id: existing.id, slug: existing.slug }
    : null;
  const collision = slugCollision(slug, ref);
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
    slug,
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

  // 9. ONLY NOW make the bytes public: the stable `current.html` the serve path
  //    streams (see publishStableArtifact — writing it before the commit above
  //    would publish content the DB never committed).
  await publishStableArtifact(pageId, acct, built, deps);

  // 10. Persist the lockfile snapshot for the next publish's diff.
  await deps.data.putStoredLockfile(pageId, input.lockfile);

  // 11. Edge: purge the cached URL. The page's canonical URL is the per-page
  //     subdomain (`https://<subdomain>.<root>`). NO KV route write (#232): the
  //     route record is version-independent, so the Worker's read-through cold
  //     miss populates it once and it survives every republish.
  const url = subdomainUrl(resolveRootDomain(deps.env), subdomain);
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
  const replay = await replayIdempotent(acct, input.idempotencyKey, deps);
  if (replay) return replay;

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
  // Only now make the new bytes public (see publishStableArtifact): if any of
  // the commit steps above throws, `current.html` still holds the PREVIOUS
  // version and the page keeps serving it.
  await publishStableArtifact(input.pageId, acct, built, deps);
  await deps.data.putStoredLockfile(input.pageId, input.lockfile);

  // SAME url — both the slug AND the subdomain are retained from the page record
  //   (PRD §3.2 identity; the subdomain is stable once minted). Legacy rows with
  //   no stored subdomain fall back to the slug as the label.
  const subdomain = page.subdomain ?? page.slug;
  const url = subdomainUrl(resolveRootDomain(deps.env), subdomain);
  // #232: no KV route write — the stable `current.html` this route resolves to
  // was just overwritten, so the cached record needs no update at all.
  // The edge purge (#207) collapses the public 60s cache TTL to immediate.
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

/**
 * Resolve the page's handle: an explicit `slug` is validated (never rewritten),
 * otherwise one is derived from the best human name available.
 *
 * The seed is NEVER the raw markup. Slugifying a document body produced handles
 * like `doctype-html-html-lang-en-data-appearance-dark-head-meta-charse`, which
 * is worse than no name at all for a URL a human is meant to receive. Order:
 * the caller's `title`, then the document's own `<title>`, then an opaque
 * minted handle. A seed that slugifies to nothing or lands on a reserved word
 * falls through to the minted handle too: a publish is not worth failing over a
 * name the caller never asked for.
 */
function slugSeed(input: PublishInput): string {
  return input.title ?? htmlTitle(input.html) ?? "";
}

/**
 * The handle the CALLER asked for: validated if explicit, derived from the seed
 * otherwise, or `null` when nothing usable was supplied (mint one instead).
 */
function namedSlug(input: PublishInput): SlugResult | null {
  if (input.slug !== undefined) return validateSlug(input.slug);
  // An empty/unusable/reserved seed makes `deriveSlug` fail, which lands on the mint.
  const derived = deriveSlug(slugSeed(input));
  return derived.ok ? derived : null;
}

/**
 * Length of a minted handle. Longer than the 6-char disambiguating suffix
 * {@link mintSubdomainId} was built for: here the id is the ENTIRE handle, and
 * for an `unlisted` page the URL is the only thing guarding it. 10 chars over a
 * 30-symbol alphabet is ~49 bits, drawn from WebCrypto.
 */
export const MINTED_HANDLE_LENGTH = 10;

/** A minted handle that no page in the account already holds. */
async function mintFreeSlug(acct: string, deps: PublishDeps): Promise<string> {
  // Bounded: at ~49 bits a single retry is already paranoid, but a caller must
  // never get a 409 naming a page they did not ask for.
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = `page-${mintSubdomainId(MINTED_HANDLE_LENGTH)}`;
    if (!(await deps.data.findPageBySlug(acct, candidate))) return candidate;
  }
  return `page-${mintSubdomainId(MINTED_HANDLE_LENGTH * 2)}`;
}

async function resolveSlug(
  input: PublishInput,
  acct: string,
  deps: PublishDeps,
): Promise<string> {
  const named = namedSlug(input);
  if (named === null) return await mintFreeSlug(acct, deps);
  // Only an EXPLICIT bad slug is an error; a bad derivation already fell through
  // to the mint above rather than failing the publish.
  if (!named.ok) throw new Error(`shortwind publish: ${named.error}`);
  return named.value;
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
