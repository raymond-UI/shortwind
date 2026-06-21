import { v, ConvexError } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { requireDomainsBind, requireRead } from "./lib/auth_guard.js";

/**
 * Custom-domain bind — Cloudflare for SaaS, human-gated (CLOUD-40, PRD §6.1/§7.2/§9).
 *
 * Binding a custom hostname to a page is the productized "bring your own domain"
 * path. Cloudflare for SaaS issues + renews an edge-terminated cert PER hostname,
 * so binding is a two-step dance: create the custom hostname, then wait for the
 * cert to go `pending → active`. Two PRD §9 caveats shape this module:
 *
 *   - cert issuance is RATE-LIMITED → a burst can be rejected; we mark the bind
 *     `queued` and retry with backoff rather than fail the caller.
 *   - hostname state-change webhooks are ENTERPRISE-ONLY → we cannot be pushed
 *     the "cert active" event; we POLL the hostname-details endpoint instead.
 *
 * Two gates sit in front of the Cloudflare call (PRD §7.2):
 *   1. the `domains:bind` SCOPE — a privileged, human-gated grant absent from the
 *      default device-flow token (→ 403 without it). Enforced via
 *      {@link requireDomainsBind}.
 *   2. the account POLICY `customDomainNeedsApproval` — when set, the bind parks
 *      in `pending-human` and NO Cloudflare hostname is created until an operator
 *      approves it. The policy is read from the CLOUD-35 `policy.set` audit entry
 *      (no schema change — same durable-store convention as `dashboard.ts`).
 *
 * The Cloudflare for SaaS API is reached through an INJECTABLE
 * {@link CloudflareSaaSClient} so the action is exercisable offline: tests inject
 * a mock; the REAL HTTP client is wired at deploy (CLOUD-30b/41) via
 * {@link __setCloudflareSaaSClient}. The default client throws `NOT_CONFIGURED`
 * (closed-by-default) so an un-provisioned deployment cannot silently no-op a
 * bind.
 *
 * The state machine (plain data, returned to the caller):
 *
 *   pending-human ──approve──► (queued ⇄ pending-cert) ──► active
 *        │                          │   │                     ▲
 *     (no CF call)            rate-limit polls            cert ready
 *                                    │   │
 *                                    └───┴──► failed (cert failed / max retries)
 *
 *   - `pending-human` — policy gate; awaits operator approval (no CF hostname yet).
 *   - `queued`        — CF returned a rate-limit; the create is retried w/ backoff.
 *   - `pending-cert`  — hostname created; polling the details endpoint for the cert.
 *   - `active`        — cert issued; `pages.customDomain` set, meter incremented.
 *   - `failed`        — cert failed or polling exhausted.
 */

// ---------------------------------------------------------------------------
// Injectable Cloudflare for SaaS client (CLOUD-30b/41 wire the real HTTP impl).
// ---------------------------------------------------------------------------

/** SSL/cert lifecycle for a custom hostname, as reported by the details endpoint. */
export type CustomHostnameCertStatus =
  | "initializing"
  | "pending_validation"
  | "pending_issuance"
  | "active"
  | "failed";

/** The (subset of the) Cloudflare custom-hostname record this module reads. */
export interface CustomHostnameRecord {
  /** Cloudflare's hostname id — the handle the details endpoint is polled by. */
  id: string;
  hostname: string;
  /** The cert/SSL status. `active` ⇒ the edge-terminated cert is live. */
  certStatus: CustomHostnameCertStatus;
}

/** A rate-limited Cloudflare response — the create must be retried after backoff. */
export interface CustomHostnameRateLimited {
  rateLimited: true;
  /** Seconds the caller should back off before retrying (best-effort). */
  retryAfter: number;
}

export type CreateCustomHostnameResult =
  | { rateLimited?: false; record: CustomHostnameRecord }
  | CustomHostnameRateLimited;

/**
 * The Cloudflare for SaaS custom-hostnames API, narrowed to what bind needs.
 * Injectable so the bind action runs offline with a mock; the real HTTP client
 * (auth'd to the CF API with the zone + API token) is wired at deploy.
 */
export interface CloudflareSaaSClient {
  /**
   * Create a custom hostname (POST /zones/{zone}/custom_hostnames). Returns the
   * created record (cert typically `pending_*` initially) OR a rate-limit signal
   * the caller turns into a `queued` state + retry.
   */
  createCustomHostname(hostname: string): Promise<CreateCustomHostnameResult>;
  /**
   * Read a custom hostname's current state (GET …/custom_hostnames/{id}). POLLED
   * for the cert status because state-change webhooks are enterprise-only (§9).
   */
  getCustomHostname(id: string): Promise<CustomHostnameRecord>;
}

