/**
 * Plain-data record types for the Shortwind Cloud data model.
 *
 * Per CLAUDE.md: all cross-boundary values are plain serializable data — no
 * class instances, no closures. These shapes mirror the Convex tables (filled
 * in by CLOUD-10) but are defined here once so the CLI, worker, and convex
 * surfaces share a single source of truth.
 *
 * Conventions:
 *  - Ids are opaque branded strings. The Convex tables key on real
 *    `Id<"table">`s; at the shared/plain-data boundary they are strings so this
 *    module stays free of any Convex runtime dependency.
 *  - Timestamps are epoch milliseconds (numbers) — JSON-safe and the Convex
 *    `Date.now()` convention.
 *  - Content hashes (`*Sha`/`*Hash`) are lowercase hex, matching
 *    `@shortwind/core` fingerprint output.
 */

/** Opaque id brand. A document id is a string at the plain-data boundary. */
export type Id<TTable extends string> = string & { readonly __table?: TTable };

/** Epoch milliseconds. */
export type Timestamp = number;

/** Lowercase-hex content hash (e.g. recipe body sha, expanded artifact hash). */
export type Sha = string;

// ---------------------------------------------------------------------------
// Lifecycle / state enums
// ---------------------------------------------------------------------------

/**
 * A page's lifecycle.
 *  - `active`      — published and (subject to visibility) servable.
 *  - `quarantined` — sealed for abuse review; object preserved, not deleted.
 *  - `tombstoned`  — soft-deleted; serves 410 Gone, never hard-deleted here.
 */
export type PageLifecycle = "active" | "quarantined" | "tombstoned";

/**
 * Who can reach a page.
 *  - `public`   — served with no auth.
 *  - `unlisted` — served to anyone with the URL but excluded from discovery.
 *  - `private`  — requires a valid scoped token at serve time.
 */
export type PageVisibility = "public" | "unlisted" | "private";

/**
 * Moderation case state machine.
 *  - `reported`    — an abuse report exists; not yet actioned.
 *  - `quarantined` — content sealed pending review.
 *  - `preserved`   — retained (not deleted) for legal/NCMEC obligations.
 *  - `cleared`     — reviewed and found acceptable; case closed.
 */
export type ModerationState =
  | "reported"
  | "quarantined"
  | "preserved"
  | "cleared";

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

