// @vitest-environment edge-runtime
import { afterEach, describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema.js";
import { api } from "./_generated/api.js";
import type { Doc } from "./_generated/dataModel.js";
import {
  __setCloudflareSaaSClient,
  __resetCloudflareSaaSClient,
  __setBindTimings,
  __resetBindTimings,
  classifyCertStatus,
  type CloudflareSaaSClient,
  type CreateCustomHostnameResult,
  type CustomHostnameRecord,
} from "./domains.js";
import { computeBodySha } from "../shared/src/fingerprint.js";
import type { Lockfile } from "../shared/src/lockfile-diff.js";

/**
 * CLOUD-40 — bind-domain (Cloudflare for SaaS, human-gated) integration tests.
 *
 * Run against the REAL schema + functions via convex-test (offline; no live CF
 * creds — the Cloudflare for SaaS client is INJECTED as a mock, and the
 * backoff/poll timings are zeroed so the retry/poll loops run instantly).
 *
 * Asserts:
 *   - bind requires `domains:bind` (a token without it → FORBIDDEN/403);
 *   - the `customDomainNeedsApproval` policy parks the bind in `pending-human`
 *     WITHOUT any Cloudflare call (no hostname created until approval);
 *   - approval then provisions: cert polled pending → active sets
 *     `pages.customDomain` AND emits the domain billing meter event;
 *   - a Cloudflare cert-issuance rate-limit → `queued`, with the create RETRIED;
 *   - the domain billing meter increment is recorded on active.
 */

declare global {
  interface ImportMeta {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
}
const modules = import.meta.glob("./**/*.ts");

/**
 * Pull the structured ConvexError payload. The action edge may stringify `data`
 * (sometimes DOUBLY — a JSON string whose content is itself JSON), so parse
 * until we land on an object.
 */
function errData(err: unknown): { code?: string } {
  let raw: unknown = (err as { data?: unknown }).data;
  for (let i = 0; i < 3 && typeof raw === "string"; i++) {
    try {
      raw = JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return (raw as { code?: string }) ?? {};
}

const CARD_BODY = "@recipe card {\n  rounded-lg border p-4\n}\n";
async function cleanCardSource(): Promise<string> {
  const sha = await computeBodySha(`x\n${CARD_BODY}`);
  return `/* shortwind: card@0.4.0 sha:${sha} — DO NOT EDIT THIS LINE */\n${CARD_BODY}`;
}
function lockfile(): Lockfile {
  return {
    version: 1,
    registry: "default",
    families: { card: { version: "0.4.0", sha: "deadbeefdeadbeef" } },
  };
}

async function seedAccount(
  t: ReturnType<typeof convexTest>,
  suffix = "domains",
): Promise<string> {
  return t.run(async (ctx) => {
    const now = Date.now();
    return ctx.db.insert("accounts", {
      authUserId: `auth_user_${suffix}`,
      name: "Domains Account",
      email: null,
      createdAt: now,
      updatedAt: now,
    });
  });
}

async function issueBearer(
  t: ReturnType<typeof convexTest>,
  accountId: string,
  scopes: string[],
): Promise<string> {
  const issued = await t.mutation(api.tokens.issueToken, {
    accountId: accountId as never,
    scopes,
  });
  return issued.secret;
}

/** Publish a page and return its id. */
async function publishPage(
  t: ReturnType<typeof convexTest>,
  bearer: string,
  slug: string,
): Promise<string> {
  const out = await t.action(api.pages.publish, {
    bearer,
    html: '<div class="@card">hi</div>',
    slug,
    recipes: [{ family: "card", source: await cleanCardSource() }],
    lockfile: lockfile(),
    visibility: "public",
  });
  if (!out.ok) throw new Error("publish collided");
  return out.id;
}

/** Set the account's customDomainNeedsApproval policy via the dashboard mutation. */
async function setPolicy(
  t: ReturnType<typeof convexTest>,
  bearer: string,
  needsApproval: boolean,
): Promise<void> {
  await t.mutation(api.dashboard.setAccountPolicy, {
    bearer,
    customDomainNeedsApproval: needsApproval,
  });
}

/** Read an account's audit rows of a given action. */
async function auditRows(
  t: ReturnType<typeof convexTest>,
  accountId: string,
  action: string,
): Promise<Doc<"auditLog">[]> {
  return t.run(async (ctx) => {
    // `t` is typed as the schema-less `convexTest` return here (helper param),
    // so the db query resolves to SystemIndexes only — cast to drive `by_account`.
    const db = ctx.db as unknown as {
      query: (table: "auditLog") => {
        withIndex: (
          name: "by_account",
          cb: (q: { eq: (f: "accountId", v: string) => unknown }) => unknown,
        ) => { collect: () => Promise<Doc<"auditLog">[]> };
      };
    };
    const rows = await db
      .query("auditLog")
      .withIndex("by_account", (q) => q.eq("accountId", accountId))
      .collect();
    return rows.filter((r: Doc<"auditLog">) => r.action === action);
  });
}

/** A mock CF client whose hostname goes active immediately. */
function activeClient(): CloudflareSaaSClient {
  return {
    createCustomHostname: async (
      hostname,
    ): Promise<CreateCustomHostnameResult> => ({
      record: { id: `cf_${hostname}`, hostname, certStatus: "pending_issuance" },
    }),
    getCustomHostname: async (id): Promise<CustomHostnameRecord> => ({
      id,
      hostname: id.replace(/^cf_/, ""),
      certStatus: "active",
    }),
  };
}

const PERF_TIMINGS = {
  maxCreateRetries: 3,
  maxCertPolls: 5,
  sleepMs: () => 0,
};

afterEach(() => {
  __resetCloudflareSaaSClient();
  __resetBindTimings();
});

// ---------------------------------------------------------------------------
// Pure cert classification.
// ---------------------------------------------------------------------------

describe("classifyCertStatus — pure cert verdict", () => {
  it("maps active → active, failed → failed, the rest → pending", () => {
    expect(classifyCertStatus("active")).toBe("active");
    expect(classifyCertStatus("failed")).toBe("failed");
    expect(classifyCertStatus("initializing")).toBe("pending");
    expect(classifyCertStatus("pending_validation")).toBe("pending");
    expect(classifyCertStatus("pending_issuance")).toBe("pending");
  });
});

// ---------------------------------------------------------------------------
// Scope gate.
// ---------------------------------------------------------------------------

describe("bindDomain — domains:bind scope gate (PRD §7.2)", () => {
  it("rejects a token WITHOUT domains:bind with FORBIDDEN (→ 403)", async () => {
    const t = convexTest(schema, modules);
    __setBindTimings(PERF_TIMINGS);
    __setCloudflareSaaSClient(activeClient());

    const accountId = await seedAccount(t);
    const bearer = await issueBearer(t, accountId, ["pages:read", "pages:write"]);
    const pageId = await publishPage(t, bearer, "no-scope");

    const err = await t
      .action(api.domains.bindDomain, {
        bearer,
        pageId: pageId as never,
        hostname: "example.com",
      })
      .then(
        () => {
          throw new Error("expected bindDomain to reject without domains:bind");
        },
        (e: unknown) => e,
      );
    // The action edge stringifies the ConvexError `data` payload (same as the
    // scan tests) — parse it before asserting the FORBIDDEN (→ 403) code.
    expect(errData(err).code).toBe("FORBIDDEN");

    // No Cloudflare hostname → no bind audit, page still unbound.
    const page = (await t.run((ctx) =>
      ctx.db.get(pageId as never),
    )) as Doc<"pages">;
    expect(page.customDomain).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Human-approval policy.
// ---------------------------------------------------------------------------

describe("bindDomain — customDomainNeedsApproval policy", () => {
  it("parks in pending-human and makes NO Cloudflare call when approval is required", async () => {
    const t = convexTest(schema, modules);
    __setBindTimings(PERF_TIMINGS);

    // A client that FAILS the test if it is ever called (no CF until approval).
    let cfCalled = false;
    __setCloudflareSaaSClient({
      createCustomHostname: async () => {
        cfCalled = true;
        throw new Error("Cloudflare must not be called for a pending-human bind");
      },
      getCustomHostname: async () => {
        cfCalled = true;
        throw new Error("Cloudflare must not be called for a pending-human bind");
      },
    });

    const accountId = await seedAccount(t);
    const bindBearer = await issueBearer(t, accountId, [
      "pages:read",
      "pages:write",
      "domains:bind",
    ]);
    const pageId = await publishPage(t, bindBearer, "needs-approval");

    // Policy ON (also the default, but set it explicitly).
    await setPolicy(t, bindBearer, true);

    const result = await t.action(api.domains.bindDomain, {
      bearer: bindBearer,
      pageId: pageId as never,
      hostname: "Gated.Example.com",
    });

    expect(result.state).toBe("pending-human");
    expect(result.cloudflareHostnameId).toBeNull();
    expect(result.hostname).toBe("gated.example.com"); // normalized
    expect(cfCalled).toBe(false);

    // Page is NOT bound yet.
    const page = (await t.run((ctx) =>
      ctx.db.get(pageId as never),
    )) as Doc<"pages">;
    expect(page.customDomain).toBeNull();

    // A pending-human bind audit was recorded.
    const binds = await auditRows(t, accountId, "domain.bind");
    expect(binds.some((b) => (b.metadata as any).state === "pending-human")).toBe(
      true,
    );
  });

  it("approveDomain then provisions: cert polled pending→active binds the page + emits the meter", async () => {
    const t = convexTest(schema, modules);
    __setBindTimings(PERF_TIMINGS);

    // Cert is pending on the first poll, active on the second (polled, not pushed).
    let polls = 0;
    __setCloudflareSaaSClient({
      createCustomHostname: async (hostname) => ({
        record: {
          id: `cf_${hostname}`,
          hostname,
          certStatus: "pending_validation",
        },
      }),
      getCustomHostname: async (id) => {
        polls += 1;
        return {
          id,
          hostname: id.replace(/^cf_/, ""),
          certStatus: polls >= 2 ? "active" : "pending_issuance",
        };
      },
    });

    const accountId = await seedAccount(t);
    const bindBearer = await issueBearer(t, accountId, [
      "pages:read",
      "pages:write",
      "domains:bind",
    ]);
    const pageId = await publishPage(t, bindBearer, "approve-flow");
    await setPolicy(t, bindBearer, true);

    // 1. Bind parks pending-human.
    const parked = await t.action(api.domains.bindDomain, {
      bearer: bindBearer,
      pageId: pageId as never,
      hostname: "approved.example.com",
    });
    expect(parked.state).toBe("pending-human");

    // 2. Operator approves → provisions → cert polled to active.
    const approved = await t.action(api.domains.approveDomain, {
      bearer: bindBearer,
      pageId: pageId as never,
      hostname: "approved.example.com",
    });
    expect(approved.state).toBe("active");
    expect(approved.cloudflareHostnameId).toBe("cf_approved.example.com");
    expect(polls).toBeGreaterThanOrEqual(2); // polled, not webhook-pushed

    // 3. The page is now bound to the hostname.
    const page = (await t.run((ctx) =>
      ctx.db.get(pageId as never),
    )) as Doc<"pages">;
    expect(page.customDomain).toBe("approved.example.com");

    // 4. The domain billing meter increment was recorded.
    const meters = await auditRows(t, accountId, "domain.meter");
    expect(meters.length).toBe(1);
    expect((meters[0]!.metadata as any).kind).toBe("custom-domain");
    expect((meters[0]!.metadata as any).delta).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// No-approval fast path + rate-limit queue.
// ---------------------------------------------------------------------------

describe("bindDomain — provisioning paths", () => {
  it("with approval OFF: cert active → bound page + meter (one bind, no human gate)", async () => {
    const t = convexTest(schema, modules);
    __setBindTimings(PERF_TIMINGS);
    __setCloudflareSaaSClient(activeClient());

    const accountId = await seedAccount(t);
    const bindBearer = await issueBearer(t, accountId, [
      "pages:read",
      "pages:write",
      "domains:bind",
    ]);
    const pageId = await publishPage(t, bindBearer, "no-approval");
    await setPolicy(t, bindBearer, false);

    const result = await t.action(api.domains.bindDomain, {
      bearer: bindBearer,
      pageId: pageId as never,
      hostname: "direct.example.com",
    });
    expect(result.state).toBe("active");

    const page = (await t.run((ctx) =>
      ctx.db.get(pageId as never),
    )) as Doc<"pages">;
    expect(page.customDomain).toBe("direct.example.com");

    const meters = await auditRows(t, accountId, "domain.meter");
    expect(meters.length).toBe(1);
  });

  it("rate-limited create → queued, with the create RETRIED then succeeding", async () => {
    const t = convexTest(schema, modules);
    __setBindTimings(PERF_TIMINGS);

    // Rate-limit the first two creates, then never succeed → exhaust retries → queued.
    let creates = 0;
    __setCloudflareSaaSClient({
      createCustomHostname: async (): Promise<CreateCustomHostnameResult> => {
        creates += 1;
        return { rateLimited: true, retryAfter: 1 };
      },
      getCustomHostname: async (id) => ({
        id,
        hostname: "x",
        certStatus: "active",
      }),
    });

    const accountId = await seedAccount(t);
    const bindBearer = await issueBearer(t, accountId, [
      "pages:read",
      "pages:write",
      "domains:bind",
    ]);
    const pageId = await publishPage(t, bindBearer, "rate-limited");
    await setPolicy(t, bindBearer, false);

    const result = await t.action(api.domains.bindDomain, {
      bearer: bindBearer,
      pageId: pageId as never,
      hostname: "busy.example.com",
    });

    expect(result.state).toBe("queued");
    // The create was RETRIED up to the retry budget (not a single attempt).
    expect(creates).toBe(PERF_TIMINGS.maxCreateRetries);

    // Page NOT bound while queued.
    const page = (await t.run((ctx) =>
      ctx.db.get(pageId as never),
    )) as Doc<"pages">;
    expect(page.customDomain).toBeNull();

    // A `queued` bind audit was recorded.
    const binds = await auditRows(t, accountId, "domain.bind");
    expect(binds.some((b) => (b.metadata as any).state === "queued")).toBe(true);
  });

  it("retries the rate-limit then SUCCEEDS when a later create clears it", async () => {
    const t = convexTest(schema, modules);
    __setBindTimings(PERF_TIMINGS);

    let creates = 0;
    __setCloudflareSaaSClient({
      createCustomHostname: async (
        hostname,
      ): Promise<CreateCustomHostnameResult> => {
        creates += 1;
        if (creates < 2) return { rateLimited: true, retryAfter: 1 };
        return {
          record: { id: `cf_${hostname}`, hostname, certStatus: "active" },
        };
      },
      getCustomHostname: async (id) => ({
        id,
        hostname: id.replace(/^cf_/, ""),
        certStatus: "active",
      }),
    });

    const accountId = await seedAccount(t);
    const bindBearer = await issueBearer(t, accountId, [
      "pages:read",
      "pages:write",
      "domains:bind",
    ]);
    const pageId = await publishPage(t, bindBearer, "retry-clears");
    await setPolicy(t, bindBearer, false);

    const result = await t.action(api.domains.bindDomain, {
      bearer: bindBearer,
      pageId: pageId as never,
      hostname: "eventually.example.com",
    });

    expect(result.state).toBe("active");
    expect(creates).toBe(2); // first rate-limited, second cleared
    const page = (await t.run((ctx) =>
      ctx.db.get(pageId as never),
    )) as Doc<"pages">;
    expect(page.customDomain).toBe("eventually.example.com");
  });
});
