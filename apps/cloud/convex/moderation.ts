import { v, ConvexError } from "convex/values";
import { internalMutation, mutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireWrite } from "./lib/auth_guard.js";
import { scheduleRouteEviction, type SchedulerCtx } from "./lib/edge_kv.js";
import {
  scheduleArtifactSeal,
  type SealSchedulerCtx,
} from "./lib/r2_seal.js";
import { scheduleAbuseNotification } from "./lib/abuse_notify.js";

/**
 * CLOUD-32 — abuse intake + fast global kill + CSAM/NCMEC preservation (PRD §8).
 *
 * This module EXTENDS the CLOUD-31 lifecycle state machine above with the legal
 * surface PRD §8 mandates at launch:
 *
 *   reportAbuse  — the reachable, UNAUTHENTICATED intake (anyone can report; the
 *                  monitored endpoint NCMEC reporting flows through). Opens a
 *                  `reported` case; it does NOT pull the page (a human/classifier
 *                  drives the kill).
 *   killPage     — the FAST GLOBAL KILL. In ONE transaction:
 *                    applyLifecycle('quarantine')  → seal R2, lifecycle pulled
 *                    + edge cache purge + KV route evict (via {@link KillEdgePort})
 *                    + persist preservedR2Key (preserve-not-delete, §8.2)
 *                    + for CSAM: preservationExpiresAt = now + 60d, ncmecReportId.
 *                  Same path for phishing/malware (§8.4).
 *
 * Preserve-not-delete is structural: the kill SEALS the object (records its
 * sealed-store key) and pulls the public route; it NEVER hard-deletes. The
 * version rows (the R2 object pointers) are retained for the legal window.
 */

/**
 * Page lifecycle state machine (CLOUD-31, PRD §8.2).
 *
 * Two orthogonal axes the platform must keep distinct:
 *
 *   pages.lifecycle    : "active" | "quarantined" | "tombstoned"
 *   moderation.state   : "reported" | "quarantined" | "preserved" | "cleared"
 *
 * The lifecycle is the page-visible disposition (does it serve? is it gone?);
 * the moderation state is the trust-and-safety CASE attached to a page. CLOUD-31
 * wires the lifecycle transitions a human/operator drives directly:
 *
 *   active → tombstoned          ordinary user "delete" (NOT a hard delete; the
 *                                page record + every version row are RETAINED so
 *                                the page can be audited / restored — PRD §8.2
 *                                "delete means tombstone"). Page no longer serves.
 *
 *   active → quarantined         delete-for-ABUSE. The R2 object is SEALED (moved
 *                                to a sealed store), the case opened, the page
 *                                pulled — but the object is NEVER hard-deleted
 *                                (the law requires preserving reported material).
 *   quarantined → preserved      the case has been actioned and the material is
 *                                held in the sealed store for the legal window.
 *
 *   * → cleared                  a false report: the case is closed. (CLOUD-32's
 *                                abuse-intake/kill path reuses these same pure
 *                                transition functions.)
 *
 * INVARIANT (machine-checked in the tests): a quarantined/preserved object is
 * NEVER hard-deleted, and tombstone ≠ quarantine — they are mutually exclusive
 * lifecycle states reached by distinct transitions.
 *
 * Per CLAUDE.md the DECISION logic is a PURE function over plain data; the thin
 * mutations below are the only IO. CLOUD-32 (abuse intake + global kill path)
 * EXTENDS this module by calling {@link quarantinePage} / {@link clearReport} /
 * the pure {@link transition} — they are left as clean, injectable seams.
 */

// ---------------------------------------------------------------------------
// Pure state machine — no Convex, no IO. Directly unit + integration tested.
// ---------------------------------------------------------------------------

/** The page-visible disposition axis (mirrors `pages.lifecycle`). */
export type Lifecycle = "active" | "quarantined" | "tombstoned";

