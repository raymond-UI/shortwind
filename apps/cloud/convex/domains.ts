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
import { requireDomainsBind } from "./lib/auth_guard.js";
import { requireReadOperator } from "./lib/operator_auth.js";
import { resolvePlan } from "./lib/plan_resolver.js";
import { withinCustomDomainQuota } from "./lib/billing_limits.js";

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
 * Three gates sit in front of the Cloudflare call (PRD §7.2 + §8.4):
 *   1. the `domains:bind` SCOPE — a privileged, human-gated grant absent from the
 *      default device-flow token (→ 403 without it). Enforced via
 *      {@link requireDomainsBind}.
 *   1b. plan ENTITLEMENT — a custom domain requires a paid plan (the
 *      card-before-custom-domain anti-phishing lever, PRD §8.4). `free` has a
 *      domain quota of 0, so the bind is rejected (NOT_ENTITLED) before any
 *      Cloudflare hostname exists. The plan is resolved through the injectable
 *      {@link resolvePlan} seam and the quota checked with
 *      {@link withinCustomDomainQuota}.
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

// ===========================================================================
// ACCOUNT-LEVEL custom domains (the ONLY custom-domain model; the per-page
// bind was removed).
//
// A domain is an alias of the ACCOUNT: bind one subdomain you own
// (`pages.abc.com`) and EVERY page is reachable at `<hostname>/<slug>` (path-
// routed by serve.resolveAccountDomainRoute), alongside its
// `<subdomain>.shortwind.app` vanity URL. One Cloudflare-for-SaaS cert per
// hostname (not per page). Same scope + approval + entitlement gates as the
// per-page bind; the difference is the subject (account, no `pageId`) and that
// the hostname must be a subdomain (not a bare apex).
// ===========================================================================

/** Reserved apexes the platform serves from — an account cannot bind these. */
const RESERVED_APEXES = ["shortwind.app", "shortwind.dev"] as const;
/** One DNS label: 1–63 chars, alnum, internal hyphens allowed. */
const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Validate a bindable custom domain. Subdomain-ONLY (product decision): a bare
 * apex (`abc.com`, 2 labels) is rejected — bind `pages.abc.com`. Also rejects
 * malformed hostnames and any shortwind-owned name. Pure/exported for tests.
 */
export function isBindableSubdomain(
  hostname: string,
): { ok: true; hostname: string } | { ok: false; reason: string } {
  const h = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (!h) return { ok: false, reason: "hostname is required" };
  const labels = h.split(".");
  if (labels.length < 3) {
    return {
      ok: false,
      reason:
        "a subdomain is required (e.g. pages.example.com), not a bare apex",
    };
  }
  if (!labels.every((l) => HOST_LABEL.test(l))) {
    return { ok: false, reason: `invalid hostname: ${JSON.stringify(h)}` };
  }
  if (RESERVED_APEXES.some((a) => h === a || h.endsWith(`.${a}`))) {
    return { ok: false, reason: "cannot bind a shortwind-owned domain" };
  }
  return { ok: true, hostname: h };
}

const accountDomainStatus = v.union(
  v.literal("pending-human"),
  v.literal("queued"),
  v.literal("pending-cert"),
  v.literal("active"),
  v.literal("failed"),
);

/** The account-domain bind outcome, as plain data (no `pageId` — account-wide). */
export interface AccountDomainBindResult {
  state: DomainBindState;
  hostname: string;
  cloudflareHostnameId: string | null;
  reason?: string;
}

const accountBindResultValidator = v.object({
  state: accountDomainStatus,
  hostname: v.string(),
  cloudflareHostnameId: v.union(v.string(), v.null()),
  reason: v.optional(v.string()),
});

/**
 * Scope (`domains:bind`) + entitlement (plan quota on ACTIVE account domains) +
 * approval policy + global hostname-conflict check. Returns the bind context.
 * A hostname already active for THIS account short-circuits as idempotent
 * (`alreadyActive`), consuming no new quota; one bound to ANOTHER account is a
 * CONFLICT.
 */
