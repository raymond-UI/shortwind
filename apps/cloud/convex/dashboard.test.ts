import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema.js";
import { api, internal } from "./_generated/api.js";

/**
 * CLOUD-35 — dashboard oversight queries, in-harness against the REAL schema +
 * functions (the convex-test pattern from integration.test.ts / moderation.test.ts).
 *
 * Proves the five reactive oversight queries + the policy mutation:
 *   - account scoping (no cross-account leakage)
 *   - listPages attaches version history (newest first)
 *   - listRecipeEditEvents is the DISTINCT §5.4 feed and computes "affects N
 *     pages" from the account's ACTIVE pages
 *   - listModeration surfaces the account's cases (preserve-not-delete pointer)
 *   - getAccountPolicy defaults safe; setAccountPolicy persists + round-trips
 */

declare global {
  interface ImportMeta {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
}
const modules = import.meta.glob("./**/*.ts");

async function seedAccount(
  t: ReturnType<typeof convexTest>,
  authUserId: string,
): Promise<{ accountId: string; readBearer: string; writeBearer: string }> {
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
  // A read-scoped operator bearer through the REAL issueToken so the auth
  // guard's hash-lookup matches (the dashboard holds a pages:read bearer).
  const issued = await t.mutation(internal.tokens.issueToken, {
    accountId: accountId as never,
    scopes: ["pages:read"],
  });
  // A write-scoped bearer for the mutating verb: setAccountPolicy now requires
  // pages:write on the bearer path (audit #152).
  const issuedWrite = await t.mutation(internal.tokens.issueToken, {
    accountId: accountId as never,
    scopes: ["pages:read", "pages:write"],
  });
  return {
    accountId,
    readBearer: issued.secret,
    writeBearer: issuedWrite.secret,
  };
}

describe("dashboard.listPages", () => {
  it("lists the account's pages with version history, newest-updated first", async () => {
    const t = convexTest(schema, modules);
    const { accountId, readBearer } = await seedAccount(t, "acct_pages");

    const { pageId } = await t.run(async (ctx) => {
      const now = Date.now();
      const pageId = await ctx.db.insert("pages", {
        accountId: accountId as never,
        slug: "launch",
        customDomain: null,
        visibility: "public",
        lifecycle: "active",
        tags: ["ops"],
        currentVersionId: null,
        // CLOUD-51 (additive): the pages table now requires these fields.
        expiresAt: null,
        projectGroup: null,
        currentVersion: 2,
        createdAt: now,
        updatedAt: now + 1000,
      });
      await ctx.db.insert("pageVersions", {
        pageId,
        accountId: accountId as never,
        version: 1,
        artifactKey: "r2/launch/1",
        expandedHash: "exp1",
        sourceHash: "src1",
        lockfile: {},
        createdAt: now,
      });
      await ctx.db.insert("pageVersions", {
        pageId,
        accountId: accountId as never,
        version: 2,
        artifactKey: "r2/launch/2",
        expandedHash: "exp2",
        sourceHash: "src2",
        lockfile: {},
        createdAt: now + 1000,
      });
      return { pageId };
    });

    const rows = await t.query(api.dashboard.listPages, { bearer: readBearer });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.page.id).toBe(pageId);
    expect(rows[0]!.page.slug).toBe("launch");
    // version history newest-first.
    expect(rows[0]!.versions.map((v) => v.version)).toEqual([2, 1]);
  });

  it("does not leak another account's pages", async () => {
    const t = convexTest(schema, modules);
    const mine = await seedAccount(t, "acct_a");
    const other = await seedAccount(t, "acct_b");
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("pages", {
        accountId: other.accountId as never,
        slug: "secret",
        customDomain: null,
        visibility: "private",
        lifecycle: "active",
        tags: [],
        currentVersionId: null,
        // CLOUD-51 (additive): the pages table now requires these fields.
        expiresAt: null,
        projectGroup: null,
        currentVersion: 1,
        createdAt: now,
        updatedAt: now,
      });
    });
    const rows = await t.query(api.dashboard.listPages, {
      bearer: mine.readBearer,
    });
    expect(rows).toHaveLength(0);
  });
});

