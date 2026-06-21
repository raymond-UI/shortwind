import { v, ConvexError } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { requireRead, requireWrite } from "./lib/auth_guard.js";
import { applyLifecycle } from "./moderation.js";
import {
  classifyContent,
  hashMatch,
  type ClassifyConfig,
  type ClassifyResult,
  type HashMatchResult,
  type KnownHashList,
} from "./lib/content_scan.js";
import {
  checkPublishLimit,
  type PublishLimitResult,
  type RateLimitRunCtx,
} from "./lib/rate_limit.js";
import {
  runPublish,
  runUpdate,
  type EdgePort,
  type PublishDataPort,
  type PublishDeps,
  type PublishOutcome,
  type StoragePort,
} from "./lib/publish_core.js";
import type { Lockfile } from "../shared/src/lockfile-diff.js";
import { scheduleRouteEviction, type SchedulerCtx } from "./lib/edge_kv.js";

/**
 * Page publish + update — the thick path (CLOUD-23, PRD §6.2).
 *
 * ALL business logic lives in the pure `lib/publish_core` (`runPublish` /
 * `runUpdate`); this module is the thin Convex adapter that builds the real
 * IO ports over the action `ctx` and exposes the two public verbs.
 *
 * The action↔mutation / codegen boundary (CLAUDE.md):
 *   - A Convex ACTION can do the R2 network write but has no `ctx.db`.
 *   - A Convex MUTATION has `ctx.db` but cannot do network IO.
 * So `publish`/`update` are ACTIONS. Their data port delegates each DB read to
 * an `internalQuery` and each DB write to an `internalMutation` via
 * `ctx.runQuery` / `ctx.runMutation`; the page-shell create, the immutable
 * pageVersion + page re-point, the lockfile snapshot, and the publish audit are
 * batched into the transactional `commitPublish` / `commitVersion`
 * internalMutations so each commits atomically. The storage port does the R2
 * `fetch` (S3 API) directly in the action. The recipe-edit writes go through
 * `internal.recipes.commitRecipeEdit`.
 *
 * Offline-codegen note: `internal.pages.*` / `internal.recipes.*` refs require
 * fresh `_generated`. The committed codegen is stale here (no `CONVEX_DEPLOYMENT`
 * offline), so `_generated/api.d.ts` is hand-extended to declare the `pages` and
 * `recipes` modules. `_generated/api.js` already resolves them at runtime via
 * `anyApi`. A real `convex dev` (CLOUD-30) regenerates both.
 *
 * CLOUD-30 must wire: the R2 S3 credentials/endpoint (`R2_*` env) consumed by
 * `writeArtifactToR2`, and the real edge invalidation + KV route put consumed by
 * the edge port. Both are left as documented placeholders below.
 *
 * pages.ts is the home for the page verbs; CLOUD-24 (find/get) extends it with
 * read queries. The internal read queries below are exported as clean reuse
 * points.
 */

type AccountId = Id<"accounts">;
type TokenId = Id<"tokens">;

// ---------------------------------------------------------------------------
// Internal read queries (data-port reads). Exported as CLOUD-24 reuse points.
// ---------------------------------------------------------------------------

const pageRecordValidator = v.union(
  v.object({
    id: v.id("pages"),
    accountId: v.id("accounts"),
    slug: v.string(),
    // CLOUD-SUBDOMAIN: the page's stable subdomain label (absent on legacy rows).
    subdomain: v.optional(v.string()),
    currentVersion: v.number(),
  }),
  v.null(),
);

/** Resolve an account's page at a slug (the publish collision lookup). */
export const findPageBySlug = internalQuery({
  args: { accountId: v.id("accounts"), slug: v.string() },
  returns: pageRecordValidator,
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("pages")
      .withIndex("by_slug", (q) =>
        q.eq("accountId", args.accountId).eq("slug", args.slug),
      )
      .unique();
    return row ? toPageRecord(row) : null;
  },
});

/**
 * CLOUD-SUBDOMAIN: is `label` already taken as a subdomain by ANY page across ALL
 * accounts? Backs the global-uniqueness check at publish (the bare slug vs the
 * disambiguated `slug-<id>` decision). Index-backed via `by_subdomain` — a single
 * `unique()` probe, not a scan.
 */
export const subdomainTaken = internalQuery({
  args: { label: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("pages")
      .withIndex("by_subdomain", (q) => q.eq("subdomain", args.label))
      .first();
    return row !== null;
  },
});

/** Load a page by id (the update path). */
export const getPageById = internalQuery({
  args: { pageId: v.id("pages") },
  returns: pageRecordValidator,
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.pageId);
    return row ? toPageRecord(row) : null;
  },
});

/** The stored lockfile snapshot for a page (null before the first publish). */
export const getStoredLockfile = internalQuery({
  args: { pageId: v.id("pages") },
  returns: v.union(v.any(), v.null()),
  handler: async (ctx, args) => {
    // The authoritative stored snapshot is the current version's `lockfile`
    // field, reconstituted into the shared `Lockfile` shape. The `{family:
    // version}` map is the version axis; the body shas live on `recipeVersions`,
    // but the publish diff only needs version+sha identity for the families it
    // carries, so we surface the version map and let the diff treat absent shas
    // as "version-only" identity. CLOUD-30 may denormalize a richer snapshot.
    const page = await ctx.db.get(args.pageId);
    if (!page || page.currentVersionId === null) return null;
    const version = await ctx.db.get(page.currentVersionId);
    if (!version) return null;
    const families: Record<string, { version: string; sha: string }> = {};
    for (const [family, ver] of Object.entries(version.lockfile)) {
      families[family] = { version: ver, sha: "" };
    }
    return { version: 1, registry: "default", families } satisfies Lockfile;
  },
});