/** The trust-and-safety case axis (mirrors `moderation.state`). */
export type ModerationState =
  | "reported"
  | "quarantined"
  | "preserved"
  | "cleared";

/** The lifecycle transitions CLOUD-31 supports. */
export type LifecycleTransition =
  | "delete" // active → tombstoned
  | "quarantine" // active → quarantined (abuse; seal, never delete)
  | "preserve" // quarantined → preserved (hold in sealed store)
  | "clear"; // * → cleared (false report; case closed, page restored to active)

/** The mapped target lifecycle + moderation state for a transition. */
export interface TransitionResult {
  /** The next `pages.lifecycle` value. */
  lifecycle: Lifecycle;
  /** The moderation case state this transition records, if it opens/moves one. */
  moderationState: ModerationState | null;
  /** Whether this transition seals (preserves) the R2 object. NEVER deletes. */
  seals: boolean;
  /** Whether this transition hard-deletes the object. ALWAYS false (invariant). */
  hardDeletes: false;
  /** The audit verb written for this transition. */
  auditAction: string;
}

/** A transition the state machine rejects (illegal source state). */
export interface TransitionError {
  ok: false;
  reason: string;
}

/**
 * The PURE transition function: given the current lifecycle and the requested
 * transition, decide the next lifecycle + moderation state, or reject.
 *
 * Mutual exclusivity is structural — a page is in exactly ONE lifecycle state,
 * and each transition names exactly one target. There is no transition that
 * hard-deletes; `hardDeletes` is a compile-time `false` on every branch so the
 * preserve-not-delete invariant cannot regress unnoticed.
 */
export function transition(
  current: Lifecycle,
  t: LifecycleTransition,
): { ok: true; result: TransitionResult } | TransitionError {
  switch (t) {
    case "delete":
      // Ordinary delete: only an active page tombstones. A quarantined page is
      // a live abuse case and must NOT be silently tombstoned over.
      if (current !== "active") {
        return {
          ok: false,
          reason: `cannot delete a ${current} page (only active pages tombstone)`,
        };
      }
      return {
        ok: true,
        result: {
          lifecycle: "tombstoned",
          moderationState: null,
          seals: false,
          hardDeletes: false,
          auditAction: "page.delete",
        },
      };

    case "quarantine":
      // Delete-for-abuse: an active page is pulled and its object SEALED.
      if (current !== "active") {
        return {
          ok: false,
          reason: `cannot quarantine a ${current} page (only active pages quarantine)`,
        };
      }
      return {
        ok: true,
        result: {
          lifecycle: "quarantined",
          moderationState: "quarantined",
          seals: true,
          hardDeletes: false,
          auditAction: "page.quarantine",
        },
      };

    case "preserve":
      // A quarantined case is held in the sealed store for the legal window.
      if (current !== "quarantined") {
        return {
          ok: false,
          reason: `cannot preserve a ${current} page (only quarantined pages preserve)`,
        };
      }
      return {
        ok: true,
        result: {
          // Lifecycle stays quarantined (the page is still pulled); the
          // moderation case advances to preserved. The object remains sealed.
          lifecycle: "quarantined",
          moderationState: "preserved",
          seals: true,
          hardDeletes: false,
          auditAction: "page.preserve",
        },
      };

    case "clear":
      // A false report: close the case and restore the page to active. Valid
      // from any non-tombstoned state (a tombstoned page is intentionally gone).
      if (current === "tombstoned") {
        return {
          ok: false,
          reason: "cannot clear a tombstoned page (delete is not a moderation case)",
        };
      }
      return {
        ok: true,
        result: {
          lifecycle: "active",
          moderationState: "cleared",
          seals: false,
          hardDeletes: false,
          auditAction: "page.moderation.clear",
        },
      };
  }
}

/**
 * The canonical sealed-store key for a quarantined R2 object. The live artifact
 * at `artifactKey` is MOVED here (sealed); the original key stops serving. Pure
 * so the seal target is deterministic + testable. Real object-move wired at
 * deploy (CLOUD-30/-32) via the storage/edge port — until then the mutation
 * records this key so the sealed location is auditable.
 */
