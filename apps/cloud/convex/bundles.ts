import { v, ConvexError } from "convex/values";
import { action, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { requireWrite } from "./lib/auth_guard.js";
import { deriveSlug, validateSlug } from "../shared/src/slug.js";
import { normalizeBundlePath } from "./lib/bundle_path.js";
import {
  assembleArtifact,
  lockfileVersions,
  runPublish,
  runUpdate,
  type Actor,
  type CollisionResult,
  type PublishDeps,
  type StoragePort,
} from "./lib/publish_core.js";
import { makeDeps, makeStoragePort, runPublishScan } from "./pages.js";
import { expandPage, type RecipeSource } from "./expand.js";
import { themePreamble } from "./lib/theme_preamble.js";
import type { Lockfile } from "../shared/src/lockfile-diff.js";

/**
 * CLOUD-50 — Bundles: a linked multi-page unit published under ONE entry point.
 *
 * A BUNDLE is a set of HTML files deployed together: an ENTRY page plus sibling
 * sub-pages, all reachable at `<subdomain>.shortwind.app/<path>`. Files link to
 * one another with ordinary relative links (`<a href="about.html">`).
 *
 * ENTRY-AS-PAGE (the resolved model): the entry file is published as a normal
 * `pages` row via the single-file {@link runPublish} — so it reserves the
 * globally-unique subdomain and inherits versioning, visibility, lifecycle, the
 * kill/tombstone path, and the R2 write with ZERO duplication. The sibling files
 * are expanded + written to R2 and recorded in an additive `bundleVersions` row
 * linked back to the entry page (`entryPageId`). The serve path resolves the
 * entry by subdomain (unchanged) and a sibling by looking the page up, then its
 * bundle, then matching the request path (see `serve.resolveRoute`).
 *
 * NO LINK REWRITING: because each file serves at its AUTHORED path on the entry's
 * subdomain, the author's relative links resolve natively in the browser. The
 * old "link-before-deploy" rewrite (which assumed files lived at opaque R2 keys)
 * is gone.
 *
 * As with `lib/publish_core`, ALL business logic is a PURE function over plain
 * serializable data with IO behind injected ports; the Convex action is the thin
 * adapter that builds the real ports over `ctx` (reusing `pages.ts`'s).
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
  /** The incoming `.shortwind-lock.json` snapshot. */
  lockfile: Lockfile;
  /** Discovery tags for the entry page. */
  tags?: readonly string[];
  /** Visibility of the whole bundle (applied to the entry page; siblings inherit). */
  visibility?: "public" | "unlisted" | "private";
  /** Scoped-CSS preamble / theme override applied to every file in the bundle. */
  css?: string;
}

/** A served sibling file in a published bundle (one immutable R2 artifact). */
export interface BundleFileResult {
  /** The authored bundle-relative path. */
  path: string;
  /** The R2 artifact key the served document was written to. */
  artifactKey: string;
  /** Content hash of the expanded+assembled document. */
  sourceHash: string;
  /** Always false: the entry is the page, not a bundle file (kept for the wire shape). */
  entry: boolean;
}

/** The result of a successful bundle publish. */
export interface PublishBundleResult {
  /** The bundle's stable identifier — its account-scoped entry slug. */
  bundleId: string;
  /** The entry page id (a real `pages` row). */
  entryPageId: string;
  /** The public URL of the entry point. */
  url: string;
  /** The bundle version this publish landed. */
  version: number;
  /** The served sibling sub-pages. */
  files: BundleFileResult[];
}

/** Either the publish succeeded, or the entry slug collided with an existing page. */
export type PublishBundleOutcome =
  | { ok: true; result: PublishBundleResult }
  | { ok: false; collision: CollisionResult };

// ===========================================================================
// Bundle ports — reuse the single-file publish deps for the ENTRY; add only the
// bundle-version write.
// ===========================================================================

