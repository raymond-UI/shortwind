// @vitest-environment edge-runtime
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema.js";
import { api, internal } from "./_generated/api.js";
import { subdomainLabel } from "./serve.js";
import { computeBodySha } from "../shared/src/fingerprint.js";
import type { Lockfile } from "../shared/src/lockfile-diff.js";

/**
 * CLOUD-SUBDOMAIN — serve resolver integration test (subdomain-only serving).
 *
 * Exercises `serve.resolveRoute` against the REAL schema + publish action via
 * convex-test, proving:
 *   - a per-page subdomain host (`<subdomain>.shortwind.dev`) resolves the page,
 *   - a reserved/system host (`c.shortwind.dev`) resolves NOTHING (no path-based
 *     fallback — serving is subdomain-only),
 *   - a non-subdomain host (apex, workers.dev) resolves nothing regardless of path,
 *   - a second account's same-slug page gets a disambiguated subdomain that
 *     resolves independently (no collision).
 */

declare global {
  interface ImportMeta {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
}
const modules = import.meta.glob("./**/*.ts");

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

async function seedAuth(
  t: ReturnType<typeof convexTest>,
  authUserId: string,
): Promise<string> {
  const accountId = await t.run(async (ctx) => {
    const now = Date.now();
    return ctx.db.insert("accounts", {
      authUserId,
      name: authUserId,
      email: null,
      createdAt: now,
      updatedAt: now,
    });
  });
  const issued = await t.mutation(internal.tokens.issueToken, {
    accountId: accountId as never,
    scopes: ["pages:read", "pages:write"],
  });
  return issued.secret;
}

async function publishPage(
  t: ReturnType<typeof convexTest>,
  bearer: string,
  slug: string,
): Promise<{ id: string; url: string }> {
  const out = await t.action(api.pages.publish, {
    bearer,
    html: '<div class="@card">hi</div>',
    slug,
    recipes: [{ family: "card", source: await cleanCardSource() }],
    lockfile: lockfile(),
    visibility: "public",
  });
  if (!out.ok) throw new Error("publish collided unexpectedly");
  return { id: out.id, url: out.url };
}

describe("CLOUD-SUBDOMAIN — pure host parsing", () => {
  it("extracts the page label from a <label>.shortwind.dev host", () => {
    expect(subdomainLabel("cloud-ops.shortwind.dev")).toBe("cloud-ops");
    expect(subdomainLabel("My-Status.Shortwind.Dev")).toBe("my-status");
  });

  it("returns null for reserved/system labels (never resolve as a page)", () => {
    expect(subdomainLabel("c.shortwind.dev")).toBeNull();
    expect(subdomainLabel("www.shortwind.dev")).toBeNull();
    expect(subdomainLabel("api.shortwind.dev")).toBeNull();
  });

  it("returns null for the apex and for non-3-label hosts (workers.dev etc.)", () => {
    expect(subdomainLabel("shortwind.dev")).toBeNull();
    expect(subdomainLabel("shortwind-cloud-serve.mzed-studio.workers.dev")).toBeNull();
  });
});

describe("CLOUD-SUBDOMAIN — serve.resolveRoute (subdomain-only)", () => {
  it("resolves a per-page subdomain host to the right page", async () => {
    const t = convexTest(schema, modules);
    const bearer = await seedAuth(t, "auth_user_a");
    const { id } = await publishPage(t, bearer, "cloud-ops");

    // The Worker calls resolveRoute(host=<subdomain>.shortwind.dev, path="/").
    const route = await t.query(api.serve.resolveRoute, {
      host: "cloud-ops.shortwind.dev",
      path: "/",
    });
    expect(route).not.toBeNull();
    expect(route!.pageId).toBe(id);
    expect(route!.visibility).toBe("public");
    expect(route!.lifecycle).toBe("active");
  });

  it("does NOT resolve a reserved/system host by path (subdomain-only — no fallback)", async () => {
    const t = convexTest(schema, modules);
    const bearer = await seedAuth(t, "auth_user_b");
    await publishPage(t, bearer, "cloud-ops");

    // c.shortwind.dev is a reserved/system host. With path-based serving removed,
    // it resolves NOTHING regardless of the path that would once have matched.
    const route = await t.query(api.serve.resolveRoute, {
      host: "c.shortwind.dev",
      path: "/cloud-ops",
    });
    expect(route).toBeNull();
  });

  it("a reserved subdomain host resolves nothing", async () => {
    const t = convexTest(schema, modules);
    await seedAuth(t, "auth_user_c");
    const route = await t.query(api.serve.resolveRoute, {
      host: "c.shortwind.dev",
      path: "/",
    });
    expect(route).toBeNull();
  });

  it("a second account's same-slug page gets a disambiguated, independently-resolving subdomain", async () => {
    const t = convexTest(schema, modules);
    const bearerA = await seedAuth(t, "auth_user_d1");
    const bearerB = await seedAuth(t, "auth_user_d2");

    const a = await publishPage(t, bearerA, "cloud-ops");
    const b = await publishPage(t, bearerB, "cloud-ops");

    // A took the bare label; B was disambiguated.
    expect(a.url).toBe("https://cloud-ops.shortwind.app");
    expect(b.url).toMatch(/^https:\/\/cloud-ops-[a-z0-9]+\.shortwind\.app$/);
    expect(b.url).not.toBe(a.url);

    // Each subdomain resolves to its OWN page.
    const labelB = new URL(b.url).hostname.split(".")[0]!;
    const routeA = await t.query(api.serve.resolveRoute, {
      host: "cloud-ops.shortwind.app",
      path: "/",
    });
    const routeB = await t.query(api.serve.resolveRoute, {
      host: `${labelB}.shortwind.app`,
      path: "/",
    });
    expect(routeA!.pageId).toBe(a.id);
    expect(routeB!.pageId).toBe(b.id);
    expect(routeA!.pageId).not.toBe(routeB!.pageId);
  });
});

// Account-level custom-domain resolution (`resolveAccountDomainRoute`) is
// covered end-to-end in `account_domains.test.ts`. The removed per-page
// `resolveCustomDomain` test lived here.