export function sealedKey(artifactKey: string): string {
  return `quarantine/${artifactKey}`;
}

// ---------------------------------------------------------------------------
// Thin mutations — the only IO. Each transition writes an `auditLog` entry.
// ---------------------------------------------------------------------------

/** A guarded `ConvexError` for an illegal lifecycle transition (400 family). */
function transitionError(reason: string): ConvexError<{
  code: "INVALID_TRANSITION";
  message: string;
}> {
  return new ConvexError({ code: "INVALID_TRANSITION", message: reason });
}

const lifecycleValidator = v.union(
  v.literal("active"),
  v.literal("quarantined"),
  v.literal("tombstoned"),
);

/** The current version's R2 artifact key for a page, or null if unpublished. */
async function currentArtifactKey(
  ctx: { db: any },
  pageId: Id<"pages">,
): Promise<string | null> {
  const page = await ctx.db.get(pageId);
  const versionId = page?.currentVersionId ?? null;
  if (!versionId) return null;
  const version = await ctx.db.get(versionId);
  return version?.artifactKey ?? null;
}

/**
 * The CLOUD-32 legal-preservation fields a kill/report may set on the case. Each
 * is optional in the patch sense: `undefined` leaves an existing value untouched
 * (so a `kill` after a `report` keeps the reporter contact), while an explicit
 * value (including `null`) is written. The sealed-store key + the NCMEC report id
 * + the 60-day preservation clock all live HERE on the case now (CLOUD-31
 * recorded the sealed key on auditLog.metadata as a workaround).
 */
interface ModerationCaseFields {
  reporterContact?: string | null;
  ncmecReportId?: string | null;
  preservedR2Key?: string | null;
  preservationExpiresAt?: number | null;
}

/**
 * Upsert the page's moderation case to `state`. One case per page (the latest
 * case is the live one); the case is never deleted — its state advances. Writes
 * the state + reason + timestamps, plus any provided CLOUD-32 legal fields
 * (reporter contact, sealed key, NCMEC report id, preservation clock).
 */
async function upsertModeration(
  ctx: { db: any },
  args: {
    pageId: Id<"pages">;
    accountId: Id<"accounts">;
    state: ModerationState;
    reason: string | null;
    now: number;
  } & ModerationCaseFields,
): Promise<void> {
  // Only fields explicitly present in `args` are written; `undefined` ⇒ leave as-is.
  const caseFields: Record<string, unknown> = {};
  if (args.reporterContact !== undefined)
    caseFields.reporterContact = args.reporterContact;
  if (args.ncmecReportId !== undefined)
    caseFields.ncmecReportId = args.ncmecReportId;
  if (args.preservedR2Key !== undefined)
    caseFields.preservedR2Key = args.preservedR2Key;
  if (args.preservationExpiresAt !== undefined)
    caseFields.preservationExpiresAt = args.preservationExpiresAt;

  const existing = await ctx.db
    .query("moderation")
    .withIndex("by_page", (q: any) => q.eq("pageId", args.pageId))
    .first();
  if (existing) {
    await ctx.db.patch(existing._id, {
      state: args.state,
      reason: args.reason ?? existing.reason,
      updatedAt: args.now,
      ...caseFields,
    });
    return;
  }
  await ctx.db.insert("moderation", {
    pageId: args.pageId,
    accountId: args.accountId,
    state: args.state,
    reason: args.reason,
    reporterContact: args.reporterContact ?? null,
    ncmecReportId: args.ncmecReportId ?? null,
    preservedR2Key: args.preservedR2Key ?? null,
    preservationExpiresAt: args.preservationExpiresAt ?? null,
    createdAt: args.now,
    updatedAt: args.now,
  });
}

// ---------------------------------------------------------------------------
// Public moderation verbs (operator-driven). CLOUD-32 extends with intake.
// ---------------------------------------------------------------------------

