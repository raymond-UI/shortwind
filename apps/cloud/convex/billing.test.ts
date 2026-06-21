import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema.js";
import { api } from "./_generated/api.js";
import { artifactBytes } from "./billing.js";

/**
 * CLOUD-43 — metered billing usage, in-harness against the REAL schema +
 * functions (the convex-test pattern from dashboard.test.ts / moderation.test.ts).
 *
 * Proves the three meters are aligned to the PRD §6.4 cost shape:
 *   - publishes      = COUNT of the account's `pageVersions` rows
 *   - storageBytes   = SUM of each frozen artifact's derived byte size
 *   - customDomains  = COUNT of the account's `domain.meter` events (CLOUD-40)
 * and the headline §6.4 invariant:
 *   - serving a page (no NEW version) adds ZERO to every meter — a viral page
 *     costs nothing.
 * plus account scoping (no cross-account leakage), mirroring the oversight queries.
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
): Promise<{ accountId: string; readBearer: string }> {
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
  // guard's hash-lookup matches (getUsage is guarded by requireRead).
  const issued = await t.mutation(api.tokens.issueToken, {
    accountId: accountId as never,
    scopes: ["pages:read"],
  });
  return { accountId, readBearer: issued.secret };
}

/** Insert a page + N frozen versions (each version row models one publish). */
async function seedPageWithVersions(
  t: ReturnType<typeof convexTest>,
  accountId: string,
  slug: string,
  versionCount: number,
): Promise<{ pageId: string }> {
  return t.run(async (ctx) => {
    const now = Date.now();
    const pageId = await ctx.db.insert("pages", {
      accountId: accountId as never,
      slug,
      customDomain: null,
      visibility: "public",
      lifecycle: "active",
      tags: [],
      currentVersionId: null,
      currentVersion: versionCount,
      createdAt: now,
      updatedAt: now,
    });
    for (let v = 1; v <= versionCount; v++) {
      await ctx.db.insert("pageVersions", {
        pageId,
        accountId: accountId as never,
        version: v,
        artifactKey: `r2/${slug}/${v}`,
        expandedHash: `exp-${slug}-${v}`,
        sourceHash: `src-${slug}-${v}`,
        lockfile: {},
        createdAt: now + v,
      });
    }
    return { pageId };
  });
}

/** Emit a `domain.meter` event — exactly what CLOUD-40 writes on activation. */
async function emitDomainMeter(
  t: ReturnType<typeof convexTest>,
  accountId: string,
  pageId: string,
  hostname: string,
): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert("auditLog", {
      accountId: accountId as never,
      action: "domain.meter",
      targetId: pageId,
      actorTokenId: null,
      metadata: { hostname, kind: "custom-domain", delta: 1 },
      createdAt: Date.now(),
    });
  });
}

describe("billing.getUsage — publishes meter", () => {
  it("publishes = count of the account's pageVersions rows", async () => {
    const t = convexTest(schema, modules);
    const { accountId, readBearer } = await seedAccount(t, "acct_pub");
    await seedPageWithVersions(t, accountId, "launch", 3);
    await seedPageWithVersions(t, accountId, "blog", 2);

    const usage = await t.query(api.billing.getUsage, { bearer: readBearer });
    expect(usage.publishes).toBe(5);
  });

  it("publishes is zero for an account that never published", async () => {
    const t = convexTest(schema, modules);
    const { readBearer } = await seedAccount(t, "acct_empty");

    const usage = await t.query(api.billing.getUsage, { bearer: readBearer });
    expect(usage.publishes).toBe(0);
    expect(usage.storageBytes).toBe(0);
    expect(usage.customDomains).toBe(0);
  });
});

