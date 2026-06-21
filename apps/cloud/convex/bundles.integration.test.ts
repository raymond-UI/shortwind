// @vitest-environment edge-runtime
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema.js";
import { api } from "./_generated/api.js";

/**
 * CLOUD-50 — handler-level INTEGRATION test for the bundle publish pipeline,
 * against the REAL `schema.ts` (+ the additive `bundleVersions` table) and the
 * real `bundles.ts` action/query/mutation, wired through `_generated` anyApi.
 *
 * Proves end-to-end: a bundle with internal cross-file links publishes; the
 * links resolve to served siblings (the rewrite landed in the stored version's
 * file set + the entry routes to the entry file); the bundle is versioned
 * forward-only and a re-publish retains the prior version (rollback). Runs
 * OFFLINE under convex-test (same pinning note as integration.test.ts).
 */

declare global {
  interface ImportMeta {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
}
const modules = import.meta.glob("./**/*.ts");

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
  const issued = await t.mutation(api.tokens.issueToken, {
    accountId: accountId as never,
    scopes: ["pages:read", "pages:write"],
  });
  return { accountId, bearer: issued.secret };
}

const CARD = "@recipe card {\n  rounded-lg border p-4\n}\n";
const cardSource = `/* shortwind: card@0.4.0 sha:deadbeefdeadbeef */\n${CARD}`;

describe("CLOUD-50 bundle integration — publish, route, version retention", () => {
  it("publishes a linked bundle; links resolve to served siblings; entry routes", async () => {
    const t = convexTest(schema, modules);
    const { accountId, bearer } = await seedAuth(t);

    const result = await t.action(api.bundles.publishBundle, {
      bearer,
      slug: "handbook",
      entryPath: "index.html",
      files: [
        {
          path: "index.html",
          html: '<div class="@card"><a href="./about.html">about</a></div>',
        },
        { path: "about.html", html: '<a href="index.html">home</a>' },
      ],
      recipes: [{ family: "card", source: cardSource }],
      lockfile: { card: "0.4.0" },
    });

    expect(result.ok).toBe(true);
    expect(result.version).toBe(1);
    expect(result.bundleId).toBe("handbook");
    expect(result.url).toContain("/handbook");
    expect(result.files).toHaveLength(2);

    const entry = result.files.find((f) => f.entry)!;
    expect(entry.path).toBe("index.html");

    // the bundleVersions row actually landed (handler-level scoping proof) and
    // carries the entry + the served sibling keys.
    await t.run(async (ctx) => {
      const rows = await ctx.db
        .query("bundleVersions")
        .withIndex("by_slug", (q) =>
          q.eq("accountId", accountId as never).eq("slug", "handbook"),
        )
        .collect();
      expect(rows).toHaveLength(1);
      const row = rows[0]!;
      expect(row.version).toBe(1);
      expect(row.entryPath).toBe("index.html");
      expect(row.files.map((f) => f.path).sort()).toEqual([
        "about.html",
        "index.html",
      ]);
      // exactly one entry file is flagged.
      expect(row.files.filter((f) => f.entry)).toHaveLength(1);
      // a bundle.publish audit row was written.
      const audits = await ctx.db
        .query("auditLog")
        .withIndex("by_account", (q) => q.eq("accountId", accountId as never))
        .collect();
      expect(audits.some((a) => a.action === "bundle.publish")).toBe(true);
    });
  });

  it("is forward-only: re-publishing the slug bumps the version, retaining v1 for rollback", async () => {
    const t = convexTest(schema, modules);
    const { accountId, bearer } = await seedAuth(t);

    const files = [
      { path: "index.html", html: '<a href="./about.html">about</a>' },
      { path: "about.html", html: "<p>about</p>" },
    ];
    const v1 = await t.action(api.bundles.publishBundle, {
      bearer,
      slug: "site",
      entryPath: "index.html",
      files,
      recipes: [],
      lockfile: {},
    });
    const v2 = await t.action(api.bundles.publishBundle, {
      bearer,
      slug: "site",
      entryPath: "index.html",
      files: [
        { path: "index.html", html: '<a href="./about.html">about v2</a>' },
        { path: "about.html", html: "<p>about v2</p>" },
      ],
      recipes: [],
      lockfile: {},
    });
    expect(v1.version).toBe(1);
    expect(v2.version).toBe(2);

    await t.run(async (ctx) => {
      const rows = await ctx.db
        .query("bundleVersions")
        .withIndex("by_slug", (q) =>
          q.eq("accountId", accountId as never).eq("slug", "site"),
        )
        .collect();
      // BOTH versions retained (frozen) — rollback target still present.
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
        lockfile: {},
      }),
    ).rejects.toThrow();
  });
});
