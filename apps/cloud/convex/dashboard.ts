import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireRead } from "./lib/auth_guard.js";

/**
 * Dashboard oversight queries (CLOUD-35, PRD §3 / §5.4 / §6.3 / §8).
 *
 * These power the human OPERATOR's read-mostly oversight dashboard. The
 * operator grants access, sets policy, and oversees the system — authoring is
 * NOT their job (PRD §3). So this module is deliberately read-heavy:
 *
 *   - `listPages`            — every page in the account + its current state.
 *   - `listAuditLog`         — the chronological actor/action feed (PRD §6.3).
 *   - `listRecipeEditEvents` — the DISTINCT recipe-edit feed (PRD §5.4): the
 *                              human must SEE "agent modified @card 0.4.0→0.5.0,
 *                              affects N pages" as its own thing, separate from
 *                              an ordinary page edit, so they can roll back.
 *   - `listModeration`       — the abuse/quarantine queue (oversight of the §8
 *                              kill path).
 *   - `getAccountPolicy`     — operator policy toggles (read).
 *   - `setAccountPolicy`     — the ONE mutation: persist a policy toggle.
 *
 * Auth + scoping: every function routes through `requireRead` (the dashboard
 * holds a read-scoped operator bearer) and is scoped to the resolved
 * `auth.accountId`. No cross-account leakage — the same invariant `pages.find`
 * relies on.
 *
 * Reactivity: these are plain Convex queries, so the dashboard re-renders the
 * instant any of these tables change (PRD §6.3). No polling.
 *
 * Policy storage (no-schema-change note): the schema (owned elsewhere, CLOUD-23)
 * has no dedicated policy table, and CLOUD-35 must not alter it. The single
 * operator policy document is therefore persisted as an append-only `auditLog`
 * entry with `action === "policy.set"` whose `metadata` carries the policy.
 * `getAccountPolicy` reads back the newest such entry. This keeps the toggle
 * durable AND auditable (a policy change is itself a consequential mutation that
 * belongs in the audit trail) with zero schema migration. When a real policy
 * table lands, this reader/writer pair is the only thing to repoint.
 *
 * Offline-codegen note: `convex dev` cannot run here (no CONVEX_DEPLOYMENT), so
 * the `dashboard` module is declared by hand in `_generated/api.d.ts` (additive,
 * mirroring how CLOUD-23/CLOUD-33 declared their modules) — without it the
 * dashboard's `api.dashboard.*` references would not typecheck. A real
 * `convex dev` (CLOUD-30b) regenerates that file and supersedes the edit.
 */

// ---------------------------------------------------------------------------
// Shared validators — the serializable shapes the dashboard renders.
// ---------------------------------------------------------------------------

/** A page row as the dashboard lists it (metadata only; versions on demand). */
const pageRowValidator = v.object({
  id: v.id("pages"),
  slug: v.string(),
  customDomain: v.union(v.string(), v.null()),
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
  tags: v.array(v.string()),
  currentVersion: v.number(),
  updatedAt: v.number(),
  createdAt: v.number(),
});

/** One immutable published snapshot in a page's history. */
const pageVersionRowValidator = v.object({
  id: v.id("pageVersions"),
  version: v.number(),
  artifactKey: v.string(),
  expandedHash: v.string(),
  sourceHash: v.string(),
  createdAt: v.number(),
});

/** A chronological audit entry (actor/action feed, PRD §6.3). */
const auditRowValidator = v.object({
  id: v.id("auditLog"),
  action: v.string(),
  targetId: v.union(v.string(), v.null()),
  actorTokenId: v.union(v.id("tokens"), v.null()),
  metadata: v.any(),
  createdAt: v.number(),
});

/**
 * A recipe-edit event — the DISTINCT §5.4 feed. `affectedPages` is the count of
 * the account's currently-active pages, i.e. how many pages this family change
 * "affects … on next publish" (the human-facing phrasing from the PRD). It is
 * computed here so the dashboard can render the warning without a second query.
 */
const recipeEditRowValidator = v.object({
  id: v.id("recipeEditEvents"),
  family: v.string(),
  fromVersion: v.union(v.string(), v.null()),
  toVersion: v.string(),
  bodySha: v.string(),
  actorTokenId: v.union(v.id("tokens"), v.null()),
  createdAt: v.number(),
  affectedPages: v.number(),
});

/** A trust-and-safety case (abuse/quarantine queue, PRD §8). */
const moderationRowValidator = v.object({
  id: v.id("moderation"),
  pageId: v.id("pages"),
  state: v.union(
    v.literal("reported"),
    v.literal("quarantined"),
    v.literal("preserved"),
    v.literal("cleared"),
  ),
  reason: v.union(v.string(), v.null()),
  reporterContact: v.union(v.string(), v.null()),
  ncmecReportId: v.union(v.string(), v.null()),
  preservedR2Key: v.union(v.string(), v.null()),
  preservationExpiresAt: v.union(v.number(), v.null()),
  createdAt: v.number(),
  updatedAt: v.number(),
});