/** Fields for a new immutable `bundleVersions` row. */
export interface NewBundleVersion {
  accountId: string;
  slug: string;
  entryPageId: string;
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

export interface BundleDeps {
  /** The single-file publish deps used to publish the entry as a page. */
  publish: PublishDeps;
  /** Append an immutable bundle version linked to the entry page. */
  insertBundleVersion(version: NewBundleVersion): Promise<string>;
  /**
   * The current (highest) bundle version whose entry is `entryPageId`, plus
   * whether that entry page is still active — or null if `entryPageId` is not a
   * bundle entry. Drives publish-vs-update: an account re-publishing its own
   * live bundle at the same slug UPDATES it (forward-only) instead of colliding.
   */
  currentBundle(
    entryPageId: string,
  ): Promise<{ version: number; active: boolean } | null>;
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

/**
 * A sibling file's served R2 key namespaces the bundle by its ENTRY PAGE id (the
 * stable identity) + the authored path. Mirrors the single-file
 * `artifacts/<acct>/<pageId>/<hash>.html` layout under a `bundles/` prefix.
 */
export function bundleArtifactKey(
  accountId: string,
  entryPageId: string,
  path: string,
  expandedHash: string,
): string {
  return `bundles/${accountId}/${entryPageId}/${normalizeBundlePath(path)}/${expandedHash}.html`;
}

/** Resolve/validate the bundle's entry slug (account-scoped handle). */
function resolveBundleSlug(input: PublishBundleInput): string {
  if (input.slug !== undefined) {
    const r = validateSlug(input.slug);
    if (!r.ok) throw new Error(`shortwind bundle: ${r.error}`);
    return r.value;
  }
  const seed = input.title ?? input.entryPath.replace(/\.[a-z0-9]+$/i, "");
  const r = deriveSlug(seed);
  if (!r.ok) throw new Error(`shortwind bundle: ${r.error}`);
  return r.value;
}

// ===========================================================================
// runPublishBundle — the pure pipeline. Publishes the entry as a page (reusing
// runPublish), writes the siblings, and records the bundle version.
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
  const entryFile = input.files.find((f) => normalizeBundlePath(f.path) === entry);
  if (!entryFile) {
    throw new Error(
      `shortwind bundle: entry "${input.entryPath}" is not one of the bundle files`,
    );
  }

  // 2. Resolve the entry slug up front so the stored bundle row and the entry
  //    page agree on it (we pass it explicitly to runPublish/runUpdate).
  const slug = resolveBundleSlug(input);

  // 3. Publish-or-update the ENTRY as a page. If the account already owns a LIVE
  //    bundle at this slug, UPDATE it (new version, same URL) — forward-only,
  //    prior versions retained. A slug held by a non-bundle page, or by a
  //    tombstoned/quarantined bundle, is a 409 (never resurrect a pulled page).
  const existing = await deps.publish.data.findPageBySlug(acct, slug);
  let pageId: string;
  let url: string;
  let version: number;
  if (existing) {
    const cur = await deps.currentBundle(existing.id);
    if (cur === null || !cur.active) {
      return {
        ok: false,
        collision: { status: 409, existingId: existing.id },
      };
    }
    const updated = await runUpdate(
      {
        actor: input.actor,
        pageId: existing.id,
        html: entryFile.html,
        recipes: input.recipes,
        lockfile: input.lockfile,
        tags: input.tags,
        visibility: input.visibility,
        css: input.css,
      },
      deps.publish,
    );
    if (!updated.ok) {
      return { ok: false, collision: updated.collision };
    }
    ({ id: pageId, url, version } = updated.result);
  } else {
    const created = await runPublish(
      {
        actor: input.actor,
        html: entryFile.html,
        slug,
        recipes: input.recipes,
        lockfile: input.lockfile,
        tags: input.tags,
        visibility: input.visibility,
        css: input.css,
      },
      deps.publish,
    );
    if (!created.ok) {
      return { ok: false, collision: created.collision };
    }
    ({ id: pageId, url, version } = created.result);
  }