/**
 * The default (un-provisioned) client: every call throws `NOT_CONFIGURED`.
 * Closed-by-default so a deployment without the CF wiring cannot quietly drop a
 * bind on the floor. CLOUD-30b/41 replaces this with the live HTTP client.
 */
const defaultClient: CloudflareSaaSClient = {
  createCustomHostname: async () => {
    throw new ConvexError({
      code: "NOT_CONFIGURED",
      message: "Cloudflare for SaaS client is not configured",
    });
  },
  getCustomHostname: async () => {
    throw new ConvexError({
      code: "NOT_CONFIGURED",
      message: "Cloudflare for SaaS client is not configured",
    });
  },
};

let cfClient: CloudflareSaaSClient = defaultClient;

/** Test/deploy seam: inject the Cloudflare for SaaS client (real HTTP at deploy). */
export function __setCloudflareSaaSClient(client: CloudflareSaaSClient): void {
  cfClient = client;
}

/** Restore the closed-by-default (un-provisioned) client. */
export function __resetCloudflareSaaSClient(): void {
  cfClient = defaultClient;
}

// ---------------------------------------------------------------------------
// Backoff/poll tunables. Overridable in tests so the retry/poll loops run with
// zero real delay (the loops themselves — not the timings — are what we assert).
// ---------------------------------------------------------------------------

export interface BindTimings {
  /** Max create attempts before a persistent rate-limit gives up → `queued`. */
  maxCreateRetries: number;
  /** Max detail polls before the cert is declared not-yet-ready. */
  maxCertPolls: number;
  /** Sleep between attempts (ms). 0 in tests; real backoff at deploy. */
  sleepMs: (attempt: number) => number;
}

const defaultTimings: BindTimings = {
  maxCreateRetries: 3,
  maxCertPolls: 5,
  // Exponential backoff (1s, 2s, 4s…) for the real client; capped for sanity.
  sleepMs: (attempt) => Math.min(1000 * 2 ** attempt, 30_000),
};

let timings: BindTimings = defaultTimings;

/** Test seam: override the backoff/poll tunables (sleepMs → 0 in tests). */
export function __setBindTimings(t: BindTimings): void {
  timings = t;
}

/** Restore the production backoff/poll tunables. */
export function __resetBindTimings(): void {
  timings = defaultTimings;
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// State machine — plain data (CLAUDE.md: serializable, no class instances).
// ---------------------------------------------------------------------------

export type DomainBindState =
  | "pending-human"
  | "queued"
  | "pending-cert"
  | "active"
  | "failed";

/** The bind outcome handed back to the HTTP edge + CLI, as plain data. */
export interface DomainBindResult {
  state: DomainBindState;
  hostname: string;
  /** Cloudflare's hostname id once created; null in `pending-human`. */
  cloudflareHostnameId: string | null;
  /** Set only on `active` (the bound page) / context on other states. */
  pageId: string;
  /** Present on `failed` (cert failed / retries exhausted) to explain why. */
  reason?: string;
}

/**
 * The PURE cert-status → terminal classification. Polling reads the CF record's
 * `certStatus`; this maps it to "done" / "still pending" / "failed" with no IO so
 * the poll loop's decision is unit-testable.
 */
export function classifyCertStatus(
  status: CustomHostnameCertStatus,
): "active" | "pending" | "failed" {
  if (status === "active") return "active";
  if (status === "failed") return "failed";
  return "pending";
}

// ---------------------------------------------------------------------------
// Internal queries/mutations (the action has no ctx.db; it delegates these).
// ---------------------------------------------------------------------------

/**
 * Validate the bearer for `domains:bind` AND resolve the bind context: the page
 * (account-scoped — another account's page is reported not-found) and the
 * account's `customDomainNeedsApproval` policy (read from the newest `policy.set`
 * audit entry, the CLOUD-35 durable-store convention; default `true`).
 */
export const authAndContextForBind = internalQuery({
  args: { bearer: v.string(), pageId: v.id("pages") },
  returns: v.object({
    accountId: v.id("accounts"),
    tokenId: v.id("tokens"),
    needsApproval: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const auth = await requireDomainsBind(ctx, args.bearer);
    const page = await ctx.db.get(args.pageId);
    if (!page || page.accountId !== auth.accountId) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Page not found" });
    }
    const needsApproval = await readNeedsApproval(ctx, auth.accountId);
    return {
      accountId: auth.accountId,
      tokenId: auth.tokenId,
      needsApproval,
    };
  },
});

const POLICY_ACTION = "policy.set" as const;

/**
 * Read the effective `customDomainNeedsApproval` policy from the newest
 * `policy.set` audit entry. Mirrors `dashboard.getAccountPolicy`'s read so the
 * two never diverge; defaults to `true` (safe-by-default) when never set.
 */
async function readNeedsApproval(
  ctx: { db: { query: (t: "auditLog") => any } },
  accountId: Id<"accounts">,
): Promise<boolean> {
  const rows = (await ctx.db
    .query("auditLog")
    .withIndex("by_account", (q: any) => q.eq("accountId", accountId))
    .order("desc")
    .collect()) as Doc<"auditLog">[];
  const latest = rows.find((r) => r.action === POLICY_ACTION);
  if (!latest) return true;
  const md = (latest.metadata ?? {}) as { customDomainNeedsApproval?: unknown };
  return typeof md.customDomainNeedsApproval === "boolean"
    ? md.customDomainNeedsApproval
    : true;
}

/** The minimal auth/context for an operator approval (read scope is enough). */
export const authForApprove = internalQuery({
  args: { bearer: v.string(), pageId: v.id("pages") },
  returns: v.object({
    accountId: v.id("accounts"),
    tokenId: v.id("tokens"),
  }),
  handler: async (ctx, args) => {
    const auth = await requireRead(ctx, args.bearer);
    const page = await ctx.db.get(args.pageId);
    if (!page || page.accountId !== auth.accountId) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Page not found" });
    }
    return { accountId: auth.accountId, tokenId: auth.tokenId };
  },
});

