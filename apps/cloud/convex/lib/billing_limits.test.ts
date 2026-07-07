import { describe, expect, it } from "vitest";
import {
  PLAN_LIMITS,
  customDomainAllowed,
  publishQuotaExceeded,
  withinCustomDomainQuota,
} from "./billing_limits.js";

/**
 * Pure enforcement policy — no Convex, runs offline. This is the contract the
 * custom-domain bind gate (`domains.ts`) relies on.
 */

describe("customDomainAllowed", () => {
  it("free cannot bind custom domains (the upgrade gate)", () => {
    expect(customDomainAllowed("free")).toBe(false);
  });
  it("pro can bind custom domains", () => {
    expect(customDomainAllowed("pro")).toBe(true);
  });
});

describe("withinCustomDomainQuota", () => {
  it("free is blocked at any count (limit 0)", () => {
    expect(withinCustomDomainQuota("free", 0)).toBe(false);
  });

  it("pro allows binds up to its limit, then blocks", () => {
    const limit = PLAN_LIMITS.pro.customDomains;
    expect(withinCustomDomainQuota("pro", 0)).toBe(true);
    expect(withinCustomDomainQuota("pro", limit - 1)).toBe(true);
    // At the limit, one more would exceed it.
    expect(withinCustomDomainQuota("pro", limit)).toBe(false);
    expect(withinCustomDomainQuota("pro", limit + 5)).toBe(false);
  });
});

describe("publishQuotaExceeded", () => {
  it("never exceeded when the plan has no publish cap (null = unlimited)", () => {
    // Both plans are unlimited today (§6.4: publishing is cheap).
    expect(publishQuotaExceeded("free", 0)).toBe(false);
    expect(publishQuotaExceeded("free", 10_000)).toBe(false);
    expect(publishQuotaExceeded("pro", 10_000)).toBe(false);
  });
});
