import { v, ConvexError } from "convex/values";
import { mutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireWrite } from "./lib/auth-guard.js";

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
 * Upsert the page's moderation case to `state`. One case per page (the latest
 * case is the live one); the case is never deleted — its state advances. The
 * sealed-key location lives on the audit entry (the `moderation` schema is owned
 * by CLOUD-00 and carries no key column), so this writes the state + reason +
 * timestamps only.
 */
async function upsertModeration(
  ctx: { db: any },
  args: {
    pageId: Id<"pages">;
    accountId: Id<"accounts">;
    state: ModerationState;
    reason: string | null;
    now: number;
  },
): Promise<void> {
  const existing = await ctx.db
    .query("moderation")
    .withIndex("by_page", (q: any) => q.eq("pageId", args.pageId))
    .first();
  if (existing) {
    await ctx.db.patch(existing._id, {
      state: args.state,
      reason: args.reason ?? existing.reason,
      updatedAt: args.now,
    });
    return;
  }
  await ctx.db.insert("moderation", {
    pageId: args.pageId,
    accountId: args.accountId,
    state: args.state,
    reason: args.reason,
    reporterContact: null,
    ncmecReportId: null,
    preservationExpiresAt: null,
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
  ctx: { db: any },
  args: {
    pageId: Id<"pages">;
    accountId: AccountId;
    tokenId: TokenId | null;
    transition: LifecycleTransition;
    reason: string | null;
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
    await upsertModeration(ctx, {
      pageId: args.pageId,
      accountId: args.accountId,
      state: result.moderationState,
      reason: args.reason,
      now,
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
