import { describe, expect, it } from "vitest";
import {
  TOKEN_PREFIX,
  type TokenRecord,
  evaluateToken,
  generateTokenSecret,
  hasScopes,
  hashToken,
  sanitizeScopes,
} from "./tokens.js";
import {
  SCOPE_DOMAINS_BIND,
  SCOPE_PAGES_READ,
  SCOPE_PAGES_WRITE,
} from "../shared/src/scopes.js";

describe("hashToken", () => {
  it("produces a stable 64-char lowercase hex SHA-256", async () => {
    const h = await hashToken("swc_example");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    // Deterministic.
    expect(await hashToken("swc_example")).toBe(h);
  });

  it("differs for different inputs and never echoes the plaintext", async () => {
    const a = await hashToken("secret-a");
    const b = await hashToken("secret-b");
    expect(a).not.toBe(b);
    expect(a).not.toContain("secret-a");
  });
});

describe("generateTokenSecret", () => {
  it("is prefixed and high-entropy", () => {
    const s = generateTokenSecret();
    expect(s.startsWith(TOKEN_PREFIX)).toBe(true);
    expect(s.length).toBeGreaterThan(40);
    expect(s).toMatch(/^swc_[A-Za-z0-9_-]+$/);
  });

  it("is unique across calls", () => {
    const seen = new Set(Array.from({ length: 50 }, () => generateTokenSecret()));
    expect(seen.size).toBe(50);
  });

  it("is deterministic under injected randomness (golden)", () => {
    const fixed = (n: number) => new Uint8Array(n).fill(0);
    // 32 zero bytes -> base64url of all-zero == 43 'A's.
    expect(generateTokenSecret(fixed)).toBe(`${TOKEN_PREFIX}${"A".repeat(43)}`);
  });
});

describe("sanitizeScopes", () => {
  it("keeps known scopes, drops unknown, de-dupes", () => {
    expect(
      sanitizeScopes([
        SCOPE_PAGES_READ,
        "pages:delete",
        SCOPE_PAGES_WRITE,
        SCOPE_PAGES_READ,
      ]),
    ).toEqual([SCOPE_PAGES_READ, SCOPE_PAGES_WRITE]);
  });

  it("returns empty for an all-unknown list", () => {
    expect(sanitizeScopes(["nope", ""])).toEqual([]);
  });
});

describe("evaluateToken", () => {
  const NOW = 1_000_000;
  const live: TokenRecord = {
    scopes: [SCOPE_PAGES_READ, SCOPE_PAGES_WRITE],
    revokedAt: null,
    expiresAt: null,
  };

  it("validates a live token and returns sanitized scopes", () => {
    const v = evaluateToken(
      { ...live, scopes: [...live.scopes, "bogus"] },
      NOW,
    );
    expect(v).toEqual({
      valid: true,
      scopes: [SCOPE_PAGES_READ, SCOPE_PAGES_WRITE],
    });
  });

  it("reports not_found for a missing row", () => {
    expect(evaluateToken(null, NOW)).toEqual({
      valid: false,
      reason: "not_found",
    });
    expect(evaluateToken(undefined, NOW)).toEqual({
      valid: false,
      reason: "not_found",
    });
  });

  it("reports revoked once revokedAt is set", () => {
    expect(
      evaluateToken({ ...live, revokedAt: NOW - 10 }, NOW),
    ).toEqual({ valid: false, reason: "revoked" });
  });

  it("prefers revoked over expired when both apply", () => {
    expect(
      evaluateToken({ ...live, revokedAt: NOW - 10, expiresAt: NOW - 5 }, NOW),
    ).toEqual({ valid: false, reason: "revoked" });
  });

  it("reports expired when expiresAt has passed", () => {
    expect(
      evaluateToken({ ...live, expiresAt: NOW }, NOW),
    ).toEqual({ valid: false, reason: "expired" });
    expect(
      evaluateToken({ ...live, expiresAt: NOW - 1 }, NOW),
    ).toEqual({ valid: false, reason: "expired" });
  });

  it("stays valid right up to (but not including) the expiry instant", () => {
    expect(evaluateToken({ ...live, expiresAt: NOW + 1 }, NOW).valid).toBe(true);
  });
});

describe("hasScopes", () => {
  it("is true only when every required scope is granted", () => {
    const granted = [SCOPE_PAGES_READ, SCOPE_PAGES_WRITE] as const;
    expect(hasScopes(granted, [SCOPE_PAGES_READ])).toBe(true);
    expect(hasScopes(granted, [SCOPE_PAGES_READ, SCOPE_PAGES_WRITE])).toBe(true);
    expect(hasScopes(granted, [SCOPE_DOMAINS_BIND])).toBe(false);
    expect(
      hasScopes(granted, [SCOPE_PAGES_WRITE, SCOPE_DOMAINS_BIND]),
    ).toBe(false);
  });

  it("trivially true for an empty requirement", () => {
    expect(hasScopes([], [])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Issue -> validate -> revoke round trip, exercised against the pure layer the
// Convex wrappers delegate to (no Convex harness / network).
// ---------------------------------------------------------------------------

describe("issue -> validate -> revoke (pure round trip)", () => {
  it("a freshly minted token validates, then fails after revocation", async () => {
    // Mint: generate a secret, hash it, store the hash in a fake row.
    const secret = generateTokenSecret();
    const row: TokenRecord = {
      scopes: [SCOPE_PAGES_READ, SCOPE_PAGES_WRITE],
      revokedAt: null,
      expiresAt: null,
    };
    const storedHash = await hashToken(secret);

    // Validate: re-hash the presented bearer, confirm it matches and is live.
    expect(await hashToken(secret)).toBe(storedHash);
    const ok = evaluateToken(row, Date.now());
    expect(ok.valid).toBe(true);
    if (ok.valid) {
      expect(hasScopes(ok.scopes, [SCOPE_PAGES_WRITE])).toBe(true);
    }

    // Revoke: flip revokedAt; the same secret now fails validation.
    const revoked: TokenRecord = { ...row, revokedAt: Date.now() };
    expect(evaluateToken(revoked, Date.now())).toEqual({
      valid: false,
      reason: "revoked",
    });
  });
});
