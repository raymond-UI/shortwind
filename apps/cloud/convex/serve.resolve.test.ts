// @vitest-environment edge-runtime
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema.js";
import { api } from "./_generated/api.js";
import { subdomainLabel, pathToSlug } from "./serve.js";
import { computeBodySha } from "../shared/src/fingerprint.js";
import type { Lockfile } from "../shared/src/lockfile-diff.js";

/**
 * CLOUD-SUBDOMAIN — serve resolver integration test (the Vercel hybrid).
 *
 * Exercises `serve.resolveRoute` against the REAL schema + publish action via
 * convex-test, proving:
 *   - a per-page subdomain host (`<subdomain>.shortwind.dev`) resolves the page,
 *   - legacy path-based serving (`c.shortwind.dev/<slug>`) still resolves,
 *   - a reserved/system subdomain (`c.shortwind.dev`) falls through to path-based,
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
  const issued = await t.mutation(api.tokens.issueToken, {
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

  it("returns null for reserved/system labels (fall through to path-based)", () => {
    expect(subdomainLabel("c.shortwind.dev")).toBeNull();
    expect(subdomainLabel("www.shortwind.dev")).toBeNull();
    expect(subdomainLabel("api.shortwind.dev")).toBeNull();
  });

  it("returns null for the apex and for non-3-label hosts (workers.dev etc.)", () => {
    expect(subdomainLabel("shortwind.dev")).toBeNull();
    expect(subdomainLabel("shortwind-cloud-serve.mzed-studio.workers.dev")).toBeNull();
  });

  it("pathToSlug strips slashes and treats root as empty", () => {
    expect(pathToSlug("/cloud-ops")).toBe("cloud-ops");
    expect(pathToSlug("/")).toBe("");
  });
});

describe("CLOUD-SUBDOMAIN — serve.resolveRoute (subdomain + path-based)", () => {
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

  it("keeps legacy path-based serving working (c.shortwind.dev/<slug>)", async () => {
    const t = convexTest(schema, modules);
    const bearer = await seedAuth(t, "auth_user_b");
    const { id } = await publishPage(t, bearer, "cloud-ops");

    // c.shortwind.dev is a reserved/system host → path-as-slug resolution.
    const route = await t.query(api.serve.resolveRoute, {
      host: "c.shortwind.dev",
      path: "/cloud-ops",
    });
    expect(route).not.toBeNull();
    expect(route!.pageId).toBe(id);
  });

  it("a reserved subdomain host with no matching path resolves nothing", async () => {
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
    expect(a.url).toBe("https://cloud-ops.shortwind.dev");
    expect(b.url).toMatch(/^https:\/\/cloud-ops-[a-z0-9]+\.shortwind\.dev$/);
    expect(b.url).not.toBe(a.url);

    // Each subdomain resolves to its OWN page.
    const labelB = new URL(b.url).hostname.split(".")[0]!;
    const routeA = await t.query(api.serve.resolveRoute, {
      host: "cloud-ops.shortwind.dev",
      path: "/",
    });
    const routeB = await t.query(api.serve.resolveRoute, {
      host: `${labelB}.shortwind.dev`,
      path: "/",
    });
    expect(routeA!.pageId).toBe(a.id);
    expect(routeB!.pageId).toBe(b.id);
    expect(routeA!.pageId).not.toBe(routeB!.pageId);
  });
});