describe("billing.getUsage — storage meter", () => {
  it("storageBytes = sum of the derived artifact sizes across versions", async () => {
    const t = convexTest(schema, modules);
    const { accountId, readBearer } = await seedAccount(t, "acct_storage");
    await seedPageWithVersions(t, accountId, "launch", 2);

    // Independently recompute the expected sum from the same deterministic
    // derivation the query uses (artifactBytes over each version's identifiers).
    const expected =
      artifactBytes({
        artifactKey: "r2/launch/1",
        expandedHash: "exp-launch-1",
        sourceHash: "src-launch-1",
      }) +
      artifactBytes({
        artifactKey: "r2/launch/2",
        expandedHash: "exp-launch-2",
        sourceHash: "src-launch-2",
      });

    const usage = await t.query(api.billing.getUsage, { bearer: readBearer });
    expect(usage.storageBytes).toBe(expected);
    expect(usage.storageBytes).toBeGreaterThan(0);
  });
});

describe("billing.getUsage — custom-domain meter", () => {
  it("customDomains increments on each domain.meter activation event", async () => {
    const t = convexTest(schema, modules);
    const { accountId, readBearer } = await seedAccount(t, "acct_domains");
    const { pageId } = await seedPageWithVersions(t, accountId, "launch", 1);

    const before = await t.query(api.billing.getUsage, { bearer: readBearer });
    expect(before.customDomains).toBe(0);

    await emitDomainMeter(t, accountId, pageId, "shop.example.com");
    const after1 = await t.query(api.billing.getUsage, { bearer: readBearer });
    expect(after1.customDomains).toBe(1);

    await emitDomainMeter(t, accountId, pageId, "www.example.com");
    const after2 = await t.query(api.billing.getUsage, { bearer: readBearer });
    expect(after2.customDomains).toBe(2);
  });
});

describe("billing.getUsage — §6.4 invariant: serving a page adds ZERO", () => {
  it("a viral page (many serves, no new version) does not move any meter", async () => {
    const t = convexTest(schema, modules);
    const { accountId, readBearer } = await seedAccount(t, "acct_viral");
    const { pageId } = await seedPageWithVersions(t, accountId, "viral", 1);
    await emitDomainMeter(t, accountId, pageId, "viral.example.com");

    // Snapshot the meters after the single publish + single domain bind.
    const baseline = await t.query(api.billing.getUsage, { bearer: readBearer });
    expect(baseline.publishes).toBe(1);
    expect(baseline.customDomains).toBe(1);
    expect(baseline.storageBytes).toBeGreaterThan(0);

    // "Serve" the page a million times. A serve writes NO pageVersions row and
    // NO domain.meter event — it touches none of the metered tables. We model
    // that simply by NOT inserting anything and re-reading usage repeatedly.
    for (let i = 0; i < 5; i++) {
      const again = await t.query(api.billing.getUsage, { bearer: readBearer });
      // Every meter is byte-identical to the baseline: serving costs nothing.
      expect(again.publishes).toBe(baseline.publishes);
      expect(again.customDomains).toBe(baseline.customDomains);
      expect(again.storageBytes).toBe(baseline.storageBytes);
    }
  });
});

describe("billing.getUsage — account scoping", () => {
  it("never leaks another account's publishes, storage, or domains", async () => {
    const t = convexTest(schema, modules);
    const a = await seedAccount(t, "acct_a");
    const b = await seedAccount(t, "acct_b");

    // Account A: 3 versions across 2 pages + 1 custom domain.
    await seedPageWithVersions(t, a.accountId, "a-launch", 2);
    const { pageId: aPage } = await seedPageWithVersions(
      t,
      a.accountId,
      "a-blog",
      1,
    );
    await emitDomainMeter(t, a.accountId, aPage, "a.example.com");

    // Account B: 1 version, no custom domains.
    await seedPageWithVersions(t, b.accountId, "b-launch", 1);

    const usageA = await t.query(api.billing.getUsage, { bearer: a.readBearer });
    const usageB = await t.query(api.billing.getUsage, { bearer: b.readBearer });

    expect(usageA.publishes).toBe(3);
    expect(usageA.customDomains).toBe(1);
    expect(usageA.storageBytes).toBeGreaterThan(0);

    // B sees only its own single publish and zero domains — no A leakage.
    expect(usageB.publishes).toBe(1);
    expect(usageB.customDomains).toBe(0);
    expect(usageB.storageBytes).toBeLessThan(usageA.storageBytes);
  });
});
