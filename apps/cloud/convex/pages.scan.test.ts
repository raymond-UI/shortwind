// @vitest-environment edge-runtime
import { afterEach, describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema.js";
import { api, internal } from "./_generated/api.js";
import {
  __setScanSources,
  __resetScanSources,
  __setLifecycleEdgePort,
  __resetLifecycleEdgePort,
  type LifecycleEdgePort,
} from "./pages.js";
import {
  __setPublishLimiter,
  __resetPublishLimiter,
  inMemoryPublishLimiter,
} from "./lib/rate_limit.js";
import { digestArtifact, makeHashList } from "./lib/content_scan.js";
import { computeBodySha } from "../shared/src/fingerprint.js";
import type { Lockfile } from "../shared/src/lockfile-diff.js";

/**
 * CLOUD-33 — publish-time content scan + per-account rate limit, end-to-end
 * against the REAL schema via convex-test (offline; the rate-limiter component
 * cannot run here so the publish hook injects the in-memory limiter — the
 * component is still registered in convex.config.ts for the deploy path).
 *
 * Asserts:
 *   - a known-CSAM hash-list match BLOCKS publish AND opens a moderation case via
 *     the CLOUD-32 kill seam (lifecycle quarantined, not public, sealed) — and
 *     NO findable/public page is left;
 *   - a classifier `block` rejects + opens a `reported` case;
 *   - a classifier `review` allows the publish but flags it (reported case);
 *   - the per-account publish rate limit trips after the burst (retryAfter set).
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
  const accountId = await t.run(async (ctx) =>
    ctx.db.insert("accounts", {
      authUserId: "auth_user_scan",
      name: "Scan Account",
      email: null,
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

/** Pull the structured ConvexError payload (convex-test may stringify `data`). */
function errData(err: unknown): { code?: string; retryAfter?: number } {
  const raw = (err as { data?: unknown }).data;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return (raw as { code?: string; retryAfter?: number }) ?? {};
}

const BENIGN_HTML = '<div class="@card">hi</div>';

function publishArgs(html: string, slug: string) {
  return {
    html,
    slug,
    recipes: [] as { family: string; source: string }[],
    lockfile: lockfile(),
    visibility: "public" as const,
  };
}

async function benignRecipes() {
  return [{ family: "card", source: await cleanCardSource() }];
}

afterEach(() => {
  __resetScanSources();
  __resetPublishLimiter();
  __resetLifecycleEdgePort();
});

/** A recording lifecycle edge port so a test can assert evict/invalidate fired. */
function recordingEdgePort(): {
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

describe("publish-time CSAM hash-match (PRD §8.2 proactive hash-matching)", () => {
  it("blocks publish AND opens a CSAM moderation case via the CLOUD-32 seam", async () => {
    const t = convexTest(schema, modules);
    // Give every account a generous limiter so the limit never interferes.
    __setPublishLimiter(inMemoryPublishLimiter({ capacity: 100, now: () => 0 }));
    const { bearer } = await seedAuth(t);

    const badHtml = '<div class="@card">contraband</div>';
    // The hook hashes the raw artifact (html, no css here). Seed the known list
    // with exactly that digest so the publish trips the proactive match.
    const knownHash = await digestArtifact(badHtml);
    __setScanSources({ hashList: makeHashList("ncmec-test", [knownHash]) });

    // The publish must be REJECTED (thrown), not return a success.
    await expect(
      t.action(api.pages.publish, {
        bearer,
        ...publishArgs(badHtml, "contraband"),
        recipes: await benignRecipes(),
      }),
    ).rejects.toThrow();

    await t.run(async (ctx) => {
      // A page row exists only because the kill seam needs a target — but it is
      // QUARANTINED (pulled), never an active/public page.
      const pages = await ctx.db.query("pages").collect();
      expect(pages).toHaveLength(1);
      expect(pages[0]!.lifecycle).toBe("quarantined");

      // A moderation case was opened via the CLOUD-32 seam: quarantined + sealed
      // + the 60-day NCMEC preservation clock set (preserve-not-delete).
      const cases = await ctx.db.query("moderation").collect();
      expect(cases).toHaveLength(1);
      expect(cases[0]!.state).toBe("quarantined");
      expect(cases[0]!.preservedR2Key).not.toBeNull();
      expect(cases[0]!.preservationExpiresAt).not.toBeNull();
    });

    // No PUBLIC page: the quarantined page is excluded from `find`.
    const found = await t.query(api.pages.find, { bearer });
    expect(found).toHaveLength(0);
  });

  it("EVICTS the edge route + purges the cache on a CSAM block (stops serving now, not after TTL)", async () => {
    // PR #143 BLOCKER: `runPublish` publishes an active KV route before the block;
    // the block MUST evict it so a CSAM artifact stops serving immediately. Assert
    // the lifecycle edge port (the same seam delete/kill drive) was fired.
    const t = convexTest(schema, modules);
    __setPublishLimiter(inMemoryPublishLimiter({ capacity: 100, now: () => 0 }));
    const edge = recordingEdgePort();
    __setLifecycleEdgePort(edge.port);
    const { bearer } = await seedAuth(t);

    const badHtml = '<div class="@card">contraband</div>';
    const knownHash = await digestArtifact(badHtml);
    __setScanSources({ hashList: makeHashList("ncmec-test", [knownHash]) });

    await expect(
      t.action(api.pages.publish, {
        bearer,
        ...publishArgs(badHtml, "contraband-evict"),
        recipes: await benignRecipes(),
      }),
    ).rejects.toThrow();

    // The KV route the publish just put up was evicted + the cache purged.
    expect(edge.evicted).toHaveLength(1);
    expect(edge.evicted[0]!.slug).toBe("contraband-evict");
    expect(edge.invalidated).toHaveLength(1);
    expect(edge.invalidated[0]).toContain("contraband-evict");
  });

  it("passes a clean artifact (unknown hash → publish succeeds, no case)", async () => {
    const t = convexTest(schema, modules);
    __setPublishLimiter(inMemoryPublishLimiter({ capacity: 100, now: () => 0 }));
    const { bearer } = await seedAuth(t);
    // A known list that does NOT contain our artifact.
    __setScanSources({ hashList: makeHashList("ncmec-test", ["0".repeat(64)]) });

    const out = await t.action(api.pages.publish, {
      bearer,
      ...publishArgs(BENIGN_HTML, "clean-page"),
      recipes: await benignRecipes(),
    });
    expect(out.ok).toBe(true);

    await t.run(async (ctx) => {
      const cases = await ctx.db.query("moderation").collect();
      expect(cases).toHaveLength(0);
    });
    const found = await t.query(api.pages.find, { bearer });
    expect(found).toHaveLength(1);
  });
});

describe("publish-time classifier (PRD §8.4)", () => {
  it("BLOCKS a high-score page → quarantines it (NOT public), opens a case, and EVICTS the edge route", async () => {
    // PR #143 review: a classifier `block` is a HARD reject — it must NOT leave a
    // findable/served page. Assert the page is quarantined (excluded from `find`)
    // and the edge route is evicted, mirroring the CSAM path.
    const t = convexTest(schema, modules);
    __setPublishLimiter(inMemoryPublishLimiter({ capacity: 100, now: () => 0 }));
    const edge = recordingEdgePort();
    __setLifecycleEdgePort(edge.port);
    const { bearer } = await seedAuth(t);

    const phishing =
      '<div class="@card"><form><input type="password"/>verify your bank account</form>' +
      "<script>eval(atob('x'))</script></div>";

    await expect(
      t.action(api.pages.publish, {
        bearer,
        ...publishArgs(phishing, "phish"),
        recipes: await benignRecipes(),
      }),
    ).rejects.toThrow();

    await t.run(async (ctx) => {
      // The page is QUARANTINED — a classifier block does not leave it public.
      const pages = await ctx.db.query("pages").collect();
      expect(pages).toHaveLength(1);
      expect(pages[0]!.lifecycle).toBe("quarantined");

      const cases = await ctx.db.query("moderation").collect();
      expect(cases).toHaveLength(1);
      // The quarantine case state (the page is pulled, not merely reported).
      expect(cases[0]!.state).toBe("quarantined");
      expect(cases[0]!.reason).toContain("classifier-block");
    });

    // The KV route the publish put up was evicted + the cache purged.
    expect(edge.evicted).toHaveLength(1);
    expect(edge.evicted[0]!.slug).toBe("phish");
    expect(edge.invalidated).toHaveLength(1);

    // Not public: excluded from `find`.
    const found = await t.query(api.pages.find, { bearer });
    expect(found).toHaveLength(0);
  });

  it("ALLOWS a `review`-score page but FLAGS it (reported case, still public)", async () => {
    const t = convexTest(schema, modules);
    __setPublishLimiter(inMemoryPublishLimiter({ capacity: 100, now: () => 0 }));
    const { bearer } = await seedAuth(t);

    // One credential-harvest signal alone = 0.5 → review (≥0.4, <0.8).
    const reviewHtml =
      '<div class="@card"><form><input type="password"/>confirm your login</form></div>';

    const out = await t.action(api.pages.publish, {
      bearer,
      ...publishArgs(reviewHtml, "review-me"),
      recipes: await benignRecipes(),
    });
    expect(out.ok).toBe(true);

    await t.run(async (ctx) => {
      // The page is still active (review allows publish).
      const pages = await ctx.db.query("pages").collect();
      expect(pages[0]!.lifecycle).toBe("active");
      // …but flagged: a `reported` case + a scan.flag audit row.
      const cases = await ctx.db.query("moderation").collect();
      expect(cases).toHaveLength(1);
      expect(cases[0]!.state).toBe("reported");
      expect(cases[0]!.reason).toContain("classifier-review");
      const audit = await ctx.db.query("auditLog").collect();
      expect(audit.some((a) => a.action === "page.scan.flag")).toBe(true);
    });

    // A flagged page is still public/findable (the classifier is uncertain).
    const found = await t.query(api.pages.find, { bearer });
    expect(found.map((p) => p.id)).toContain(out.ok ? out.id : "");
  });
});

describe("blocked-publish idempotency (PR #143 review nit)", () => {
  it("a retried CSAM-block with the SAME idempotencyKey RE-BLOCKS (no cached success replay, no INVALID_TRANSITION)", async () => {
    const t = convexTest(schema, modules);
    __setPublishLimiter(inMemoryPublishLimiter({ capacity: 100, now: () => 0 }));
    const edge = recordingEdgePort();
    __setLifecycleEdgePort(edge.port);
    const { bearer } = await seedAuth(t);

    const badHtml = '<div class="@card">contraband</div>';
    const knownHash = await digestArtifact(badHtml);
    __setScanSources({ hashList: makeHashList("ncmec-test", [knownHash]) });

    const reqArgs = {
      bearer,
      ...publishArgs(badHtml, "contraband-idem"),
      recipes: await benignRecipes(),
      idempotencyKey: "retry-key-1",
    };

    // First attempt: blocked (thrown), page quarantined, route evicted.
    await expect(t.action(api.pages.publish, reqArgs)).rejects.toThrow();

    // The blocked outcome must NOT have left a cached `{ok:true}` idempotency row.
    await t.run(async (ctx) => {
      const keys = await ctx.db.query("idempotencyKeys").collect();
      expect(keys).toHaveLength(0);
    });

    // Retry with the SAME key: must RE-BLOCK (not replay success) and surface
    // CSAM_BLOCKED — NOT INVALID_TRANSITION (the page is already quarantined).
    let err: unknown;
    try {
      await t.action(api.pages.publish, reqArgs);
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    expect(errData(err).code).toBe("CSAM_BLOCKED");

    // Still exactly one page, still quarantined; the re-block re-evicted the route.
    await t.run(async (ctx) => {
      const pages = await ctx.db.query("pages").collect();
      expect(pages).toHaveLength(1);
      expect(pages[0]!.lifecycle).toBe("quarantined");
    });
    // evictRoute fired on BOTH the first block and the idempotent re-block.
    expect(edge.evicted.length).toBeGreaterThanOrEqual(2);

    // Not public on either attempt.
    const found = await t.query(api.pages.find, { bearer });
    expect(found).toHaveLength(0);
  });
});

describe("per-account publish rate limit (PRD §8.4)", () => {
  it("trips after the burst is exhausted, returning a retryAfter", async () => {
    const t = convexTest(schema, modules);
    // Freeze time, burst of 2, so the 3rd publish in the window trips.
    __setPublishLimiter(
      inMemoryPublishLimiter({ rate: 10, capacity: 2, periodMs: 60_000, now: () => 0 }),
    );
    __setScanSources({ hashList: makeHashList("ncmec-test", []) });
    const { bearer } = await seedAuth(t);
    const recipes = await benignRecipes();

    for (let i = 0; i < 2; i++) {
      const out = await t.action(api.pages.publish, {
        bearer,
        ...publishArgs(`<div class="@card">p${i}</div>`, `rl-${i}`),
        recipes,
      });
      expect(out.ok).toBe(true);
    }

    // The 3rd publish in the window trips the limit → thrown RATE_LIMITED.
    let err: unknown;
    try {
      await t.action(api.pages.publish, {
        bearer,
        ...publishArgs('<div class="@card">p2</div>', "rl-2"),
        recipes,
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeDefined();
    // convex-test surfaces the ConvexError `data` as a JSON string across the
    // action boundary; parse it back to the structured payload.
    const data = errData(err);
    expect(data.code).toBe("RATE_LIMITED");
    expect(data.retryAfter).toBeGreaterThan(0);

    // The tripped publish created NO page (rejected before the pipeline).
    await t.run(async (ctx) => {
      const pages = await ctx.db.query("pages").collect();
      expect(pages).toHaveLength(2);
    });
  });
});