  // 4. Write each SIBLING file to R2 (expand + assemble, same machinery), served
  //    at its authored path on the entry's subdomain — no link rewriting.
  const recipeSources: RecipeSource[] = input.recipes.map((r) => ({
    filename: `${r.family}.css`,
    source: r.source,
  }));
  const siblings = input.files.filter(
    (f) => normalizeBundlePath(f.path) !== entry,
  );
  const fileResults: BundleFileResult[] = [];
  for (const file of siblings) {
    const path = normalizeBundlePath(file.path);
    const expanded = await expandPage({
      html: file.html,
      recipes: recipeSources,
      css: input.css,
    });
    const document = assembleArtifact(expanded.expandedHtml, expanded.css);
    const key = bundleArtifactKey(acct, pageId, path, expanded.expandedHash);
    await deps.publish.storage.writeArtifact(key, document, {
      expandedHash: expanded.expandedHash,
      version,
      accountId: acct,
      pageId,
    });
    const sourceHash = await sha256Hex(file.html);
    fileResults.push({ path, artifactKey: key, sourceHash, entry: false });
  }

  // 5. Append the immutable bundle version, linked to the entry page.
  await deps.insertBundleVersion({
    accountId: acct,
    slug,
    entryPageId: pageId,
    version,
    entryPath: entry,
    files: fileResults.map((f) => ({
      path: f.path,
      artifactKey: f.artifactKey,
      sourceHash: f.sourceHash,
      entry: f.entry,
    })),
    lockfile: lockfileVersions(input.lockfile),
  });

  return {
    ok: true,
    result: { bundleId: slug, entryPageId: pageId, url, version, files: fileResults },
  };
}

// ===========================================================================
// Convex adapter — thin ports over the action ctx (reuses pages.ts's).
// ===========================================================================

type AccountId = Id<"accounts">;

const bundleFileValidator = v.object({
  path: v.string(),
  artifactKey: v.string(),
  sourceHash: v.string(),
  entry: v.boolean(),
});

/**
 * Append the immutable `bundleVersions` row (forward-only) + audit, in one
 * mutation so a publish either fully lands or not at all. Linked to the entry
 * page via `entryPageId` (the serve path resolves siblings through it).
 */
export const commitBundleVersion = internalMutation({
  args: {
    accountId: v.id("accounts"),
    slug: v.string(),
    entryPageId: v.id("pages"),
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
      entryPageId: args.entryPageId,
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
        entryPageId: args.entryPageId,
      },
      createdAt: now,
    });
    return versionId;
  },
});

/**
 * The current bundle head for an entry page: its highest `version` + whether the
 * entry page is still active. Null when `entryPageId` is not a bundle entry.
 * Drives the publish-vs-update decision in {@link runPublishBundle}.
 */
