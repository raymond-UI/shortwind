// @vitest-environment edge-runtime
import { afterEach, describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema.js";
import { api, internal } from "./_generated/api.js";
import { __setLifecycleEdgePort, type LifecycleEdgePort } from "./pages.js";
import { computeBodySha } from "../shared/src/fingerprint.js";
import type { Lockfile } from "../shared/src/lockfile-diff.js";

/**
 * CLOUD-31 — delete (→ tombstone) + visibility integration tests.
 *
 * Exercises the real `deletePage` / `setVisibility` mutations against the real
 * schema with `convex-test`, asserting:
 *   - delete TOMBSTONES (page gone from `find`; `get` still returns it MARKED;
 *     the page record + version rows are RETAINED — not a hard delete),
 *   - delete invalidates the edge cache + evicts the KV route (EdgePort spy),
 *   - visibility change PERSISTS and would invalidate the cache (EdgePort spy),
 *   - both are audited.
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

async function seedAuth(t: ReturnType<typeof convexTest>): Promise<{
  accountId: string;
  bearer: string;
}> {
  const accountId = await t.run(async (ctx) => {
    const now = Date.now();
    return ctx.db.insert("accounts", {
      authUserId: "auth_user_lifecycle",
      name: "Lifecycle Account",
      email: null,
      createdAt: now,
      updatedAt: now,
    });
  });
  const issued = await t.mutation(internal.tokens.issueToken, {
    accountId: accountId as never,
    scopes: ["pages:read", "pages:write"],
  });
  return { accountId, bearer: issued.secret };
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

/** A spying edge port that records every invalidate/evict call. */
function spyEdgePort(): {
  port: LifecycleEdgePort;
  invalidated: string[];
  evicted: { pageId: string; slug: string }[];
} {
  const invalidated: string[] = [];
  const evicted: { pageId: string; slug: string }[] = [];
  return {
    invalidated,
    evicted,
    port: {
      invalidate: async (url) => {
        invalidated.push(url);
      },
      evictRoute: async (route) => {
        evicted.push(route);
      },
    },
  };
}

// Restore the production (no-op) port after each test.
afterEach(() => {
  __setLifecycleEdgePort({
    invalidate: async () => {},
    evictRoute: async () => {},
  });
});

describe("deletePage — delete means tombstone (CLOUD-31)", () => {
  it("tombstones: gone from find, get still returns it marked, record retained", async () => {
    const t = convexTest(schema, modules);
    const { bearer } = await seedAuth(t);
    const pageId = await publishPage(t, bearer, "delete-me");

    // present in find before delete.
    const before = await t.query(api.pages.find, { bearer, q: "delete" });
    expect(before.map((p) => p.id)).toContain(pageId);

    const res = await t.mutation(api.pages.deletePage, {
      bearer,
      id: pageId as never,
    });
    expect(res.lifecycle).toBe("tombstoned");

    // NO LONGER in find (an agent must not get a dead page back).
    const after = await t.query(api.pages.find, { bearer, q: "delete" });
    expect(after.map((p) => p.id)).not.toContain(pageId);

    // get STILL returns the page's metadata, clearly marked tombstoned (audit).
    const got = await t.query(api.pages.get, { bearer, id: pageId as never });
    expect(got).not.toBeNull();
    expect(got!.page.lifecycle).toBe("tombstoned");

    // The page record + version rows are RETAINED (NOT a hard delete).
    await t.run(async (ctx) => {
      const page = await ctx.db.get(pageId as never);
      expect(page).not.toBeNull();
      expect((page as { lifecycle: string }).lifecycle).toBe("tombstoned");
      const versions = await ctx.db
        .query("pageVersions")
        .withIndex("by_page", (q) => q.eq("pageId", pageId as never))
        .collect();
      expect(versions).toHaveLength(1);
    });
  });

  it("invalidates the edge cache + evicts the KV route on delete", async () => {
    const t = convexTest(schema, modules);
    const { bearer } = await seedAuth(t);
    const pageId = await publishPage(t, bearer, "purge-me");

    const spy = spyEdgePort();
    __setLifecycleEdgePort(spy.port);

    await t.mutation(api.pages.deletePage, { bearer, id: pageId as never });

    expect(spy.invalidated.some((u) => u.includes("/purge-me"))).toBe(true);
    expect(spy.evicted.map((e) => e.slug)).toContain("purge-me");
  });

  it("audits the delete (page.delete)", async () => {
    const t = convexTest(schema, modules);
    const { accountId, bearer } = await seedAuth(t);
    const pageId = await publishPage(t, bearer, "audit-delete");
    await t.mutation(api.pages.deletePage, { bearer, id: pageId as never });

    await t.run(async (ctx) => {
      const audit = await ctx.db
        .query("auditLog")
        .withIndex("by_account", (q) => q.eq("accountId", accountId as never))
        .collect();
      expect(audit.some((a) => a.action === "page.delete")).toBe(true);
    });
  });

  it("rejects an unscoped bearer / unknown page", async () => {
    const t = convexTest(schema, modules);
    const { bearer } = await seedAuth(t);
    const pageId = await publishPage(t, bearer, "guarded");
    await expect(
      t.mutation(api.pages.deletePage, {
        bearer: "swc_nope",
        id: pageId as never,
      }),
    ).rejects.toThrow();
  });
});

describe("setVisibility — update + cache invalidation (CLOUD-31)", () => {
  it("persists the new visibility and invalidates the cache", async () => {
    const t = convexTest(schema, modules);
    const { bearer } = await seedAuth(t);
    const pageId = await publishPage(t, bearer, "vis-page");

    const spy = spyEdgePort();
    __setLifecycleEdgePort(spy.port);

    const res = await t.mutation(api.pages.setVisibility, {
      bearer,
      id: pageId as never,
      visibility: "private",
    });
    expect(res.visibility).toBe("private");

    // persisted on the record + reflected in find.
    await t.run(async (ctx) => {
      const page = await ctx.db.get(pageId as never);
      expect((page as { visibility: string }).visibility).toBe("private");
    });
    const found = await t.query(api.pages.find, { bearer, q: "vis" });
    expect(found[0]!.visibility).toBe("private");

    // visibility affects serving → the cache was invalidated.
    expect(spy.invalidated.some((u) => u.includes("/vis-page"))).toBe(true);
  });

  it("#232: evicts the KV route so a public → private flip stops serving at once", async () => {
    const t = convexTest(schema, modules);
    const { bearer } = await seedAuth(t);
    const pageId = await publishPage(t, bearer, "vis-evict");

    const spy = spyEdgePort();
    __setLifecycleEdgePort(spy.port);

    await t.mutation(api.pages.setVisibility, {
      bearer,
      id: pageId as never,
      visibility: "private",
    });

    // Without this the KV record keeps saying `public` for up to the 1h route
    // TTL and the router serves the page with NO bearer check (security bug).
    expect(spy.evicted.map((e) => e.slug)).toContain("vis-evict");
    expect(spy.evicted.map((e) => e.pageId)).toContain(pageId);
  });

  it("audits the visibility change (page.visibility)", async () => {
    const t = convexTest(schema, modules);
    const { accountId, bearer } = await seedAuth(t);
    const pageId = await publishPage(t, bearer, "vis-audit");
    await t.mutation(api.pages.setVisibility, {
      bearer,
      id: pageId as never,
      visibility: "unlisted",
    });
    await t.run(async (ctx) => {
      const audit = await ctx.db
        .query("auditLog")
        .withIndex("by_account", (q) => q.eq("accountId", accountId as never))
        .collect();
      const vis = audit.find((a) => a.action === "page.visibility");
      expect(vis).toBeDefined();
      expect((vis!.metadata as { to: string }).to).toBe("unlisted");
    });
  });
});