/** A cloud account — the unit of ownership and billing. */
export interface Account {
  id: Id<"accounts">;
  /** Better Auth user id this account is bound to. */
  authUserId: string;
  /** Human-facing display name. */
  name: string;
  /** Optional contact email (denormalized for moderation/abuse contact). */
  email: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

/**
 * A hosted page. Holds metadata + a pointer to the current version; the frozen
 * artifacts live in R2 and the per-version history in `PageVersion`.
 */
export interface Page {
  id: Id<"pages">;
  accountId: Id<"accounts">;
  /** Stable URL handle. Unique per account; collision -> 409. */
  slug: string;
  /** Optional bound custom hostname (Cloudflare for SaaS). */
  customDomain: string | null;
  visibility: PageVisibility;
  lifecycle: PageLifecycle;
  /** Free-form discovery tags (load-bearing for `find`). */
  tags: string[];
  /** Pointer to the current `PageVersion`. Null only between create + first version. */
  currentVersionId: Id<"pageVersions"> | null;
  /** Monotonic version counter; bumps on every publish/update. */
  currentVersion: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/**
 * An immutable published snapshot of a page. Old versions are frozen and never
 * rebuilt (PRD 5.6) — they pin the recipe state of their build moment.
 */
export interface PageVersion {
  id: Id<"pageVersions">;
  pageId: Id<"pages">;
  accountId: Id<"accounts">;
  version: number;
  /** R2 key for the frozen Tailwind HTML artifact. */
  artifactKey: string;
  /** Hash of the expanded output; deterministic for a given input+registry. */
  expandedHash: Sha;
  /** Hash of the shorthand source that produced this version. */
  sourceHash: Sha;
  /** Snapshot of the lockfile (family -> version) used to expand this version. */
  lockfile: Record<string, string>;
  createdAt: Timestamp;
}

// ---------------------------------------------------------------------------
// Recipes
// ---------------------------------------------------------------------------

/**
 * A versioned recipe family body in the account's cloud palette. Forward-only
 * (PRD 5.4): an edit produces a new version; nothing is overwritten.
 */
export interface RecipeVersion {
  id: Id<"recipeVersions">;
  accountId: Id<"accounts">;
  /** Recipe family name (e.g. "card"). */
  family: string;
  /** Semantic version (e.g. "0.5.0"). */
  version: string;
  /** Normalized recipe body source. */
  body: string;
  /** Content hash of the normalized body (matches core fingerprint). */
  bodySha: Sha;
  createdAt: Timestamp;
}

/**
 * Audit-grade record of a recipe edit riding up on a publish. Recorded
 * distinctly (PRD 5.4) so the human operator can see e.g. "agent modified
 * @card (0.4.0 -> 0.5.0), affects N pages on next publish."
 */
export interface RecipeEditEvent {
  id: Id<"recipeEditEvents">;
  accountId: Id<"accounts">;
  family: string;
  /** Prior version, or null if this is the family's first version. */
  fromVersion: string | null;
  toVersion: string;
  /** New body content hash. */
  bodySha: Sha;
  /** The publish/token actor that carried the edit. */
  actorTokenId: Id<"tokens"> | null;
  createdAt: Timestamp;
}

// ---------------------------------------------------------------------------
// Tokens & scopes
// ---------------------------------------------------------------------------

/** Re-export so consumers can import the scope union alongside the records. */
export type { Scope } from "./scopes.js";

/**
 * A scoped bearer token issued by Better Auth via the device flow. The raw
 * secret is never stored — only its hash.
 */
export interface Token {
  id: Id<"tokens">;
  accountId: Id<"accounts">;
  /** Hash of the token secret; the plaintext is shown once at issue time. */
  tokenHash: Sha;
  /** Granted scopes (see ./scopes.ts). */
  scopes: import("./scopes.js").Scope[];
  /** Short human-readable label (device/agent name). */
  label: string | null;
  createdAt: Timestamp;
  /** Null while valid; set when revoked. */
  revokedAt: Timestamp | null;
  /** Optional hard expiry. */
  expiresAt: Timestamp | null;
}

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

/** A generic audit-log entry for any consequential mutation. */
export interface AuditEvent {
  id: Id<"auditLog">;
  accountId: Id<"accounts">;
  /** Verb, e.g. "page.publish", "page.delete", "domain.bind". */
  action: string;
  /** Affected document id (page, recipe, token, ...), if any. */
  targetId: string | null;
  /** Acting token, if the action was token-authenticated. */
  actorTokenId: Id<"tokens"> | null;
  /** Free-form structured detail; must be JSON-serializable. */
  metadata: Record<string, unknown>;
  createdAt: Timestamp;
}

// ---------------------------------------------------------------------------
// Moderation
// ---------------------------------------------------------------------------

/**
 * A trust-and-safety case attached to a page. Quarantined objects are sealed
 * and preserved, never hard-deleted (PRD 8 invariant).
 */
export interface Moderation {
  id: Id<"moderation">;
  pageId: Id<"pages">;
  accountId: Id<"accounts">;
  state: ModerationState;
  /** Why the case was opened (reporter note / classifier reason). */
  reason: string | null;
  /** Reporter contact, if from the abuse-intake route. */
  reporterContact: string | null;
  /** NCMEC CyberTipline report id, set when a report is filed. */
  ncmecReportId: string | null;
  /** When legally-required preservation expires (e.g. 60-day window). */
  preservationExpiresAt: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

/**
 * An idempotency record so a retried publish with the same key returns the same
 * result instead of creating a duplicate (PRD 6.2 idempotent re-publish).
 */
export interface IdempotencyKey {
  id: Id<"idempotencyKeys">;
  accountId: Id<"accounts">;
  /** Client-supplied key, unique per account. */
  key: string;
  /** The document id produced by the first successful call. */
  resultId: string;
  /** JSON-serializable cached response payload. */
  result: Record<string, unknown>;
  createdAt: Timestamp;
}