/**
 * Record a bind state transition as an append-only `domain.bind` audit entry.
 * Every state the bind passes through (pending-human / queued / pending-cert /
 * active / failed) is auditable. No schema change — same convention as policy.
 */
export const recordBindAudit = internalMutation({
  args: {
    accountId: v.id("accounts"),
    pageId: v.id("pages"),
    actorTokenId: v.union(v.id("tokens"), v.null()),
    hostname: v.string(),
    state: v.string(),
    cloudflareHostnameId: v.union(v.string(), v.null()),
    reason: v.union(v.string(), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("auditLog", {
      accountId: args.accountId,
      action: "domain.bind",
      targetId: args.pageId,
      actorTokenId: args.actorTokenId,
      metadata: {
        hostname: args.hostname,
        state: args.state,
        cloudflareHostnameId: args.cloudflareHostnameId,
        reason: args.reason,
      },
      createdAt: Date.now(),
    });
    return null;
  },
});

/**
 * The ACTIVE commit: bind the hostname onto the page AND emit the custom-domain
 * billing meter increment — atomically. The meter is a simple `domain.meter`
 * audit event here (a counter/event); full metered billing lands in CLOUD-43,
 * which consumes these events. The bind is also audited as `active`.
 */
export const commitDomainActive = internalMutation({
  args: {
    accountId: v.id("accounts"),
    pageId: v.id("pages"),
    actorTokenId: v.union(v.id("tokens"), v.null()),
    hostname: v.string(),
    cloudflareHostnameId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const page = await ctx.db.get(args.pageId);
    if (!page || page.accountId !== args.accountId) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Page not found" });
    }
    const now = Date.now();
    // Bind the hostname onto the page (the worker's custom-hostname resolution
    // reads `by_customDomain`).
    await ctx.db.patch(args.pageId, { customDomain: args.hostname, updatedAt: now });
    // Billing meter increment — a counter/event CLOUD-43's billing rollup reads.
    await ctx.db.insert("auditLog", {
      accountId: args.accountId,
      action: "domain.meter",
      targetId: args.pageId,
      actorTokenId: args.actorTokenId,
      metadata: { hostname: args.hostname, kind: "custom-domain", delta: 1 },
      createdAt: now,
    });
    // The active transition itself, audited.
    await ctx.db.insert("auditLog", {
      accountId: args.accountId,
      action: "domain.bind",
      targetId: args.pageId,
      actorTokenId: args.actorTokenId,
      metadata: {
        hostname: args.hostname,
        state: "active",
        cloudflareHostnameId: args.cloudflareHostnameId,
        reason: null,
      },
      createdAt: now,
    });
    return null;
  },
});