/**
 * Operator policy toggles (PRD §3 — the operator sets policy). Kept small and
 * explicit; new toggles are added as named booleans here, never a free-form bag.
 */
const policyValidator = v.object({
  /**
   * When true, a custom-domain bind requires explicit human approval before the
   * hostname goes live (the privileged, human-gated path, PRD §7.2). Defaults
   * to `true` (safe-by-default) when the operator has never set a policy.
   */
  customDomainNeedsApproval: v.boolean(),
  /** When the policy was last set; null if never set (defaults in effect). */
  updatedAt: v.union(v.number(), v.null()),
});

const POLICY_ACTION = "policy.set" as const;

/** The safe defaults applied when an account has never set a policy. */
function defaultPolicy(): { customDomainNeedsApproval: boolean } {
  return { customDomainNeedsApproval: true };
}

// ---------------------------------------------------------------------------
// Queries — read-mostly oversight.
// ---------------------------------------------------------------------------

/**
 * listPages: every page in the operator's account, newest-updated first, with
 * full per-page version history attached so the dashboard's Pages view can show
 * "list + version history per page" without an N+1 round trip.
 */
export const listPages = query({
  args: { bearer: v.string() },
  returns: v.array(
    v.object({
      page: pageRowValidator,
      versions: v.array(pageVersionRowValidator),
    }),
  ),
  handler: async (ctx, args) => {
    const auth = await requireRead(ctx, args.bearer);
    const pages = await ctx.db
      .query("pages")
      .withIndex("by_account", (q) => q.eq("accountId", auth.accountId))
      .collect();

    const rows = await Promise.all(
      pages
        .slice()
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map(async (p: Doc<"pages">) => {
          const versionRows = await ctx.db
            .query("pageVersions")
            .withIndex("by_page", (q) => q.eq("pageId", p._id))
            .collect();
          const versions = versionRows
            .slice()
            .sort((a, b) => b.version - a.version)
            .map((vr: Doc<"pageVersions">) => ({
              id: vr._id,
              version: vr.version,
              artifactKey: vr.artifactKey,
              expandedHash: vr.expandedHash,
              sourceHash: vr.sourceHash,
              createdAt: vr.createdAt,
            }));
          return {
            page: {
              id: p._id,
              slug: p.slug,
              customDomain: p.customDomain,
              visibility: p.visibility,
              lifecycle: p.lifecycle,
              tags: p.tags,
              currentVersion: p.currentVersion,
              updatedAt: p.updatedAt,
              createdAt: p._creationTime,
            },
            versions,
          };
        }),
    );
    return rows;
  },
});

/**
 * listAuditLog: the chronological actor/action feed (PRD §6.3), newest first.
 * `limit` caps the page size (default 200) — the dashboard tails the head.
 */
export const listAuditLog = query({
  args: { bearer: v.string(), limit: v.optional(v.number()) },
  returns: v.array(auditRowValidator),
  handler: async (ctx, args) => {
    const auth = await requireRead(ctx, args.bearer);
    const limit = Math.max(1, Math.min(args.limit ?? 200, 1000));
    const rows = await ctx.db
      .query("auditLog")
      .withIndex("by_account", (q) => q.eq("accountId", auth.accountId))
      .order("desc")
      .take(limit);
    return rows.map((r: Doc<"auditLog">) => ({
      id: r._id,
      action: r.action,
      targetId: r.targetId,
      actorTokenId: r.actorTokenId,
      metadata: r.metadata,
      createdAt: r._creationTime,
    }));
  },
});

/**
 * listRecipeEditEvents: the DISTINCT §5.4 recipe-edit feed, newest first. Each
 * row carries `affectedPages` (count of the account's active pages) so the
 * dashboard can render "@card 0.4.0→0.5.0, affects N pages on next publish".
 * This feed is what makes a recipe edit VISIBLE to the human as its own event,
 * separate from a page edit, so they can notice and roll back.
 */
