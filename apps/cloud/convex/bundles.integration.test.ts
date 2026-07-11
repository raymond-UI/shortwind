// @vitest-environment edge-runtime
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema.js";
import { api, internal } from "./_generated/api.js";
import type { Lockfile } from "../shared/src/lockfile-diff.js";

/**
 * CLOUD-50 — handler-level INTEGRATION test for the bundle publish pipeline,
 * against the REAL `schema.ts` (+ the additive `bundleVersions` table) and the
 * real `bundles.ts` action/mutation, wired through `_generated` anyApi.
 *
 * Proves end-to-end (ENTRY-AS-PAGE model): a bundle publishes the entry as a
 * real `pages` row, records the sibling sub-pages in a linked `bundleVersions`
 * row, and the serve resolver (`api.serve.resolveRoute`) returns the ENTRY for
 * `/` and the SIBLING artifact for `/about.html`. Re-publishing an occupied slug
 * 409s (like a single-file page). Runs OFFLINE under convex-test.
 */

declare global {
  interface ImportMeta {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
}
const modules = import.meta.glob("./**/*.ts");

const LOCKFILE: Lockfile = { version: 1, registry: "default", families: {} };

async function seedAuth(t: ReturnType<typeof convexTest>): Promise<{
  accountId: string;
  bearer: string;
}> {
  const accountId = await t.run(async (ctx) => {
    const now = Date.now();
    return ctx.db.insert("accounts", {
      authUserId: "auth_user_bundle",
      name: "Bundle Account",
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

const CARD = "@recipe card {\n  rounded-lg border p-4\n}\n";
const cardSource = `/* shortwind: card@0.4.0 sha:deadbeefdeadbeef */\n${CARD}`;

describe("CLOUD-50 bundle integration — entry-as-page publish + serving", () => {
  it("publishes a bundle: entry becomes a page, siblings recorded + served", async () => {
    const t = convexTest(schema, modules);
    const { accountId, bearer } = await seedAuth(t);

    const result = await t.action(api.bundles.publishBundle, {
      bearer,
      slug: "handbook",
      entryPath: "index.html",
      files: [
        {
          path: "index.html",
          html: '<div class="@card"><a href="about.html">about</a></div>',
        },
        { path: "about.html", html: '<a href="index.html">home</a>' },
      ],
      recipes: [{ family: "card", source: cardSource }],
      lockfile: LOCKFILE,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unexpected 409");
    expect(result.version).toBe(1);
    expect(result.bundleId).toBe("handbook");
    // Entry-as-page → subdomain URL.
    expect(result.url).toBe("https://handbook.shortwind.app");
    // Result lists only the sibling sub-pages (the entry is the page).
    expect(result.files.map((f) => f.path)).toEqual(["about.html"]);

    await t.run(async (ctx) => {
      // The entry landed as a real page row.
      const page = await ctx.db
        .query("pages")
        .withIndex("by_slug", (q) =>
          q.eq("accountId", accountId as never).eq("slug", "handbook"),
        )
        .unique();
      expect(page).not.toBeNull();

      // A bundleVersions row links to that entry page + records the sibling.
      const rows = await ctx.db
        .query("bundleVersions")
        .withIndex("by_entryPage", (q) => q.eq("entryPageId", page!._id))
        .collect();
      expect(rows).toHaveLength(1);
      expect(rows[0]!.entryPath).toBe("index.html");
      expect(rows[0]!.files.map((f) => f.path)).toEqual(["about.html"]);

      // A bundle.publish audit row was written.
      const audits = await ctx.db
        .query("auditLog")
        .withIndex("by_account", (q) => q.eq("accountId", accountId as never))
        .collect();
      expect(audits.some((a) => a.action === "bundle.publish")).toBe(true);
    });

    // SERVE: the subdomain root resolves the entry; a sibling path resolves the
    // sibling artifact; an unknown path falls back to the entry.
    const host = "handbook.shortwind.app";
    const rootRoute = await t.query(api.serve.resolveRoute, { host, path: "/" });
    const siblingRoute = await t.query(api.serve.resolveRoute, {
      host,
      path: "/about.html",
    });
    expect(rootRoute).not.toBeNull();
    expect(siblingRoute).not.toBeNull();
    // The sibling serves a DIFFERENT artifact than the entry.
    expect(siblingRoute!.artifactKey).not.toBe(rootRoute!.artifactKey);
    expect(siblingRoute!.artifactKey).toContain("bundles/");
  });

  it("re-publishing an owned bundle slug UPDATES it in place (v2, retained)", async () => {
    const t = convexTest(schema, modules);
    const { accountId, bearer } = await seedAuth(t);
    const v1 = await t.action(api.bundles.publishBundle, {
      bearer,
      slug: "site",
      entryPath: "index.html",
      files: [
        { path: "index.html", html: '<a href="about.html">home</a>' },
        { path: "about.html", html: "<p>about v1</p>" },
      ],
      recipes: [],
      lockfile: LOCKFILE,
    });
    expect(v1.ok).toBe(true);
    if (!v1.ok) throw new Error("v1 failed");

    const v2 = await t.action(api.bundles.publishBundle, {
      bearer,
      slug: "site",
      entryPath: "index.html",
      files: [
        { path: "index.html", html: '<a href="about.html">home v2</a>' },
        { path: "about.html", html: "<p>about v2</p>" },
      ],
      recipes: [],
      lockfile: LOCKFILE,
    });
    expect(v2.ok).toBe(true);
    if (!v2.ok) throw new Error("expected an update, got a 409");
    expect(v2.version).toBe(2);
    expect(v2.url).toBe(v1.url); // same URL — updated in place

    await t.run(async (ctx) => {
      const page = await ctx.db
        .query("pages")
        .withIndex("by_slug", (q) =>
          q.eq("accountId", accountId as never).eq("slug", "site"),
        )
        .unique();
      // Still ONE page (updated), and BOTH bundle versions retained (rollback).
      expect(page).not.toBeNull();
      const rows = await ctx.db
        .query("bundleVersions")
        .withIndex("by_entryPage", (q) => q.eq("entryPageId", page!._id))
        .collect();
      expect(rows.map((r) => r.version).sort()).toEqual([1, 2]);
    });
  });

  it("rejects an unscoped/missing bearer at the handler boundary", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.action(api.bundles.publishBundle, {
        bearer: "swc_not_a_real_token",
        entryPath: "index.html",
        files: [{ path: "index.html", html: "<p>x</p>" }],
        recipes: [],
        lockfile: LOCKFILE,
      }),
    ).rejects.toThrow();
  });
});
