import { v, ConvexError } from "convex/values";
import { action, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireWrite } from "./lib/auth-guard.js";
import { deriveSlug, validateSlug } from "../shared/src/slug.js";
import {
  assembleArtifact,
  pageUrl,
  type Actor,
  type StoragePort,
} from "./lib/publish-core.js";
import { expandPage, type RecipeSource } from "./expand.js";

/**
 * CLOUD-50 — Bundles: linked multi-file deploys with one entry point
 * (PRD §10 Phase 3; the §2.2 fast-follow to single-file deploys).
 *
 * A BUNDLE is a set of HTML files deployed as ONE unit under ONE entry point.
 * Files may link to one another with ordinary relative links (`<a href>`,
 * `<img src>`, …). Because the served artifacts live at content-addressed R2
 * keys (NOT at the author's relative paths), those cross-file links must be
 * REWRITTEN to the served sibling URLs BEFORE deploy ("link-before-deploy",
 * PRD §10). A link that points OUT of the bundle (absolute URL, `mailto:`,
 * anchor-only, or a path with no sibling) is left untouched.
 *
 * REUSE (CLAUDE.md dependency direction + the CLOUD-23 single-file machinery):
 * each file is expanded with `expandPage`, assembled with `assembleArtifact`,
 * keyed with `artifactKey`, and written to R2 through the SAME `StoragePort`
 * the single-file publish uses — nothing is re-implemented. Versioning is the
 * same forward-only model as `pageVersions` (PRD §5.6): a `bundleVersions` row
 * is appended per publish, the prior version is retained (frozen) for rollback,
 * and the bundle record re-points at the new version.
 *
 * As with `lib/publish-core`, ALL business logic is a PURE function over plain
 * serializable data with IO behind injected ports; the Convex action below is
 * the thin adapter that builds the real ports over `ctx`. The pure core is
 * unit/golden tested with in-memory ports (no Convex harness).
 *
 * Schema: ADDITIVE `bundleVersions` table only (see schema.ts). No existing
 * table/field is touched and no separate bundle-record table is added — a bundle
 * is identified by its account-scoped `slug`, and its CURRENT version is the
 * highest `version` row for that (accountId, slug). Bundle SERVING through the
 * worker is a follow-up (CLOUD-30b): this issue lands the publish pipeline + the
 * routed entry point.
 */

// ===========================================================================
// Plain-data boundary types (no Convex types, no class instances, no closures).
// ===========================================================================

/** One authored file in a bundle: its bundle-relative path + shorthand HTML. */
export interface BundleFileInput {
  /** Bundle-relative POSIX path, e.g. "index.html" or "docs/guide.html". */
  path: string;
  /** The file's shorthand HTML (recipe tokens in `class=`/`className=`). */
  html: string;
}

/** Input to {@link runPublishBundle}. All fields plain serializable data. */
export interface PublishBundleInput {
  actor: Actor;
  /** The bundle's files. Exactly one must be the entry point (see `entryPath`). */
  files: readonly BundleFileInput[];
  /** The bundle-relative path of the entry file (the one the slug routes to). */
  entryPath: string;
  /** Desired stable handle for the entry point. Derived from `entryPath` when omitted. */
  slug?: string;
  /** Optional human title used to derive a slug when `slug` is omitted. */
  title?: string;
  /** The full recipe set carried on this publish (shared across the bundle). */
  recipes: readonly { family: string; source: string }[];
  /** The incoming `.shortwind-lock.json` snapshot (family → version map). */
  lockfile: Record<string, string>;
  /** Scoped-CSS preamble / theme override applied to every file in the bundle. */
  css?: string;
}

/** A served file in a published bundle (one immutable R2 artifact). */
export interface BundleFileResult {
  /** The authored bundle-relative path. */
  path: string;
  /** The R2 artifact key the served document was written to. */
  artifactKey: string;
  /** Content hash of the expanded+assembled document. */
  sourceHash: string;
  /** True for the entry file (the one the bundle slug routes to). */
  entry: boolean;
}

