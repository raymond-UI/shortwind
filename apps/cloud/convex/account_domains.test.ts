// @vitest-environment edge-runtime
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema.js";
import { api, internal } from "./_generated/api.js";
import type { Doc } from "./_generated/dataModel.js";
import {
  isBindableSubdomain,
  __setCloudflareSaaSClient,
  __resetCloudflareSaaSClient,
  __setBindTimings,
  __resetBindTimings,
  type CloudflareSaaSClient,
  type CreateCustomHostnameResult,
  type CustomHostnameRecord,
} from "./domains.js";
import { slugFromPath } from "./serve.js";
import {
  __setPlanResolver,
  __resetPlanResolver,
  type PlanResolver,
} from "./lib/plan_resolver.js";
import { computeBodySha } from "../shared/src/fingerprint.js";
import type { Lockfile } from "../shared/src/lockfile-diff.js";

/**
 * ACCOUNT-LEVEL custom domains — bind + serve-resolution + pageDomains, offline
 * via convex-test (CF client injected, plan resolver injected, backoff zeroed).
 */

declare global {
  interface ImportMeta {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
}
const modules = import.meta.glob("./**/*.ts");

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
  suffix: string,
): Promise<string> {
  return t.run(async (ctx) => {
    const now = Date.now();
    return ctx.db.insert("accounts", {
      authUserId: `auth_${suffix}`,
      name: `Account ${suffix}`,
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
  const issued = await t.mutation(internal.tokens.issueToken, {
    accountId: accountId as never,
    scopes,
  });
  return issued.secret;
}

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
const failIfCalled: CloudflareSaaSClient = {
  createCustomHostname: async () => {
    throw new Error("Cloudflare must not be called");
  },
  getCustomHostname: async () => {
    throw new Error("Cloudflare must not be called");
  },
};
const PERF_TIMINGS = { maxCreateRetries: 3, maxCertPolls: 5, sleepMs: () => 0 };
function planResolver(plan: "free" | "pro"): PlanResolver {
  return { resolve: async () => plan };
}
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

beforeEach(() => {
  __setBindTimings(PERF_TIMINGS);
  __setPlanResolver(planResolver("pro")); // entitled by default; free tests override
});
afterEach(() => {
  __resetCloudflareSaaSClient();
  __resetBindTimings();
  __resetPlanResolver();
});

// ---------------------------------------------------------------------------
// Pure helpers.
// ---------------------------------------------------------------------------

describe("isBindableSubdomain (subdomain-only)", () => {
  it("accepts a subdomain of a domain you own", () => {
    expect(isBindableSubdomain("pages.abc.com")).toEqual({
      ok: true,
      hostname: "pages.abc.com",
    });
  });
  it("normalizes case + trailing dot", () => {
    const r = isBindableSubdomain("Pages.ABC.com.");
    expect(r).toEqual({ ok: true, hostname: "pages.abc.com" });
  });
  it("rejects a bare apex", () => {
    expect(isBindableSubdomain("abc.com").ok).toBe(false);
  });
  it("rejects a shortwind-owned host", () => {
    expect(isBindableSubdomain("evil.shortwind.app").ok).toBe(false);
  });
  it("rejects a malformed hostname", () => {
    expect(isBindableSubdomain("pages..abc.com").ok).toBe(false);
  });
});

describe("slugFromPath", () => {
  it("extracts a single segment", () => {
    expect(slugFromPath("/price-calculator")).toBe("price-calculator");
    expect(slugFromPath("price-calculator/")).toBe("price-calculator");
  });
  it("returns null for the root (no account index page)", () => {
    expect(slugFromPath("/")).toBeNull();
    expect(slugFromPath("")).toBeNull();
  });
  it("returns null for a nested path", () => {
    expect(slugFromPath("/a/b")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// bindAccountDomain.
// ---------------------------------------------------------------------------

describe("bindAccountDomain — gates", () => {
  it("rejects a bare apex with BAD_REQUEST before any CF/auth", async () => {
    const t = convexTest(schema, modules);
    __setCloudflareSaaSClient(failIfCalled);
    const accountId = await seedAccount(t, "apex");
    const bearer = await issueBearer(t, accountId, ["domains:bind"]);
    const err = await t
      .action(api.domains.bindAccountDomain, { bearer, hostname: "abc.com" })
      .then(
        () => {
          throw new Error("expected BAD_REQUEST");
        },
        (e: unknown) => e,
      );
    expect(errData(err).code).toBe("BAD_REQUEST");
  });

  it("rejects a FREE plan with NOT_ENTITLED and makes NO Cloudflare call", async () => {
    const t = convexTest(schema, modules);
    __setPlanResolver(planResolver("free"));
    __setCloudflareSaaSClient(failIfCalled);
    const accountId = await seedAccount(t, "free");
    const bearer = await issueBearer(t, accountId, [
      "pages:write",
      "domains:bind",
    ]);
    const err = await t
      .action(api.domains.bindAccountDomain, {
        bearer,
        hostname: "pages.abc.com",
      })
      .then(
        () => {
          throw new Error("expected NOT_ENTITLED");
        },
        (e: unknown) => e,
      );
    expect(errData(err).code).toBe("NOT_ENTITLED");
    const rows = await t.run((ctx) => ctx.db.query("accountDomains").collect());
    expect(rows.length).toBe(0);
  });

  it("PRO binds a subdomain through to active (row + meter)", async () => {
    const t = convexTest(schema, modules);
    __setCloudflareSaaSClient(activeClient());
    const accountId = await seedAccount(t, "pro");
    const bearer = await issueBearer(t, accountId, [
      "pages:write",
      "domains:bind",
    ]);
    await setPolicy(t, bearer, false);
    const result = await t.action(api.domains.bindAccountDomain, {
      bearer,
      hostname: "pages.abc.com",
    });
    expect(result.state).toBe("active");
    const rows = (await t.run((ctx) =>
      ctx.db.query("accountDomains").collect(),
    )) as Doc<"accountDomains">[];
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe("active");
    expect(rows[0].hostname).toBe("pages.abc.com");
  });

  it("enforces the 1-domain quota: a second active bind is NOT_ENTITLED", async () => {
    const t = convexTest(schema, modules);
    __setCloudflareSaaSClient(activeClient());
    const accountId = await seedAccount(t, "quota");
    const bearer = await issueBearer(t, accountId, [
      "pages:write",
      "domains:bind",
    ]);
    await setPolicy(t, bearer, false);
    await t.action(api.domains.bindAccountDomain, {
      bearer,
      hostname: "pages.abc.com",
    });
    const err = await t
      .action(api.domains.bindAccountDomain, {
        bearer,
        hostname: "www.abc.com",
      })
      .then(
        () => {
          throw new Error("expected NOT_ENTITLED for a 2nd domain");
        },
        (e: unknown) => e,
      );
    expect(errData(err).code).toBe("NOT_ENTITLED");
  });

  it("rejects a hostname already bound to ANOTHER account with CONFLICT", async () => {
    const t = convexTest(schema, modules);
    __setCloudflareSaaSClient(activeClient());
    const accA = await seedAccount(t, "owner");
    const bearerA = await issueBearer(t, accA, ["pages:write", "domains:bind"]);
    await setPolicy(t, bearerA, false);
    await t.action(api.domains.bindAccountDomain, {
      bearer: bearerA,
      hostname: "pages.shared.com",
    });

    const accB = await seedAccount(t, "intruder");
    const bearerB = await issueBearer(t, accB, ["pages:write", "domains:bind"]);
    const err = await t
      .action(api.domains.bindAccountDomain, {
        bearer: bearerB,
        hostname: "pages.shared.com",
      })
      .then(
        () => {
          throw new Error("expected CONFLICT");
        },
        (e: unknown) => e,
      );
    expect(errData(err).code).toBe("CONFLICT");
  });

  it("parks in pending-human under the approval policy (no CF call)", async () => {
    const t = convexTest(schema, modules);
    __setCloudflareSaaSClient(failIfCalled);
    const accountId = await seedAccount(t, "approval");
    const bearer = await issueBearer(t, accountId, [
      "pages:write",
      "domains:bind",
    ]);
    await setPolicy(t, bearer, true);
    const result = await t.action(api.domains.bindAccountDomain, {
      bearer,
      hostname: "pages.abc.com",
    });
    expect(result.state).toBe("pending-human");
  });
});

// ---------------------------------------------------------------------------
// Serve resolution + pageDomains.
// ---------------------------------------------------------------------------

describe("resolveAccountDomainRoute — host + path → page", () => {
  async function boundAccountWithPage() {
    const t = convexTest(schema, modules);
    __setCloudflareSaaSClient(activeClient());
    const accountId = await seedAccount(t, "serve");
    const bearer = await issueBearer(t, accountId, [
      "pages:write",
      "domains:bind",
      "pages:read",
    ]);
    await setPolicy(t, bearer, false);
    await t.action(api.domains.bindAccountDomain, {
      bearer,
      hostname: "pages.abc.com",
    });
    const pageId = await publishPage(t, bearer, "price-calculator");
    return { t, bearer, pageId };
  }

  it("resolves <hostname>/<slug> to the page", async () => {
    const { t, pageId } = await boundAccountWithPage();
    const route = await t.query(api.serve.resolveAccountDomainRoute, {
      host: "pages.abc.com",
      path: "/price-calculator",
    });
    expect(route).not.toBeNull();
    expect(route?.pageId).toBe(pageId);
  });

  it("returns null for the domain root (no index page)", async () => {
    const { t } = await boundAccountWithPage();
    expect(
      await t.query(api.serve.resolveAccountDomainRoute, {
        host: "pages.abc.com",
        path: "/",
      }),
    ).toBeNull();
  });

  it("returns null for an unknown slug", async () => {
    const { t } = await boundAccountWithPage();
    expect(
      await t.query(api.serve.resolveAccountDomainRoute, {
        host: "pages.abc.com",
        path: "/nope",
      }),
    ).toBeNull();
  });

  it("returns null for an unbound host", async () => {
    const { t } = await boundAccountWithPage();
    expect(
      await t.query(api.serve.resolveAccountDomainRoute, {
        host: "other.example.com",
        path: "/price-calculator",
      }),
    ).toBeNull();
  });

  it("does not serve a page from a pending (non-active) domain", async () => {
    const t = convexTest(schema, modules);
    __setCloudflareSaaSClient(activeClient());
    const accountId = await seedAccount(t, "pending");
    const bearer = await issueBearer(t, accountId, [
      "pages:write",
      "domains:bind",
      "pages:read",
    ]);
    await setPolicy(t, bearer, true); // approval → pending-human, never active
    await t.action(api.domains.bindAccountDomain, {
      bearer,
      hostname: "pages.abc.com",
    });
    await publishPage(t, bearer, "price-calculator");
    expect(
      await t.query(api.serve.resolveAccountDomainRoute, {
        host: "pages.abc.com",
        path: "/price-calculator",
      }),
    ).toBeNull();
  });
});

describe("pageDomains — where a page lives", () => {
  it("lists the vanity subdomain plus each active account domain URL", async () => {
    const t = convexTest(schema, modules);
    __setCloudflareSaaSClient(activeClient());
    const accountId = await seedAccount(t, "urls");
    const bearer = await issueBearer(t, accountId, [
      "pages:write",
      "domains:bind",
      "pages:read",
    ]);
    await setPolicy(t, bearer, false);
    await t.action(api.domains.bindAccountDomain, {
      bearer,
      hostname: "pages.abc.com",
    });
    const pageId = await publishPage(t, bearer, "price-calculator");

    const out = await t.query(api.domains.pageDomains, {
      bearer,
      pageId: pageId as never,
    });
    expect(out.slug).toBe("price-calculator");
    expect(out.customDomains).toEqual([
      {
        hostname: "pages.abc.com",
        url: "https://pages.abc.com/price-calculator",
      },
    ]);
  });
});
