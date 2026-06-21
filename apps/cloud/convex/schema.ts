import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Convex schema SKELETON.
 *
 * Tables mirror the plain-data records in `shared/src/types.ts`, one table per
 * record type. Columns and indexes (by_slug, by_account, by_customDomain,
 * by_tag, ...) are intentionally minimal here and **filled in by CLOUD-10** —
 * this file only needs to define the table set and typecheck.
 *
 * Auth tables (user, session, account, verification) are owned by the
 * @convex-dev/better-auth component (CLOUD-01), not defined here.
 */
export default defineSchema({
  // CLOUD-01: authUserId/name/email/createdAt/updatedAt — CLOUD-10 completes remaining tables
  accounts: defineTable({
    // Better Auth user id this account is bound to (component-owned `user` row).
    authUserId: v.string(),
    name: v.string(),
    email: v.union(v.string(), v.null()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    // CLOUD-01: lookup an account by its Better Auth user id at token-issue time.
    .index("by_authUserId", ["authUserId"]),
  // filled in by CLOUD-10
  pages: defineTable({}),
  // filled in by CLOUD-10
  pageVersions: defineTable({}),
  // filled in by CLOUD-10
  recipeVersions: defineTable({}),
  // filled in by CLOUD-10
  recipeEditEvents: defineTable({}),
  // CLOUD-01: tokenHash/accountId/scopes/label/createdAt/revokedAt/expiresAt — CLOUD-10 completes remaining tables
  tokens: defineTable({
    accountId: v.id("accounts"),
    // SHA-256 hex of the raw bearer secret; the plaintext is shown once at issue
    // time and never persisted (PRD 7). Validation re-hashes and matches here.
    tokenHash: v.string(),
    // Granted scopes — a subset of shared `Scope` strings. Stored as raw strings
    // (validated against `isScope` in app code) to keep the schema independent of
    // the shared scope union.
    scopes: v.array(v.string()),
    label: v.union(v.string(), v.null()),
    createdAt: v.number(),
    // Null while valid; set to a timestamp on revocation.
    revokedAt: v.union(v.number(), v.null()),
    // Optional hard expiry (epoch ms); null means no expiry.
    expiresAt: v.union(v.number(), v.null()),
  })
    // CLOUD-01: bearer validation looks a token up by its hash in O(1).
    .index("by_tokenHash", ["tokenHash"])
    // CLOUD-01: list/revoke an account's tokens.
    .index("by_account", ["accountId"]),
  // filled in by CLOUD-10
  auditLog: defineTable({}),
  // filled in by CLOUD-10
  moderation: defineTable({}),
  // filled in by CLOUD-10
  idempotencyKeys: defineTable({}),
});

// `v` is imported so CLOUD-10 has the validator namespace in scope without a
// follow-up edit to the import block; referenced here to satisfy noUnusedLocals.
export const _validators = v;
