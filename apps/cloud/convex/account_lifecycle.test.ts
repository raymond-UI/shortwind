// @vitest-environment edge-runtime
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema.js";
import { api, internal } from "./_generated/api.js";
import { computeBodySha } from "../shared/src/fingerprint.js";
import type { Lockfile } from "../shared/src/lockfile-diff.js";

/**
 * #202 — GDPR/CCPA account data export + closure, reconciled with the §8.2
 * preserve-not-delete legal hold. Offline under convex-test.
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

async function seedAuth(t: ReturnType<typeof convexTest>) {
  const accountId = await t.run(async (ctx) =>
    ctx.db.insert("accounts", {
      authUserId: "auth_user_acct",
      name: "Acct",
      email: "a@example.com",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
  const issued = await t.mutation(internal.tokens.issueToken, {
    accountId: accountId as never,
    scopes: ["pages:read", "pages:write"],
  });
  return { accountId, bearer: issued.secret };
}

async function publish(t: ReturnType<typeof convexTest>, bearer: string, slug: string) {
  const out = await t.action(api.pages.publish, {
    bearer,
    html: '<div class="@card">hi</div>',
    slug,
    recipes: [{ family: "card", source: await cleanCardSource() }],
    lockfile: lockfile(),
    visibility: "public",
  });
  if (!out.ok) throw new Error("collide");
  return out.id;
}

describe("exportAccountData", () => {
  it("returns the account's own pages + profile", async () => {
    const t = convexTest(schema, modules);
    const { bearer } = await seedAuth(t);
    await publish(t, bearer, "export-me");

    const bundle = await t.query(api.account_lifecycle.exportAccountData, { bearer });
    expect(bundle.account?.email).toBe("a@example.com");
    expect(bundle.pages.map((p) => p.slug)).toContain("export-me");
    expect(bundle.pageVersions.length).toBeGreaterThanOrEqual(1);
  });
});

describe("closeAccount", () => {
  it("revokes all credentials and tombstones active pages", async () => {
    const t = convexTest(schema, modules);
    const { bearer } = await seedAuth(t);
    await publish(t, bearer, "close-me");

    const res = await t.mutation(api.account_lifecycle.closeAccount, { bearer });
    expect(res.revokedTokens).toBeGreaterThanOrEqual(1);
    expect(res.tombstonedPages).toBe(1);

    // The (now-revoked) token can no longer act.
    await expect(
      t.query(api.account_lifecycle.exportAccountData, { bearer }),
    ).rejects.toThrow();
  });

  it("PRESERVES quarantined pages (legal hold survives erasure)", async () => {
    const t = convexTest(schema, modules);
    const { accountId, bearer } = await seedAuth(t);
    const pageId = await publish(t, bearer, "held");
    // Quarantine it (self-account write token can quarantine its own page).
    await t.mutation(api.moderation.quarantinePage, {
      bearer,
      id: pageId as never,
      reason: "hold",
    });

    const res = await t.mutation(api.account_lifecycle.closeAccount, { bearer });
    expect(res.preservedPages).toBe(1);
    expect(res.tombstonedPages).toBe(0);

    // The quarantined page + its moderation case survive the closure.
    await t.run(async (ctx) => {
      const page = await ctx.db.get(pageId as never);
      expect((page as { lifecycle: string }).lifecycle).toBe("quarantined");
      const cases = await ctx.db
        .query("moderation")
        .withIndex("by_account", (q) => q.eq("accountId", accountId as never))
        .collect();
      expect(cases).toHaveLength(1);
    });
  });
});
