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
  // filled in by CLOUD-10
  accounts: defineTable({}),
  // filled in by CLOUD-10
  pages: defineTable({}),
  // filled in by CLOUD-10
  pageVersions: defineTable({}),
  // filled in by CLOUD-10
  recipeVersions: defineTable({}),
  // filled in by CLOUD-10
  recipeEditEvents: defineTable({}),
  // filled in by CLOUD-10
  tokens: defineTable({}),
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
