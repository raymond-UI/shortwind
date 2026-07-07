import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ConvexError } from "convex/values";
import {
  ACTIVE_STATUSES,
  isActiveStatus,
  planToPriceId,
  priceToPlan,
  subscriptionToPlan,
} from "./plans.js";

/**
 * Ported from Realm's `billingStripe/__tests__/plans.test.ts`. Pure logic —
 * runs offline, no Convex deployment or codegen required. Shortwind colocates
 * tests next to source (see `billing.test.ts`), so this lives beside `plans.ts`.
 */

const PRO_ENV = "STRIPE_PRO_PRICE_ID";

describe("priceToPlan", () => {
  const original = process.env[PRO_ENV];
  beforeEach(() => {
    process.env[PRO_ENV] = "price_test_pro_123";
  });
  afterEach(() => {
    if (original === undefined) delete process.env[PRO_ENV];
    else process.env[PRO_ENV] = original;
  });

  it("maps the configured pro price to 'pro'", () => {
    expect(priceToPlan("price_test_pro_123")).toBe("pro");
  });

  it("returns null for unknown prices", () => {
    expect(priceToPlan("price_legacy_999")).toBeNull();
  });

  it("returns null when the env var is unset", () => {
    delete process.env[PRO_ENV];
    expect(priceToPlan("price_test_pro_123")).toBeNull();
  });
});

describe("planToPriceId", () => {
  const original = process.env[PRO_ENV];
  afterEach(() => {
    if (original === undefined) delete process.env[PRO_ENV];
    else process.env[PRO_ENV] = original;
  });

  it("returns null for free (no checkout)", () => {
    expect(planToPriceId("free")).toBeNull();
  });

  it("returns the env-configured price for pro", () => {
    process.env[PRO_ENV] = "price_test_pro_123";
    expect(planToPriceId("pro")).toBe("price_test_pro_123");
  });

  it("returns null for pro when unconfigured", () => {
    delete process.env[PRO_ENV];
    expect(planToPriceId("pro")).toBeNull();
  });
});

describe("isActiveStatus", () => {
  it.each(ACTIVE_STATUSES)("'%s' is active", (status) => {
    expect(isActiveStatus(status)).toBe(true);
  });

  it.each(["past_due", "unpaid", "canceled", "incomplete", "incomplete_expired"])(
    "'%s' is not active",
    (status) => {
      expect(isActiveStatus(status)).toBe(false);
    },
  );
});

describe("subscriptionToPlan", () => {
  const original = process.env[PRO_ENV];
  beforeEach(() => {
    process.env[PRO_ENV] = "price_test_pro_123";
  });
  afterEach(() => {
    if (original === undefined) delete process.env[PRO_ENV];
    else process.env[PRO_ENV] = original;
  });

  it("returns the plan id when the price is in the catalog", () => {
    expect(
      subscriptionToPlan({
        stripeSubscriptionId: "sub_1",
        priceId: "price_test_pro_123",
      }),
    ).toBe("pro");
  });

  it("throws BILLING_UNKNOWN_PRICE when the price is not in the catalog", () => {
    expect(() =>
      subscriptionToPlan({
        stripeSubscriptionId: "sub_1",
        priceId: "price_legacy_999",
      }),
    ).toThrow(ConvexError);
  });

  it("throws when the env var is unset (entire catalog unconfigured)", () => {
    delete process.env[PRO_ENV];
    expect(() =>
      subscriptionToPlan({
        stripeSubscriptionId: "sub_1",
        priceId: "price_test_pro_123",
      }),
    ).toThrow(ConvexError);
  });
});
