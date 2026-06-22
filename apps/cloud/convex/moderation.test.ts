// @vitest-environment edge-runtime
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema.js";
import { api, internal } from "./_generated/api.js";
import {
  transition,
  sealedKey,
  type Lifecycle,
  type LifecycleTransition,
} from "./moderation.js";
import { computeBodySha } from "../shared/src/fingerprint.js";
import type { Lockfile } from "../shared/src/lockfile-diff.js";

/**
 * CLOUD-31 — lifecycle state-machine tests.
 *
 * The PURE `transition` is unit-tested directly (every legal/illegal edge, the
 * preserve-not-delete invariant, mutual exclusivity). The thin mutations are
 * exercised against the REAL schema + functions with `convex-test` (offline, no
 * R2 — the same harness/pinning as integration.test.ts) so the
 * quarantine/preserve/clear/delete flows prove the lifecycle + moderation rows +
 * audit entries land, and that NOTHING is hard-deleted.
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
      authUserId: "auth_user_moderation",
      name: "Moderation Account",
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

/** Publish a page and return its id. */
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

// ---------------------------------------------------------------------------
// Pure state machine.
// ---------------------------------------------------------------------------

describe("transition — the pure lifecycle state machine", () => {
  it("active → tombstoned on delete (ordinary delete, no seal)", () => {
    const r = transition("active", "delete");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.result.lifecycle).toBe("tombstoned");
    expect(r.result.moderationState).toBeNull();
    expect(r.result.seals).toBe(false);
    expect(r.result.hardDeletes).toBe(false);
  });

  it("active → quarantined on quarantine (abuse; seals, never deletes)", () => {
    const r = transition("active", "quarantine");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.result.lifecycle).toBe("quarantined");
    expect(r.result.moderationState).toBe("quarantined");
    expect(r.result.seals).toBe(true);
    expect(r.result.hardDeletes).toBe(false);
  });

  it("quarantined → preserved on preserve (held in sealed store)", () => {
    const r = transition("quarantined", "preserve");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.result.moderationState).toBe("preserved");
    expect(r.result.seals).toBe(true);
    expect(r.result.hardDeletes).toBe(false);
  });

  it("clears a quarantined report back to active (false report)", () => {
    const r = transition("quarantined", "clear");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.result.lifecycle).toBe("active");
    expect(r.result.moderationState).toBe("cleared");
  });

  it("tombstone ≠ quarantine: delete and quarantine reach DISTINCT states", () => {
    const del = transition("active", "delete");
    const quar = transition("active", "quarantine");
    if (!del.ok || !quar.ok) throw new Error("expected ok");
    expect(del.result.lifecycle).toBe("tombstoned");
    expect(quar.result.lifecycle).toBe("quarantined");
    expect(del.result.lifecycle).not.toBe(quar.result.lifecycle);
  });

  it("rejects illegal source states (mutual exclusivity enforced)", () => {
    // can't delete/quarantine a non-active page
    expect(transition("tombstoned", "delete").ok).toBe(false);
    expect(transition("quarantined", "delete").ok).toBe(false);
    expect(transition("tombstoned", "quarantine").ok).toBe(false);
    // can't preserve a non-quarantined page
    expect(transition("active", "preserve").ok).toBe(false);
    expect(transition("tombstoned", "preserve").ok).toBe(false);
    // can't clear a tombstoned page (delete is not a moderation case)
    expect(transition("tombstoned", "clear").ok).toBe(false);
  });

  it("INVARIANT: no transition ever hard-deletes", () => {
    const states: Lifecycle[] = ["active", "quarantined", "tombstoned"];
    const transitions: LifecycleTransition[] = [
      "delete",
      "quarantine",
      "preserve",
      "clear",
    ];
    for (const s of states) {
      for (const tr of transitions) {
        const r = transition(s, tr);
        if (r.ok) expect(r.result.hardDeletes).toBe(false);
      }
    }
  });

  it("sealedKey moves the object to the sealed store (does not drop it)", () => {
    expect(sealedKey("artifacts/acc/pg/abc.html")).toBe(
      "quarantine/artifacts/acc/pg/abc.html",
    );
  });
});

// ---------------------------------------------------------------------------
// Mutations against the real schema.
// ---------------------------------------------------------------------------