export const bundleForEntry = internalQuery({
  args: { entryPageId: v.id("pages") },
  returns: v.union(
    v.object({ version: v.number(), active: v.boolean() }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("bundleVersions")
      .withIndex("by_entryPage", (q) => q.eq("entryPageId", args.entryPageId))
      .collect();
    if (rows.length === 0) return null;
    const version = rows.reduce((max, r) => Math.max(max, r.version), 0);
    const page = await ctx.db.get(args.entryPageId);
    return { version, active: page?.lifecycle === "active" };
  },
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

// Bundle resource caps (server-side; the CLI enforces the same on the walk).
export const MAX_BUNDLE_FILES = 2000;
export const MAX_BUNDLE_BYTES = 50 * 1024 * 1024; // 50 MB

const bundleFileInputArg = v.object({ path: v.string(), html: v.string() });
const recipeArg = v.object({ family: v.string(), source: v.string() });
const lockfileArg = v.object({
  version: v.number(),
  registry: v.string(),
  families: v.record(
    v.string(),
    v.object({ version: v.string(), sha: v.string() }),
  ),
});

const bundleOutcomeValidator = v.union(
  v.object({
    ok: v.literal(true),
    bundleId: v.string(),
    url: v.string(),
    version: v.number(),
    files: v.array(bundleFileValidator),
  }),
  v.object({ ok: v.literal(false), status: v.literal(409), existingId: v.string() }),
);

/**
 * publishBundle (POST /v1/bundles): publish a linked multi-page unit under one
 * entry point (entry-as-page). The whole bundle's HTML is content-scanned +
 * rate-limited ONCE (parity with single-file publish); on a hard block nothing
 * is materialized. Then the entry publishes as a page and the siblings are
 * written + versioned. Re-publishing an occupied slug 409s (like a page).
 */
export const publishBundle = action({
  args: {
    bearer: v.string(),
    files: v.array(bundleFileInputArg),
    entryPath: v.string(),
    slug: v.optional(v.string()),
    title: v.optional(v.string()),
    recipes: v.array(recipeArg),
    lockfile: lockfileArg,
    tags: v.optional(v.array(v.string())),
    visibility: v.optional(
      v.union(v.literal("public"), v.literal("unlisted"), v.literal("private")),
    ),
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
    if (args.files.length > MAX_BUNDLE_FILES) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: `bundle exceeds ${MAX_BUNDLE_FILES} files`,
      });
    }
    const totalBytes = args.files.reduce(
      (n, f) => n + new TextEncoder().encode(f.html).byteLength,
      0,
    );
    if (totalBytes > MAX_BUNDLE_BYTES) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: `bundle exceeds ${MAX_BUNDLE_BYTES} bytes`,
      });
    }

    // Content scan + rate limit ONCE over the whole bundle (parity with a
    // single-file publish; one rate-limit consumption per publish). A hard block
    // rejects BEFORE anything is materialized (nothing is stored). NOTE: unlike
    // the single-file CSAM path, bundles do not materialize-then-preserve on a
    // CSAM hit yet — a preserve-for-NCMEC parity pass is a follow-up.
    const combined = args.files.map((f) => f.html).join("\n");
    const gate = await runPublishScan(ctx, {
      accountId: auth.accountId,
      html: combined,
      css: args.css,
    });
    if (!gate.proceed) {
      if (gate.rejection.code === "RATE_LIMITED") {
        throw new ConvexError({
          code: "RATE_LIMITED",
          message: "Publish rate limit exceeded for this account",
          retryAfter: gate.rejection.retryAfter,
        });
      }
      if (gate.rejection.code === "BLOCKED_CSAM") {
        throw new ConvexError({
          code: "CSAM_BLOCKED",
          message: "Publish blocked: content matched a known-CSAM hash list",
        });
      }
      throw new ConvexError({
        code: "CONTENT_BLOCKED",
        message: "Publish blocked by the content classifier",
      });
    }

    const deps: BundleDeps = {
      publish: makeDeps(ctx, auth.tokenId),
      insertBundleVersion: (version) =>
        ctx.runMutation(internal.bundles.commitBundleVersion, {
          accountId: version.accountId as AccountId,
          slug: version.slug,
          entryPageId: version.entryPageId as Id<"pages">,
          version: version.version,
          entryPath: version.entryPath,
          files: version.files,
          lockfile: version.lockfile,
          actorTokenId: auth.tokenId,
        }),
      currentBundle: (entryPageId) =>
        ctx.runQuery(internal.bundles.bundleForEntry, {
          entryPageId: entryPageId as Id<"pages">,
        }),
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
        tags: args.tags,
        visibility: args.visibility,
        css: args.css,
      },
      deps,
    );

    if (!outcome.ok) {
      return {
        ok: false as const,
        status: 409 as const,
        existingId: outcome.collision.existingId,
      };
    }

    // A `review` flag → publish allowed but recorded against the entry page.
    if (gate.flag) {
      await ctx.runMutation(internal.pages.commitScanFlag, {
        pageId: outcome.result.entryPageId as Id<"pages">,
        accountId: auth.accountId as AccountId,
        actorTokenId: auth.tokenId as Id<"tokens">,
        reason: gate.flag.reason,
        score: gate.flag.score,
      });
    }

    return {
      ok: true as const,
      bundleId: outcome.result.bundleId,
      url: outcome.result.url,
      version: outcome.result.version,
      files: outcome.result.files,
    };
  },
});

/**
 * publishBundleFromWeb — publish a linked multi-page bundle from the dashboard
 * (folder drop). Session-authed (no bearer), the web analogue of
 * {@link publishBundle}. `@recipe` shorthand across the bundle is expanded
 * server-side against the account's STORED palette (the browser has no local
 * palette), so it has the same recipe parity as the single-file web publish.
 */
