import { describe, expect, it } from "vitest";
import { ConvexError } from "convex/values";
import {
  AUTH_FORBIDDEN,
  AUTH_UNAUTHORIZED,
  type AuthErrorPayload,
  decideAuth,
  requireAuth,
} from "./auth-guard.js";
import {
  SCOPE_DOMAINS_BIND,
  SCOPE_PAGES_READ,
  SCOPE_PAGES_WRITE,
} from "../../shared/src/scopes.js";
import {
  generateTokenSecret,
  hashToken,
  type TokenRecord,
} from "../tokens.js";

// ---------------------------------------------------------------------------
// decideAuth — the pure verdict→authorization decision. No Convex, no IO.
// ---------------------------------------------------------------------------

describe("decideAuth", () => {
  it("401-equivalent when the token row is not found", () => {
    const d = decideAuth({ valid: false, reason: "not_found" }, [
      SCOPE_PAGES_READ,
    ]);
    expect(d).toEqual({
      ok: false,
      code: AUTH_UNAUTHORIZED,
      reason: "not_found",
    });
  });

  it("401-equivalent when revoked", () => {
    const d = decideAuth({ valid: false, reason: "revoked" }, [
      SCOPE_PAGES_READ,
    ]);
    expect(d).toEqual({ ok: false, code: AUTH_UNAUTHORIZED, reason: "revoked" });
  });

  it("401-equivalent when expired", () => {
    const d = decideAuth({ valid: false, reason: "expired" }, [
      SCOPE_PAGES_READ,
    ]);
    expect(d).toEqual({ ok: false, code: AUTH_UNAUTHORIZED, reason: "expired" });
  });

  it("403 when valid but missing a required scope", () => {
    const d = decideAuth(
      { valid: true, scopes: [SCOPE_PAGES_READ] },
      [SCOPE_PAGES_WRITE],
    );
    expect(d).toEqual({
      ok: false,
      code: AUTH_FORBIDDEN,
      reason: "insufficient_scope",
      missing: [SCOPE_PAGES_WRITE],
    });
  });

  it("403 lists every missing scope (domains:bind excluded from default)", () => {
    const d = decideAuth(
      { valid: true, scopes: [SCOPE_PAGES_READ, SCOPE_PAGES_WRITE] },
      [SCOPE_PAGES_WRITE, SCOPE_DOMAINS_BIND],
    );
    expect(d).toEqual({
      ok: false,
      code: AUTH_FORBIDDEN,
      reason: "insufficient_scope",
      missing: [SCOPE_DOMAINS_BIND],
    });
  });

  it("ok when valid and every required scope is granted", () => {
    const d = decideAuth(
      { valid: true, scopes: [SCOPE_PAGES_READ, SCOPE_PAGES_WRITE] },
      [SCOPE_PAGES_WRITE],
    );
    expect(d).toEqual({
      ok: true,
      scopes: [SCOPE_PAGES_READ, SCOPE_PAGES_WRITE],
    });
  });

  it("ok with an empty requirement (authentication only)", () => {
    const d = decideAuth({ valid: true, scopes: [SCOPE_PAGES_READ] }, []);
    expect(d).toEqual({ ok: true, scopes: [SCOPE_PAGES_READ] });
  });
});

// ---------------------------------------------------------------------------
// requireAuth — ctx-bound guard. We drive it with a tiny fake ctx whose
// `db.query(...).withIndex(...).unique()` returns a planted token row (or
// null). This exercises the full path — missing token, hash lookup, verdict,
// scope gate — without a Convex deployment.
// ---------------------------------------------------------------------------

type Row = (TokenRecord & { _id: string; accountId: string }) | null;

/** A minimal stand-in for the slice of QueryCtx the guard touches. */
function fakeCtx(rowsByHash: Record<string, Row>) {
  let captured: string | undefined;
  return {
    db: {
      query(_table: string) {
        return {
          withIndex(
            _index: string,
            cb: (q: { eq: (field: string, value: string) => unknown }) => unknown,
          ) {
            cb({
              eq(_field: string, value: string) {
                captured = value;
                return null;
              },
            });
            return {
              async unique() {
                return rowsByHash[captured ?? ""] ?? null;
              },
            };
          },
        };
      },
    },
  } as unknown as Parameters<typeof requireAuth>[0];
}

