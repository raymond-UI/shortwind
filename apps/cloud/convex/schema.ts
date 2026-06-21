import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Convex schema — system of record for Shortwind Cloud (PRD 6.3).
 *
 * Every table mirrors a plain-data record in `shared/src/types.ts`, one table
 * per record type. The shared module is the field source of truth; the mapping
 * is mechanical:
 *   - `Id<"table">`            ↔ `v.id("table")`
 *   - `Timestamp` (epoch ms)   ↔ `v.number()`
 *   - `Sha` / hex string       ↔ `v.string()`
 *   - `T | null`               ↔ `v.union(v.<t>(), v.null())`
 *   - `Record<string, unknown>`↔ `v.any()` (must stay JSON-serializable)
 *   - string-literal unions    ↔ `v.union(v.literal(...), ...)`
 *
 * Indexes back the `find`-style lookups described in PRD 6.3 / the issue spec
 * (by_slug, by_account, by_customDomain, by_tag, ...).
 *
 * Auth tables (user, session, account, verification) are owned by the
 * @convex-dev/better-auth component (CLOUD-01), not defined here.
 */
export default defineSchema({
  // CLOUD-01: authUserId/name/email/createdAt/updatedAt — DO NOT ALTER (auth depends on it).
  // Mirrors shared `Account`.
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

  // Mirrors shared `Page`. The page's metadata + a pointer to the current
  // version; frozen artifacts live in R2, per-version history in `pageVersions`.
  pages: defineTable({
    accountId: v.id("accounts"),
    // Stable URL handle. Unique per account (collision -> 409, enforced in app).
    slug: v.string(),
    // Optional bound custom hostname (Cloudflare for SaaS); null when unbound.
    customDomain: v.union(v.string(), v.null()),
    // PageVisibility: who can reach the page.
    visibility: v.union(
      v.literal("public"),
      v.literal("unlisted"),
      v.literal("private"),
    ),
    // PageLifecycle: active | quarantined | tombstoned (PRD 8.2).
    lifecycle: v.union(
      v.literal("active"),
      v.literal("quarantined"),
      v.literal("tombstoned"),
    ),
    // Free-form discovery tags (load-bearing for `find`; backed by by_tag).
    tags: v.array(v.string()),
    // Pointer to the current `pageVersions` row. Null only between create and
    // the first published version.
    currentVersionId: v.union(v.id("pageVersions"), v.null()),
    // Monotonic version counter; bumps on every publish/update.
    currentVersion: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    // Resolve a page by (account, slug) — the primary publish/lookup path.
    .index("by_slug", ["accountId", "slug"])
    // List an account's pages.
    .index("by_account", ["accountId"])
    // Custom-domain serve path resolves host -> page.
    .index("by_customDomain", ["customDomain"])
    // Discovery: enumerate pages by tag (array index fans out per element).
    .index("by_tag", ["tags"]),

  // Mirrors shared `PageVersion`. An immutable published snapshot — old
  // versions are frozen and never rebuilt (PRD 5.6).
  pageVersions: defineTable({
    pageId: v.id("pages"),
    accountId: v.id("accounts"),
    version: v.number(),
    // R2 key for the frozen Tailwind HTML artifact.
    artifactKey: v.string(),
    // Hash of the expanded output; deterministic for a given input+registry.
    expandedHash: v.string(),
    // Hash of the shorthand source that produced this version.
    sourceHash: v.string(),
    // Snapshot of the lockfile (family -> version) used to expand this version.
    lockfile: v.record(v.string(), v.string()),
    createdAt: v.number(),
  })
    // List/iterate a page's version history.
    .index("by_page", ["pageId"]),

  // Mirrors shared `RecipeVersion`. Forward-only versioned recipe family bodies
  // in the account's cloud palette (PRD 5.4).
  recipeVersions: defineTable({
    accountId: v.id("accounts"),
    // Recipe family name (e.g. "card").
    family: v.string(),
    // Semantic version (e.g. "0.5.0").
    version: v.string(),
    // Normalized recipe body source.
    body: v.string(),
    // Content hash of the normalized body (matches core fingerprint).
    bodySha: v.string(),
    createdAt: v.number(),
  })
    // Resolve a family's versions within an account.
    .index("by_account_family", ["accountId", "family"]),

  // Mirrors shared `RecipeEditEvent`. Audit-grade record of a recipe edit that
  // rode up on a publish (PRD 5.4).
  recipeEditEvents: defineTable({
    accountId: v.id("accounts"),
    family: v.string(),
    // Prior version, or null if this is the family's first version.
    fromVersion: v.union(v.string(), v.null()),
    toVersion: v.string(),
    // New body content hash.
    bodySha: v.string(),
    // The publish/token actor that carried the edit.
    actorTokenId: v.union(v.id("tokens"), v.null()),
    createdAt: v.number(),
  })
    // List an account's recipe-edit history.
    .index("by_account", ["accountId"]),

  // CLOUD-01: tokenHash/accountId/scopes/label/createdAt/revokedAt/expiresAt —
  // DO NOT ALTER (auth depends on it). Mirrors shared `Token`.
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

  // Mirrors shared `AuditEvent`. Append-only entry for any consequential
  // mutation (PRD 6.3 audit log).
  auditLog: defineTable({
    accountId: v.id("accounts"),
    // Verb, e.g. "page.publish", "page.delete", "domain.bind".
    action: v.string(),
    // Affected document id (page, recipe, token, ...), if any. Stored as a raw
    // string since the target table varies.
    targetId: v.union(v.string(), v.null()),
    // Acting token, if the action was token-authenticated.
    actorTokenId: v.union(v.id("tokens"), v.null()),
    // Free-form structured detail; must be JSON-serializable.
    metadata: v.any(),
    createdAt: v.number(),
  })
    // List an account's audit trail.
    .index("by_account", ["accountId"]),

  // Mirrors shared `Moderation`. A trust-and-safety case attached to a page;
  // quarantined objects are sealed and preserved, never hard-deleted (PRD 8).
  moderation: defineTable({
    pageId: v.id("pages"),
    accountId: v.id("accounts"),
    // ModerationState: reported | quarantined | preserved | cleared.
    state: v.union(
      v.literal("reported"),
      v.literal("quarantined"),
      v.literal("preserved"),
      v.literal("cleared"),
    ),
    // Why the case was opened (reporter note / classifier reason).
    reason: v.union(v.string(), v.null()),
    // Reporter contact, if from the abuse-intake route.
    reporterContact: v.union(v.string(), v.null()),
    // NCMEC CyberTipline report id, set when a report is filed.
    ncmecReportId: v.union(v.string(), v.null()),
    // When legally-required preservation expires (e.g. 60-day window).
    preservationExpiresAt: v.union(v.number(), v.null()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    // Resolve a page's moderation case(s).
    .index("by_page", ["pageId"])
    // Sweep cases by state (review queue, preservation expiry).
    .index("by_state", ["state"]),

  // Mirrors shared `IdempotencyKey`. A retried publish with the same key returns
  // the same result instead of duplicating (PRD 6.2).
  idempotencyKeys: defineTable({
    accountId: v.id("accounts"),
    // Client-supplied key, unique per account.
    key: v.string(),
    // The document id produced by the first successful call.
    resultId: v.string(),
    // JSON-serializable cached response payload.
    result: v.any(),
    createdAt: v.number(),
  })
    // O(1) idempotency check: resolve (account, key) -> prior result.
    .index("by_key", ["accountId", "key"]),
});
