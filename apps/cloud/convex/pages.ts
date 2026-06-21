import { v } from "convex/values";
import { action, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { requireWrite } from "./lib/auth-guard.js";
import {
  runPublish,
  runUpdate,
  type EdgePort,
  type PublishDataPort,
  type PublishDeps,
  type PublishOutcome,
  type StoragePort,
} from "./lib/publish-core.js";
import type { Lockfile } from "../shared/src/lockfile-diff.js";

/**
 * Page publish + update — the thick path (CLOUD-23, PRD §6.2).
 *
 * ALL business logic lives in the pure `lib/publish-core` (`runPublish` /
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
      customDomain: null,
      visibility: args.visibility,
      lifecycle: "active",
      tags: args.tags,
      currentVersionId: null,
      currentVersion: 0,
      createdAt: now,
      updatedAt: now,
    });
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
    insertPage: (page) =>
      ctx.runMutation(internal.pages.commitNewPage, {
        accountId: page.accountId as AccountId,
        slug: page.slug,
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

async function writeArtifactToR2(
  key: string,
  html: string,
  meta: { expandedHash: string; version: number; accountId: string; pageId: string },
): Promise<void> {
  // CLOUD-30: PUT to the R2 bucket via its S3-compatible API using `R2_ENDPOINT`,
  // `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`. Content-Type
  // text/html; charset=utf-8; customMetadata mirrors worker/src/r2.ts ArtifactMeta
  // (expandedHash, version, accountId, pageId). Until then this is a no-op so the
  // pipeline runs in dev/test deployments without R2 creds.
  void key;
  void html;
  void meta;
}

async function invalidateEdge(url: string): Promise<void> {
  // CLOUD-30: purge the Cloudflare edge cache for `url` (cache API / purge call).
  void url;
}

async function putEdgeRoute(route: {
  pageId: string;
  slug: string;
  version: number;
  artifactKey: string;
}): Promise<void> {
  // CLOUD-30: write the hostname+path → page-version route into the Worker KV
  // namespace consumed by worker/src/kv.ts so the hot path resolves the artifact.
  void route;
}

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
  },
  returns: outcomeValidator,
  handler: async (ctx, args) => {
    const auth = await ctx.runQuery(internal.pages.authForWrite, {
      bearer: args.bearer,
    });
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
    env: { baseUrl: pageBaseUrl() },
  };
}

function pageBaseUrl(): string {
  // CLOUD-30: read the public origin from env (`PAGES_BASE_URL`). Fallback keeps
  // URLs well-formed in dev/test deployments.
  return "https://shortwind.app";
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
    currentVersion: row.currentVersion,
  };
}
