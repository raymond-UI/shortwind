import { v } from "convex/values";
import { query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { requireRead } from "./lib/auth_guard.js";

/**
 * Metered billing usage (CLOUD-43, PRD §6.4 / §11).
 *
 * The cost shape, restated from the PRD: serving a page is essentially free —
 * a viral page with a million views costs ~nothing. What costs money is the
 * work and the footprint a publish creates: each PUBLISH (an expand + a frozen
 * R2 artifact), each CUSTOM DOMAIN (a Cloudflare-for-SaaS hostname + cert), and
 * the STORAGE those frozen artifacts occupy. So the meter is aligned to *those*
 * three quantities, NOT to page views. The headline invariant (PRD §6.4) is:
 *
 *     serving a page (no new version) adds ZERO to every meter.
 *
 * This module is deliberately ADDITIVE and READ-ONLY. It does not touch the
 * publish path (`pages.ts`), the domain-bind path (`domains.ts`) or the schema.
 * Every meter is DERIVED by querying tables those paths already write:
 *
 *   - publishes      = COUNT of this account's `pageVersions` rows. A publish is
 *                      exactly one new immutable version row (PRD §5.6); a serve
 *                      writes no version, so it cannot move this number.
 *   - customDomains  = COUNT of `domain.meter` audit events (CLOUD-40 emits one
 *                      per custom-domain activation). Append-only and emitted only
 *                      on a bind, never on a serve.
 *   - storageBytes   = SUM over the account's `pageVersions` of each frozen
 *                      artifact's byte size. The schema (owned elsewhere, not
 *                      editable here) persists no size column, so the size is
 *                      derived deterministically per version from the immutable
 *                      identifiers already on the row (see {@link artifactBytes}).
 *                      A real R2 HEAD on the `artifactKey` supersedes this proxy
 *                      once CLOUD-30 wires live R2; until then the derivation is
 *                      stable + golden-testable and, crucially, still moves only
 *                      when a new version row exists — i.e. on publish, not serve.
 *
 * Auth + scoping mirror `dashboard.ts`: every meter routes through `requireRead`
 * (the dashboard's read-scoped operator bearer) and is filtered to the resolved
 * `auth.accountId`, so there is no cross-account leakage — the same invariant
 * `pages.find` / the oversight queries rely on. `pageVersions` is indexed only
 * `by_page` (no account index), so — exactly like `dashboard.listModeration` —
 * we collect and filter by `accountId` in app code.
 *
 * Offline-codegen note: like `dashboard.ts` (CLOUD-35) this module is declared by
 * hand in `_generated/api.d.ts` (additive) because `convex dev` cannot run here
 * (no CONVEX_DEPLOYMENT). A real `convex dev` regenerates that file and
 * supersedes the edit.
 */

/** The custom-domain meter event CLOUD-40 emits on each hostname activation. */
const DOMAIN_METER_ACTION = "domain.meter" as const;

/**
 * The serializable usage shape the dashboard renders. Three meters + the period
 * they were measured over. The meters are lifetime-cumulative counts derived
 * from append-only tables; a real billing run would pass an explicit window —
 * modelled here (`periodStart`/`periodEnd`), not wired to a live invoice.
 */
const usageValidator = v.object({
  /** Count of frozen versions ever published by this account (one per publish). */
  publishes: v.number(),
  /** Count of custom-domain activations metered for this account. */
  customDomains: v.number(),
  /** Sum of the frozen artifacts' byte sizes (storage footprint). */
  storageBytes: v.number(),
  /** Lower bound (epoch ms) of the measured window; null ⇒ since account start. */
  periodStart: v.union(v.number(), v.null()),
  /** Upper bound (epoch ms) of the measured window: when this was computed. */
  periodEnd: v.number(),
});

/**
 * Deterministic per-version storage size, in bytes.
 *
 * The frozen artifact for a version lives in R2 at `artifactKey`; its true size
 * is the byte length of the expanded HTML. The schema persists no size column
 * (and it is not editable from this issue), so until a live R2 HEAD is wired
 * (CLOUD-30) we derive a STABLE size from the version's own immutable, content-
 * addressed identifiers. This is a proxy — not the exact on-disk size — but it
 * is deterministic (same version row ⇒ same bytes), strictly positive, and
 * monotonic in the number of versions, which is all the meter needs to satisfy
 * the §6.4 invariant: it can only grow when a NEW version row exists (a publish),
 * never on a serve. When R2 is live this function is the single place to repoint
 * at the real object size.
 */
export function artifactBytes(version: {
  artifactKey: string;
  expandedHash: string;
  sourceHash: string;
}): number {
  // The expanded HTML is content-addressed by `expandedHash` and stored at
  // `artifactKey`; both, plus `sourceHash`, are fixed for the life of the frozen
  // version. Their combined UTF-8 length is a deterministic, positive proxy for
  // the artifact footprint. (A real R2 HEAD returns the exact Content-Length.)
  const fingerprint = `${version.artifactKey}\n${version.expandedHash}\n${version.sourceHash}`;
  return new TextEncoder().encode(fingerprint).byteLength;
}

/**
 * getUsage: the three metered quantities for the current period, account-scoped.
 *
 * Pure read: every number is derived from tables the publish / bind paths already
 * write, so this stays additive and cannot perturb them. Serving a page touches
 * none of those tables, so a viral page adds ZERO to all three meters (the §6.4
 * invariant, asserted in billing.test.ts).
 */
export const getUsage = query({
  args: { bearer: v.string() },
  returns: usageValidator,
  handler: async (ctx, args) => {
    const auth = await requireRead(ctx, args.bearer);

    // publishes + storageBytes — derived from the account's frozen versions.
    // `pageVersions` carries `accountId` on every row but is indexed only
    // `by_page`, so (mirroring `dashboard.listModeration`) we filter in app code.
    const allVersions = await ctx.db.query("pageVersions").collect();
    const versions = allVersions.filter(
      (r: Doc<"pageVersions">) => r.accountId === auth.accountId,
    );

    const publishes = versions.length;
    const storageBytes = versions.reduce(
      (sum: number, r: Doc<"pageVersions">) => sum + artifactBytes(r),
      0,
    );

    // customDomains — count the account's `domain.meter` activation events
    // (CLOUD-40). Append-only and emitted only on a bind, never on a serve.
    const auditRows = await ctx.db
      .query("auditLog")
      .withIndex("by_account", (q) => q.eq("accountId", auth.accountId))
      .collect();
    const customDomains = auditRows.filter(
      (r: Doc<"auditLog">) => r.action === DOMAIN_METER_ACTION,
    ).length;

    return {
      publishes,
      customDomains,
      storageBytes,
      periodStart: null,
      periodEnd: Date.now(),
    };
  },
});
