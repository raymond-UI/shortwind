// @vitest-environment edge-runtime
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema.js";
import { api, internal } from "./_generated/api.js";
import { computeBodySha } from "../shared/src/fingerprint.js";
import type { Lockfile } from "../shared/src/lockfile-diff.js";

/**
 * CLOUD-51 — expiry sweep + project-group filter (PRD §10 Phase 3 optional).
 *
 * Handler-level integration with `convex-test` (same harness + offline pinning
 * as integration.test.ts). Proves:
 *   - the scheduled `sweepExpired` mutation TOMBSTONES an expired active page
 *     (excluded from `find` afterwards; the record + version rows are RETAINED —
 *     NOT hard-deleted) via the same `applyLifecycle('delete')` path as a user
 *     delete;
 *   - a non-expired page survives the sweep;
 *   - the `group` filter in `find` returns only that group's pages;
 *   - the new `expiresAt` / `projectGroup` fields appear on the summary;
 *   - existing find/get/publish are unaffected when the new args are omitted.
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
      authUserId: "auth_user_expiry",
      name: "Expiry Account",
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

async function publish(
  t: ReturnType<typeof convexTest>,
  bearer: string,
  args: {
    slug: string;
    expiresAt?: number | null;
    projectGroup?: string | null;
  },
): Promise<string> {
  const out = await t.action(api.pages.publish, {
    bearer,
    html: '<div class="@card">hi</div>',
    slug: args.slug,
    recipes: [{ family: "card", source: await cleanCardSource() }],
    lockfile: lockfile(),
    ...(args.expiresAt !== undefined ? { expiresAt: args.expiresAt } : {}),
    ...(args.projectGroup !== undefined
      ? { projectGroup: args.projectGroup }
      : {}),
  });
  if (!out.ok) throw new Error(`publish collided for ${args.slug}`);
  return out.id;
}

describe("CLOUD-51 expiry sweep", () => {
  it("tombstones an expired page (NOT a hard delete); non-expired survives", async () => {
    const t = convexTest(schema, modules);
    const { bearer } = await seedAuth(t);

    const past = Date.now() - 60_000;
    const future = Date.now() + 60 * 60 * 1000;
    const expiredId = await publish(t, bearer, {
      slug: "expired-page",
      expiresAt: past,
    });
    const liveId = await publish(t, bearer, {
      slug: "live-page",
      expiresAt: future,
    });

    // Both findable before the sweep.
    const before = await t.query(api.pages.find, { bearer });
    expect(new Set(before.map((p) => p.id))).toEqual(
      new Set([expiredId, liveId]),
    );

    // Run the cron sweep mutation directly (convex-test has no cron scheduler).
    const swept = await t.mutation(internal.pages.sweepExpired, {});
    expect(swept.tombstoned).toBe(1);

    // The expired page is gone from find; the live one survives.
    const after = await t.query(api.pages.find, { bearer });
    expect(after.map((p) => p.id)).toEqual([liveId]);

    // RETAINED, not hard-deleted: the record + its version rows still exist, and
    // its lifecycle is `tombstoned` (the user-delete tombstone path). `get`
    // still surfaces it for audit.
    await t.run(async (ctx) => {
      const page = await ctx.db.get(expiredId as never);
      expect(page).not.toBeNull();
      expect((page as { lifecycle: string }).lifecycle).toBe("tombstoned");
      const versions = await ctx.db
        .query("pageVersions")
        .withIndex("by_page", (q) => q.eq("pageId", expiredId as never))
        .collect();
      expect(versions.length).toBeGreaterThanOrEqual(1);
    });
    const got = await t.query(api.pages.get, { bearer, id: expiredId as never });
    expect(got).not.toBeNull();
    if (got === null) throw new Error("get returned null");
    expect(got.page.lifecycle).toBe("tombstoned");

    // A second sweep is a no-op (the page is already tombstoned).
    const again = await t.mutation(internal.pages.sweepExpired, {});
    expect(again.tombstoned).toBe(0);
  });

  it("leaves pages without an expiry untouched", async () => {
    const t = convexTest(schema, modules);
    const { bearer } = await seedAuth(t);
    const id = await publish(t, bearer, { slug: "no-expiry" });

    const swept = await t.mutation(internal.pages.sweepExpired, {});
    expect(swept.tombstoned).toBe(0);
    const found = await t.query(api.pages.find, { bearer });
    expect(found.map((p) => p.id)).toEqual([id]);
  });
});

describe("CLOUD-51 project-group filter + summary fields", () => {
  it("find?group= returns only that group's pages", async () => {
    const t = convexTest(schema, modules);
    const { bearer } = await seedAuth(t);

    const aId = await publish(t, bearer, {
      slug: "alpha",
      projectGroup: "marketing",
    });
    await publish(t, bearer, { slug: "beta", projectGroup: "docs" });
    await publish(t, bearer, { slug: "gamma" }); // ungrouped

    const marketing = await t.query(api.pages.find, {
      bearer,
      group: "marketing",
    });
    expect(marketing.map((p) => p.id)).toEqual([aId]);
    expect(marketing[0]!.projectGroup).toBe("marketing");

    // No group filter → all three pages.
    const all = await t.query(api.pages.find, { bearer });
    expect(all).toHaveLength(3);

    // A group with no pages → empty.
    const empty = await t.query(api.pages.find, { bearer, group: "nope" });
    expect(empty).toHaveLength(0);
  });

  it("surfaces expiresAt / projectGroup on the summary", async () => {
    const t = convexTest(schema, modules);
    const { bearer } = await seedAuth(t);
    const exp = Date.now() + 24 * 60 * 60 * 1000;
    await publish(t, bearer, {
      slug: "tagged",
      expiresAt: exp,
      projectGroup: "marketing",
    });

    const found = await t.query(api.pages.find, { bearer });
    expect(found).toHaveLength(1);
    expect(found[0]!.expiresAt).toBe(exp);
    expect(found[0]!.projectGroup).toBe("marketing");
  });

  it("existing publish/find/get are unaffected when the new args are omitted", async () => {
    const t = convexTest(schema, modules);
    const { bearer } = await seedAuth(t);
    const id = await publish(t, bearer, { slug: "plain" });

    const found = await t.query(api.pages.find, { bearer, q: "plain" });
    expect(found).toHaveLength(1);
    expect(found[0]!.id).toBe(id);
    // Defaults: no expiry, no group.
    expect(found[0]!.expiresAt).toBeNull();
    expect(found[0]!.projectGroup).toBeNull();

    const got = await t.query(api.pages.get, { bearer, id: id as never });
    expect(got).not.toBeNull();
    if (got === null) throw new Error("get returned null");
    expect(got.page.expiresAt).toBeNull();
    expect(got.page.projectGroup).toBeNull();
    expect(got.versions).toHaveLength(1);
  });
});