export const listRecipeEditEvents = query({
  args: { bearer: v.string(), limit: v.optional(v.number()) },
  returns: v.array(recipeEditRowValidator),
  handler: async (ctx, args) => {
    const auth = await requireRead(ctx, args.bearer);
    const limit = Math.max(1, Math.min(args.limit ?? 200, 1000));
    const rows = await ctx.db
      .query("recipeEditEvents")
      .withIndex("by_account", (q) => q.eq("accountId", auth.accountId))
      .order("desc")
      .take(limit);

    // "affects N pages on next publish" — count the account's active pages once;
    // a recipe-family change rides up on the next publish of any page that uses
    // the family. Active pages are the addressable surface (dead pages are never
    // republished), so they are the meaningful blast radius the human cares about.
    const activePages = await ctx.db
      .query("pages")
      .withIndex("by_account", (q) => q.eq("accountId", auth.accountId))
      .collect();
    const affectedPages = activePages.filter(
      (p: Doc<"pages">) => p.lifecycle === "active",
    ).length;

    return rows.map((r: Doc<"recipeEditEvents">) => ({
      id: r._id,
      family: r.family,
      fromVersion: r.fromVersion,
      toVersion: r.toVersion,
      bodySha: r.bodySha,
      actorTokenId: r.actorTokenId,
      createdAt: r._creationTime,
      affectedPages,
    }));
  },
});

/**
 * listModeration: the abuse/quarantine queue (oversight of the §8 kill path),
 * newest-updated first. The operator watches this to confirm reported/killed
 * objects are handled (and preserved, not deleted).
 */
export const listModeration = query({
  args: { bearer: v.string() },
  returns: v.array(moderationRowValidator),
  handler: async (ctx, args) => {
    const auth = await requireRead(ctx, args.bearer);
    // The moderation table is indexed by page/state, not account; scope by the
    // resolved account in app code (each case carries `accountId`).
    const all = await ctx.db.query("moderation").collect();
    const mine = all
      .filter((m: Doc<"moderation">) => m.accountId === auth.accountId)
      .sort((a, b) => b.updatedAt - a.updatedAt);
    return mine.map((m: Doc<"moderation">) => ({
      id: m._id,
      pageId: m.pageId,
      state: m.state,
      reason: m.reason,
      reporterContact: m.reporterContact,
      ncmecReportId: m.ncmecReportId,
      preservedR2Key: m.preservedR2Key,
      preservationExpiresAt: m.preservationExpiresAt,
      createdAt: m._creationTime,
      updatedAt: m.updatedAt,
    }));
  },
});

/**
 * getAccountPolicy: the operator's current policy toggles. Reads the newest
 * `policy.set` audit entry (the durable store, see module note); when none
 * exists, returns the safe defaults.
 */
export const getAccountPolicy = query({
  args: { bearer: v.string() },
  returns: policyValidator,
  handler: async (ctx, args) => {
    const auth = await requireRead(ctx, args.bearer);
    const rows = await ctx.db
      .query("auditLog")
      .withIndex("by_account", (q) => q.eq("accountId", auth.accountId))
      .order("desc")
      .collect();
    const latest = rows.find(
      (r: Doc<"auditLog">) => r.action === POLICY_ACTION,
    );
    if (!latest) {
      return { ...defaultPolicy(), updatedAt: null };
    }
    const md = (latest.metadata ?? {}) as {
      customDomainNeedsApproval?: unknown;
    };
    return {
      customDomainNeedsApproval:
        typeof md.customDomainNeedsApproval === "boolean"
          ? md.customDomainNeedsApproval
          : defaultPolicy().customDomainNeedsApproval,
      updatedAt: latest._creationTime,
    };
  },
});

/**
 * setAccountPolicy: the ONE mutation in this module. Persists an operator policy
 * toggle as an append-only `policy.set` audit entry (durable + auditable). Only
 * the supplied fields are changed; the rest carry over from the current policy.
 */
export const setAccountPolicy = mutation({
  args: {
    bearer: v.string(),
    customDomainNeedsApproval: v.optional(v.boolean()),
  },
  returns: policyValidator,
  handler: async (ctx, args) => {
    const auth = await requireRead(ctx, args.bearer);

    // Merge over the current effective policy so a partial toggle leaves the
    // other fields untouched.
    const existing = await ctx.db
      .query("auditLog")
      .withIndex("by_account", (q) => q.eq("accountId", auth.accountId))
      .order("desc")
      .collect();
    const latest = existing.find(
      (r: Doc<"auditLog">) => r.action === POLICY_ACTION,
    );
    const current = latest
      ? ((latest.metadata ?? {}) as { customDomainNeedsApproval?: unknown })
      : {};
    const merged = {
      customDomainNeedsApproval:
        args.customDomainNeedsApproval ??
        (typeof current.customDomainNeedsApproval === "boolean"
          ? current.customDomainNeedsApproval
          : defaultPolicy().customDomainNeedsApproval),
    };

    const id = await ctx.db.insert("auditLog", {
      accountId: auth.accountId,
      action: POLICY_ACTION,
      targetId: null,
      actorTokenId: auth.tokenId,
      metadata: merged,
      createdAt: Date.now(),
    });
    const inserted = await ctx.db.get(id);
    return {
      customDomainNeedsApproval: merged.customDomainNeedsApproval,
      updatedAt: inserted?._creationTime ?? Date.now(),
    };
  },
});