/** An idempotency lookup → the cached result, or null. */
export const getIdempotency = internalQuery({
  args: { accountId: v.id("accounts"), key: v.string() },
  returns: v.union(
    v.object({ resultId: v.string(), result: v.any() }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("idempotencyKeys")
      .withIndex("by_key", (q) =>
        q.eq("accountId", args.accountId).eq("key", args.key),
      )
      .unique();
    return row ? { resultId: row.resultId, result: row.result } : null;
  },
});

// ---------------------------------------------------------------------------
// Internal write mutations (data-port writes). Each commits atomically.
// ---------------------------------------------------------------------------

/** Insert a new page shell (no current version yet) → its id. */
export const commitNewPage = internalMutation({
  args: {
    accountId: v.id("accounts"),
    slug: v.string(),
    // CLOUD-SUBDOMAIN: the globally-unique subdomain label minted by the core.
    subdomain: v.string(),
    visibility: v.union(
      v.literal("public"),
      v.literal("unlisted"),
      v.literal("private"),
    ),
    tags: v.array(v.string()),
  },
  returns: v.id("pages"),
  handler: async (ctx, args) => {
    const now = Date.now();
    return ctx.db.insert("pages", {
      accountId: args.accountId,
      slug: args.slug,
      subdomain: args.subdomain,
      customDomain: null,
      visibility: args.visibility,
      lifecycle: "active",
      tags: args.tags,
      currentVersionId: null,
      currentVersion: 0,
      // CLOUD-51 (additive): new pages default to no expiry / no group. The
      // publish action patches them via `commitPageGrouping` when the additive
      // `expiresAt`/`projectGroup` args are supplied (keeps the core pipeline
      // unchanged — it never sees these fields).
      expiresAt: null,
      projectGroup: null,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * CLOUD-51 (ADDITIVE): set a page's optional expiry + project group. Called by
 * the publish/update actions AFTER the core pipeline lands, ONLY when the new
 * args are supplied — so the core publish/update logic is untouched and the
 * existing behavior is identical when they are absent. `undefined` leaves a
 * field as-is; an explicit value (including `null`) is written.
 */
export const commitPageGrouping = internalMutation({
  args: {
    pageId: v.id("pages"),
    accountId: v.id("accounts"),
    expiresAt: v.optional(v.union(v.number(), v.null())),
    projectGroup: v.optional(v.union(v.string(), v.null())),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const page = await ctx.db.get(args.pageId);
    // The page was just materialized by the same action — absence is a bug.
    if (!page || page.accountId !== args.accountId) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Page not found" });
    }
    const patch: Record<string, unknown> = {};
    if (args.expiresAt !== undefined) patch.expiresAt = args.expiresAt;
    if (args.projectGroup !== undefined) patch.projectGroup = args.projectGroup;
    if (Object.keys(patch).length > 0) {
      patch.updatedAt = Date.now();
      await ctx.db.patch(args.pageId, patch);
    }
    return null;
  },
});

/**
 * The transactional version commit: insert the immutable `pageVersions` row,
 * re-point the page at it, persist the lockfile snapshot (carried on the version
 * row itself), and write the `page.publish` / `page.update` audit entry — all in
 * one mutation so a publish either fully lands or not at all. The prior version
 * row is never touched (PRD §5.6: old versions stay frozen).
 */
export const commitVersion = internalMutation({
  args: {
    pageId: v.id("pages"),
    accountId: v.id("accounts"),
    version: v.number(),
    artifactKey: v.string(),
    expandedHash: v.string(),
    sourceHash: v.string(),
    lockfile: v.record(v.string(), v.string()),
    auditAction: v.string(),
    actorTokenId: v.union(v.id("tokens"), v.null()),
    auditMetadata: v.any(),
  },
  returns: v.id("pageVersions"),
  handler: async (ctx, args) => {
    const now = Date.now();
    const versionId = await ctx.db.insert("pageVersions", {
      pageId: args.pageId,
      accountId: args.accountId,
      version: args.version,
      artifactKey: args.artifactKey,
      expandedHash: args.expandedHash,
      sourceHash: args.sourceHash,
      lockfile: args.lockfile,
      createdAt: now,
    });
    await ctx.db.patch(args.pageId, {
      currentVersionId: versionId,
      currentVersion: args.version,
      updatedAt: now,
    });
    await ctx.db.insert("auditLog", {
      accountId: args.accountId,
      action: args.auditAction,
      targetId: args.pageId,
      actorTokenId: args.actorTokenId,
      metadata: args.auditMetadata,
      createdAt: now,
    });
    return versionId;
  },
});

/** Record an idempotency result for future retries. */
export const commitIdempotency = internalMutation({
  args: {
    accountId: v.id("accounts"),
    key: v.string(),
    resultId: v.string(),
    result: v.any(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("idempotencyKeys", {
      accountId: args.accountId,
      key: args.key,
      resultId: args.resultId,
      result: args.result,
      createdAt: Date.now(),
    });
    return null;
  },
});

// ---------------------------------------------------------------------------
// Port construction over the action ctx.
// ---------------------------------------------------------------------------

/** The slice of action ctx the ports use: `runQuery` + `runMutation`. */
type RunnerCtx = {
  runQuery: (ref: any, args: any) => Promise<any>;
  runMutation: (ref: any, args: any) => Promise<any>;
};

/**
 * Build the data port over the action ctx. Reads delegate to internalQueries;
 * writes delegate to internalMutations.
 *
 * Two pure-core write sequences are coalesced into single transactional Convex
 * mutations so the publish lands atomically rather than as a string of separate
 * commits:
 *
 *  - The version commit: the core calls `insertAudit` ("page.publish"/"update")
 *    then `insertPageVersion`. We capture the audit row and fold it into one
 *    `commitVersion` mutation that inserts the immutable `pageVersions` row,
 *    re-points the page, and writes the audit — together.
 *  - Each recipe edit: the core calls `insertRecipeVersion` then
 *    `insertRecipeEditEvent` (then a "recipe.edit" `insertAudit`). We capture
 *    the version body and flush on the edit-event write via `commitRecipeEdit`,
 *    which inserts the `recipeVersions` row + `recipeEditEvents` row +
 *    `recipe.edit` audit row in one mutation. The "recipe.edit" `insertAudit`
 *    call is then a no-op (already committed).
 *
 * `patchPageCurrentVersion` / `putStoredLockfile` are no-ops: the re-point and
 * the lockfile snapshot both live ON the `pageVersions` row written by
 * `commitVersion`, so there is no second write to issue. They exist to satisfy
 * the pure interface and document the contract.
 */
function makeDataPort(ctx: RunnerCtx, tokenId: TokenId): PublishDataPort {
  // Captured between the paired core calls (see the doc comment above).
  let pendingAudit: { action: string; metadata: Record<string, unknown> } = {
    action: "page.publish",
    metadata: {},
  };
  let pendingRecipe: { family: string; body: string; bodySha: string } | null = null;

  return {
    findPageBySlug: (accountId, slug) =>
      ctx.runQuery(internal.pages.findPageBySlug, {
        accountId: accountId as AccountId,
        slug,
      }),
    getPage: (pageId) =>
      ctx.runQuery(internal.pages.getPageById, { pageId: pageId as Id<"pages"> }),
    // CLOUD-SUBDOMAIN: global subdomain-uniqueness probe (by_subdomain index).
    subdomainTaken: (label) =>
      ctx.runQuery(internal.pages.subdomainTaken, { label }),
    insertPage: (page) =>
      ctx.runMutation(internal.pages.commitNewPage, {
        accountId: page.accountId as AccountId,
        slug: page.slug,
        subdomain: page.subdomain,
        visibility: page.visibility,
        tags: page.tags,
      }),
    // The re-point is committed inside `commitVersion`.
    patchPageCurrentVersion: async () => {},
    // The version write carries the captured audit row, committed atomically.
    insertPageVersion: (version) =>
      ctx.runMutation(internal.pages.commitVersion, {
        pageId: version.pageId as Id<"pages">,
        accountId: version.accountId as AccountId,
        version: version.version,
        artifactKey: version.artifactKey,
        expandedHash: version.expandedHash,
        sourceHash: version.sourceHash,
        lockfile: version.lockfile,
        auditAction: pendingAudit.action,
        actorTokenId: tokenId,
        auditMetadata: pendingAudit.metadata,
      }),

    latestRecipeVersion: (accountId, family) =>
      ctx.runQuery(internal.recipes.latestRecipeVersion, {
        accountId: accountId as AccountId,
        family,
      }),
    // Capture the body; the matching edit-event write flushes the transaction.
    insertRecipeVersion: async (write) => {
      pendingRecipe = {
        family: write.family,
        body: write.body,
        bodySha: write.bodySha,
      };
      return "";
    },
    insertRecipeEditEvent: async (write) => {
      const body =
        pendingRecipe?.family === write.family ? pendingRecipe.body : "";
      pendingRecipe = null;
      await ctx.runMutation(internal.recipes.commitRecipeEdit, {
        accountId: write.accountId as AccountId,
        family: write.family,
        fromVersion: write.fromVersion,
        toVersion: write.toVersion,
        body,
        bodySha: write.bodySha,
        actorTokenId: tokenId,
      });
      return "";
    },
    insertAudit: async (write) => {
      // recipe.edit audit is already committed inside commitRecipeEdit.
      if (write.action === "recipe.edit") return "";
      // Capture the page.publish/page.update audit for the next commitVersion.
      pendingAudit = { action: write.action, metadata: write.metadata };
      return "";
    },

    getStoredLockfile: (pageId) =>
      ctx.runQuery(internal.pages.getStoredLockfile, {
        pageId: pageId as Id<"pages">,
      }),
    // The snapshot lives on the pageVersions row written by commitVersion.
    putStoredLockfile: async () => {},

    getIdempotency: (accountId, key) =>
      ctx.runQuery(internal.pages.getIdempotency, {
        accountId: accountId as AccountId,
        key,
      }),
    putIdempotency: async (accountId, key, resultId, result) => {
      await ctx.runMutation(internal.pages.commitIdempotency, {
        accountId: accountId as AccountId,
        key,
        resultId,
        result,
      });
    },
  };
}

/**
 * Build the R2 storage port. The write is the action's one true network call.
 * The S3 endpoint + credentials are env placeholders deferred to CLOUD-30.
 */
function makeStoragePort(): StoragePort {
  return {
    writeArtifact: (key, html, meta) => writeArtifactToR2(key, html, meta),
  };
}

/** Build the edge port. Real invalidation / KV route put deferred to CLOUD-30. */
function makeEdgePort(): EdgePort {
  return {
    invalidate: async (url) => invalidateEdge(url),
    putRoute: async (route) => putEdgeRoute(route),
  };
}

// ---------------------------------------------------------------------------
// IO placeholders — wired by CLOUD-30. Kept side-effect-free + non-throwing so
// the publish path is exercisable end-to-end before the infra lands.
// ---------------------------------------------------------------------------

/**
 * CLOUD-30b: minimal `process.env` accessor. This workspace types against
 * `@cloudflare/workers-types` (no Node `process`), so we declare the slice we
 * read — the R2 S3 credentials the publish action signs requests with. These are
 * set on the Convex deployment via `npx convex env set` (see the doc comment on
 * {@link writeArtifactToR2}); absent in dev/test ⇒ the write is skipped.
 */
declare const process: { env: Record<string, string | undefined> };

/**
 * PUT a frozen artifact to R2 via its S3-compatible API, SigV4-signed with
 * `aws4fetch` (no `@aws-sdk` — lightweight, one fetch). The object is written
 * with `Content-Type: text/html; charset=utf-8` and the same custom metadata the
 * Worker's `r2.ts` reads back (`x-amz-meta-{expandedhash,version,accountid,pageid}`).
 *
 * Env (set on the Convex deployment with `npx convex env set <NAME> <value>`):
 *   - `R2_S3_ENDPOINT`       — `https://<accountid>.r2.cloudflarestorage.com`
 *   - `R2_ACCESS_KEY_ID`     — R2 S3 access key id
 *   - `R2_SECRET_ACCESS_KEY` — R2 S3 secret access key
 *   - `R2_BUCKET_NAME`       — bucket name (defaults to `shortwind-artifacts`)
 *
 * These R2 S3 keys are PENDING from the user at the time of this wave; until they
 * are set on the Convex deployment this function SKIPS the write (so the pipeline
 * still runs end-to-end in dev/test without R2 creds, exactly as the prior no-op
 * did). It does NOT fake a success — when creds ARE present it performs the real
 * signed PUT and throws on a non-2xx so a failed write surfaces (publish fails
 * loudly rather than silently dropping the artifact).
 */
async function writeArtifactToR2(
  key: string,
  html: string,
  meta: { expandedHash: string; version: number; accountId: string; pageId: string },
): Promise<void> {
  const endpoint = process.env.R2_S3_ENDPOINT;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET_NAME ?? "shortwind-artifacts";

  // Creds not yet provisioned (PENDING): skip the write so the publish pipeline
  // still runs in dev/test. Wired live once `npx convex env set R2_*` is run.
  if (!endpoint || !accessKeyId || !secretAccessKey) {
    return;
  }

  // Lazy import so the dependency is only pulled when a real write happens.
  const { AwsClient } = await import("aws4fetch");
  const client = new AwsClient({
    accessKeyId,
    secretAccessKey,
    service: "s3",
    region: "auto", // R2 uses the fixed "auto" region for SigV4.
  });

  const objectUrl = `${endpoint.replace(/\/+$/, "")}/${bucket}/${key}`;
  const res = await client.fetch(objectUrl, {
    method: "PUT",
    body: html,
    headers: {
      "content-type": "text/html; charset=utf-8",
      // Mirror worker/src/r2.ts ArtifactMeta. S3 custom metadata rides as
      // `x-amz-meta-*`; R2 surfaces these as the object's customMetadata.
      "x-amz-meta-expandedhash": meta.expandedHash,
      "x-amz-meta-version": String(meta.version),
      "x-amz-meta-accountid": meta.accountId,
      "x-amz-meta-pageid": meta.pageId,
    },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `R2 artifact PUT failed (${res.status}) for ${key}: ${detail.slice(0, 200)}`,
    );
  }
}

async function invalidateEdge(url: string): Promise<void> {
  // CLOUD-30: purge the Cloudflare edge cache for `url` (cache API / purge call).
  void url;
}

async function putEdgeRoute(route: {
  pageId: string;
  slug: string;
  subdomain: string;
  version: number;
  artifactKey: string;
}): Promise<void> {
  // CLOUD-30: write the hostname+path → page-version route into the Worker KV
  // namespace consumed by worker/src/kv.ts so the hot path resolves the artifact.
  // Two route keys map to this page: the legacy path-based one
  // (`route:{serveHost}/{slug}`) and the per-page subdomain one
  // (`route:{subdomain}.{root}/`). The hot path lazily populates KV on a cold
  // miss either way, so an eager put here is an optimization, not required —
  // left as a documented placeholder (the read-through fallback resolves both).
  void route;
}

async function deleteEdgeRoute(
  route: { pageId: string; slug: string; subdomain?: string | null },
  ctx?: SchedulerCtx,
): Promise<void> {
  // CLOUD-30b: evict the hostname+path → page-version route from the Worker KV
  // namespace (the edge side is worker/src/kv.ts `deleteRoute`) so a tombstoned/
  // quarantined/expired page stops resolving on the hot path "in seconds" rather
  // than after the 1h route TTL.
  //
  // The KV delete is an HTTP `fetch`, which Convex forbids inside a MUTATION (and
  // deletePage/sweepExpired/commitScanBlock are all mutations). So we SCHEDULE the
  // eviction to run in an action the instant the mutation commits, via the
  // mutation's `ctx.scheduler`. Fail-safe: the scheduled action swallows + logs any
  // Cloudflare error so the DB tombstone (the source of truth) is never broken.
  // No worker code is imported into Convex (CLAUDE.md dependency direction);
  // `lib/edge_kv` re-derives the route key to match worker/src/kv.ts.
  if (ctx === undefined) return; // No scheduler (shouldn't happen in prod) → skip.
  // CLOUD-SUBDOMAIN: thread the subdomain so the per-page subdomain KV key is
  // evicted alongside the legacy path-based one (the page serves under both).
  await scheduleRouteEviction(ctx, route.slug, route.subdomain ?? null);
}

// ---------------------------------------------------------------------------
// Lifecycle edge port (CLOUD-31). The delete/visibility MUTATIONS invalidate the
// edge cache + evict the KV route through this injectable seam so the change is
// reflected on the hot path. Exposed as `__setLifecycleEdgePort` ONLY so the
// integration tests can assert `invalidate`/`evictRoute` fired (the production
// port is the no-op placeholders above, wired for real at deploy — CLOUD-30).
// ---------------------------------------------------------------------------

/** The edge effects a lifecycle/visibility change drives. */
export interface LifecycleEdgePort {
  /** Purge the edge cache for the page URL (visibility + delete both affect it). */
  invalidate(url: string): Promise<void>;
  /**
   * Evict the KV route so a deleted/pulled page stops resolving on the edge. The
   * optional `ctx` carries the calling mutation's scheduler — the production port
   * schedules the KV `fetch` to run in an action (a mutation cannot fetch). The
   * test ports ignore it (a 1-arg `evictRoute(route)` is assignable here).
   */
  evictRoute(
    args: { pageId: string; slug: string; subdomain?: string | null },
    ctx?: SchedulerCtx,
  ): Promise<void>;
}

const defaultLifecycleEdgePort: LifecycleEdgePort = {
  invalidate: (url) => invalidateEdge(url),
  evictRoute: (route, ctx) => deleteEdgeRoute(route, ctx),
};

let lifecycleEdgePort: LifecycleEdgePort = defaultLifecycleEdgePort;

/** Test-only: override the lifecycle edge port to assert it was driven. */
export function __setLifecycleEdgePort(port: LifecycleEdgePort): void {
  lifecycleEdgePort = port;
}

/** Test-only: restore the production (no-op placeholder) lifecycle edge port. */
export function __resetLifecycleEdgePort(): void {
  lifecycleEdgePort = defaultLifecycleEdgePort;
}

// ===========================================================================
// CLOUD-33 — publish-time content scan + per-account rate limit (PRD §8.2/§8.4).
//
// A SINGLE guarded hook (`runPublishScan`) sits at the START of the publish
// action, after auth and BEFORE `runPublish`. It is deliberately self-contained
// and additive — it does NOT touch the core publish/update/find/get pipeline:
//
//   1. rate limit  — per-account publish token bucket (lib/rate_limit). A trip
//                    throws `RATE_LIMITED` carrying `retryAfter` (the action
//                    never reaches `runPublish`).
//   2. hash match  — proactive known-CSAM hash-list match over the artifact
//                    (lib/content_scan). A hit BLOCKS publish and opens a
//                    moderation case via the CLOUD-32 kill seam
//                    (`applyLifecycle('quarantine', csam)`): the page is
//                    materialized only to be sealed + quarantined in the same
//                    action (preserve-not-delete, NCMEC 60-day clock) and is
//                    NEVER public (excluded from `find`). The action returns a
//                    `blocked` outcome.
//   3. classifier  — phishing/malware/abuse scoring (lib/content_scan). A
//                    `block` verdict rejects + opens a `reported` case; a
//                    `review` verdict ALLOWS the publish but flags it (a
//                    `reported` case + audit) for human follow-up.
//
// The known-CSAM hash list and the domain-reputation provider are INJECTABLE
// (lib/content_scan): offline + in tests they are in-memory; the real NCMEC /
// industry list + reputation feed are wired at deploy (CLOUD-30b). The hook reads
// them through `scanSources` so a test can supply a list with a known hash.
// ===========================================================================

/** The disposition the scan decides for a publish, as plain data. */
export type PublishScanDecision =
  | { kind: "allow" }
  | { kind: "flag"; reason: string; score: number }
  | { kind: "block-csam"; listId: string; hash: string }
  | { kind: "block-classifier"; reason: string; score: number };

/**
 * The PURE scan decision: given the hash-match + classifier results, decide the
 * publish disposition. CSAM hash match is the hard block (drives the CSAM kill
 * seam); else the classifier gate (`block` rejects, `review` flags, `allow`
 * passes). No IO — the action does the materialize/kill/flag based on this.
 */
export function decidePublishScan(
  hash: HashMatchResult,
  classify: ClassifyResult,
): PublishScanDecision {
  if (hash.match) {
    return { kind: "block-csam", listId: hash.listId ?? "unknown", hash: hash.hash };
  }
  if (classify.verdict === "block") {
    return {
      kind: "block-classifier",
      reason: `classifier:${classify.signals.map((s) => s.name).join(",") || "score"}`,
      score: classify.score,
    };
  }
  if (classify.verdict === "review") {
    return {
      kind: "flag",
      reason: `classifier:${classify.signals.map((s) => s.name).join(",") || "score"}`,
      score: classify.score,
    };
  }
  return { kind: "allow" };
}

/**
 * The injectable scan sources (known-CSAM hash list + classifier config). The
 * DEFAULTS are the production posture: an EMPTY hash list (the real NCMEC list is
 * wired at deploy — CLOUD-30b) and the default classifier config. Tests override
 * via `__setScanSources` to supply a list with a known hash / a tuned threshold.
 */
export interface ScanSources {
  hashList: KnownHashList;
  classifyConfig?: ClassifyConfig;
}

let scanSources: ScanSources = {
  // Empty until CLOUD-30b wires the real NCMEC / industry hash list. An empty
  // list means hashMatch never fires offline — the proactive seam is present and
  // exercised, the data source is deferred.
  hashList: { id: "ncmec", has: () => false },
};

/** Test-only: inject the scan sources (a hash list with a known hash, etc.). */
export function __setScanSources(sources: ScanSources): void {
  scanSources = sources;
}

/** Test-only: restore the production (empty hash list) scan sources. */
export function __resetScanSources(): void {
  scanSources = { hashList: { id: "ncmec", has: () => false } };
}

/** The scan/limit outcome handed back to the publish action. */
export type PublishScanGate =
  | { proceed: true; flag: null | { reason: string; score: number } }
  | { proceed: false; rejection: ScanRejection };

/** A non-proceed scan result — the action turns this into a thrown error. */
export type ScanRejection =
  | { code: "RATE_LIMITED"; retryAfter: number }
  | { code: "BLOCKED_CSAM"; listId: string }
  | { code: "BLOCKED_CONTENT"; reason: string; score: number };

/**
 * The publish-scan hook. Runs the rate-limit check then the content scan over the
 * artifact (`html` + optional `css`). Returns a {@link PublishScanGate}:
 *   - `proceed:false` ⇒ the action rejects (rate-limit / CSAM / classifier block);
 *     on a CSAM/classifier block the moderation case is opened AFTER the page is
 *     materialized (the kill seam needs a pageId) — see the publish action.
 *   - `proceed:true, flag` ⇒ publish proceeds; a non-null `flag` is recorded as a
 *     `reported` case + audit after the page lands (review verdict).
 *
 * Self-contained: it reads nothing from and writes nothing to the publish core.
 */
export async function runPublishScan(
  ctx: RateLimitRunCtx,
  args: { accountId: string; html: string; css?: string },
): Promise<PublishScanGate> {
  // 1. Per-account publish rate limit.
  const limit: PublishLimitResult = await checkPublishLimit(ctx, args.accountId);
  if (!limit.ok) {
    return {
      proceed: false,
      rejection: { code: "RATE_LIMITED", retryAfter: limit.retryAfter ?? 0 },
    };
  }

  // 2. Content scan over the artifact bytes (html + css preamble).
  const artifact = args.css ? `${args.css}\n${args.html}` : args.html;
  const hash = await hashMatch(artifact, scanSources.hashList);
  const classify = classifyContent(args.html, scanSources.classifyConfig);
  const decision = decidePublishScan(hash, classify);

  switch (decision.kind) {
    case "allow":
      return { proceed: true, flag: null };
    case "flag":
      return {
        proceed: true,
        flag: { reason: decision.reason, score: decision.score },
      };
    case "block-csam":
      return {
        proceed: false,
        rejection: { code: "BLOCKED_CSAM", listId: decision.listId },
      };
    case "block-classifier":
      return {
        proceed: false,
        rejection: {
          code: "BLOCKED_CONTENT",
          reason: decision.reason,
          score: decision.score,
        },
      };
  }
}

/**
 * Internal mutation: BLOCK a scan-flagged publish — pull the page so it is never
 * public AND evict the edge route it was just published on, then open/advance the
 * moderation case. Both block kinds quarantine through the CLOUD-32 seam so the
 * page stops serving (lifecycle → quarantined, excluded from `find`):
 *
 *   - `csam`       — `applyLifecycle('quarantine', csam)`: seal the artifact, open
 *                    the CSAM case, stamp the 60-day NCMEC clock (preserve-not-
 *                    delete). The CSAM case reason carries the matched list id.
 *   - `classifier` — `applyLifecycle('quarantine')` too: a `block` verdict is a
 *                    HARD reject, so the page must NOT stay public/findable while a
 *                    human actions it. The case reason marks it `classifier-block`.
 *
 * THE LEGAL-CRITICAL STEP (PR #143 review BLOCKER): `runPublish` already published
 * an `active` KV route (`edge.putRoute`) for this page before this mutation runs,
 * so flipping the DB row to `quarantined` is NOT enough — the artifact would keep
 * serving a live 200 from the KV/edge cache for up to the 1h route TTL. We MUST
 * evict the route + purge the edge cache the same way `deletePage`/`killPage` do
 * (`lifecycleEdgePort.invalidate` + `evictRoute`) so it stops serving immediately.
 *
 * IDEMPOTENT BLOCK (review nit): a publish retried with an idempotencyKey re-scans
 * and re-blocks; the page is then ALREADY `quarantined`, so the pure transition
 * (`active → quarantined` only) would reject with `INVALID_TRANSITION`. We guard
 * that: an already-quarantined page is treated as a successful (idempotent) block —
 * we skip the transition but still evict the edge route, so the action surfaces
 * `CSAM_BLOCKED`/`CONTENT_BLOCKED`, never the confusing `INVALID_TRANSITION`.
 */
export const commitScanBlock = internalMutation({
  args: {
    pageId: v.id("pages"),
    accountId: v.id("accounts"),
    actorTokenId: v.union(v.id("tokens"), v.null()),
    kind: v.union(v.literal("csam"), v.literal("classifier")),
    reason: v.string(),
    listId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const page = await ctx.db.get(args.pageId);
    if (!page || page.accountId !== args.accountId) {
      // The page was just materialized by this same action — absence is a bug.
      throw new ConvexError({ code: "NOT_FOUND", message: "Page not found" });
    }

    // Quarantine (pull) the page UNLESS it is already quarantined (an idempotent
    // re-block of a prior block). `active → quarantined` is the only legal source,
    // so re-entering applyLifecycle on a quarantined page would throw
    // INVALID_TRANSITION; treat the already-quarantined state as block-success.
    if (page.lifecycle === "active") {
      const now = Date.now();
      const isCsam = args.kind === "csam";
      await applyLifecycle(ctx, {
        pageId: args.pageId,
        accountId: args.accountId,
        tokenId: args.actorTokenId,
        transition: "quarantine",
        reason: isCsam
          ? `[csam] proactive hash-match (${args.listId ?? "unknown"})`
          : `[classifier-block] ${args.reason}`,
        caseFields: isCsam
          ? {
              // NCMEC 60-day preservation clock (matches moderation.killPage csam).
              ncmecReportId: null,
              preservationExpiresAt: now + 60 * 24 * 60 * 60 * 1000,
            }
          : undefined,
      });
      await ctx.db.insert("auditLog", {
        accountId: args.accountId,
        action: "page.scan.block",
        targetId: args.pageId,
        actorTokenId: args.actorTokenId,
        metadata: { kind: args.kind, reason: args.reason },
        createdAt: now,
      });
    }

    // LEGAL-CRITICAL: evict the KV route + purge the edge cache the publish just
    // put up, so the blocked artifact stops serving immediately (not after TTL).
    // Mirrors deletePage/killPage. Driven on EVERY block (incl. idempotent re-block)
    // so a retry re-asserts the eviction.
    const url = summaryUrl(pageBaseUrl(), page.slug);
    await lifecycleEdgePort.invalidate(url);
    await lifecycleEdgePort.evictRoute(
      { pageId: args.pageId, slug: page.slug, subdomain: page.subdomain ?? null },
      ctx,
    );

    return null;
  },
});

/**
 * Internal mutation: drop a cached idempotency result for a blocked publish. The
 * core `runPublish` caches `{ok:true}` keyed by `idempotencyKey` BEFORE this hook
 * quarantines+throws, so a naive retry would replay that cached success instead of
 * re-blocking. We delete the cached row on a block so a retry re-scans → re-blocks
 * (the re-block is idempotent — see `commitScanBlock`).
 */
export const dropIdempotency = internalMutation({
  args: { accountId: v.id("accounts"), key: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("idempotencyKeys")
      .withIndex("by_key", (q) =>
        q.eq("accountId", args.accountId).eq("key", args.key),
      )
      .unique();
    if (row) await ctx.db.delete(row._id);
    return null;
  },
});

/**
 * Internal mutation: flag a `review`-verdict publish for human follow-up. Opens a
 * `reported` moderation case + audit but LEAVES the page active/public (the
 * classifier is uncertain — a human confirms). Additive; does not pull the page.
 */
export const commitScanFlag = internalMutation({
  args: {
    pageId: v.id("pages"),
    accountId: v.id("accounts"),
    actorTokenId: v.union(v.id("tokens"), v.null()),
    reason: v.string(),
    score: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.insert("moderation", {
      pageId: args.pageId,
      accountId: args.accountId,
      state: "reported",
      reason: `[classifier-review] ${args.reason}`,
      reporterContact: null,
      ncmecReportId: null,
      preservedR2Key: null,
      preservationExpiresAt: null,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert("auditLog", {
      accountId: args.accountId,
      action: "page.scan.flag",
      targetId: args.pageId,
      actorTokenId: args.actorTokenId,
      metadata: { reason: args.reason, score: args.score },
      createdAt: now,
    });
    return null;
  },
});

// ---------------------------------------------------------------------------
// Public verbs.
// ---------------------------------------------------------------------------

const recipeArg = v.object({ family: v.string(), source: v.string() });
const lockfileArg = v.object({
  version: v.number(),
  registry: v.string(),
  families: v.record(
    v.string(),
    v.object({ version: v.string(), sha: v.string() }),
  ),
});
const outcomeValidator = v.union(
  v.object({
    ok: v.literal(true),
    id: v.string(),
    url: v.string(),
    version: v.number(),
  }),
  v.object({
    ok: v.literal(false),
    status: v.literal(409),
    existingId: v.string(),
  }),
);

/**
 * publish (POST /v1/pages): create a page from HTML (+ lockfile + touched
 * recipes). Returns `{ id, url, version }` or a 409 with the existing id when
 * the stable handle is taken. Idempotency-keyed.
 */
export const publish = action({
  args: {
    bearer: v.string(),
    html: v.string(),
    slug: v.optional(v.string()),
    title: v.optional(v.string()),
    recipes: v.array(recipeArg),
    lockfile: lockfileArg,
    tags: v.optional(v.array(v.string())),
    visibility: v.optional(
      v.union(v.literal("public"), v.literal("unlisted"), v.literal("private")),
    ),
    idempotencyKey: v.optional(v.string()),
    css: v.optional(v.string()),
    // CLOUD-51 (additive): optional hard expiry (epoch ms; null = no expiry) and
    // project-grouping handle. When absent the publish behaves exactly as before.
    expiresAt: v.optional(v.union(v.number(), v.null())),
    projectGroup: v.optional(v.union(v.string(), v.null())),
  },
  returns: outcomeValidator,
  handler: async (ctx, args) => {
    const auth = await ctx.runQuery(internal.pages.authForWrite, {
      bearer: args.bearer,
    });

    // --- CLOUD-33 publish-time guard (after auth, before the pipeline) --------
    // A single, self-contained call: rate limit + content scan. A rate-limit
    // trip or a content block short-circuits the pipeline; a `review` flag rides
    // along and is recorded after the page lands. See `runPublishScan`.
    const gate = await runPublishScan(ctx, {
      accountId: auth.accountId,
      html: args.html,
      css: args.css,
    });
    if (!gate.proceed && gate.rejection.code === "RATE_LIMITED") {
      // Trip → reject WITHOUT materializing anything (no page created).
      throw new ConvexError({
        code: "RATE_LIMITED",
        message: "Publish rate limit exceeded for this account",
        retryAfter: gate.rejection.retryAfter,
      });
    }
    // --------------------------------------------------------------------------

    const deps = makeDeps(ctx, auth.tokenId);
    const outcome = await runPublish(
      {
        actor: { accountId: auth.accountId, tokenId: auth.tokenId },
        html: args.html,
        slug: args.slug,
        title: args.title,
        recipes: args.recipes,
        lockfile: args.lockfile,
        tags: args.tags,
        visibility: args.visibility,
        idempotencyKey: args.idempotencyKey,
        css: args.css,
      },
      deps,
    );

    // --- CLOUD-33 post-materialize scan disposition ---------------------------
    // The scan ran on the artifact above. The CLOUD-32 kill seam / case open needs
    // a pageId, so a BLOCK acts here once the publish landed, then THROWS so the
    // action never returns a success for blocked content (the page is quarantined +
    // its edge route evicted, never public). A `review` flag rides along and is
    // recorded but the publish still succeeds.
    //
    // A blocked publish has TWO materialize shapes that both resolve to a page id:
    //   - `outcome.ok`        → the page we just created (first attempt);
    //   - 409 collision       → an idempotency RETRY whose slug now resolves to the
    //                           page the FIRST attempt quarantined. `runPublish`
    //                           returns a 409 (the slug is taken) instead of
    //                           re-creating, so we re-block that SAME page (the
    //                           re-block is idempotent — already-quarantined ⇒
    //                           block-success) and re-surface CSAM_BLOCKED/
    //                           CONTENT_BLOCKED, never a confusing 409 for content
    //                           that must never publish.
    if (!gate.proceed) {
      const blockedPageId: Id<"pages"> = outcome.ok
        ? (outcome.result.id as Id<"pages">)
        : (outcome.collision.existingId as Id<"pages">);
      // A blocked publish must NOT leave a cached `{ok:true}` idempotency result
      // (`runPublish` writes one before we block): a retry must re-scan + re-block,
      // not replay a success that was never honored. Drop it before we throw.
      if (args.idempotencyKey !== undefined) {
        await ctx.runMutation(internal.pages.dropIdempotency, {
          accountId: auth.accountId as Id<"accounts">,
          key: args.idempotencyKey,
        });
      }
      if (gate.rejection.code === "BLOCKED_CSAM") {
        // Proactive CSAM hash match → quarantine via the CLOUD-32 kill seam + open
        // the CSAM case (preserve-not-delete, 60-day clock) + EVICT the edge route
        // the publish just put up (the page is pulled and stops serving at once).
        await ctx.runMutation(internal.pages.commitScanBlock, {
          pageId: blockedPageId,
          accountId: auth.accountId as Id<"accounts">,
          actorTokenId: auth.tokenId as Id<"tokens">,
          kind: "csam",
          reason: "proactive hash-match",
          listId: gate.rejection.listId,
        });
        throw new ConvexError({
          code: "CSAM_BLOCKED",
          message: "Publish blocked: content matched a known-CSAM hash list",
        });
      }
      if (gate.rejection.code === "BLOCKED_CONTENT") {
        // Classifier block → quarantine (a `block` verdict is a hard reject — the
        // page is NOT left public) + open the case + EVICT the edge route.
        await ctx.runMutation(internal.pages.commitScanBlock, {
          pageId: blockedPageId,
          accountId: auth.accountId as Id<"accounts">,
          actorTokenId: auth.tokenId as Id<"tokens">,
          kind: "classifier",
          reason: gate.rejection.reason,
        });
        throw new ConvexError({
          code: "CONTENT_BLOCKED",
          message: "Publish blocked by the content classifier",
          score: gate.rejection.score,
        });
      }
    }
    if (outcome.ok && gate.proceed && gate.flag) {
      // `review` verdict → publish allowed but flagged for human follow-up.
      await ctx.runMutation(internal.pages.commitScanFlag, {
        pageId: outcome.result.id as Id<"pages">,
        accountId: auth.accountId as Id<"accounts">,
        actorTokenId: auth.tokenId as Id<"tokens">,
        reason: gate.flag.reason,
        score: gate.flag.score,
      });
    }
    // --------------------------------------------------------------------------

    // CLOUD-51 (additive): apply expiry/group AFTER the core publish landed, only
    // when supplied — the core pipeline never sees these fields. A 409 collision
    // returns an existing page we did not create, so we DON'T touch it.
    if (
      outcome.ok &&
      (args.expiresAt !== undefined || args.projectGroup !== undefined)
    ) {
      await ctx.runMutation(internal.pages.commitPageGrouping, {
        pageId: outcome.result.id as Id<"pages">,
        accountId: auth.accountId as Id<"accounts">,
        expiresAt: args.expiresAt,
        projectGroup: args.projectGroup,
      });
    }

    return flattenOutcome(outcome);
  },
});

/**
 * update (PATCH /v1/pages/{id}): publish a new version of an existing page.
 * Bumps the version, keeps the SAME url, retains the prior version (PRD §5.6).
 */
export const update = action({
  args: {
    bearer: v.string(),
    pageId: v.id("pages"),
    html: v.string(),
    recipes: v.array(recipeArg),
    lockfile: lockfileArg,
    tags: v.optional(v.array(v.string())),
    visibility: v.optional(
      v.union(v.literal("public"), v.literal("unlisted"), v.literal("private")),
    ),
    idempotencyKey: v.optional(v.string()),
    css: v.optional(v.string()),
    // CLOUD-51 (additive): re-set expiry / project group on update (null clears).
    expiresAt: v.optional(v.union(v.number(), v.null())),
    projectGroup: v.optional(v.union(v.string(), v.null())),
  },
  returns: outcomeValidator,
  handler: async (ctx, args) => {
    const auth = await ctx.runQuery(internal.pages.authForWrite, {
      bearer: args.bearer,
    });
    const deps = makeDeps(ctx, auth.tokenId);
    const outcome = await runUpdate(
      {
        actor: { accountId: auth.accountId, tokenId: auth.tokenId },
        pageId: args.pageId,
        html: args.html,
        recipes: args.recipes,
        lockfile: args.lockfile,
        tags: args.tags,
        visibility: args.visibility,
        idempotencyKey: args.idempotencyKey,
        css: args.css,
      },
      deps,
    );

    // CLOUD-51 (additive): apply expiry/group after the core update, only when
    // supplied — the core update pipeline is untouched.
    if (
      outcome.ok &&
      (args.expiresAt !== undefined || args.projectGroup !== undefined)
    ) {
      await ctx.runMutation(internal.pages.commitPageGrouping, {
        pageId: outcome.result.id as Id<"pages">,
        accountId: auth.accountId as Id<"accounts">,
        expiresAt: args.expiresAt,
        projectGroup: args.projectGroup,
      });
    }

    return flattenOutcome(outcome);
  },
});

/**
 * The write-scope auth check. An ACTION cannot read `ctx.db`, so the bearer is
 * validated in a query and the resolved identity handed back as plain data.
 */
export const authForWrite = internalQuery({
  args: { bearer: v.string() },
  returns: v.object({
    accountId: v.id("accounts"),
    tokenId: v.id("tokens"),
  }),
  handler: async (ctx, args) => {
    const auth = await requireWrite(ctx, args.bearer);
    return { accountId: auth.accountId, tokenId: auth.tokenId };
  },
});

// ---------------------------------------------------------------------------
// Adapter glue.
// ---------------------------------------------------------------------------

/** Assemble the full deps bundle over the action ctx. */
function makeDeps(ctx: RunnerCtx, tokenId: TokenId): PublishDeps {
  return {
    data: makeDataPort(ctx, tokenId),
    storage: makeStoragePort(),
    edge: makeEdgePort(),
    env: { baseUrl: pageBaseUrl(), rootDomain: pageRootDomain() },
  };
}

function pageBaseUrl(): string {
  // CLOUD-30: read the public origin from env (`PAGES_BASE_URL`). Fallback keeps
  // URLs well-formed in dev/test deployments. This is the LEGACY path-based serve
  // origin (`c.shortwind.dev/<slug>`), kept for backward-compat (CLOUD-31 edge
  // eviction + the demo page still serve from it).
  return process.env.PAGES_BASE_URL ?? "https://c.shortwind.dev";
}

/**
 * CLOUD-SUBDOMAIN: the apex domain pages are served under as per-page subdomains
 * (`https://<subdomain>.<rootDomain>`). Read from env (`PAGES_ROOT_DOMAIN`),
 * else default to `shortwind.dev`. The publish/update URL builder uses this.
 */
function pageRootDomain(): string {
  return process.env.PAGES_ROOT_DOMAIN ?? "shortwind.dev";
}

function flattenOutcome(outcome: PublishOutcome) {
  if (outcome.ok) {
    return {
      ok: true as const,
      id: outcome.result.id,
      url: outcome.result.url,
      version: outcome.result.version,
    };
  }
  return {
    ok: false as const,
    status: outcome.collision.status,
    existingId: outcome.collision.existingId,
  };
}

function toPageRecord(row: Doc<"pages">) {
  return {
    id: row._id,
    accountId: row.accountId,
    slug: row.slug,
    // CLOUD-SUBDOMAIN: surface the stable subdomain so the update path retains it.
    subdomain: row.subdomain,
    currentVersion: row.currentVersion,
  };
}

// ===========================================================================
// CLOUD-24 — `find` / `get` read verbs (PRD §3.1 load-bearing, §4).
//
// `find` is the verb a STATELESS agent calls to answer "do I already have a
// page like this?" before publishing — so it must be cheap, account-scoped, and
// index-backed (never a full table scan). `get` returns a page's metadata + its
// version history so the agent can confirm before acting.
//
// Both are public `query`s (a query CAN read `ctx.db`, unlike the publish/update
// ACTIONS), so they validate the bearer inline via `requireRead` and read the
// `by_customDomain` / `by_tag` / `by_account` / `by_page` indexes directly.
//
// The non-trivial decision logic (index plan, residual q filter, summary
// projection, version ordering) is factored into the PURE helpers below and
// unit-tested offline in `pages.find-get.test.ts` (apps/cloud has no convex-test
// harness — same convention as CLOUD-23's schema-shape test).
// ===========================================================================

/** A page summary returned by `find` — the fields the agent needs to decide
 * publish-vs-update without fetching the full page. CLOUD-25's CLI consumes
 * this verbatim. */
export interface PageSummary {
  id: string;
  slug: string;
  url: string;
  visibility: "public" | "unlisted" | "private";
  /** Lifecycle disposition so callers can see a page's state (CLOUD-31). An
   * agent never gets a tombstoned/quarantined page from `find`, but `get`
   * surfaces it (clearly marked) for audit. */
  lifecycle: "active" | "quarantined" | "tombstoned";
  customDomain: string | null;
  currentVersion: number;
  tags: string[];
  /** CLOUD-51 (additive): optional hard expiry (epoch ms); null = no expiry. */
  expiresAt: number | null;
  /** CLOUD-51 (additive): optional project-grouping handle; null = ungrouped. */
  projectGroup: string | null;
  updatedAt: number;
}

/** The minimal page-row shape the projection reads. Mirrors the `pages` table. */
export interface PageRowLike {
  _id: string;
  slug: string;
  visibility: "public" | "unlisted" | "private";
  lifecycle: "active" | "quarantined" | "tombstoned";
  customDomain: string | null;
  currentVersion: number;
  tags: string[];
  // CLOUD-51 (additive): mirror the new pages fields.
  expiresAt: number | null;
  projectGroup: string | null;
  updatedAt: number;
}

/** The normalized, trimmed `find` filters. `undefined`/blank ⇒ "no filter". */
export interface FindFilters {
  q?: string;
  domain?: string;
  tag?: string;
  // CLOUD-51 (additive): restrict to a single project group.
  group?: string;
}

/** A version entry in the `get` history (newest first). */
export interface VersionEntry {
  id: string;
  version: number;
  artifactKey: string;
  expandedHash: string;
  sourceHash: string;
  createdAt: number;
}

/** Render the public URL for a page slug under the platform origin. */
export function summaryUrl(baseUrl: string, slug: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${slug}`;
}

/** Project a page row into the `find` summary shape. */
export function toPageSummary(row: PageRowLike, baseUrl: string): PageSummary {
  return {
    id: row._id,
    slug: row.slug,
    url: summaryUrl(baseUrl, row.slug),
    visibility: row.visibility,
    lifecycle: row.lifecycle,
    customDomain: row.customDomain,
    currentVersion: row.currentVersion,
    tags: row.tags,
    // CLOUD-51 (additive): surface expiry + group on the summary.
    expiresAt: row.expiresAt,
    projectGroup: row.projectGroup,
    updatedAt: row.updatedAt,
  };
}

/**
 * `find` returns only pages an agent can still act on. A tombstoned page is
 * deleted (gone); a quarantined page is pulled for abuse — neither should come
 * back from a discovery query (CLOUD-31 / CLOUD-24 follow-up). `get` does NOT
 * use this filter: it can still return a dead page's metadata for audit, clearly
 * marked by its `lifecycle` field.
 */
export function isFindable(row: {
  lifecycle: "active" | "quarantined" | "tombstoned";
}): boolean {
  return row.lifecycle === "active";
}

/** Trim a query-string value; treat empty/whitespace as absent. */
export function normalizeFilter(
  value: string | undefined | null,
): string | undefined {
  if (value === undefined || value === null) return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/** Normalize a raw filter bag (parsed query params) into `FindFilters`. */
export function normalizeFindFilters(raw: {
  q?: string | null;
  domain?: string | null;
  tag?: string | null;
  group?: string | null;
}): FindFilters {
  return {
    q: normalizeFilter(raw.q),
    domain: normalizeFilter(raw.domain),
    tag: normalizeFilter(raw.tag),
    // CLOUD-51 (additive): the optional project-group filter.
    group: normalizeFilter(raw.group),
  };
}

/** Case-insensitive substring match of `q` against the page slug. (Title is
 * only used at publish time to derive a slug — never persisted — so the slug is
 * the only durable text handle.) */
export function matchesQuery(row: { slug: string }, q: string): boolean {
  return row.slug.toLowerCase().includes(q.toLowerCase());
}

/** True when `tag` is one of the page's tags (membership, not whole-array). */
export function matchesTag(row: { tags: string[] }, tag: string): boolean {
  return row.tags.includes(tag);
}

/**
 * Apply the residual (non-index) `find` filters to an already account-scoped,
 * index-narrowed candidate set. The adapter drives the scan from the most
 * selective INDEX (see {@link planFindIndex}); the filters no index can serve
 * are applied here:
 *   - the free-text substring `q` (no equality index exists for it), and
 *   - `tag` MEMBERSHIP. Convex's `by_tag` index keys on the WHOLE `tags` array,
 *     not on individual elements, so it can only answer whole-array equality —
 *     not "contains this tag". Membership is therefore enforced here over the
 *     account-scoped candidate set (still index-backed via `by_account`; see
 *     {@link planFindIndex}). A schema migration to a fan-out tag table would
 *     let this move onto an index, but the schema is owned elsewhere (CLOUD-00).
 */
export function applyResidualFilters<
  T extends { slug: string; tags: string[]; projectGroup?: string | null },
>(rows: T[], filters: FindFilters): T[] {
  let out = rows;
  if (filters.q !== undefined) {
    const q = filters.q;
    out = out.filter((r) => matchesQuery(r, q));
  }
  if (filters.tag !== undefined) {
    const tag = filters.tag;
    out = out.filter((r) => matchesTag(r, tag));
  }
  // CLOUD-51 (additive): the project-group filter. When `by_project` drove the
  // scan this is already satisfied; applying it residually is a cheap no-op then
  // and the correct narrowing when another index (e.g. by_customDomain) drove it.
  if (filters.group !== undefined) {
    const group = filters.group;
    out = out.filter((r) => r.projectGroup === group);
  }
  return out;
}

/**
 * The INDEX the adapter drives the scan from, as plain data (so the "no full
 * scan" choice is unit-testable without a DB):
 *   - `domain` present → `by_customDomain` (a true equality index, most
 *     selective: at most one page binds a given hostname).
 *   - else             → `by_account` (the caller's pages). `tag`-only and
 *     `q`-only both land here; `tag` membership is then a residual filter (see
 *     {@link applyResidualFilters} for why `by_tag` cannot serve membership).
 * Every branch is constrained to ONE account downstream, so there is never a
 * cross-account leak and never a full-table scan.
 */
export type FindIndexPlan =
  | { index: "by_customDomain"; domain: string }
  | { index: "by_project"; group: string }
  | { index: "by_account" };

export function planFindIndex(filters: FindFilters): FindIndexPlan {
  if (filters.domain !== undefined) {
    return { index: "by_customDomain", domain: filters.domain };
  }
  // CLOUD-51 (additive): a `group`-scoped find drives the `by_project`
  // (accountId, projectGroup) equality index — account-scoped + group-narrowed,
  // so it never scans the whole account or the whole table.
  if (filters.group !== undefined) {
    return { index: "by_project", group: filters.group };
  }
  return { index: "by_account" };
}

/** Order a page's versions newest-first (descending `version`). */
export function selectGetVersions<T extends { version: number }>(
  versions: T[],
): T[] {
  return [...versions].sort((a, b) => b.version - a.version);
}

const summaryValidator = v.object({
  id: v.string(),
  slug: v.string(),
  url: v.string(),
  visibility: v.union(
    v.literal("public"),
    v.literal("unlisted"),
    v.literal("private"),
  ),
  lifecycle: v.union(
    v.literal("active"),
    v.literal("quarantined"),
    v.literal("tombstoned"),
  ),
  customDomain: v.union(v.string(), v.null()),
  currentVersion: v.number(),
  tags: v.array(v.string()),
  // CLOUD-51 (additive): expiry + project group on the summary.
  expiresAt: v.union(v.number(), v.null()),
  projectGroup: v.union(v.string(), v.null()),
  updatedAt: v.number(),
});

const versionEntryValidator = v.object({
  id: v.id("pageVersions"),
  version: v.number(),
  artifactKey: v.string(),
  expandedHash: v.string(),
  sourceHash: v.string(),
  createdAt: v.number(),
});

/**
 * find (GET /v1/pages?q=&domain=&tag=): list the caller's pages matching the
 * filters, as summaries. Empty result → `[]` (the agent reads this to decide
 * publish-vs-update). requireRead-guarded, account-scoped, INDEX-backed.
 */
export const find = query({
  args: {
    bearer: v.string(),
    q: v.optional(v.string()),
    domain: v.optional(v.string()),
    tag: v.optional(v.string()),
    // CLOUD-51 (additive): restrict the find to a single project group.
    group: v.optional(v.string()),
  },
  returns: v.array(summaryValidator),
  handler: async (ctx, args) => {
    const auth = await requireRead(ctx, args.bearer);
    const filters = normalizeFindFilters({
      q: args.q,
      domain: args.domain,
      tag: args.tag,
      group: args.group,
    });
    const plan = planFindIndex(filters);

    // Narrow by the chosen index FIRST, then enforce account scope. Every
    // branch yields rows for the caller's account only — no full table scan,
    // no cross-account leakage.
    let candidates: Doc<"pages">[];
    if (plan.index === "by_customDomain") {
      const domain = plan.domain;
      candidates = await ctx.db
        .query("pages")
        .withIndex("by_customDomain", (q) => q.eq("customDomain", domain))
        .collect();
      candidates = candidates.filter((p) => p.accountId === auth.accountId);
    } else if (plan.index === "by_project") {
      // CLOUD-51: account-scoped + group-narrowed via the by_project index.
      const group = plan.group;
      candidates = await ctx.db
        .query("pages")
        .withIndex("by_project", (q) =>
          q.eq("accountId", auth.accountId).eq("projectGroup", group),
        )
        .collect();
    } else {
      candidates = await ctx.db
        .query("pages")
        .withIndex("by_account", (q) => q.eq("accountId", auth.accountId))
        .collect();
    }

    const filtered = applyResidualFilters(candidates, filters)
      // CLOUD-31: a dead page (tombstoned/quarantined) is never discoverable —
      // an agent must not get a deleted/pulled page back. `get` still returns it.
      .filter(isFindable);
    const baseUrl = pageBaseUrl();
    return filtered.map((row) =>
      toPageSummary(
        {
          _id: row._id,
          slug: row.slug,
          visibility: row.visibility,
          lifecycle: row.lifecycle,
          customDomain: row.customDomain,
          currentVersion: row.currentVersion,
          tags: row.tags,
          expiresAt: row.expiresAt ?? null,
          projectGroup: row.projectGroup ?? null,
          updatedAt: row.updatedAt,
        },
        baseUrl,
      ),
    );
  },
});

/**
 * get (GET /v1/pages/{id}): a page's metadata (as the `find` summary) + its full
 * version history (newest first) so the agent can confirm before acting.
 * requireRead-guarded + account-scoped: a page belonging to another account is
 * reported as not-found (no existence leak).
 */
export const get = query({
  args: { bearer: v.string(), id: v.id("pages") },
  returns: v.union(
    v.object({
      page: summaryValidator,
      versions: v.array(versionEntryValidator),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const auth = await requireRead(ctx, args.bearer);
    const page = await ctx.db.get(args.id);
    if (!page || page.accountId !== auth.accountId) return null;

    const versionRows = await ctx.db
      .query("pageVersions")
      .withIndex("by_page", (q) => q.eq("pageId", page._id))
      .collect();
    const versions = selectGetVersions(
      versionRows.map((vr) => ({
        id: vr._id,
        version: vr.version,
        artifactKey: vr.artifactKey,
        expandedHash: vr.expandedHash,
        sourceHash: vr.sourceHash,
        createdAt: vr.createdAt,
      })),
    );

    return {
      // `get` returns a page's metadata even when tombstoned/quarantined (for
      // audit) — the `lifecycle` field on the summary marks it clearly.
      page: toPageSummary(
        {
          _id: page._id,
          slug: page.slug,
          visibility: page.visibility,
          lifecycle: page.lifecycle,
          customDomain: page.customDomain,
          currentVersion: page.currentVersion,
          tags: page.tags,
          expiresAt: page.expiresAt ?? null,
          projectGroup: page.projectGroup ?? null,
          updatedAt: page.updatedAt,
        },
        pageBaseUrl(),
      ),
      versions,
    };
  },
});

// ===========================================================================
// CLOUD-31 — delete (→ tombstone) + visibility mutations.
//
// Both are MUTATIONS (a mutation has `ctx.db`; the lifecycle/visibility patch +
// audit are DB writes). The edge effects ride the injectable `lifecycleEdgePort`
// no-op placeholders (real purge/evict wired at deploy — CLOUD-30); they are
// awaited so the contract is exercised end-to-end and the tests can assert it.
// ===========================================================================

const lifecycleResultValidator = v.object({
  lifecycle: v.union(
    v.literal("active"),
    v.literal("quarantined"),
    v.literal("tombstoned"),
  ),
  sealedKey: v.union(v.string(), v.null()),
});

// ===========================================================================
// CLOUD-51 — scheduled expiry sweep (PRD §10 Phase 3 optional).
//
// `sweepExpired` is the internalMutation a cron (crons.ts) ticks. It tombstones
// every page whose `expiresAt <= now` that is still `active`, reusing the SAME
// CLOUD-31/32 `applyLifecycle('delete')` path a user delete uses — so an expired
// page is TOMBSTONED, never hard-deleted (the record + every version row are
// retained, PRD §8.2). It then evicts the KV route + purges the edge cache via
// the same `lifecycleEdgePort` seam as `deletePage`, so the expired page stops
// serving on the hot path. A quarantined/preserved/tombstoned page is skipped
// (only `active` pages tombstone — applyLifecycle's `delete` transition rejects
// the rest, and a live abuse case must not be silently tombstoned over).
// ===========================================================================

/** Pull `expiresAt`-due active pages and tombstone them. Returns the count. */
export const sweepExpired = internalMutation({
  args: { now: v.optional(v.number()) },
  returns: v.object({ tombstoned: v.number() }),
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    // Scan active pages with a non-null expiry that is due. The set is small in
    // practice (only pages that opted into an expiry); the filter keeps the
    // tombstone path off non-expiring pages.
    const due = await ctx.db
      .query("pages")
      .filter((q) =>
        q.and(
          q.eq(q.field("lifecycle"), "active"),
          q.neq(q.field("expiresAt"), null),
          q.lte(q.field("expiresAt"), now),
        ),
      )
      .collect();

    let tombstoned = 0;
    for (const page of due) {
      // Reuse the user-delete tombstone path: active → tombstoned (+ audit), the
      // page record + versions retained (preserve-not-delete, PRD §8.2). The
      // sweep is system-driven, so there is no actor token.
      await applyLifecycle(ctx, {
        pageId: page._id,
        accountId: page.accountId,
        tokenId: null,
        transition: "delete",
        reason: "expired",
      });
      // Same edge eviction as deletePage so the expired page stops serving now.
      const url = summaryUrl(pageBaseUrl(), page.slug);
      await lifecycleEdgePort.invalidate(url);
      await lifecycleEdgePort.evictRoute(
        { pageId: page._id, slug: page.slug, subdomain: page.subdomain ?? null },
        ctx,
      );
      tombstoned += 1;
    }
    return { tombstoned };
  },
});

/**
 * deletePage (DELETE /v1/pages/{id}): requireWrite → move the page's lifecycle
 * to `tombstoned` via the shared moderation transition (NOT a hard delete — the
 * page record + every version row are RETAINED, PRD §8.2), invalidate the edge
 * cache + evict the KV route so the page stops serving (→ 410 at the edge), and
 * audit. A tombstoned page no longer appears in `find` but `get` still returns
 * its metadata for audit, marked by its `lifecycle`.
 */
export const deletePage = mutation({
  args: { bearer: v.string(), id: v.id("pages") },
  returns: lifecycleResultValidator,
  handler: async (ctx, args) => {
    const auth = await requireWrite(ctx, args.bearer);
    const page = await ctx.db.get(args.id);
    if (!page || page.accountId !== auth.accountId) {
      // Account-scoped not-found (no existence leak): mirror `get`/`update`.
      throw new ConvexError({ code: "NOT_FOUND", message: "Page not found" });
    }

    // active → tombstoned (+ audit) through the single shared transition path.
    const outcome = await applyLifecycle(ctx, {
      pageId: args.id,
      accountId: auth.accountId,
      tokenId: auth.tokenId,
      transition: "delete",
      reason: null,
    });

    // Edge: purge the cache + evict the KV route so the dead page stops serving.
    const url = summaryUrl(pageBaseUrl(), page.slug);
    await lifecycleEdgePort.invalidate(url);
    await lifecycleEdgePort.evictRoute(
      { pageId: args.id, slug: page.slug, subdomain: page.subdomain ?? null },
      ctx,
    );

    return outcome;
  },
});

const visibilityArg = v.union(
  v.literal("public"),
  v.literal("unlisted"),
  v.literal("private"),
);

/**
 * setVisibility (PATCH /v1/pages/{id}/visibility): requireWrite → update
 * `pages.visibility`, invalidate the edge cache (visibility affects who the edge
 * serves the artifact to), and audit. Returns the new visibility.
 */
export const setVisibility = mutation({
  args: {
    bearer: v.string(),
    id: v.id("pages"),
    visibility: visibilityArg,
  },
  returns: v.object({ visibility: visibilityArg }),
  handler: async (ctx, args) => {
    const auth = await requireWrite(ctx, args.bearer);
    const page = await ctx.db.get(args.id);
    if (!page || page.accountId !== auth.accountId) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Page not found" });
    }

    const now = Date.now();
    const from = page.visibility;
    if (from !== args.visibility) {
      await ctx.db.patch(args.id, { visibility: args.visibility, updatedAt: now });
    }
    await ctx.db.insert("auditLog", {
      accountId: auth.accountId,
      action: "page.visibility",
      targetId: args.id,
      actorTokenId: auth.tokenId,
      metadata: { from, to: args.visibility },
      createdAt: now,
    });

    // Visibility changes what the edge may serve → purge the cached URL.
    await lifecycleEdgePort.invalidate(summaryUrl(pageBaseUrl(), page.slug));

    return { visibility: args.visibility };
  },
});