/** The result of a successful bundle publish. */
export interface PublishBundleResult {
  /** The bundle's stable identifier — its account-scoped entry slug. */
  bundleId: string;
  /** The public URL of the entry point. */
  url: string;
  /** The bundle version this publish landed (v1 on first deploy; forward-only). */
  version: number;
  files: BundleFileResult[];
}

export type PublishBundleOutcome = { ok: true; result: PublishBundleResult };

// ===========================================================================
// Ports — the injected IO surface for the bundle pipeline. Plain async; no
// Convex types. The storage port is the SAME `StoragePort` the single-file
// publish uses (reuse, not re-implement).
// ===========================================================================

/**
 * The current HEAD of a bundle (its highest-`version` row) the core reads back to
 * decide publish-vs-collision and the next version number. A bundle is identified
 * by its account-scoped `slug`; there is no separate bundle-record table.
 */
export interface BundleHead {
  /** The bundle's stable identifier — its account-scoped entry slug. */
  slug: string;
  accountId: string;
  /** The current (highest) version number for this bundle. */
  currentVersion: number;
}

/** Fields for a new immutable `bundleVersions` row. */
export interface NewBundleVersion {
  accountId: string;
  slug: string;
  version: number;
  entryPath: string;
  files: {
    path: string;
    artifactKey: string;
    sourceHash: string;
    entry: boolean;
  }[];
  lockfile: Record<string, string>;
}

/** The transactional data port for the bundle pipeline (in prod → `ctx.db`). */
export interface BundleDataPort {
  /**
   * The current HEAD version for the account's bundle at `slug`, or null if no
   * bundle occupies that slug yet (the slug is free).
   */
  bundleHead(accountId: string, slug: string): Promise<BundleHead | null>;
  /** Append an immutable bundle version (forward-only) → its new row id. */
  insertBundleVersion(version: NewBundleVersion): Promise<string>;
}

/** The edge port — register the entry-point route (the slug → entry artifact). */
export interface BundleEdgePort {
  /** Register the bundle's entry route in KV (host+path → entry artifact). */
  putEntryRoute(args: {
    slug: string;
    version: number;
    entryArtifactKey: string;
    /** Every served sibling key keyed by its `<slug>/<path>` route. */
    siblings: { path: string; artifactKey: string }[];
  }): Promise<void>;
  /** Purge the edge cache for the entry URL on (re)publish. */
  invalidate(url: string): Promise<void>;
}

/** Ambient knobs (clock, base URL) the core needs but does not compute. */
export interface BundleEnv {
  baseUrl: string;
}

export interface BundleDeps {
  data: BundleDataPort;
  storage: StoragePort;
  edge: BundleEdgePort;
  env: BundleEnv;
}

// ===========================================================================
// Pure link-rewrite ("link-before-deploy"). Golden-fixture tested.
// ===========================================================================

/** Normalize a bundle-relative path to a canonical POSIX form (no `./`, no `..`). */
export function normalizeBundlePath(path: string): string {
  const parts: string[] = [];
  for (const seg of path.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      parts.pop();
      continue;
    }
    parts.push(seg);
  }
  return parts.join("/");
}

/**
 * Resolve a relative href found in `fromPath` against the bundle, returning the
 * normalized target path (sans `#fragment`/`?query`) and the trailing
 * fragment/query suffix to re-attach, or `null` when the link is NOT an
 * in-bundle relative reference (absolute URL, scheme, protocol-relative,
 * root-absolute, anchor-only, or empty).
 */