export const publishBundleFromWeb = action({
  args: {
    files: v.array(bundleFileInputArg),
    entryPath: v.string(),
    slug: v.optional(v.string()),
    title: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    visibility: v.optional(
      v.union(v.literal("public"), v.literal("unlisted"), v.literal("private")),
    ),
    css: v.optional(v.string()),
  },
  returns: bundleOutcomeValidator,
  handler: async (ctx, args) => {
    const auth = await ctx.runQuery(internal.pages.authForWebWrite, {});

    if (args.files.length === 0) {
      throw new ConvexError({ code: "BAD_REQUEST", message: "bundle has no files" });
    }
    if (args.files.length > MAX_BUNDLE_FILES) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: `bundle exceeds ${MAX_BUNDLE_FILES} files`,
      });
    }
    const totalBytes = args.files.reduce(
      (n, f) => n + new TextEncoder().encode(f.html).byteLength,
      0,
    );
    if (totalBytes > MAX_BUNDLE_BYTES) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: `bundle exceeds ${MAX_BUNDLE_BYTES} bytes`,
      });
    }

    const combined = args.files.map((f) => f.html).join("\n");
    const gate = await runPublishScan(ctx, {
      accountId: auth.accountId,
      html: combined,
      css: args.css,
    });
    if (!gate.proceed) {
      if (gate.rejection.code === "RATE_LIMITED") {
        throw new ConvexError({
          code: "RATE_LIMITED",
          message: "Publish rate limit exceeded for this account",
          retryAfter: gate.rejection.retryAfter,
        });
      }
      if (gate.rejection.code === "BLOCKED_CSAM") {
        throw new ConvexError({
          code: "CSAM_BLOCKED",
          message: "Publish blocked: content matched a known-CSAM hash list",
        });
      }
      throw new ConvexError({
        code: "CONTENT_BLOCKED",
        message: "Publish blocked by the content classifier",
      });
    }

    // Expand @recipe across the bundle against the account's stored palette
    // (body-only sources → full parity, no spurious recipe-edit events).
    const palette: { family: string; body: string }[] = await ctx.runQuery(
      internal.recipes.listRecipePalette,
      { accountId: auth.accountId },
    );
    const recipes = palette.map((p) => ({ family: p.family, source: p.body }));

    // Theme the fragment-wrapped sub-pages with the account accent + radius (P5).
    const theme = await ctx.runQuery(
      internal.dashboard.getAccountThemeInternal,
      { accountId: auth.accountId },
    );
    const css = args.css ?? themePreamble(theme);

    const deps: BundleDeps = {
      publish: makeDeps(ctx, auth.tokenId),
      insertBundleVersion: (version) =>
        ctx.runMutation(internal.bundles.commitBundleVersion, {
          accountId: version.accountId as AccountId,
          slug: version.slug,
          entryPageId: version.entryPageId as Id<"pages">,
          version: version.version,
          entryPath: version.entryPath,
          files: version.files,
          lockfile: version.lockfile,
          actorTokenId: auth.tokenId,
        }),
      currentBundle: (entryPageId) =>
        ctx.runQuery(internal.bundles.bundleForEntry, {
          entryPageId: entryPageId as Id<"pages">,
        }),
    };

    const outcome = await runPublishBundle(
      {
        actor: { accountId: auth.accountId, tokenId: auth.tokenId },
        files: args.files,
        entryPath: args.entryPath,
        slug: args.slug,
        title: args.title,
        recipes,
        lockfile: { version: 1, registry: "default", families: {} },
        tags: args.tags,
        visibility: args.visibility,
        css,
      },
      deps,
    );

    if (!outcome.ok) {
      return {
        ok: false as const,
        status: 409 as const,
        existingId: outcome.collision.existingId,
      };
    }

    if (gate.flag) {
      await ctx.runMutation(internal.pages.commitScanFlag, {
        pageId: outcome.result.entryPageId as Id<"pages">,
        accountId: auth.accountId as AccountId,
        actorTokenId: auth.tokenId as Id<"tokens"> | null,
        reason: gate.flag.reason,
        score: gate.flag.score,
      });
    }

    return {
      ok: true as const,
      bundleId: outcome.result.bundleId,
      url: outcome.result.url,
      version: outcome.result.version,
      files: outcome.result.files,
    };
  },
});