describe("dashboard.listRecipeEditEvents (PRD §5.4 distinct feed)", () => {
  it("returns edits newest-first and computes affects-N from ACTIVE pages", async () => {
    const t = convexTest(schema, modules);
    const { accountId, readBearer } = await seedAccount(t, "acct_recipe");

    await t.run(async (ctx) => {
      const now = Date.now();
      // 2 active pages + 1 tombstoned → affectedPages must be 2.
      for (const [slug, lifecycle] of [
        ["a", "active"],
        ["b", "active"],
        ["c", "tombstoned"],
      ] as const) {
        await ctx.db.insert("pages", {
          accountId: accountId as never,
          slug,
          customDomain: null,
          visibility: "public",
          lifecycle,
          tags: [],
          currentVersionId: null,
        // CLOUD-51 (additive): the pages table now requires these fields.
        expiresAt: null,
        projectGroup: null,
          currentVersion: 1,
          createdAt: now,
          updatedAt: now,
        });
      }
      await ctx.db.insert("recipeEditEvents", {
        accountId: accountId as never,
        family: "card",
        fromVersion: "0.4.0",
        toVersion: "0.5.0",
        bodySha: "sha_new",
        actorTokenId: null,
        createdAt: now,
      });
      await ctx.db.insert("recipeEditEvents", {
        accountId: accountId as never,
        family: "button",
        fromVersion: null,
        toVersion: "0.1.0",
        bodySha: "sha_btn",
        actorTokenId: null,
        createdAt: now + 1000,
      });
    });

    const rows = await t.query(api.dashboard.listRecipeEditEvents, {
      bearer: readBearer,
    });
    expect(rows).toHaveLength(2);
    // newest first.
    expect(rows[0]!.family).toBe("button");
    expect(rows[1]!.family).toBe("card");
    // affects-N counts only ACTIVE pages (2), not the tombstoned one.
    expect(rows[0]!.affectedPages).toBe(2);
    expect(rows[1]!.affectedPages).toBe(2);
    // the §5.4 transition fields the dashboard renders distinctly.
    expect(rows[1]!.fromVersion).toBe("0.4.0");
    expect(rows[1]!.toVersion).toBe("0.5.0");
  });
});

