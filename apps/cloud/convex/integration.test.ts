// @vitest-environment edge-runtime
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema.js";
import { api, internal } from "./_generated/api.js";
import { computeBodySha } from "../shared/src/fingerprint.js";
import type { Lockfile } from "../shared/src/lockfile-diff.js";

/**
 * CLOUD-30a — handler-level INTEGRATION test.
 *
 * The prior waves unit-tested the PURE cores (publish-core, find/get
 * projections, the auth guard) with in-memory ports, and asserted the schema
 * SHAPE statically — but no test exercised the real Convex functions against the
 * real schema end-to-end. Reviewers flagged that "handler-level scoping" gap.
 *
 * This closes it with `convex-test`, which runs the actual `schema.ts` +
 * `pages.ts` actions/queries/mutations in-process (no live deployment, no R2 —
 * the storage/edge ports are the documented no-op placeholders), wired through
 * the real `_generated` `anyApi` refs. The flow proves:
 *
 *   publish (action) → page + pageVersion rows committed
 *     → find (query) returns the new page summary
 *     → get  (query) returns the page + its version history
 *     → update (action) bumps the version, retaining the prior one (PRD §5.6).
 *
 * convex-test runs OFFLINE here: see the PR notes for the convex@1.31.6 /
 * convex-test@0.0.41 pinning (newer convex-test requires the convex 1.32+
 * `getConvexSize` syscall this workspace's convex predates).
 */

// `import.meta.glob` enumerates every module convex-test runs in-process. It is
// a Vite/vitest transform that is STATICALLY replaced at transform time, so it
// must be written literally (not aliased). It is not part of the ambient
// `ImportMeta` lib this workspace types against (`@cloudflare/workers-types`
// only), so the shape is declared locally here rather than widening the package
// tsconfig `types`/`lib` (this file is the sole `import.meta.glob` user).
declare global {
  interface ImportMeta {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
}
const modules = import.meta.glob("./**/*.ts");

/** A sealed `@recipe card` file whose header sha MATCHES its body (untouched). */
const CARD_BODY = "@recipe card {\n  rounded-lg border p-4\n}\n";
async function cleanCardSource(): Promise<string> {
  const sha = await computeBodySha(`x\n${CARD_BODY}`);
  return `/* shortwind: card@0.4.0 sha:${sha} — DO NOT EDIT THIS LINE */\n${CARD_BODY}`;
}

/** The incoming lockfile pinning the `card` family. */
function lockfile(): Lockfile {
  return {
    version: 1,
    registry: "default",
    families: { card: { version: "0.4.0", sha: "deadbeefdeadbeef" } },
  };
}

/**
 * Seed an account + a `pages:read pages:write` bearer through the REAL
 * `issueToken` mutation (so the auth guard's hash-lookup matches), returning the
 * plaintext secret the actions take as `bearer`.
 */
async function seedAuth(t: ReturnType<typeof convexTest>): Promise<{
  accountId: string;
  bearer: string;
}> {
  const accountId = await t.run(async (ctx) => {
    const now = Date.now();
    return ctx.db.insert("accounts", {
      authUserId: "auth_user_integration",
      name: "Integration Account",
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

describe("CLOUD-30a integration — publish → find → get → update", () => {
  it("runs the full page lifecycle against the real schema + functions", async () => {
    const t = convexTest(schema, modules);
    const { accountId, bearer } = await seedAuth(t);

    // 1. publish — the thick action. Writes page + pageVersion rows.
    const published = await t.action(api.pages.publish, {
      bearer,
      html: '<div class="@card">hello</div>',
      slug: "my-status-page",
      recipes: [{ family: "card", source: await cleanCardSource() }],
      lockfile: lockfile(),
      tags: ["ops"],
      visibility: "public",
    });
    expect(published.ok).toBe(true);
    if (!published.ok) throw new Error("publish collided unexpectedly");
    expect(published.version).toBe(1);
    // CLOUD-SUBDOMAIN: the canonical URL is now the per-page subdomain.
    expect(published.url).toBe("https://my-status-page.shortwind.dev");
    const pageId = published.id;

    // page + version rows actually landed (handler-level scoping proof).
    await t.run(async (ctx) => {
      const page = await ctx.db.get(pageId as never);
      expect(page).not.toBeNull();
      expect((page as { slug: string }).slug).toBe("my-status-page");
      // CLOUD-SUBDOMAIN: the page stores its globally-unique subdomain label
      // (the bare slug, since it is free across all accounts here).
      expect((page as { subdomain?: string }).subdomain).toBe("my-status-page");
      expect((page as { accountId: string }).accountId).toBe(accountId);
      expect((page as { currentVersion: number }).currentVersion).toBe(1);

      const versions = await ctx.db
        .query("pageVersions")
        .withIndex("by_page", (q) => q.eq("pageId", pageId as never))
        .collect();
      expect(versions).toHaveLength(1);
      expect(versions[0]!.version).toBe(1);
    });

    // 2. find — the read query returns the new page summary, account-scoped.
    const found = await t.query(api.pages.find, { bearer, q: "status" });
    expect(found).toHaveLength(1);
    expect(found[0]!.id).toBe(pageId);
    expect(found[0]!.slug).toBe("my-status-page");
    expect(found[0]!.tags).toEqual(["ops"]);
    expect(found[0]!.currentVersion).toBe(1);

    // a non-matching query returns empty (no cross-leak / no false positive).
    const none = await t.query(api.pages.find, { bearer, q: "nonexistent" });
    expect(none).toHaveLength(0);

    // 3. get — metadata + the full version history (newest first).
    const got = await t.query(api.pages.get, { bearer, id: pageId as never });
    expect(got).not.toBeNull();
    if (got === null) throw new Error("get returned null");
    expect(got.page.id).toBe(pageId);
    expect(got.versions).toHaveLength(1);
    expect(got.versions[0]!.version).toBe(1);

    // 4. update — bumps to v2, keeps the URL, retains v1 (PRD §5.6).
    const updated = await t.action(api.pages.update, {
      bearer,
      pageId: pageId as never,
      html: '<div class="@card">hello v2</div>',
      recipes: [{ family: "card", source: await cleanCardSource() }],
      lockfile: lockfile(),
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) throw new Error("update collided unexpectedly");
    expect(updated.version).toBe(2);
    expect(updated.id).toBe(pageId);
    expect(updated.url).toBe(published.url);

    // get now reports both versions; the page points at v2.
    const afterUpdate = await t.query(api.pages.get, {
      bearer,
      id: pageId as never,
    });
    if (afterUpdate === null) throw new Error("get returned null after update");
    expect(afterUpdate.page.currentVersion).toBe(2);
    expect(afterUpdate.versions.map((v) => v.version)).toEqual([2, 1]);
  });

  it("rejects an unscoped/missing bearer at the handler boundary", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.query(api.pages.find, { bearer: "swc_not_a_real_token" }),
    ).rejects.toThrow();
  });
});
