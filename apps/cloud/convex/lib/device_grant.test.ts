import { describe, it, expect } from "vitest";
import {
  generateDeviceCode,
  generateUserCode,
  normalizeUserCode,
  formatUserCode,
  pollVerdict,
  USER_CODE_ALPHABET,
  USER_CODE_LENGTH,
  type DeviceCodeRecord,
} from "./device_grant.js";

/** Deterministic byte source for reproducible code generation. */
const seq = (start = 0) => (n: number) =>
  Uint8Array.from({ length: n }, (_, i) => (start + i) % 256);

describe("device code generation", () => {
  it("device_code is base64url with no padding or +/ chars", () => {
    const code = generateDeviceCode(seq(1));
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(code).not.toContain("=");
    expect(code.length).toBeGreaterThanOrEqual(43);
  });

  it("user_code uses only the unambiguous alphabet and fixed length", () => {
    const code = generateUserCode(seq(0));
    expect(code).toHaveLength(USER_CODE_LENGTH);
    for (const ch of code) expect(USER_CODE_ALPHABET).toContain(ch);
    // No look-alikes ever appear.
    expect(code).not.toMatch(/[O01IL]/);
  });
});

describe("normalizeUserCode", () => {
  it("uppercases and strips hyphens/spaces/lowercase to match the stored form", () => {
    expect(normalizeUserCode("abcd-efgh")).toBe("ABCDEFGH");
    expect(normalizeUserCode("ABCD EFGH")).toBe("ABCDEFGH");
    expect(normalizeUserCode(" a b c d ")).toBe("ABCD");
  });
  it("drops characters outside the alphabet (0/O/1/I never survive)", () => {
    // 0,O,1,I,L are not in the alphabet → dropped.
    expect(normalizeUserCode("A0B1C")).toBe("ABC");
  });
  it("guards a non-string input", () => {
    // @ts-expect-error exercising the runtime guard
    expect(normalizeUserCode(undefined)).toBe("");
  });
});

describe("formatUserCode", () => {
  it("inserts a midpoint hyphen for display", () => {
    expect(formatUserCode("ABCDEFGH")).toBe("ABCD-EFGH");
  });
});

describe("pollVerdict", () => {
  const base: DeviceCodeRecord = {
    status: "pending",
    expiresAt: 1000,
    lastPolledAt: null,
    pollingInterval: 5000,
    accountId: null,
  };

  it("pending → pending on first poll", () => {
    expect(pollVerdict(base, 0)).toEqual({ state: "pending" });
  });

  it("polling faster than the interval → slow_down", () => {
    const r = { ...base, expiresAt: 1_000_000, lastPolledAt: 100 };
    expect(pollVerdict(r, 100 + 4999)).toEqual({ state: "slow_down" });
  });

  it("polling at/after the interval → pending again", () => {
    const r = { ...base, expiresAt: 1_000_000, lastPolledAt: 100 };
    expect(pollVerdict(r, 100 + 5000)).toEqual({ state: "pending" });
  });

  it("approved with an account → approved(accountId)", () => {
    const r = { ...base, status: "approved" as const, accountId: "acct_1" };
    expect(pollVerdict(r, 0)).toEqual({ state: "approved", accountId: "acct_1" });
  });

  it("approved but past TTL → expired (TTL beats approval)", () => {
    const r = { ...base, status: "approved" as const, accountId: "acct_1" };
    expect(pollVerdict(r, 1000)).toEqual({ state: "expired" });
  });

  it("approved without an account is treated as pending (defensive)", () => {
    const r = { ...base, status: "approved" as const, accountId: null };
    expect(pollVerdict(r, 0)).toEqual({ state: "pending" });
  });

  it("denied → denied", () => {
    const r = { ...base, status: "denied" as const };
    expect(pollVerdict(r, 0)).toEqual({ state: "denied" });
  });

  it("consumed → consumed even before TTL (single-use, no replay)", () => {
    const r = { ...base, status: "consumed" as const, accountId: "acct_1" };
    expect(pollVerdict(r, 0)).toEqual({ state: "consumed" });
  });

  it("expired pending → expired", () => {
    expect(pollVerdict(base, 1000)).toEqual({ state: "expired" });
  });
});