describe("dashboard.listAuditLog & listModeration", () => {
  it("returns the account's audit entries newest-first", async () => {
    const t = convexTest(schema, modules);
    const { accountId, readBearer } = await seedAccount(t, "acct_audit");
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("auditLog", {
        accountId: accountId as never,
        action: "page.publish",
        targetId: "page_1",
        actorTokenId: null,
        metadata: {},
        createdAt: now,
      });
      await ctx.db.insert("auditLog", {
        accountId: accountId as never,
        action: "page.delete",
        targetId: "page_1",
        actorTokenId: null,
        metadata: {},
        createdAt: now + 1000,
      });
    });
    const rows = await t.query(api.dashboard.listAuditLog, {
      bearer: readBearer,
    });
    expect(rows[0]!.action).toBe("page.delete");
    expect(rows[1]!.action).toBe("page.publish");
  });

  it("returns only the account's moderation cases with the sealed key", async () => {
    const t = convexTest(schema, modules);
    const mine = await seedAccount(t, "acct_mod_a");
    const other = await seedAccount(t, "acct_mod_b");
    await t.run(async (ctx) => {
      const now = Date.now();
      const myPage = await ctx.db.insert("pages", {
        accountId: mine.accountId as never,
        slug: "p",
        customDomain: null,
        visibility: "public",
        lifecycle: "quarantined",
        tags: [],
        currentVersionId: null,
        // CLOUD-51 (additive): the pages table now requires these fields.
        expiresAt: null,
        projectGroup: null,
        currentVersion: 1,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("moderation", {
        pageId: myPage,
        accountId: mine.accountId as never,
        state: "quarantined",
        reason: "reported",
        reporterContact: null,
        ncmecReportId: null,
        preservedR2Key: "sealed/p",
        preservationExpiresAt: null,
        createdAt: now,
        updatedAt: now,
      });
      // another account's case must NOT appear.
      const otherPage = await ctx.db.insert("pages", {
        accountId: other.accountId as never,
        slug: "q",
        customDomain: null,
        visibility: "public",
        lifecycle: "quarantined",
        tags: [],
        currentVersionId: null,
        // CLOUD-51 (additive): the pages table now requires these fields.
        expiresAt: null,
        projectGroup: null,
        currentVersion: 1,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert("moderation", {
        pageId: otherPage,
        accountId: other.accountId as never,
        state: "reported",
        reason: "x",
        reporterContact: null,
        ncmecReportId: null,
        preservedR2Key: null,
        preservationExpiresAt: null,
        createdAt: now,
        updatedAt: now,
      });
    });
    const rows = await t.query(api.dashboard.listModeration, {
      bearer: mine.readBearer,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.state).toBe("quarantined");
    expect(rows[0]!.preservedR2Key).toBe("sealed/p");
  });
});

describe("dashboard policy (getAccountPolicy / setAccountPolicy)", () => {
  it("defaults to customDomainNeedsApproval=true when never set", async () => {
    const t = convexTest(schema, modules);
    const { readBearer } = await seedAccount(t, "acct_pol_default");
    const policy = await t.query(api.dashboard.getAccountPolicy, {
      bearer: readBearer,
    });
    expect(policy.customDomainNeedsApproval).toBe(true);
    expect(policy.updatedAt).toBeNull();
  });

  it("persists a toggle and reads it back (the one mutation)", async () => {
    const t = convexTest(schema, modules);
    const { readBearer, writeBearer } = await seedAccount(t, "acct_pol_set");

    const set = await t.mutation(api.dashboard.setAccountPolicy, {
      bearer: writeBearer,
      customDomainNeedsApproval: false,
    });
    expect(set.customDomainNeedsApproval).toBe(false);
    expect(set.updatedAt).not.toBeNull();

    const read = await t.query(api.dashboard.getAccountPolicy, {
      bearer: readBearer,
    });
    expect(read.customDomainNeedsApproval).toBe(false);

    // toggling back round-trips.
    const set2 = await t.mutation(api.dashboard.setAccountPolicy, {
      bearer: writeBearer,
      customDomainNeedsApproval: true,
    });
    expect(set2.customDomainNeedsApproval).toBe(true);
    const read2 = await t.query(api.dashboard.getAccountPolicy, {
      bearer: readBearer,
    });
    expect(read2.customDomainNeedsApproval).toBe(true);
  });

  it("rejects setAccountPolicy from a read-only bearer (audit #152)", async () => {
    const t = convexTest(schema, modules);
    const { readBearer } = await seedAccount(t, "acct_pol_ro");
    await expect(
      t.mutation(api.dashboard.setAccountPolicy, {
        bearer: readBearer,
        customDomainNeedsApproval: false,
      }),
    ).rejects.toThrow();
    // The safe default is untouched after the rejected write.
    const policy = await t.query(api.dashboard.getAccountPolicy, {
      bearer: readBearer,
    });
    expect(policy.customDomainNeedsApproval).toBe(true);
  });

  it("scopes policy per account (one account's toggle does not affect another)", async () => {
    const t = convexTest(schema, modules);
    const a = await seedAccount(t, "acct_pol_iso_a");
    const b = await seedAccount(t, "acct_pol_iso_b");
    await t.mutation(api.dashboard.setAccountPolicy, {
      bearer: a.writeBearer,
      customDomainNeedsApproval: false,
    });
    const bPolicy = await t.query(api.dashboard.getAccountPolicy, {
      bearer: b.readBearer,
    });
    // b never set a policy → still the safe default.
    expect(bPolicy.customDomainNeedsApproval).toBe(true);
  });
});

describe("dashboard API tokens (operator-gated, account-scoped — epic #184)", () => {
  it("listTokens returns only the operator's own tokens, hash omitted", async () => {
    const t = convexTest(schema, modules);
    const a = await seedAccount(t, "acct_tok_a");
    await seedAccount(t, "acct_tok_b");

    const aTokens = await t.query(api.dashboard.listTokens, {
      bearer: a.readBearer,
    });
    // seedAccount mints exactly two tokens per account (read + write bearers).
    expect(aTokens).toHaveLength(2);
    for (const tk of aTokens) expect(tk).not.toHaveProperty("tokenHash");
  });

  it("revokeToken revokes the operator's own token (account-scoped)", async () => {
    const t = convexTest(schema, modules);
    const a = await seedAccount(t, "acct_tok_rev");
    const issued = await t.mutation(internal.tokens.issueToken, {
      accountId: a.accountId as never,
      scopes: ["pages:read"],
      label: "extra",
    });

    const res = await t.mutation(api.dashboard.revokeToken, {
      bearer: a.writeBearer,
      tokenId: issued.tokenId,
    });
    expect(res.revoked).toBe(true);

    const after = await t.query(api.dashboard.listTokens, {
      bearer: a.readBearer,
    });
    expect(after.find((tk) => tk.tokenId === issued.tokenId)?.revokedAt).not.toBeNull();
  });

  it("cannot revoke another account's token (no cross-account reach)", async () => {
    const t = convexTest(schema, modules);
    const attacker = await seedAccount(t, "acct_tok_attacker");
    const victim = await seedAccount(t, "acct_tok_victim");
    const issued = await t.mutation(internal.tokens.issueToken, {
      accountId: victim.accountId as never,
      scopes: ["pages:read"],
    });

    await expect(
      t.mutation(api.dashboard.revokeToken, {
        bearer: attacker.writeBearer,
        tokenId: issued.tokenId,
      }),
    ).rejects.toThrow();

    // The victim's token is untouched.
    const vTokens = await t.query(api.dashboard.listTokens, {
      bearer: victim.readBearer,
    });
    expect(vTokens.find((tk) => tk.tokenId === issued.tokenId)?.revokedAt).toBeNull();
  });

  it("rejects revokeToken from a read-only bearer (pages:write required)", async () => {
    const t = convexTest(schema, modules);
    const a = await seedAccount(t, "acct_tok_ro");
    const issued = await t.mutation(internal.tokens.issueToken, {
      accountId: a.accountId as never,
      scopes: ["pages:read"],
    });
    await expect(
      t.mutation(api.dashboard.revokeToken, {
        bearer: a.readBearer,
        tokenId: issued.tokenId,
      }),
    ).rejects.toThrow();
  });
});
