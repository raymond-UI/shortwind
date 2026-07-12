// @vitest-environment edge-runtime
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema.js";
import { api, internal } from "./_generated/api.js";

/**
 * Handler-level INTEGRATION test for the #201 OAuth `refresh_token` grant
 * (convex/tokens.ts `rotateRefreshToken` + the device-code exchange that now
 * mints a refresh alongside the access token). Proves: the device exchange
 * returns an access+refresh pair with a TTL; a refresh rotates to a NEW pair;
 * the OLD refresh is single-use (replay → invalid_grant); a revoked/unknown
 * refresh → invalid_grant. Runs OFFLINE under convex-test.
 */

declare global {
  interface ImportMeta {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
}
const modules = import.meta.glob("./**/*.ts");

async function seedAccount(t: ReturnType<typeof convexTest>): Promise<string> {
  return t.run(async (ctx) =>
    ctx.db.insert("accounts", {
      authUserId: "auth_user_1",
      name: "tester",
      email: "t@example.com",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  );
}

/** Run the device flow to approval and return the minted token pair. */
async function loginPair(
  t: ReturnType<typeof convexTest>,
  accountId: string,
  scope = "pages:read pages:write",
) {
  const req = await t.mutation(internal.device.requestDeviceCode, {
    clientId: "shortwind-cli",
    scope,
  });
  await t.run(async (ctx) => {
    const all = await ctx.db.query("deviceCodes").collect();
    const row = all.find(
      (r) => (r as { userCode: string }).userCode === req.userCode,
    )!;
    await ctx.db.patch(row._id, { status: "approved", accountId } as never);
  });
  const minted = await t.mutation(internal.device.pollDeviceToken, {
    deviceCode: req.deviceCode,
  });
  if (!minted.ok) throw new Error("expected mint");
  return minted;
}

describe("#201 refresh_token grant", () => {
  it("device exchange mints an access+refresh pair with a TTL", async () => {
    const t = convexTest(schema, modules);
    const accountId = await seedAccount(t);
    const pair = await loginPair(t, accountId);
    expect(pair.accessToken.startsWith("swc_")).toBe(true);
    expect(pair.refreshToken.startsWith("swc_")).toBe(true);
    expect(pair.refreshToken).not.toEqual(pair.accessToken);
    expect(pair.expiresInSeconds).toBe(3600);
  });

  it("exchanges a refresh for a NEW pair; old refresh is single-use", async () => {
    const t = convexTest(schema, modules);
    const accountId = await seedAccount(t);
    const first = await loginPair(t, accountId);

    const rotated = await t.mutation(internal.tokens.rotateRefreshToken, {
      refreshToken: first.refreshToken,
    });
    expect(rotated.ok).toBe(true);
    if (rotated.ok) {
      // Fresh, distinct tokens with the same scope + TTL.
      expect(rotated.accessToken).not.toEqual(first.accessToken);
      expect(rotated.refreshToken).not.toEqual(first.refreshToken);
      expect(rotated.expiresInSeconds).toBe(3600);
      expect(rotated.scope.split(" ").sort()).toEqual([
        "pages:read",
        "pages:write",
      ]);
      // The new access token validates.
      const verdict = await t.query(api.tokens.validateToken, {
        secret: rotated.accessToken,
      });
      expect(verdict).toMatchObject({ valid: true });
    }

    // Replaying the ROTATED-OUT refresh fails (single-use).
    const replay = await t.mutation(internal.tokens.rotateRefreshToken, {
      refreshToken: first.refreshToken,
    });
    expect(replay).toEqual({ ok: false, error: "invalid_grant" });
  });

  it("unknown refresh → invalid_grant", async () => {
    const t = convexTest(schema, modules);
    const res = await t.mutation(internal.tokens.rotateRefreshToken, {
      refreshToken: "swc_nope",
    });
    expect(res).toEqual({ ok: false, error: "invalid_grant" });
  });

  it("a revoked refresh (kill switch) → invalid_grant", async () => {
    const t = convexTest(schema, modules);
    const accountId = await seedAccount(t);
    const pair = await loginPair(t, accountId);
    // Revoke every refresh token for the account (the kill switch).
    await t.run(async (ctx) => {
      const rows = await ctx.db.query("refreshTokens").collect();
      for (const r of rows) await ctx.db.patch(r._id, { revokedAt: Date.now() });
    });
    const res = await t.mutation(internal.tokens.rotateRefreshToken, {
      refreshToken: pair.refreshToken,
    });
    expect(res).toEqual({ ok: false, error: "invalid_grant" });
  });
});