async function ctxFor(secret: string, row: Omit<NonNullable<Row>, "_id" | "accountId"> & Partial<Pick<NonNullable<Row>, "_id" | "accountId">> | null) {
  const hash = await hashToken(secret);
  const full: Row = row
    ? { _id: "tok_1", accountId: "acc_1", ...row }
    : null;
  return fakeCtx({ [hash]: full });
}

describe("requireAuth", () => {
  it("missing bearer token throws UNAUTHORIZED (401)", async () => {
    const ctx = await ctxFor("ignored", {
      scopes: [SCOPE_PAGES_READ],
      revokedAt: null,
      expiresAt: null,
    });
    await expect(requireAuth(ctx, undefined, [SCOPE_PAGES_READ])).rejects.toThrow(
      ConvexError,
    );
    await expect(
      requireAuth(ctx, "   ", [SCOPE_PAGES_READ]),
    ).rejects.toMatchObject({
      data: { code: AUTH_UNAUTHORIZED, reason: "missing_token" },
    });
  });

  it("unknown/invalid token throws UNAUTHORIZED (401)", async () => {
    const ctx = await ctxFor("swc_real", {
      scopes: [SCOPE_PAGES_READ],
      revokedAt: null,
      expiresAt: null,
    });
    // A different secret hashes to a different key -> not found.
    let err: ConvexError<AuthErrorPayload> | undefined;
    try {
      await requireAuth(ctx, "swc_other", [SCOPE_PAGES_READ]);
    } catch (e) {
      err = e as ConvexError<AuthErrorPayload>;
    }
    expect(err).toBeInstanceOf(ConvexError);
    expect(err?.data).toMatchObject({
      code: AUTH_UNAUTHORIZED,
      reason: "not_found",
    });
  });

  it("revoked token throws UNAUTHORIZED (401)", async () => {
    const secret = generateTokenSecret();
    const ctx = await ctxFor(secret, {
      scopes: [SCOPE_PAGES_READ, SCOPE_PAGES_WRITE],
      revokedAt: Date.now() - 10,
      expiresAt: null,
    });
    await expect(
      requireAuth(ctx, secret, [SCOPE_PAGES_READ]),
    ).rejects.toMatchObject({
      data: { code: AUTH_UNAUTHORIZED, reason: "revoked" },
    });
  });

  it("expired token throws UNAUTHORIZED (401)", async () => {
    const secret = generateTokenSecret();
    const ctx = await ctxFor(secret, {
      scopes: [SCOPE_PAGES_READ],
      revokedAt: null,
      expiresAt: Date.now() - 1,
    });
    await expect(
      requireAuth(ctx, secret, [SCOPE_PAGES_READ]),
    ).rejects.toMatchObject({
      data: { code: AUTH_UNAUTHORIZED, reason: "expired" },
    });
  });

  it("valid token lacking a required scope throws FORBIDDEN (403)", async () => {
    const secret = generateTokenSecret();
    const ctx = await ctxFor(secret, {
      scopes: [SCOPE_PAGES_READ],
      revokedAt: null,
      expiresAt: null,
    });
    await expect(
      requireAuth(ctx, secret, [SCOPE_PAGES_WRITE]),
    ).rejects.toMatchObject({
      data: {
        code: AUTH_FORBIDDEN,
        reason: "insufficient_scope",
        missing: [SCOPE_PAGES_WRITE],
      },
    });
  });

  it("valid token with sufficient scope resolves {accountId, tokenId, scopes}", async () => {
    const secret = generateTokenSecret();
    const ctx = await ctxFor(secret, {
      scopes: [SCOPE_PAGES_READ, SCOPE_PAGES_WRITE],
      revokedAt: null,
      expiresAt: null,
    });
    const auth = await requireAuth(ctx, secret, [SCOPE_PAGES_WRITE]);
    expect(auth).toEqual({
      accountId: "acc_1",
      tokenId: "tok_1",
      scopes: [SCOPE_PAGES_READ, SCOPE_PAGES_WRITE],
    });
  });

  it("drops unknown stored scopes before the gate (sanitized result)", async () => {
    const secret = generateTokenSecret();
    const ctx = await ctxFor(secret, {
      scopes: [SCOPE_PAGES_READ, "pages:nope"],
      revokedAt: null,
      expiresAt: null,
    });
    const auth = await requireAuth(ctx, secret, [SCOPE_PAGES_READ]);
    expect(auth.scopes).toEqual([SCOPE_PAGES_READ]);
  });
});