type AccountId = Id<"accounts">;
type TokenId = Id<"tokens">;

/**
 * quarantinePage — delete-for-abuse. requireWrite → active → quarantined; the
 * R2 object is sealed (key recorded), the moderation case opened, audited. The
 * object is preserved, never hard-deleted. (CLOUD-32's kill path is this plus
 * the edge purge + the real object move.)
 */
export const quarantinePage = mutation({
  args: {
    bearer: v.string(),
    id: v.id("pages"),
    reason: v.optional(v.string()),
  },
  returns: v.object({
    lifecycle: lifecycleValidator,
    sealedKey: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    const auth = await requireWrite(ctx, args.bearer);
    return applyLifecycle(ctx, {
      pageId: args.id,
      accountId: auth.accountId,
      tokenId: auth.tokenId,
      transition: "quarantine",
      reason: args.reason ?? null,
    });
  },
});

/**
 * preservePage — advance a quarantined case to preserved (held in the sealed
 * store for the legal window). requireWrite, audited, object still sealed.
 */
export const preservePage = mutation({
  args: {
    bearer: v.string(),
    id: v.id("pages"),
    reason: v.optional(v.string()),
  },
  returns: v.object({
    lifecycle: lifecycleValidator,
    sealedKey: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    const auth = await requireWrite(ctx, args.bearer);
    return applyLifecycle(ctx, {
      pageId: args.id,
      accountId: auth.accountId,
      tokenId: auth.tokenId,
      transition: "preserve",
      reason: args.reason ?? null,
    });
  },
});

/**
 * clearReport — close a false report and restore the page to active. The
 * preserved object is left in the sealed store (nothing is ever deleted by the
 * lifecycle); only the lifecycle + case state change.
 */
export const clearReport = mutation({
  args: {
    bearer: v.string(),
    id: v.id("pages"),
    reason: v.optional(v.string()),
  },
  returns: v.object({
    lifecycle: lifecycleValidator,
    sealedKey: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    const auth = await requireWrite(ctx, args.bearer);
    return applyLifecycle(ctx, {
      pageId: args.id,
      accountId: auth.accountId,
      tokenId: auth.tokenId,
      transition: "clear",
      reason: args.reason ?? null,
    });
  },
});

/**
 * The shared mutation body for the lifecycle verbs — resolves the page, runs the
 * pure {@link transition}, patches the lifecycle, upserts the moderation case on
 * a sealing/clearing transition, and audits. Inlined (rather than delegating to
 * the internalMutation) so the public mutations commit in one transaction.
 *
 * Exported as the seam CLOUD-32's kill path drives.
 */
export async function applyLifecycle(
  ctx: { db: any; scheduler?: SealSchedulerCtx["scheduler"] },
  args: {
    pageId: Id<"pages">;
    accountId: AccountId;
    tokenId: TokenId | null;
    transition: LifecycleTransition;
    reason: string | null;
    /**
     * Extra legal-preservation fields to record on the moderation case (CLOUD-32
     * kill path): reporter contact, NCMEC report id, the 60-day clock. Applied on
     * the same upsert so the case lands in one transaction. The sealed key is set
     * automatically by the sealing transition and need not be passed here.
     */
    caseFields?: ModerationCaseFields;
  },
): Promise<{ lifecycle: Lifecycle; sealedKey: string | null }> {
  const page = await ctx.db.get(args.pageId);
  if (!page || page.accountId !== args.accountId) {
    throw transitionError("page not found");
  }

  const decided = transition(page.lifecycle as Lifecycle, args.transition);
  if (!decided.ok) {
    throw transitionError(decided.reason);
  }
  const result = decided.result;
  const now = Date.now();

  if (page.lifecycle !== result.lifecycle) {
    await ctx.db.patch(args.pageId, {
      lifecycle: result.lifecycle,
      updatedAt: now,
    });
  }

  let sealed: string | null = null;
  if (result.moderationState !== null) {
    const liveKey = await currentArtifactKey(ctx, args.pageId);
    sealed = result.seals && liveKey ? sealedKey(liveKey) : null;
    // #198 item 4: actually MOVE the R2 object to the sealed prefix (copy →
    // delete-original), preserving the material while removing it from its live
    // key. The S3 calls are a `fetch`, so we SCHEDULE the seal to run in an
    // action right after this mutation commits (a mutation cannot fetch), exactly
    // like the KV eviction. Fail-safe: the scheduled action swallows errors; the
    // recorded `preservedR2Key` + lifecycle=quarantined stay the source of truth.
    if (result.seals && liveKey && sealed && ctx.scheduler) {
      await scheduleArtifactSeal(ctx as SealSchedulerCtx, liveKey, sealed);
    }
    await upsertModeration(ctx, {
      pageId: args.pageId,
      accountId: args.accountId,
      state: result.moderationState,
      reason: args.reason,
      now,
      // Persist the sealed-store location ON the case (preserve-not-delete). A
      // sealing transition records the key; a clearing one resets it to null.
      ...(result.seals
        ? { preservedR2Key: sealed }
        : result.moderationState === "cleared"
          ? { preservedR2Key: null }
          : {}),
      ...args.caseFields,
    });
  }

  await ctx.db.insert("auditLog", {
    accountId: args.accountId,
    action: result.auditAction,
    targetId: args.pageId,
    actorTokenId: args.tokenId,
    metadata: {
      from: page.lifecycle,
      to: result.lifecycle,
      moderationState: result.moderationState,
      sealedR2Key: sealed,
      reason: args.reason,
    },
    createdAt: now,
  });

  return { lifecycle: result.lifecycle, sealedKey: sealed };
}

// ===========================================================================
// CLOUD-32 — abuse intake + fast global kill + CSAM/NCMEC preservation.
// ===========================================================================

/**
 * The legally-mandated preservation window for reported CSAM material: 60 days
 * (18 U.S.C. § 2258A / the REPORT Act — report ASAP and no later than 60 days,
 * preserve the material + related data). A CSAM kill stamps
 * `preservationExpiresAt = now + PRESERVATION_WINDOW_MS`; a sweep (CLOUD-30b/-33)
 * holds the sealed object until then.
 */
export const PRESERVATION_WINDOW_MS = 60 * 24 * 60 * 60 * 1000;

/**
 * Abuse categories the intake + kill path accept. `csam` is the legally-special
 * one (drives the 60-day preservation clock + NCMEC report id); `phishing` /
 * `malware` (PRD §8.4) ride the SAME kill path; `other` covers the rest.
 */
export type AbuseCategory = "csam" | "phishing" | "malware" | "other";

const abuseCategoryValidator = v.union(
  v.literal("csam"),
  v.literal("phishing"),
  v.literal("malware"),
  v.literal("other"),
);

// ---------------------------------------------------------------------------
// Kill edge port (PRD §8.2 fast global kill). The kill purges the edge cache +
// evicts the KV route through this injectable seam so the pulled page stops
// resolving on the hot path "in seconds". The production port is wired for real
// at deploy (CLOUD-30b: Cloudflare cache purge + KV delete); offline it is a
// no-op. `__setKillEdgePort` exists ONLY so the integration tests can assert the
// edge effects fired. This mirrors pages.ts's `LifecycleEdgePort` but lives here
// (and is NOT imported from pages.ts) so the dependency direction stays one-way:
// pages.ts imports `applyLifecycle` from this module, never the reverse.
// ---------------------------------------------------------------------------

/** The edge effects the fast global kill drives. */
export interface KillEdgePort {
  /** Purge the edge cache for the page URL so the artifact stops being served. */
  invalidate(url: string): Promise<void>;
  /**
   * Evict the KV route so the killed page stops resolving on the edge. The
   * optional `ctx` carries the kill mutation's scheduler — the production port
   * schedules the KV `fetch` to run in an action (a mutation cannot fetch). The
   * test port ignores it (a 1-arg `evictRoute(route)` is assignable here).
   */
  evictRoute(
    args: { pageId: string; slug: string; subdomain?: string | null },
    ctx?: SchedulerCtx,
  ): Promise<void>;
}

/**
 * The production kill edge port (CLOUD-30b). `evictRoute` deletes the ROUTES KV
 * entry the page serves under, via the Cloudflare KV REST API, so a killed page
 * stops resolving on the hot path "in seconds" (PRD §8.2) rather than after the
 * 1h route TTL. Fail-safe: a KV error is logged + swallowed inside
 * `evictRouteForPage`, so a Cloudflare failure never breaks the DB-level kill
 * (the quarantine + find-exclusion remain the source of truth). `invalidate`
 * (edge-cache purge) is left a no-op for now — the KV eviction is the critical
 * path since serve resolves via KV → cold source, and a cold re-resolve already
 * reflects the new lifecycle. The shared `lib/edge_kv` re-derives the route key
 * to match worker/src/kv.ts (Convex never imports the Worker — CLAUDE.md).
 */
const defaultKillEdgePort: KillEdgePort = {
  invalidate: async () => {},
  evictRoute: async ({ slug, subdomain }, ctx) => {
    // A mutation cannot `fetch`; schedule the KV REST delete to run in an action
    // the instant `killPage` commits. No scheduler (shouldn't happen in prod) →
    // skip. Fail-safe: the scheduled action swallows + logs any Cloudflare error.
    // CLOUD-SUBDOMAIN: thread the subdomain so the per-page subdomain KV key —
    // the only key serving is keyed on now — is evicted.
    if (ctx === undefined) return;
    await scheduleRouteEviction(ctx, slug, subdomain ?? null);
  },
};

let killEdgePort: KillEdgePort = defaultKillEdgePort;

/** Test-only: override the kill edge port to assert it was driven. */
export function __setKillEdgePort(port: KillEdgePort): void {
  killEdgePort = port;
}

/** Test-only: restore the default (no-op) kill edge port. */
export function __resetKillEdgePort(): void {
  killEdgePort = defaultKillEdgePort;
}

/** Minimal ambient `process` — this workspace types against workers-types. */
declare const process: { env: Record<string, string | undefined> };

/** The platform origin pages serve under (mirrors pages.ts `pageBaseUrl`). */
function killBaseUrl(): string {
  // CLOUD-30b reads the public origin from env; the fallback keeps the purge URL
  // well-formed in dev/test. Audit #3: user content serves from `shortwind.app`.
  return process.env.PAGES_BASE_URL ?? "https://shortwind.app";
}

/** The public URL the kill purges from the edge cache. */
function publicUrl(slug: string): string {
  return `${killBaseUrl().replace(/\/+$/, "")}/${slug}`;
}

// ---------------------------------------------------------------------------
// CONTENT HASH-MATCHING SEAM (PRD §8.2 "proactive hash-matching").
//
// CLOUD-33 wires the real known-CSAM hash-list match on the PUBLISH path and
// calls killPage on a hit (moving us from reactive/actual-knowledge-only to a
// proactive posture). The seam is intentionally left here, documented, with no
// behavior: CLOUD-33 owns the hash-list integration + the publish-time hook.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Public verbs.
// ---------------------------------------------------------------------------

/**
 * reportAbuse — the reachable abuse-report intake (PRD §8.2). UNAUTHENTICATED:
 * anyone can report (this is the monitored endpoint NCMEC reporting flows
 * through). Opens (or refreshes) a `reported` moderation case; it does NOT pull
 * the page — an operator/classifier drives the kill. Idempotent-ish: a second
 * report on the same page refreshes the single case rather than duplicating.
 */
export const reportAbuse = mutation({
  args: {
    pageId: v.id("pages"),
    reporterContact: v.union(v.string(), v.null()),
    reason: v.string(),
    category: abuseCategoryValidator,
  },
  returns: v.object({
    state: v.literal("reported"),
  }),
  handler: async (ctx, args) => {
    const page = await ctx.db.get(args.pageId);
    if (!page) {
      // SECURITY (audit #158): do NOT leak page existence. A public intake that
      // 404s on an unknown page is an enumeration oracle (probe which page ids
      // exist). Instead, accept the report uniformly and no-op — the caller can't
      // distinguish "reported a real page" from "reported a non-existent one".
      return { state: "reported" as const };
    }
    const now = Date.now();
    await upsertModeration(ctx, {
      pageId: args.pageId,
      accountId: page.accountId,
      state: "reported",
      reason: `[${args.category}] ${args.reason}`,
      now,
      reporterContact: args.reporterContact,
    });
    await ctx.db.insert("auditLog", {
      accountId: page.accountId,
      action: "page.abuse.report",
      targetId: args.pageId,
      actorTokenId: null,
      metadata: {
        category: args.category,
        reason: args.reason,
        reporterContact: args.reporterContact,
      },
      createdAt: now,
    });
    // #198 item 3: notify the monitored endpoint (webhook) out-of-band so the
    // report is actually triaged, not just parked in the table. Scheduled to run
    // in an action after commit (mutation can't fetch); fail-safe; no reporter PII.
    await scheduleAbuseNotification(ctx, {
      pageId: args.pageId,
      accountId: page.accountId,
      category: args.category,
      reason: args.reason,
    });
    return { state: "reported" as const };
  },
});

/**
 * killPage — the FAST GLOBAL KILL (PRD §8.2/§8.4). requireWrite (operator/admin
 * token). In ONE transaction:
 *   - applyLifecycle('quarantine'): active → quarantined, R2 object SEALED
 *     (sealed-store key recorded), NEVER hard-deleted;
 *   - persist preservedR2Key on the case (preserve-not-delete);
 *   - for `csam`: stamp preservationExpiresAt = now + 60 days + record
 *     ncmecReportId;
 *   - purge the edge cache + evict the KV route so the page stops serving;
 *   - audit (via applyLifecycle).
 * phishing/malware ride the identical path (just no NCMEC clock).
 */
export const killPage = mutation({
  args: {
    bearer: v.string(),
    pageId: v.id("pages"),
    reason: v.string(),
    category: abuseCategoryValidator,
    ncmecReportId: v.optional(v.string()),
  },
  returns: v.object({
    lifecycle: lifecycleValidator,
    preservedR2Key: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    const auth = await requireWrite(ctx, args.bearer);
    const page = await ctx.db.get(args.pageId);
    if (!page || page.accountId !== auth.accountId) {
      // Account-scoped not-found (no existence leak): mirror pages.deletePage.
      throw new ConvexError({ code: "NOT_FOUND", message: "Page not found" });
    }

    const isCsam = args.category === "csam";
    // SECURITY/LEGAL (audit #158): a CSAM kill must carry its NCMEC CyberTipline
    // report id so the preserved evidence is tied to a filed report (18 U.S.C.
    // §2258A). Require it rather than recording a dangling preservation clock with
    // no report reference.
    if (isCsam && !args.ncmecReportId) {
      throw new ConvexError({
        code: "INVALID_ARGUMENT",
        message: "ncmecReportId is required for a CSAM kill",
      });
    }
    const now = Date.now();

    // active → quarantined: seal the object + open/advance the case + persist the
    // legal fields, all in this transaction (preserve-not-delete enforced inside).
    const outcome = await applyLifecycle(ctx, {
      pageId: args.pageId,
      accountId: auth.accountId,
      tokenId: auth.tokenId,
      transition: "quarantine",
      reason: `[${args.category}] ${args.reason}`,
      caseFields: {
        // CSAM: the 60-day preservation clock + the NCMEC CyberTipline report id.
        ncmecReportId: args.ncmecReportId ?? (isCsam ? null : undefined),
        preservationExpiresAt: isCsam ? now + PRESERVATION_WINDOW_MS : undefined,
      },
    });

    // Fast global kill: purge the edge cache + evict the KV route so the pulled
    // page stops resolving on the hot path. One object, one cache key (PRD §8.2).
    await killEdgePort.invalidate(publicUrl(page.slug));
    await killEdgePort.evictRoute(
      { pageId: args.pageId, slug: page.slug, subdomain: page.subdomain ?? null },
      ctx,
    );

    return {
      lifecycle: outcome.lifecycle,
      preservedR2Key: outcome.sealedKey,
    };
  },
});

/**
 * #198 item 2 — stamp the NCMEC CyberTipline report id on a page's moderation
 * case after a successful auto-submission. internalMutation (called only by the
 * scheduled `submitCyberTipReportAction`); it patches the existing case, leaving
 * the preservation clock + lifecycle untouched.
 */
export const stampNcmecReportId = internalMutation({
  args: { pageId: v.id("pages"), ncmecReportId: v.string() },
  returns: v.object({ stamped: v.boolean() }),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("moderation")
      .withIndex("by_page", (q) => q.eq("pageId", args.pageId))
      .first();
    if (!existing) return { stamped: false };
    await ctx.db.patch(existing._id, {
      ncmecReportId: args.ncmecReportId,
      updatedAt: Date.now(),
    });
    return { stamped: true };
  },
});

// ===========================================================================
// CLOUD-33 — preservation-window sweep (audit #158, PRD §8.2 / 18 U.S.C. §2258A).
//
// A CSAM kill stamps `preservationExpiresAt = now + 60d` on the case, but nothing
// read that clock — the legal hold was inert. `sweepPreservation` (ticked hourly
// by crons.ts) ranges cases whose window has ELAPSED and records a
// `moderation.preservation.window_elapsed` audit event so an operator can action
// the now-permitted cleanup of the sealed object.
//
// DELIBERATELY conservative: it NEVER auto-deletes the sealed evidence (purging
// reported CSAM via an unattended cron is legally hazardous). It clears the case's
// `preservationExpiresAt` so the same case isn't re-audited each hour; the audit
// log retains the full history (pageId, ncmecReportId, sealed key, when it
// elapsed). Actual sealed-object purge stays an explicit, operator-confirmed step.
// ===========================================================================

/** Audit + clear cases whose legal preservation window has elapsed. Returns count. */
export const sweepPreservation = internalMutation({
  args: { now: v.optional(v.number()) },
  returns: v.object({ elapsed: v.number() }),
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    // Range cases with a due preservation clock (gt(null) excludes the unset/null
    // rows that sort before all numbers; lte(now) bounds to elapsed windows).
    const due = await ctx.db
      .query("moderation")
      .withIndex("by_preservation", (q) =>
        q.gt("preservationExpiresAt", null).lte("preservationExpiresAt", now),
      )
      .collect();

    let elapsed = 0;
    for (const c of due) {
      await ctx.db.insert("auditLog", {
        accountId: c.accountId,
        action: "moderation.preservation.window_elapsed",
        targetId: c.pageId,
        actorTokenId: null,
        metadata: {
          moderationId: c._id,
          ncmecReportId: c.ncmecReportId,
          preservedR2Key: c.preservedR2Key,
          preservationExpiredAt: c.preservationExpiresAt,
        },
        createdAt: now,
      });
      // Clear the clock so the elapsed case isn't picked up again next sweep. The
      // sealed object + case are RETAINED (preserve-not-delete); only the mandatory
      // hold marker is satisfied. Operator-driven purge is a separate step.
      await ctx.db.patch(c._id, { preservationExpiresAt: null, updatedAt: now });
      elapsed += 1;
    }
    return { elapsed };
  },
});
