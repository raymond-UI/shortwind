// @vitest-environment edge-runtime
import { afterEach, describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema.js";
import { api } from "./_generated/api.js";
import {
  __setKillEdgePort,
  __resetKillEdgePort,
  PRESERVATION_WINDOW_MS,
  type KillEdgePort,
} from "./moderation.js";
import { computeBodySha } from "../shared/src/fingerprint.js";
import type { Lockfile } from "../shared/src/lockfile-diff.js";

/**
 * CLOUD-32 — abuse intake + fast global kill + CSAM/NCMEC preservation.
 *
 * Built on top of CLOUD-31's lifecycle state machine (`applyLifecycle`,
 * transition `quarantine`). These tests prove, against the REAL schema with the
 * `convex-test` harness (offline, no R2):
 *
 *   - reportAbuse opens a `reported` moderation case (no auth — anyone reports);
 *   - killPage makes the page UNREACHABLE in ONE transaction (lifecycle
 *     `quarantined`, excluded from `find`, edge invalidate + KV evict fired);
 *   - the sealed object is RETAINED — `preservedR2Key` set, version rows survive,
 *     NEVER hard-deleted (the CLOUD-31 invariant extended to the kill path);
 *   - a CSAM kill sets `preservationExpiresAt` ~60 days out + records
 *     `ncmecReportId`;
 *   - phishing/malware ride the SAME kill path (PRD §8.4).
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
      authUserId: "auth_user_kill",
      name: "Kill Account",
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

/** A recording edge port so we can assert the kill drove the edge effects. */
function recordingPort(): {
  port: KillEdgePort;
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

afterEach(() => {
  __resetKillEdgePort();
});

// ---------------------------------------------------------------------------
// Abuse intake.
// ---------------------------------------------------------------------------

describe("reportAbuse — reachable intake (PRD §8.2)", () => {
  it("opens a `reported` moderation case with reporter contact + category", async () => {
    const t = convexTest(schema, modules);
    const { bearer } = await seedAuth(t);
    const pageId = await publishPage(t, bearer, "report-me");

    const res = await t.mutation(api.moderation.reportAbuse, {
      pageId: pageId as never,
      reporterContact: "reporter@example.com",
      reason: "looks like phishing",
      category: "phishing",
    });
    expect(res.state).toBe("reported");

    await t.run(async (ctx) => {
      const cases = await ctx.db
        .query("moderation")
        .withIndex("by_page", (q) => q.eq("pageId", pageId as never))
        .collect();
      expect(cases).toHaveLength(1);
      expect(cases[0]!.state).toBe("reported");
      expect(cases[0]!.reporterContact).toBe("reporter@example.com");
    });

    // A reported (not yet killed) page is still ACTIVE — reporting alone does not
    // pull the page; an operator/classifier drives the kill.
    await t.run(async (ctx) => {
      const page = await ctx.db.get(pageId as never);
      expect((page as { lifecycle: string }).lifecycle).toBe("active");
    });
  });

  it("requires NO auth — anyone can report (intake is public)", async () => {
    const t = convexTest(schema, modules);
    const { bearer } = await seedAuth(t);
    const pageId = await publishPage(t, bearer, "anon-report");

    // No bearer passed at all.
    const res = await t.mutation(api.moderation.reportAbuse, {
      pageId: pageId as never,
      reporterContact: null,
      reason: "csam",
      category: "csam",
    });
    expect(res.state).toBe("reported");
  });
});

// ---------------------------------------------------------------------------
// Fast global kill.
// ---------------------------------------------------------------------------

describe("killPage — fast global kill (PRD §8.2/§8.4)", () => {
  it("makes the page unreachable in ONE transaction + seals (never deletes)", async () => {
    const t = convexTest(schema, modules);
    const rec = recordingPort();
    __setKillEdgePort(rec.port);
    const { accountId, bearer } = await seedAuth(t);
    const pageId = await publishPage(t, bearer, "kill-me");

    const res = await t.mutation(api.moderation.killPage, {
      bearer,
      pageId: pageId as never,
      reason: "malware payload",
      category: "malware",
    });
    expect(res.lifecycle).toBe("quarantined");
    expect(res.preservedR2Key).not.toBeNull();
    expect(res.preservedR2Key!.startsWith("quarantine/")).toBe(true);

    // The edge was purged + the KV route evicted (fast global kill).
    expect(rec.invalidated.length).toBeGreaterThanOrEqual(1);
    expect(rec.evicted.map((e) => e.pageId)).toContain(pageId);

    await t.run(async (ctx) => {
      const page = await ctx.db.get(pageId as never);
      expect((page as { lifecycle: string }).lifecycle).toBe("quarantined");

      // The case is quarantined + the sealed key is PERSISTED on moderation.
      const cases = await ctx.db
        .query("moderation")
        .withIndex("by_page", (q) => q.eq("pageId", pageId as never))
        .collect();
      expect(cases).toHaveLength(1);
      expect(cases[0]!.state).toBe("quarantined");
      expect(cases[0]!.preservedR2Key).toBe(res.preservedR2Key);

      // INVARIANT (extends CLOUD-31 to the kill path): the version row (R2 object
      // pointer) is RETAINED — the object is preserved, NEVER hard-deleted.
      const versions = await ctx.db
        .query("pageVersions")
        .withIndex("by_page", (q) => q.eq("pageId", pageId as never))
        .collect();
      expect(versions).toHaveLength(1);

      // Audited on the kill path.
      const audit = await ctx.db
        .query("auditLog")
        .withIndex("by_account", (q) => q.eq("accountId", accountId as never))
        .collect();
      expect(audit.some((a) => a.action === "page.quarantine")).toBe(true);
    });

    // Unreachable: a quarantined page is excluded from find.
    const found = await t.query(api.pages.find, { bearer, q: "kill" });
    expect(found.map((p) => p.id)).not.toContain(pageId);
  });

  it("CSAM kill sets a ~60-day preservation clock + records ncmecReportId", async () => {
    const t = convexTest(schema, modules);
    const { bearer } = await seedAuth(t);
    const pageId = await publishPage(t, bearer, "csam-kill");

    const before = Date.now();
    const res = await t.mutation(api.moderation.killPage, {
      bearer,
      pageId: pageId as never,
      reason: "apparent CSAM",
      category: "csam",
      ncmecReportId: "NCMEC-12345",
    });
    expect(res.lifecycle).toBe("quarantined");

    await t.run(async (ctx) => {
      const cases = await ctx.db
        .query("moderation")
        .withIndex("by_page", (q) => q.eq("pageId", pageId as never))
        .collect();
      const c = cases[0]!;
      expect(c.ncmecReportId).toBe("NCMEC-12345");
      expect(c.preservationExpiresAt).not.toBeNull();
      // ~60 days from now (allow a generous window for clock skew in the test).
      const expected = before + PRESERVATION_WINDOW_MS;
      expect(Math.abs(c.preservationExpiresAt! - expected)).toBeLessThan(
        60_000,
      );
      // The 60-day window is genuinely ~60 days.
      expect(PRESERVATION_WINDOW_MS).toBe(60 * 24 * 60 * 60 * 1000);
    });
  });

  it("phishing + malware ride the SAME kill path (no preservation clock)", async () => {
    const t = convexTest(schema, modules);
    const { bearer } = await seedAuth(t);

    for (const category of ["phishing", "malware"] as const) {
      const pageId = await publishPage(t, bearer, `${category}-kill`);
      const res = await t.mutation(api.moderation.killPage, {
        bearer,
      pageId: pageId as never,
        reason: `${category} content`,
        category,
      });
      expect(res.lifecycle).toBe("quarantined");
      expect(res.preservedR2Key).not.toBeNull();

      await t.run(async (ctx) => {
        const cases = await ctx.db
          .query("moderation")
          .withIndex("by_page", (q) => q.eq("pageId", pageId as never))
          .collect();
        // Non-CSAM kills seal + preserve but carry no NCMEC clock.
        expect(cases[0]!.state).toBe("quarantined");
        expect(cases[0]!.preservationExpiresAt).toBeNull();
        expect(cases[0]!.ncmecReportId).toBeNull();
      });
    }
  });

  it("kill upgrades an existing `reported` case in place (report → kill)", async () => {
    const t = convexTest(schema, modules);
    const { bearer } = await seedAuth(t);
    const pageId = await publishPage(t, bearer, "report-then-kill");

    await t.mutation(api.moderation.reportAbuse, {
      pageId: pageId as never,
      reporterContact: "tip@example.com",
      reason: "csam",
      category: "csam",
    });
    const res = await t.mutation(api.moderation.killPage, {
      bearer,
      pageId: pageId as never,
      reason: "confirmed CSAM",
      category: "csam",
      ncmecReportId: "NCMEC-999",
    });
    expect(res.lifecycle).toBe("quarantined");

    await t.run(async (ctx) => {
      const cases = await ctx.db
        .query("moderation")
        .withIndex("by_page", (q) => q.eq("pageId", pageId as never))
        .collect();
      // Still ONE case (upgraded in place), now quarantined + report id set.
      expect(cases).toHaveLength(1);
      expect(cases[0]!.state).toBe("quarantined");
      expect(cases[0]!.ncmecReportId).toBe("NCMEC-999");
      // The reporter contact from intake is retained.
      expect(cases[0]!.reporterContact).toBe("tip@example.com");
    });
  });

  it("INVARIANT: a killed/preserved object is never hard-deleted", async () => {
    const t = convexTest(schema, modules);
    const { bearer } = await seedAuth(t);
    const pageId = await publishPage(t, bearer, "preserve-invariant");

    await t.mutation(api.moderation.killPage, {
      bearer,
      pageId: pageId as never,
      reason: "csam",
      category: "csam",
      ncmecReportId: "NCMEC-INV",
    });

    await t.run(async (ctx) => {
      // Page row survives.
      expect(await ctx.db.get(pageId as never)).not.toBeNull();
      // Every version row (the R2 object pointer) survives.
      const versions = await ctx.db
        .query("pageVersions")
        .withIndex("by_page", (q) => q.eq("pageId", pageId as never))
        .collect();
      expect(versions.length).toBeGreaterThanOrEqual(1);
      // The sealed key is recorded so the preserved object is locatable.
      const cases = await ctx.db
        .query("moderation")
        .withIndex("by_page", (q) => q.eq("pageId", pageId as never))
        .collect();
      expect(cases[0]!.preservedR2Key).not.toBeNull();
    });
  });
});