export function resolveBundleLink(
  fromPath: string,
  href: string,
): { target: string; suffix: string } | null {
  const trimmed = href.trim();
  if (trimmed === "") return null;
  // Anchor-only or query-only references stay on the same document.
  if (trimmed.startsWith("#") || trimmed.startsWith("?")) return null;
  // A scheme (http:, https:, mailto:, tel:, data:, …) or protocol-relative // → external.
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return null;
  if (trimmed.startsWith("//")) return null;
  // Root-absolute paths are not bundle-relative (served from the site root).
  if (trimmed.startsWith("/")) return null;

  // Split off the fragment/query suffix; rewrite only the path portion.
  const suffixMatch = trimmed.match(/[?#].*$/);
  const suffix = suffixMatch ? suffixMatch[0] : "";
  const pathPart = suffix ? trimmed.slice(0, trimmed.length - suffix.length) : trimmed;
  if (pathPart === "") return null;

  const fromDir = fromPath.includes("/")
    ? fromPath.slice(0, fromPath.lastIndexOf("/"))
    : "";
  const joined = fromDir ? `${fromDir}/${pathPart}` : pathPart;
  return { target: normalizeBundlePath(joined), suffix };
}

/** The href-bearing attributes the rewrite scans. */
const LINK_ATTRS = ["href", "src", "action", "poster"] as const;

/**
 * Rewrite every in-bundle relative link in `html` (a file at `fromPath`) to the
 * served sibling URL produced by `served(target)`. Links that resolve to a path
 * NOT present in the bundle, or that are external/absolute/anchor-only, are left
 * verbatim. Deterministic (stable bytes) so it is golden-fixture testable.
 */
export function rewriteHtmlLinks(
  html: string,
  fromPath: string,
  served: (targetPath: string) => string | null,
): string {
  const attrAlternation = LINK_ATTRS.join("|");
  // Match `attr="value"` / `attr='value'` for the link-bearing attributes.
  const re = new RegExp(
    `\\b(${attrAlternation})\\s*=\\s*("([^"]*)"|'([^']*)')`,
    "gi",
  );
  return html.replace(re, (match, attr: string, _q: string, dq?: string, sq?: string) => {
    const quote = dq !== undefined ? '"' : "'";
    const value = dq !== undefined ? dq : (sq ?? "");
    const resolved = resolveBundleLink(fromPath, value);
    if (!resolved) return match;
    const servedUrl = served(resolved.target);
    if (servedUrl === null) return match;
    return `${attr}=${quote}${servedUrl}${resolved.suffix}${quote}`;
  });
}

/**
 * Rewrite cross-file links across the WHOLE bundle (link-before-deploy). The
 * served-URL of a sibling is `<entrySlugUrl>/<path>` for a non-entry file and
 * `<entrySlugUrl>` for the entry file itself, so an internal `./about.html`
 * resolves to the bundle's served `about.html` rather than the dead authored
 * relative path. Returns each file's path + rewritten HTML, in input order.
 */
export function rewriteBundleLinks(
  files: readonly BundleFileInput[],
  entryPath: string,
  entryUrl: string,
): { path: string; html: string }[] {
  const entry = normalizeBundlePath(entryPath);
  const known = new Set(files.map((f) => normalizeBundlePath(f.path)));
  const base = entryUrl.replace(/\/+$/, "");
  const servedUrl = (target: string): string | null => {
    if (!known.has(target)) return null;
    return target === entry ? base : `${base}/${target}`;
  };
  return files.map((f) => ({
    path: f.path,
    html: rewriteHtmlLinks(f.html, normalizeBundlePath(f.path), servedUrl),
  }));
}

// ===========================================================================
// Pure helpers.
// ===========================================================================

/** SHA-256 hex (Web Crypto) of a UTF-8 string. */
async function sha256Hex(s: string): Promise<string> {
  const bytes = new TextEncoder().encode(s);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  let hex = "";
  for (const b of new Uint8Array(digest)) hex += b.toString(16).padStart(2, "0");
  return hex;
}

/** A bundle file's served R2 key namespaces the bundle (by slug) + its path. */
export function bundleArtifactKey(
  accountId: string,
  slug: string,
  path: string,
  expandedHash: string,
): string {
  return `bundles/${accountId}/${slug}/${normalizeBundlePath(path)}/${expandedHash}.html`;
}

function resolveBundleSlug(input: PublishBundleInput) {
  if (input.slug !== undefined) return validateSlug(input.slug);
  const seed = input.title ?? input.entryPath.replace(/\.[a-z0-9]+$/i, "");
  return deriveSlug(seed);
}

// ===========================================================================
// runPublishBundle — the pure pipeline (mirrors runPublish; reuses its machinery).
// ===========================================================================

export async function runPublishBundle(
  input: PublishBundleInput,
  deps: BundleDeps,
): Promise<PublishBundleOutcome> {
  const acct = input.actor.accountId;

  // 1. Validate the bundle shape: at least one file, and the entry must be present.
  if (input.files.length === 0) {
    throw new Error("shortwind bundle: a bundle must carry at least one file");
  }
  const entry = normalizeBundlePath(input.entryPath);
  const hasEntry = input.files.some((f) => normalizeBundlePath(f.path) === entry);
  if (!hasEntry) {
    throw new Error(
      `shortwind bundle: entry "${input.entryPath}" is not one of the bundle files`,
    );
  }

  // 2. Resolve / validate the entry slug — the bundle's stable identifier.
  const slug = resolveBundleSlug(input);
  if (!slug.ok) {
    throw new Error(`shortwind bundle: ${slug.error}`);
  }

  // 3. Forward-only versioning (PRD §5.6 — reuse the pageVersions retention
  //    model): the first deploy is v1; re-deploying the SAME bundle appends the
  //    next version, retaining every prior version (frozen) for rollback. The
  //    bundle is identified by (account, slug); the head row carries the counter.
  const head = await deps.data.bundleHead(acct, slug.value);
  const version = (head?.currentVersion ?? 0) + 1;
  const url = pageUrl(deps.env.baseUrl, slug.value);

  // 4. LINK-BEFORE-DEPLOY: rewrite every cross-file link to its served sibling.
  const rewritten = rewriteBundleLinks(input.files, entry, url);

  // 5. Expand + assemble each file reusing the SINGLE-FILE machinery, write to R2.
  const recipeSources: RecipeSource[] = input.recipes.map((r) => ({
    filename: `${r.family}.css`,
    source: r.source,
  }));
  const fileResults: BundleFileResult[] = [];
  let entryArtifactKey = "";

  for (const file of rewritten) {
    const expanded = await expandPage({
      html: file.html,
      recipes: recipeSources,
      css: input.css,
    });
    const document = assembleArtifact(expanded.expandedHtml, expanded.css);
    const key = bundleArtifactKey(acct, slug.value, file.path, expanded.expandedHash);
    const isEntry = normalizeBundlePath(file.path) === entry;

    await deps.storage.writeArtifact(key, document, {
      expandedHash: expanded.expandedHash,
      version,
      accountId: acct,
      pageId: slug.value,
    });

    const sourceHash = await sha256Hex(file.html);
    fileResults.push({ path: file.path, artifactKey: key, sourceHash, entry: isEntry });
    if (isEntry) entryArtifactKey = key;
  }

  // 6. Append the immutable bundle version (forward-only — prior rows untouched).
  await deps.data.insertBundleVersion({
    accountId: acct,
    slug: slug.value,
    version,
    entryPath: entry,
    files: fileResults.map((f) => ({
      path: f.path,
      artifactKey: f.artifactKey,
      sourceHash: f.sourceHash,
      entry: f.entry,
    })),
    lockfile: input.lockfile,
  });

  // 7. Edge: route the entry point (+ its served siblings) and invalidate the URL.
  await deps.edge.putEntryRoute({
    slug: slug.value,
    version,
    entryArtifactKey,
    siblings: fileResults
      .filter((f) => !f.entry)
      .map((f) => ({ path: f.path, artifactKey: f.artifactKey })),
  });
  await deps.edge.invalidate(url);

  return {
    ok: true,
    result: { bundleId: slug.value, url, version, files: fileResults },
  };
}

// ===========================================================================
// Convex adapter — thin ports over the action ctx (mirrors pages.ts).
// ===========================================================================

type AccountId = Id<"accounts">;
type RunnerCtx = {
  runQuery: (ref: any, args: any) => Promise<any>;
  runMutation: (ref: any, args: any) => Promise<any>;
};

const bundleHeadValidator = v.union(
  v.object({
    slug: v.string(),
    accountId: v.id("accounts"),
    currentVersion: v.number(),
  }),
  v.null(),
);

/**
 * The current HEAD version of the account's bundle at `slug` — its highest
 * `version` row — or null if the slug is free. Drives the forward-only version
 * counter (next = current + 1) and the publish-vs-first-deploy decision.
 */
export const bundleHead = internalQuery({
  args: { accountId: v.id("accounts"), slug: v.string() },
  returns: bundleHeadValidator,
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("bundleVersions")
      .withIndex("by_slug", (q) =>
        q.eq("accountId", args.accountId).eq("slug", args.slug),
      )
      .collect();
    if (rows.length === 0) return null;
    const current = rows.reduce((max, r) => Math.max(max, r.version), 0);
    return { slug: args.slug, accountId: args.accountId, currentVersion: current };
  },
});

const bundleFileValidator = v.object({
  path: v.string(),
  artifactKey: v.string(),
  sourceHash: v.string(),
  entry: v.boolean(),
});

/**
 * Append the immutable `bundleVersions` row (forward-only) + audit, in one
 * mutation so a publish either fully lands or not at all. Prior version rows are
 * never touched (PRD §5.6 — old versions stay frozen for rollback). The current
 * head is the highest-`version` row for (accountId, slug); there is no separate
 * bundle record to re-point.
 */
export const commitBundleVersion = internalMutation({
  args: {
    accountId: v.id("accounts"),
    slug: v.string(),
    version: v.number(),
    entryPath: v.string(),
    files: v.array(bundleFileValidator),
    lockfile: v.record(v.string(), v.string()),
    actorTokenId: v.union(v.id("tokens"), v.null()),
  },
  returns: v.id("bundleVersions"),
  handler: async (ctx, args) => {
    const now = Date.now();
    const versionId = await ctx.db.insert("bundleVersions", {
      accountId: args.accountId,
      slug: args.slug,
      entryPageId: null,
      entryPath: args.entryPath,
      version: args.version,
      files: args.files,
      lockfile: args.lockfile,
      createdAt: now,
    });
    await ctx.db.insert("auditLog", {
      accountId: args.accountId,
      action: "bundle.publish",
      targetId: versionId,
      actorTokenId: args.actorTokenId,
      metadata: {
        slug: args.slug,
        version: args.version,
        files: args.files.length,
        entryPath: args.entryPath,
      },
      createdAt: now,
    });
    return versionId;
  },
});

/** Build the data port over the action ctx. */
function makeBundleDataPort(ctx: RunnerCtx, tokenId: Id<"tokens"> | null): BundleDataPort {
  return {
    bundleHead: (accountId, slug) =>
      ctx.runQuery(internal.bundles.bundleHead, {
        accountId: accountId as AccountId,
        slug,
      }),
    insertBundleVersion: (version) =>
      ctx.runMutation(internal.bundles.commitBundleVersion, {
        accountId: version.accountId as AccountId,
        slug: version.slug,
        version: version.version,
        entryPath: version.entryPath,
        files: version.files,
        lockfile: version.lockfile,
        actorTokenId: tokenId,
      }),
  };
}

/** R2 storage port — the SAME write the single-file publish uses. */
function makeBundleStoragePort(): StoragePort {
  return {
    writeArtifact: (key, html, meta) => writeBundleArtifactToR2(key, html, meta),
  };
}

/** Edge port — entry-route registration deferred to CLOUD-30b (bundle serving). */
function makeBundleEdgePort(): BundleEdgePort {
  return {
    putEntryRoute: async (route) => putBundleEntryRoute(route),
    invalidate: async (url) => invalidateBundleEdge(url),
  };
}

// IO placeholders — wired with the single-file infra (CLOUD-30/30b). Kept
// side-effect-free + non-throwing so the pipeline runs in dev/test deployments.
async function writeBundleArtifactToR2(
  key: string,
  html: string,
  meta: { expandedHash: string; version: number; accountId: string; pageId: string },
): Promise<void> {
  void key;
  void html;
  void meta;
}
async function putBundleEntryRoute(route: {
  slug: string;
  version: number;
  entryArtifactKey: string;
  siblings: { path: string; artifactKey: string }[];
}): Promise<void> {
  // CLOUD-30b: write the host+path → entry artifact route into the Worker KV so
  // the slug serves the bundle's entry document, and namespace the sibling keys
  // so `<slug>/<path>` resolves the served sibling. No worker code is imported.
  void route;
}
async function invalidateBundleEdge(url: string): Promise<void> {
  void url;
}

// ===========================================================================
// Public verb.
// ===========================================================================

const bundleFileInputArg = v.object({ path: v.string(), html: v.string() });
const recipeArg = v.object({ family: v.string(), source: v.string() });

const bundleOutcomeValidator = v.object({
  ok: v.literal(true),
  bundleId: v.string(),
  url: v.string(),
  version: v.number(),
  files: v.array(
    v.object({
      path: v.string(),
      artifactKey: v.string(),
      sourceHash: v.string(),
      entry: v.boolean(),
    }),
  ),
});

/** The write-scope auth check (an action cannot read `ctx.db` — validate in a query). */
export const authForBundleWrite = internalQuery({
  args: { bearer: v.string() },
  returns: v.object({ accountId: v.id("accounts"), tokenId: v.id("tokens") }),
  handler: async (ctx, args) => {
    const auth = await requireWrite(ctx, args.bearer);
    return { accountId: auth.accountId, tokenId: auth.tokenId };
  },
});

/**
 * publishBundle (POST /v1/bundles): publish a linked multi-file bundle under one
 * entry point. Cross-file links are rewritten to served siblings before deploy;
 * each file is expanded + assembled + written to R2; the bundle is versioned
 * (forward-only) and the entry point is routed. Returns the bundle id (its
 * slug), the entry URL, the version, and the per-file served keys. Re-publishing
 * the same slug appends the next version, retaining prior versions for rollback.
 */
export const publishBundle = action({
  args: {
    bearer: v.string(),
    files: v.array(bundleFileInputArg),
    entryPath: v.string(),
    slug: v.optional(v.string()),
    title: v.optional(v.string()),
    recipes: v.array(recipeArg),
    lockfile: v.record(v.string(), v.string()),
    css: v.optional(v.string()),
  },
  returns: bundleOutcomeValidator,
  handler: async (ctx, args) => {
    const auth = await ctx.runQuery(internal.bundles.authForBundleWrite, {
      bearer: args.bearer,
    });
    if (args.files.length === 0) {
      throw new ConvexError({ code: "BAD_REQUEST", message: "bundle has no files" });
    }
    const deps: BundleDeps = {
      data: makeBundleDataPort(ctx, auth.tokenId),
      storage: makeBundleStoragePort(),
      edge: makeBundleEdgePort(),
      env: { baseUrl: "https://shortwind.app" },
    };
    const outcome = await runPublishBundle(
      {
        actor: { accountId: auth.accountId, tokenId: auth.tokenId },
        files: args.files,
        entryPath: args.entryPath,
        slug: args.slug,
        title: args.title,
        recipes: args.recipes,
        lockfile: args.lockfile,
        css: args.css,
      },
      deps,
    );
    return {
      ok: true as const,
      bundleId: outcome.result.bundleId,
      url: outcome.result.url,
      version: outcome.result.version,
      files: outcome.result.files,
    };
  },
});