// ---------------------------------------------------------------------------
// The Cloudflare provisioning drive (action-side; uses the injected client).
// ---------------------------------------------------------------------------

type RunnerCtx = {
  runQuery: (ref: any, args: any) => Promise<any>;
  runMutation: (ref: any, args: any) => Promise<any>;
};

/**
 * Create the custom hostname, retrying a rate-limit with backoff. Returns the
 * created record, or `null` when the rate-limit persists past `maxCreateRetries`
 * (the caller parks the bind in `queued`).
 */
async function createWithBackoff(
  hostname: string,
): Promise<CustomHostnameRecord | null> {
  for (let attempt = 0; attempt < timings.maxCreateRetries; attempt++) {
    const result = await cfClient.createCustomHostname(hostname);
    if (!result.rateLimited) return result.record;
    // Rate-limited: back off and retry (the bind is conceptually `queued`).
    await sleep(timings.sleepMs(attempt));
  }
  return null;
}

/**
 * Poll the hostname-details endpoint until the cert is active (webhooks are
 * enterprise-only — §9). Returns `"active"` / `"failed"` once terminal, or
 * `"pending"` if the cert is still not ready after `maxCertPolls` polls (the
 * caller leaves the bind `pending-cert` for a later sweep to finish).
 */
async function pollUntilCert(
  id: string,
): Promise<"active" | "failed" | "pending"> {
  for (let poll = 0; poll < timings.maxCertPolls; poll++) {
    const record = await cfClient.getCustomHostname(id);
    const verdict = classifyCertStatus(record.certStatus);
    if (verdict === "active") return "active";
    if (verdict === "failed") return "failed";
    await sleep(timings.sleepMs(poll));
  }
  return "pending";
}

/**
 * Provision a custom hostname through Cloudflare: create (with rate-limit
 * backoff) → poll the details endpoint for the cert → on active commit the bind
 * + meter. Returns the resulting {@link DomainBindResult}. Pure orchestration
 * over the injected client + the internal mutations; no `ctx.db` (action-side).
 */
async function provision(
  ctx: RunnerCtx,
  args: {
    accountId: Id<"accounts">;
    pageId: Id<"pages">;
    tokenId: Id<"tokens">;
    hostname: string;
  },
): Promise<DomainBindResult> {
  // 1. Create the custom hostname (retry a rate-limit with backoff).
  const record = await createWithBackoff(args.hostname);
  if (record === null) {
    // Persistent rate-limit → queue the bind; a later sweep retries the create.
    await ctx.runMutation(internal.domains.recordBindAudit, {
      accountId: args.accountId,
      pageId: args.pageId,
      actorTokenId: args.tokenId,
      hostname: args.hostname,
      state: "queued",
      cloudflareHostnameId: null,
      reason: "cloudflare cert-issuance rate limit",
    });
    return {
      state: "queued",
      hostname: args.hostname,
      cloudflareHostnameId: null,
      pageId: args.pageId,
      reason: "cloudflare cert-issuance rate limit",
    };
  }

  // 2. Poll the details endpoint for the cert (webhooks enterprise-only — §9).
  const verdict = await pollUntilCert(record.id);

  if (verdict === "failed") {
    await ctx.runMutation(internal.domains.recordBindAudit, {
      accountId: args.accountId,
      pageId: args.pageId,
      actorTokenId: args.tokenId,
      hostname: args.hostname,
      state: "failed",
      cloudflareHostnameId: record.id,
      reason: "cloudflare cert issuance failed",
    });
    return {
      state: "failed",
      hostname: args.hostname,
      cloudflareHostnameId: record.id,
      pageId: args.pageId,
      reason: "cloudflare cert issuance failed",
    };
  }

  if (verdict === "pending") {
    // Cert not yet ready after the poll budget — leave `pending-cert`; the page
    // is NOT bound yet. A later sweep (or a re-bind) finishes the transition.
    await ctx.runMutation(internal.domains.recordBindAudit, {
      accountId: args.accountId,
      pageId: args.pageId,
      actorTokenId: args.tokenId,
      hostname: args.hostname,
      state: "pending-cert",
      cloudflareHostnameId: record.id,
      reason: null,
    });
    return {
      state: "pending-cert",
      hostname: args.hostname,
      cloudflareHostnameId: record.id,
      pageId: args.pageId,
    };
  }

  // 3. Active: bind onto the page + emit the domain billing meter, atomically.
  await ctx.runMutation(internal.domains.commitDomainActive, {
    accountId: args.accountId,
    pageId: args.pageId,
    actorTokenId: args.tokenId,
    hostname: args.hostname,
    cloudflareHostnameId: record.id,
  });
  return {
    state: "active",
    hostname: args.hostname,
    cloudflareHostnameId: record.id,
    pageId: args.pageId,
  };
}