export const authAndContextForAccountBind = internalQuery({
  args: { bearer: v.string(), hostname: v.string() },
  returns: v.object({
    accountId: v.id("accounts"),
    tokenId: v.id("tokens"),
    needsApproval: v.boolean(),
    alreadyActive: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const auth = await requireDomainsBind(ctx, args.bearer);

    const existing = await ctx.db
      .query("accountDomains")
      .withIndex("by_hostname", (q) => q.eq("hostname", args.hostname))
      .first();
    if (existing && existing.accountId !== auth.accountId) {
      throw new ConvexError({
        code: "CONFLICT",
        message: "This domain is already bound to another account.",
      });
    }
    const alreadyActive =
      existing?.status === "active" && existing.accountId === auth.accountId;

    if (!alreadyActive) {
      const plan = await resolvePlan(ctx, auth.accountId);
      const active = await ctx.db
        .query("accountDomains")
        .withIndex("by_account", (q) => q.eq("accountId", auth.accountId))
        .collect();
      const activeCount = active.filter((d) => d.status === "active").length;
      if (!withinCustomDomainQuota(plan, activeCount)) {
        throw new ConvexError({
          code: "NOT_ENTITLED",
          message:
            "Custom domains require a paid plan (or you have reached your plan's domain limit). Upgrade to bind a domain.",
        });
      }
    }

    const needsApproval = await readNeedsApproval(ctx, auth.accountId);
    return {
      accountId: auth.accountId,
      tokenId: auth.tokenId,
      needsApproval,
      alreadyActive,
    };
  },
});

/**
 * Upsert the account-domain row to a new state (keyed by hostname) and audit the
 * transition. On `active` it also emits the `domain.meter` billing event
 * (kind: account-custom-domain) — the same counter `billing.getUsage` reads.
 */
export const upsertAccountDomainStatus = internalMutation({
  args: {
    accountId: v.id("accounts"),
    tokenId: v.union(v.id("tokens"), v.null()),
    hostname: v.string(),
    status: accountDomainStatus,
    cloudflareHostnameId: v.union(v.string(), v.null()),
    reason: v.union(v.string(), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("accountDomains")
      .withIndex("by_hostname", (q) => q.eq("hostname", args.hostname))
      .first();
    const isActive = args.status === "active";
    const row = {
      accountId: args.accountId,
      hostname: args.hostname,
      status: args.status,
      cloudflareHostnameId: args.cloudflareHostnameId,
      verifiedAt: isActive ? now : (existing?.verifiedAt ?? null),
      createdAt: existing?.createdAt ?? now,
    };
    if (existing) await ctx.db.patch(existing._id, row);
    else await ctx.db.insert("accountDomains", row);

    await ctx.db.insert("auditLog", {
      accountId: args.accountId,
      action: "domain.bind",
      targetId: null,
      actorTokenId: args.tokenId,
      metadata: {
        hostname: args.hostname,
        state: args.status,
        cloudflareHostnameId: args.cloudflareHostnameId,
        reason: args.reason,
        scope: "account",
      },
      createdAt: now,
    });
    if (isActive) {
      await ctx.db.insert("auditLog", {
        accountId: args.accountId,
        action: "domain.meter",
        targetId: null,
        actorTokenId: args.tokenId,
        metadata: {
          hostname: args.hostname,
          kind: "account-custom-domain",
          delta: 1,
        },
        createdAt: now,
      });
    }
    return null;
  },
});

/**
 * Provision an account domain through Cloudflare: create (rate-limit backoff →
 * `queued`) → poll the cert → on active persist the row + meter. Reuses the
 * page-bind's `createWithBackoff` / `pollUntilCert` (both hostname-scoped, page-
 * agnostic); the only difference is it commits to `accountDomains`.
 */
async function provisionAccountDomain(
  ctx: RunnerCtx,
  args: {
    accountId: Id<"accounts">;
    tokenId: Id<"tokens"> | null;
    hostname: string;
  },
): Promise<AccountDomainBindResult> {
  const set = (
    status: DomainBindState,
    cloudflareHostnameId: string | null,
    reason: string | null,
  ) =>
    ctx.runMutation(internal.domains.upsertAccountDomainStatus, {
      accountId: args.accountId,
      tokenId: args.tokenId,
      hostname: args.hostname,
      status,
      cloudflareHostnameId,
      reason,
    });

  const record = await createWithBackoff(args.hostname);
  if (record === null) {
    await set("queued", null, "cloudflare cert-issuance rate limit");
    return {
      state: "queued",
      hostname: args.hostname,
      cloudflareHostnameId: null,
      reason: "cloudflare cert-issuance rate limit",
    };
  }

  const verdict = await pollUntilCert(record.id);
  if (verdict === "failed") {
    await set("failed", record.id, "cloudflare cert issuance failed");
    return {
      state: "failed",
      hostname: args.hostname,
      cloudflareHostnameId: record.id,
      reason: "cloudflare cert issuance failed",
    };
  }
  if (verdict === "pending") {
    await set("pending-cert", record.id, null);
    return {
      state: "pending-cert",
      hostname: args.hostname,
      cloudflareHostnameId: record.id,
    };
  }
  await set("active", record.id, null);
  return {
    state: "active",
    hostname: args.hostname,
    cloudflareHostnameId: record.id,
  };
}

/**
 * bindAccountDomain (POST /v1/domains): bind a subdomain you own to the ACCOUNT.
 * Same gates as the per-page bind — `domains:bind` scope, plan entitlement,
 * `customDomainNeedsApproval` policy — but no `pageId`, and the hostname must be
 * a subdomain. Every page then serves at `<hostname>/<slug>`.
 */
export const bindAccountDomain = action({
  args: { bearer: v.string(), hostname: v.string() },
  returns: accountBindResultValidator,
  handler: async (ctx, args): Promise<AccountDomainBindResult> => {
    const check = isBindableSubdomain(args.hostname);
    if (!check.ok) {
      throw new ConvexError({ code: "BAD_REQUEST", message: check.reason });
    }
    const hostname = check.hostname;

    const info = await ctx.runQuery(
      internal.domains.authAndContextForAccountBind,
      { bearer: args.bearer, hostname },
    );

    if (info.alreadyActive) {
      return { state: "active", hostname, cloudflareHostnameId: null };
    }
    if (info.needsApproval) {
      await ctx.runMutation(internal.domains.upsertAccountDomainStatus, {
        accountId: info.accountId,
        tokenId: info.tokenId,
        hostname,
        status: "pending-human",
        cloudflareHostnameId: null,
        reason: null,
      });
      return { state: "pending-human", hostname, cloudflareHostnameId: null };
    }
    return provisionAccountDomain(ctx, {
      accountId: info.accountId,
      tokenId: info.tokenId,
      hostname,
    });
  },
});

/**
 * pageDomains: the URLs a page is reachable at (decision — "check what domain a
 * page lives under"). Always its `<subdomain>.shortwind.app` vanity URL, plus —
 * because domains are account-level — one `<hostname>/<slug>` entry per ACTIVE
 * account domain. Designed for multiple domains (array), though the plan caps
 * active at 1 today. Account-scoped read (operator bearer or session).
 */
export const pageDomains = query({
  args: { pageId: v.id("pages"), bearer: v.optional(v.string()) },
  returns: v.object({
    slug: v.string(),
    subdomain: v.union(v.string(), v.null()),
    customDomains: v.array(
      v.object({ hostname: v.string(), url: v.string() }),
    ),
  }),
  handler: async (ctx, args) => {
    const auth = await requireReadOperator(ctx, args.bearer);
    const page = await ctx.db.get(args.pageId);
    if (!page || page.accountId !== auth.accountId) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Page not found" });
    }
    const domains = await ctx.db
      .query("accountDomains")
      .withIndex("by_account", (q) => q.eq("accountId", auth.accountId))
      .collect();
    return {
      slug: page.slug,
      subdomain: page.subdomain ?? null,
      customDomains: domains
        .filter((d) => d.status === "active")
        .map((d) => ({
          hostname: d.hostname,
          url: `https://${d.hostname}/${page.slug}`,
        })),
    };
  },
});

/**
 * listAccountDomains: the account's custom domains for the dashboard (hostname +
 * bind status + verifiedAt). Account-scoped read (operator session or bearer).
 */
export const listAccountDomains = query({
  args: { bearer: v.optional(v.string()) },
  returns: v.array(
    v.object({
      id: v.string(),
      hostname: v.string(),
      status: accountDomainStatus,
      verifiedAt: v.union(v.number(), v.null()),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    const auth = await requireReadOperator(ctx, args.bearer);
    const rows = await ctx.db
      .query("accountDomains")
      .withIndex("by_account", (q) => q.eq("accountId", auth.accountId))
      .collect();
    return rows.map((d) => ({
      id: d._id as string,
      hostname: d.hostname,
      status: d.status,
      verifiedAt: d.verifiedAt,
      createdAt: d.createdAt,
    }));
  },
});

/** Resolve the operator's account for a `pending-human` account-domain approval. */
export const authForAccountApprove = internalQuery({
  args: { bearer: v.optional(v.string()), hostname: v.string() },
  returns: v.object({
    accountId: v.id("accounts"),
    tokenId: v.union(v.id("tokens"), v.null()),
  }),
  handler: async (ctx, args) => {
    const auth = await requireReadOperator(ctx, args.bearer);
    const domain = await ctx.db
      .query("accountDomains")
      .withIndex("by_hostname", (q) => q.eq("hostname", args.hostname))
      .first();
    if (!domain || domain.accountId !== auth.accountId) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Domain not found" });
    }
    return { accountId: auth.accountId, tokenId: auth.tokenId };
  },
});

/**
 * approveAccountDomain (operator action): approve a `pending-human` account
 * domain and provision the hostname through Cloudflare (the same create → poll →
 * active path as a no-approval bind). The human gate of PRD §7.2 for the
 * account-level model. Operator-authed (session or read bearer).
 */
export const approveAccountDomain = action({
  args: { bearer: v.optional(v.string()), hostname: v.string() },
  returns: accountBindResultValidator,
  handler: async (ctx, args): Promise<AccountDomainBindResult> => {
    const check = isBindableSubdomain(args.hostname);
    if (!check.ok) {
      throw new ConvexError({ code: "BAD_REQUEST", message: check.reason });
    }
    const hostname = check.hostname;
    const auth = await ctx.runQuery(internal.domains.authForAccountApprove, {
      bearer: args.bearer,
      hostname,
    });
    return provisionAccountDomain(ctx, {
      accountId: auth.accountId,
      tokenId: auth.tokenId,
      hostname,
    });
  },
});