describe("moderation mutations — real schema (convex-test)", () => {
  it("quarantine seals the object + flips lifecycle, distinct from tombstone, audited", async () => {
    const t = convexTest(schema, modules);
    const { accountId, bearer } = await seedAuth(t);
    const pageId = await publishPage(t, bearer, "abusive-page");

    const res = await t.mutation(api.moderation.quarantinePage, {
      bearer,
      id: pageId as never,
      reason: "abuse report",
    });
    expect(res.lifecycle).toBe("quarantined");
    // The R2 object is SEALED (key recorded), NOT hard-deleted.
    expect(res.sealedKey).not.toBeNull();
    expect(res.sealedKey!.startsWith("quarantine/")).toBe(true);

    await t.run(async (ctx) => {
      const page = await ctx.db.get(pageId as never);
      expect((page as { lifecycle: string }).lifecycle).toBe("quarantined");

      // The moderation case landed in the `quarantined` state.
      const cases = await ctx.db
        .query("moderation")
        .withIndex("by_page", (q) => q.eq("pageId", pageId as never))
        .collect();
      expect(cases).toHaveLength(1);
      expect(cases[0]!.state).toBe("quarantined");

      // INVARIANT: the page version row (the R2 object pointer) is RETAINED.
      const versions = await ctx.db
        .query("pageVersions")
        .withIndex("by_page", (q) => q.eq("pageId", pageId as never))
        .collect();
      expect(versions).toHaveLength(1);

      // The transition is audited with the sealed key (preserve-not-delete).
      const audit = await ctx.db
        .query("auditLog")
        .withIndex("by_account", (q) => q.eq("accountId", accountId as never))
        .collect();
      const quarAudit = audit.find((a) => a.action === "page.quarantine");
      expect(quarAudit).toBeDefined();
      expect((quarAudit!.metadata as { sealedR2Key: string }).sealedR2Key).toBe(
        res.sealedKey,
      );
    });

    // quarantine ≠ tombstone: the lifecycle is the distinct `quarantined` value.
    expect(res.lifecycle).not.toBe("tombstoned");
  });

  it("quarantine → preserve holds in the sealed store; object never hard-deleted", async () => {
    const t = convexTest(schema, modules);
    const { bearer } = await seedAuth(t);
    const pageId = await publishPage(t, bearer, "preserve-me");

    await t.mutation(api.moderation.quarantinePage, {
      bearer,
      id: pageId as never,
    });
    const preserved = await t.mutation(api.moderation.preservePage, {
      bearer,
      id: pageId as never,
    });
    // Still sealed (held), lifecycle still quarantined (the page stays pulled).
    expect(preserved.lifecycle).toBe("quarantined");
    expect(preserved.sealedKey).not.toBeNull();

    await t.run(async (ctx) => {
      const cases = await ctx.db
        .query("moderation")
        .withIndex("by_page", (q) => q.eq("pageId", pageId as never))
        .collect();
      expect(cases).toHaveLength(1);
      expect(cases[0]!.state).toBe("preserved");

      // INVARIANT: a preserved object is NEVER hard-deleted — its version row +
      // page row remain.
      const page = await ctx.db.get(pageId as never);
      expect(page).not.toBeNull();
      const versions = await ctx.db
        .query("pageVersions")
        .withIndex("by_page", (q) => q.eq("pageId", pageId as never))
        .collect();
      expect(versions).toHaveLength(1);
    });
  });

  it("clear restores a quarantined page to active (false report)", async () => {
    const t = convexTest(schema, modules);
    const { bearer } = await seedAuth(t);
    const pageId = await publishPage(t, bearer, "false-report");

    await t.mutation(api.moderation.quarantinePage, {
      bearer,
      id: pageId as never,
    });
    const cleared = await t.mutation(api.moderation.clearReport, {
      bearer,
      id: pageId as never,
    });
    expect(cleared.lifecycle).toBe("active");

    await t.run(async (ctx) => {
      const page = await ctx.db.get(pageId as never);
      expect((page as { lifecycle: string }).lifecycle).toBe("active");
      const cases = await ctx.db
        .query("moderation")
        .withIndex("by_page", (q) => q.eq("pageId", pageId as never))
        .collect();
      expect(cases[0]!.state).toBe("cleared");
    });

    // a cleared page is active again → discoverable in find.
    const found = await t.query(api.pages.find, { bearer, q: "false" });
    expect(found.map((p) => p.id)).toContain(pageId);
  });

  it("rejects an illegal transition (preserve before quarantine)", async () => {
    const t = convexTest(schema, modules);
    const { bearer } = await seedAuth(t);
    const pageId = await publishPage(t, bearer, "still-active");
    await expect(
      t.mutation(api.moderation.preservePage, { bearer, id: pageId as never }),
    ).rejects.toThrow();
  });

  it("rejects an unscoped/missing bearer", async () => {
    const t = convexTest(schema, modules);
    const { bearer } = await seedAuth(t);
    const pageId = await publishPage(t, bearer, "guard-check");
    await expect(
      t.mutation(api.moderation.quarantinePage, {
        bearer: "swc_not_real",
        id: pageId as never,
      }),
    ).rejects.toThrow();
  });
});