// ---------------------------------------------------------------------------
// Public verbs.
// ---------------------------------------------------------------------------

const bindResultValidator = v.object({
  state: v.union(
    v.literal("pending-human"),
    v.literal("queued"),
    v.literal("pending-cert"),
    v.literal("active"),
    v.literal("failed"),
  ),
  hostname: v.string(),
  cloudflareHostnameId: v.union(v.string(), v.null()),
  pageId: v.string(),
  reason: v.optional(v.string()),
});

/**
 * bindDomain (POST /v1/pages/{id}/domain): bind a custom hostname to a page.
 *
 * - requires the `domains:bind` scope (→ 403 without it).
 * - honors the account policy `customDomainNeedsApproval`: when set, the bind
 *   parks in `pending-human` and NO Cloudflare hostname is created until an
 *   operator calls {@link approveDomain}.
 * - otherwise provisions the hostname through Cloudflare for SaaS: create (with
 *   rate-limit backoff → `queued`), poll the details endpoint for the cert, and
 *   on `active` set `pages.customDomain` + emit the domain billing meter.
 *
 * An ACTION (the Cloudflare calls are network IO); the bearer is validated in an
 * internalQuery (`authAndContextForBind`) since an action has no `ctx.db`.
 */
export const bindDomain = action({
  args: {
    bearer: v.string(),
    pageId: v.id("pages"),
    hostname: v.string(),
  },
  returns: bindResultValidator,
  handler: async (ctx, args): Promise<DomainBindResult> => {
    const hostname = args.hostname.trim().toLowerCase();
    if (!hostname) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "`hostname` is required",
      });
    }

    // Gate 1: scope (domains:bind) + account-scoped page + policy. Throws 403
    // (insufficient_scope) without the privileged grant; 404 for another
    // account's page.
    const ctxInfo = await ctx.runQuery(internal.domains.authAndContextForBind, {
      bearer: args.bearer,
      pageId: args.pageId,
    });

    // Gate 2: human-approval policy. When set, park in `pending-human` WITHOUT
    // calling Cloudflare — the hostname is created only after an operator approves.
    if (ctxInfo.needsApproval) {
      await ctx.runMutation(internal.domains.recordBindAudit, {
        accountId: ctxInfo.accountId,
        pageId: args.pageId,
        actorTokenId: ctxInfo.tokenId,
        hostname,
        state: "pending-human",
        cloudflareHostnameId: null,
        reason: null,
      });
      return {
        state: "pending-human",
        hostname,
        cloudflareHostnameId: null,
        pageId: args.pageId,
      };
    }

    // No approval required → provision immediately through Cloudflare.
    return provision(ctx, {
      accountId: ctxInfo.accountId,
      pageId: args.pageId,
      tokenId: ctxInfo.tokenId,
      hostname,
    });
  },
});

/**
 * approveDomain (operator action): approve a `pending-human` bind and provision
 * the hostname through Cloudflare for SaaS (the same create → poll → active path
 * as a no-approval bind). This is the human gate in PRD §7.2 — an operator
 * unblocks the queued approval, after which the cert is issued and the page is
 * bound. Re-uses the read-scope auth (the operator is acting within the account).
 */
export const approveDomain = action({
  args: {
    bearer: v.string(),
    pageId: v.id("pages"),
    hostname: v.string(),
  },
  returns: bindResultValidator,
  handler: async (ctx, args): Promise<DomainBindResult> => {
    const hostname = args.hostname.trim().toLowerCase();
    if (!hostname) {
      throw new ConvexError({
        code: "BAD_REQUEST",
        message: "`hostname` is required",
      });
    }
    const auth = await ctx.runQuery(internal.domains.authForApprove, {
      bearer: args.bearer,
      pageId: args.pageId,
    });
    return provision(ctx, {
      accountId: auth.accountId,
      pageId: args.pageId,
      tokenId: auth.tokenId,
      hostname,
    });
  },
});
