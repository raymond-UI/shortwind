import { describe, expect, it } from "vitest";
import {
  inMemoryPublishLimiter,
  PUBLISH_BURST,
} from "./rate-limit.js";

/**
 * CLOUD-33 — the in-memory token-bucket limiter that backs the OFFLINE publish
 * path (the `@convex-dev/rate-limiter` component can't run under convex-test, so
 * the publish hook injects this; it mirrors the configured component semantics).
 * The component is still registered in convex.config.ts for the deploy path.
 */

const ctx = { runMutation: async () => undefined };

describe("inMemoryPublishLimiter — token bucket (mirrors the component config)", () => {
  it("allows up to `capacity` immediate publishes, then trips with retryAfter", async () => {
    // Freeze time so no refill happens between checks.
    const limiter = inMemoryPublishLimiter({
      rate: 10,
      capacity: 3,
      periodMs: 60_000,
      now: () => 1_000,
    });
    const key = "acct_1";

    for (let i = 0; i < 3; i++) {
      const r = await limiter.check(ctx, key);
      expect(r.ok).toBe(true);
    }
    const tripped = await limiter.check(ctx, key);
    expect(tripped.ok).toBe(false);
    expect(tripped.retryAfter).toBeGreaterThan(0);
  });

  it("refills over time (a publish succeeds again after the bucket refills)", async () => {
    let t = 0;
    const limiter = inMemoryPublishLimiter({
      rate: 60, // 1 token / second
      capacity: 1,
      periodMs: 60_000,
      now: () => t,
    });
    const key = "acct_refill";

    expect((await limiter.check(ctx, key)).ok).toBe(true);
    expect((await limiter.check(ctx, key)).ok).toBe(false);
    // Advance ~1.1s → one token refilled.
    t = 1_100;
    expect((await limiter.check(ctx, key)).ok).toBe(true);
  });

  it("is per-account (one account tripping does not affect another)", async () => {
    const limiter = inMemoryPublishLimiter({
      rate: 10,
      capacity: 1,
      periodMs: 60_000,
      now: () => 5,
    });
    expect((await limiter.check(ctx, "a")).ok).toBe(true);
    expect((await limiter.check(ctx, "a")).ok).toBe(false);
    // A different account still has its full bucket.
    expect((await limiter.check(ctx, "b")).ok).toBe(true);
  });

  it("defaults to the configured publish burst", async () => {
    const limiter = inMemoryPublishLimiter({ now: () => 0 });
    let ok = 0;
    for (let i = 0; i < PUBLISH_BURST + 2; i++) {
      if ((await limiter.check(ctx, "burst")).ok) ok++;
    }
    expect(ok).toBe(PUBLISH_BURST);
  });
});
