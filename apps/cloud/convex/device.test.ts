// @vitest-environment edge-runtime
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema.js";
import { api, internal } from "./_generated/api.js";

/**
 * Handler-level INTEGRATION test for the native device-authorization grant
 * (convex/device.ts), against the REAL schema + tokens.issueToken. Proves the
 * full poll lifecycle: request → pending → approve → mint (single-use) → replay
 * rejected; plus denied/expired and the session guard on approve. Runs OFFLINE
 * under convex-test.
 */

declare global {
  interface ImportMeta {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
}
const modules = import.meta.glob("./**/*.ts");

/** Seed an account row and return its id (stands in for the approving human). */
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

/** Flip a device code to approved+account, as approveDeviceCode would. */
async function approveByUserCode(
  t: ReturnType<typeof convexTest>,
  userCode: string,
  accountId: string,
) {
  await t.run(async (ctx) => {
    const row = await ctx.db
      .query("deviceCodes")
      .withIndex("by_userCode", (q) => q.eq("userCode", userCode))
      .first();
    if (!row) throw new Error("seed: device code not found");
    await ctx.db.patch(row._id, {
      status: "approved",
      accountId: accountId as never,
    });
  });
}

describe("device authorization grant", () => {
  it("first poll before approval → authorization_pending", async () => {
    const t = convexTest(schema, modules);
    const req = await t.mutation(internal.device.requestDeviceCode, {
      clientId: "shortwind-cli",
      scope: "pages:read",
    });
    // Dashboard lookup sees the pending request.
    const look = await t.query(api.device.lookupUserCode, {
      userCode: req.userCode,
    });
    expect(look).toMatchObject({ found: true, status: "pending", expired: false });

    const pending = await t.mutation(internal.device.pollDeviceToken, {
      deviceCode: req.deviceCode,
    });
    expect(pending).toEqual({ ok: false, error: "authorization_pending" });
  });

  it("request → approve → mint scoped token (single-use)", async () => {
    const t = convexTest(schema, modules);
    const accountId = await seedAccount(t);

    const req = await t.mutation(internal.device.requestDeviceCode, {
      clientId: "shortwind-cli",
      scope: "pages:read pages:write",
    });
    expect(req.deviceCode.length).toBeGreaterThanOrEqual(43);
    expect(req.userCode).toHaveLength(8);

    // Human approves (no prior poll → no slow_down timing artifact; the real CLI
    // waits the interval between polls).
    await approveByUserCode(t, req.userCode, accountId);

    // The poll now mints a scoped swc_ token.
    const minted = await t.mutation(internal.device.pollDeviceToken, {
      deviceCode: req.deviceCode,
    });
    expect(minted.ok).toBe(true);
    if (minted.ok) {
      expect(minted.accessToken.startsWith("swc_")).toBe(true);
      expect(minted.scope.split(" ").sort()).toEqual([
        "pages:read",
        "pages:write",
      ]);

      // The minted token actually validates against the token store.
      const verdict = await t.query(api.tokens.validateToken, {
        secret: minted.accessToken,
      });
      expect(verdict).toMatchObject({ valid: true });
    }

    // Replaying the same device_code is rejected (single-use → consumed).
    const replay = await t.mutation(internal.device.pollDeviceToken, {
      deviceCode: req.deviceCode,
    });
    expect(replay).toEqual({ ok: false, error: "invalid_grant" });
  });

  it("unknown device_code → invalid_grant", async () => {
    const t = convexTest(schema, modules);
    const res = await t.mutation(internal.device.pollDeviceToken, {
      deviceCode: "nope",
    });
    expect(res).toEqual({ ok: false, error: "invalid_grant" });
  });

  it("denied code → access_denied", async () => {
    const t = convexTest(schema, modules);
    const req = await t.mutation(internal.device.requestDeviceCode, {
      clientId: "shortwind-cli",
      scope: "pages:read",
    });
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("deviceCodes")
        .withIndex("by_userCode", (q) => q.eq("userCode", req.userCode))
        .first();
      await ctx.db.patch(row!._id, { status: "denied" });
    });
    const res = await t.mutation(internal.device.pollDeviceToken, {
      deviceCode: req.deviceCode,
    });
    expect(res).toEqual({ ok: false, error: "access_denied" });
  });

  it("expired code → expired_token", async () => {
    const t = convexTest(schema, modules);
    const req = await t.mutation(internal.device.requestDeviceCode, {
      clientId: "shortwind-cli",
      scope: "pages:read",
    });
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("deviceCodes")
        .withIndex("by_userCode", (q) => q.eq("userCode", req.userCode))
        .first();
      await ctx.db.patch(row!._id, { expiresAt: Date.now() - 1 });
    });
    const res = await t.mutation(internal.device.pollDeviceToken, {
      deviceCode: req.deviceCode,
    });
    expect(res).toEqual({ ok: false, error: "expired_token" });
  });

  it("approveDeviceCode without a session is rejected (UNAUTHORIZED)", async () => {
    const t = convexTest(schema, modules);
    const req = await t.mutation(internal.device.requestDeviceCode, {
      clientId: "shortwind-cli",
      scope: "pages:read",
    });
    await expect(
      t.mutation(api.device.approveDeviceCode, { userCode: req.userCode }),
    ).rejects.toThrow();
  });

  it("sweep deletes elapsed codes", async () => {
    const t = convexTest(schema, modules);
    const req = await t.mutation(internal.device.requestDeviceCode, {
      clientId: "shortwind-cli",
      scope: "pages:read",
    });
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query("deviceCodes")
        .withIndex("by_userCode", (q) => q.eq("userCode", req.userCode))
        .first();
      await ctx.db.patch(row!._id, { expiresAt: Date.now() - 1 });
    });
    const swept = await t.mutation(internal.device.sweepExpiredDeviceCodes, {});
    expect(swept.deleted).toBe(1);
  });
});
