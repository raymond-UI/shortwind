/**
 * Typed REST client for the Shortwind Cloud page API (CLOUD-25).
 *
 * The CLI is a STATELESS agent (PRD §4): it never stores a page id locally. It
 * `find`s an existing page, then `publish`es a new one or `update`s the found
 * id — the account is the only memory. This client is the single seam through
 * which all four verbs reach the REST surface, so the command handlers can be
 * unit-tested by injecting a fake {@link ApiClient} with no network.
 *
 * Contracts consumed:
 *   - READ  (CLOUD-24, live):
 *       GET  /v1/pages?q=&domain=&tag=  → { pages: PageSummary[] }
 *       GET  /v1/pages/{id}             → { page, versions } | 404 NOT_FOUND
 *   - WRITE (CLOUD-23, body inferred from convex/pages.ts publish/update args):
 *       POST  /v1/pages                 → { id, url, version } | 409 { existingId }
 *       PATCH /v1/pages/{id}            → { id, url, version }
 *
 * Auth: `Authorization: Bearer <token>` from the active account (CLOUD-11).
 * The `bearer` field that the convex actions take as an arg is carried in the
 * header here — it is NOT part of the REST request body.
 *
 * Non-2xx responses map to typed {@link ApiError}s so callers can branch on
 * `kind` (e.g. the 409 → "use update" hint) instead of sniffing status codes.
 *
 * Node 18+ has a global `fetch`; it is injected (defaulting to that global) so
 * tests drive the client with a fake without monkey-patching the runtime.
 */

import type { Lockfile } from "./contract/lockfile-diff.js";

// ---------------------------------------------------------------------------
// Wire shapes — mirror the CLOUD-23/24 contracts as plain serializable data.
// ---------------------------------------------------------------------------

/** A page summary as returned by `find` and embedded in `get` (CLOUD-24). */
export interface PageSummary {
  id: string;
  slug: string;
  url: string;
  visibility: "public" | "unlisted" | "private";
  currentVersion: number;
  tags: string[];
  updatedAt: number;
}

/** One version entry in a page's history (newest-first), from `get`. */
export interface VersionEntry {
  id: string;
  version: number;
  artifactKey: string;
  expandedHash: string;
  sourceHash: string;
  createdAt: number;
}

/** `GET /v1/pages` → page summaries (empty → `{ pages: [] }`). */
export interface FindResult {
  pages: PageSummary[];
}

/** `GET /v1/pages/{id}` → metadata + full version history. */
export interface GetResult {
  page: PageSummary;
  versions: VersionEntry[];
}

/** A single recipe BODY carried into a publish (CLOUD-23 `recipeArg`). */
export interface RecipePayload {
  family: string;
  /** The full sealed recipe source (header + body). */
  source: string;
}

/**
 * The `POST /v1/pages` request body — the convex publish action args minus
 * `bearer` (which rides in the Authorization header). `recipes` carries ONLY
 * the touched family bodies (PRD §5.3); the full palette is never uploaded.
 */
export interface PublishPayload {
  html: string;
  lockfile: Lockfile;
  recipes: RecipePayload[];
  slug?: string;
  title?: string;
  tags?: string[];
  visibility?: "public" | "unlisted" | "private";
  idempotencyKey?: string;
  css?: string;
}

/**
 * The `PATCH /v1/pages/{id}` request body. Same assembly as publish but no
 * `slug` (the URL is fixed to the existing page; PRD §5.6).
 */
export interface UpdatePayload {
  html: string;
  lockfile: Lockfile;
  recipes: RecipePayload[];
  tags?: string[];
  visibility?: "public" | "unlisted" | "private";
  idempotencyKey?: string;
  css?: string;
}

/** A successful publish/update result. */
export interface PublishResult {
  id: string;
  url: string;
  version: number;
}

/** One authored file in a bundle publish (CLOUD-50): its path + shorthand HTML. */
export interface BundleFilePayload {
  /** Bundle-relative POSIX path, e.g. "index.html" or "docs/guide.html". */
  path: string;
  /** The file's shorthand HTML (recipe tokens in `class=`/`className=`). */
  html: string;
}

/**
 * The `POST /v1/bundles` request body (CLOUD-50) — a linked multi-file deploy
 * under one entry point. `recipes` carries only the touched family bodies (same
 * rule as a single-file publish); `bearer` rides in the Authorization header.
 */
export interface BundlePayload {
  files: BundleFilePayload[];
  /** The bundle-relative path of the entry file the slug routes to. */
  entryPath: string;
  recipes: RecipePayload[];
  lockfile: Lockfile;
  slug?: string;
  title?: string;
  css?: string;
}

/** A served file in a published bundle, as returned by `publishBundle`. */
export interface BundleFileResult {
  path: string;
  artifactKey: string;
  sourceHash: string;
  entry: boolean;
}

/** A successful bundle publish result (CLOUD-50). */
export interface BundleResult {
  bundleId: string;
  url: string;
  version: number;
  files: BundleFileResult[];
}

/**
 * Lifecycle state of a custom-hostname bind, mirroring the CLOUD-40 server
 * contract (`convex/domains.ts` `DomainBindState`). A `pending-human` bind is
 * parked behind the operator-approval policy and creates NO Cloudflare hostname
 * yet; the rest track the cert-issuance dance:
 *
 *   pending-human ──approve──► (queued ⇄ pending-cert) ──► active
 *                                    └──────────────────► failed
 *
 * Redeclared here (not imported) because the CLI must not depend on `convex/`
 * (CLAUDE.md dependency direction; the constraint forbids touching convex/).
 */
export type DomainBindState =
  | "pending-human"
  | "queued"
  | "pending-cert"
  | "active"
  | "failed";

/**
 * The `POST /v1/domains` (bind) / `POST /v1/domains/approve` response — the
 * ACCOUNT-level bind state handed back as plain data. Account-scoped: no
 * `pageId` (a domain aliases the whole account; every page serves at
 * `<hostname>/<slug>`).
 */
export interface DomainBindResult {
  state: DomainBindState;
  hostname: string;
  /** Cloudflare's hostname id once created; null while `pending-human`. */
  cloudflareHostnameId: string | null;
  /** Present on `failed` (cert failed / retries exhausted) to explain why. */
  reason?: string;
}

/** An account custom domain as `GET /v1/domains` lists it. */
export interface AccountDomain {
  id: string;
  hostname: string;
  status: DomainBindState;
  verifiedAt: number | null;
  createdAt: number;
}

/** `GET /v1/domains` → the account's domains (empty → `{ domains: [] }`). */
export interface ListDomainsResult {
  domains: AccountDomain[];
}

// ---------------------------------------------------------------------------
// Typed errors — non-2xx responses become these so callers branch on `kind`.
// ---------------------------------------------------------------------------

/** Discriminant for {@link ApiError}. */
export type ApiErrorKind =
  | "unauthorized" // 401 — no/expired token
  | "forbidden" // 403 — token lacks the scope
  | "not_found" // 404 — page id unknown
  | "conflict" // 409 — slug taken (publish); carries existingId
  | "network" // fetch threw / no response
  | "http"; // any other non-2xx

/** A typed REST error. `existingId` is set only on the 409 conflict path. */
export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status: number;
  /** Server error code (e.g. `UNAUTHORIZED`, `NOT_FOUND`), when present. */
  readonly code: string | undefined;
  /** The existing page id on a 409 conflict — drives the `update` hint. */
  readonly existingId: string | undefined;

  constructor(args: {
    kind: ApiErrorKind;
    status: number;
    message: string;
    code?: string | undefined;
    existingId?: string | undefined;
  }) {
    super(args.message);
    this.name = "ApiError";
    this.kind = args.kind;
    this.status = args.status;
    this.code = args.code;
    this.existingId = args.existingId;
  }
}

// ---------------------------------------------------------------------------
// Client surface + construction.
// ---------------------------------------------------------------------------

/** Filters for `find` (all optional; blank/absent ⇒ no filter). */
export interface FindQuery {
  q?: string | undefined;
  /** Repeatable tag filter — each becomes a `tag=` query param. */
  tags?: string[] | undefined;
}

/**
 * The verbs the CLI handlers call. Injected as a fake in tests.
 *
 * `deletePage` / `setVisibility` (CLOUD-34) are declared OPTIONAL so the many
 * existing four-verb test mocks (`publish`/`update`/`get`) that build a full
 * `ApiClient` literal keep typechecking untouched — `createApiClient` always
 * returns them, and the delete/visibility handlers narrow to the capability
 * sub-types ({@link DeleteCapableClient} / {@link VisibilityCapableClient}) so
 * the methods are still statically guaranteed present where they are used.
 */
export interface ApiClient {
  findPages(query: FindQuery): Promise<FindResult>;
  getPage(id: string): Promise<GetResult>;
  publishPage(payload: PublishPayload): Promise<PublishResult>;
  updatePage(id: string, payload: UpdatePayload): Promise<PublishResult>;
  /** `POST /v1/bundles` — publish a linked multi-file bundle (CLOUD-50). */
  publishBundle?(payload: BundlePayload): Promise<BundleResult>;
  /** `DELETE /v1/pages/{id}` — tombstone the page (CLOUD-31/34). */
  deletePage?(id: string): Promise<void>;
  /** `PATCH /v1/pages/{id}/visibility` — set the access level (CLOUD-31/34). */
  setVisibility?(id: string, level: VisibilityLevel): Promise<PageSummary>;
  /**
   * `POST /v1/domains` — bind an ACCOUNT-level custom domain (a subdomain you
   * own). Requires the `domains:bind` scope; a token without it yields a
   * `forbidden` {@link ApiError} the caller maps to the step-up grant path.
   */
  bindDomain?(hostname: string): Promise<DomainBindResult>;
  /** `GET /v1/domains` — list the account's custom domains (CLI↔web parity). */
  listDomains?(): Promise<ListDomainsResult>;
  /** `POST /v1/domains/approve` — approve a `pending-human` domain (operator). */
  approveDomain?(hostname: string): Promise<DomainBindResult>;
}

/** The three page access levels (PRD §4 — mirrors the server contract). */
export type VisibilityLevel = "public" | "unlisted" | "private";

/** An {@link ApiClient} known to carry `deletePage` (the delete handler's seam). */
export type DeleteCapableClient = ApiClient & {
  deletePage(id: string): Promise<void>;
};

/** An {@link ApiClient} known to carry `setVisibility` (the visibility seam). */
export type VisibilityCapableClient = ApiClient & {
  setVisibility(id: string, level: VisibilityLevel): Promise<PageSummary>;
};

/** An {@link ApiClient} known to carry the domain-management verbs. */
export type DomainCapableClient = ApiClient & {
  bindDomain(hostname: string): Promise<DomainBindResult>;
  listDomains(): Promise<ListDomainsResult>;
  approveDomain(hostname: string): Promise<DomainBindResult>;
};

/** The `fetch` signature the client depends on (global `fetch` satisfies it). */
export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

export interface ApiClientConfig {
  /** Cloud API origin, e.g. `https://shortwind.dev`. Trailing slashes trimmed. */
  baseUrl: string;
  /** The active account's bearer token (CLOUD-11 `readActiveAccount`). */
  token: string;
  /** Injected fetch (defaults to the global). */
  fetch?: FetchLike;
}

/**
 * The production base URL when neither config nor env overrides it. This is the
 * BRANDED, vendor-independent API origin served by the api-proxy Worker
 * (apps/cloud/api-proxy) — NOT the Convex deployment slug and NOT the
 * marketing/docs apex (`shortwind.dev`, a Cloudflare Pages site that does not
 * route the API). It matches the OAuth `issuer` the discovery doc advertises
 * (Convex `SITE_URL`), so login's discovery and these REST calls agree on one
 * origin. `SHORTWIND_CLOUD_API` still overrides for dev/staging.
 */
export const DEFAULT_BASE_URL = "https://api.shortwind.dev";

/**
 * Resolve the API origin from an explicit value, then env, then the default.
 * CLOUD-30 owns wiring the deployed origin here via `SHORTWIND_CLOUD_API`.
 */
export function resolveBaseUrl(
  explicit?: string,
  env: { SHORTWIND_CLOUD_API?: string | undefined } = process.env,
): string {
  const chosen =
    (explicit && explicit.length > 0 ? explicit : undefined) ??
    (env.SHORTWIND_CLOUD_API && env.SHORTWIND_CLOUD_API.length > 0
      ? env.SHORTWIND_CLOUD_API
      : undefined) ??
    DEFAULT_BASE_URL;
  return chosen.replace(/\/+$/, "");
}

/** Parse a `{ error: { code, message } }` body, tolerating garbage. */
function parseErrorBody(body: string): {
  code?: string | undefined;
  message?: string | undefined;
  existingId?: string | undefined;
} {
  try {
    const parsed = JSON.parse(body) as unknown;
    if (typeof parsed !== "object" || parsed === null) return {};
    const root = parsed as Record<string, unknown>;
    // 409 carries `existingId` at the top level (per the CLOUD-23 outcome shape).
    const existingId =
      typeof root["existingId"] === "string" ? root["existingId"] : undefined;
    const err = root["error"];
    if (typeof err === "object" && err !== null) {
      const e = err as Record<string, unknown>;
      return {
        code: typeof e["code"] === "string" ? e["code"] : undefined,
        message: typeof e["message"] === "string" ? e["message"] : undefined,
        ...(existingId !== undefined ? { existingId } : {}),
      };
    }
    return existingId !== undefined ? { existingId } : {};
  } catch {
    return {};
  }
}

/** Map a non-2xx response to a typed {@link ApiError}. */
function toApiError(status: number, body: string): ApiError {
  const { code, message, existingId } = parseErrorBody(body);
  const msg = message ?? `request failed with status ${status}`;
  if (status === 401) {
    return new ApiError({ kind: "unauthorized", status, message: msg, code });
  }
  if (status === 403) {
    return new ApiError({ kind: "forbidden", status, message: msg, code });
  }
  if (status === 404) {
    return new ApiError({ kind: "not_found", status, message: msg, code });
  }
  if (status === 409) {
    return new ApiError({
      kind: "conflict",
      status,
      message: msg,
      code,
      ...(existingId !== undefined ? { existingId } : {}),
    });
  }
  return new ApiError({ kind: "http", status, message: msg, code });
}

/**
 * Construct the REST client. Pure-ish: every method does exactly one request
 * and maps the outcome; no local persistence (PRD §4 — the agent is stateless).
 */
export function createApiClient(config: ApiClientConfig): ApiClient {
  const baseUrl = config.baseUrl.replace(/\/+$/, "");
  const doFetch = config.fetch ?? (globalThis.fetch as unknown as FetchLike);

  const headers = (): Record<string, string> => ({
    Authorization: `Bearer ${config.token}`,
    "Content-Type": "application/json",
  });

  async function request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    let res: { ok: boolean; status: number; text(): Promise<string> };
    try {
      res = await doFetch(`${baseUrl}${path}`, {
        method,
        headers: headers(),
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    } catch (err) {
      throw new ApiError({
        kind: "network",
        status: 0,
        message: err instanceof Error ? err.message : "network error",
      });
    }
    const text = await res.text();
    if (!res.ok) throw toApiError(res.status, text);
    return (text.length > 0 ? JSON.parse(text) : {}) as T;
  }

  return {
    async findPages(query: FindQuery): Promise<FindResult> {
      const params = new URLSearchParams();
      if (query.q) params.set("q", query.q);
      for (const tag of query.tags ?? []) params.append("tag", tag);
      const qs = params.toString();
      const result = await request<FindResult>(
        "GET",
        `/v1/pages${qs.length > 0 ? `?${qs}` : ""}`,
      );
      // Defensive: an empty body or `{ pages: null }` normalizes to `[]`.
      return { pages: Array.isArray(result.pages) ? result.pages : [] };
    },

    getPage(id: string): Promise<GetResult> {
      return request<GetResult>("GET", `/v1/pages/${encodeURIComponent(id)}`);
    },

    publishPage(payload: PublishPayload): Promise<PublishResult> {
      return request<PublishResult>("POST", "/v1/pages", payload);
    },

    updatePage(id: string, payload: UpdatePayload): Promise<PublishResult> {
      return request<PublishResult>(
        "PATCH",
        `/v1/pages/${encodeURIComponent(id)}`,
        payload,
      );
    },

    publishBundle(payload: BundlePayload): Promise<BundleResult> {
      return request<BundleResult>("POST", "/v1/bundles", payload);
    },

    async deletePage(id: string): Promise<void> {
      // DELETE /v1/pages/{id} — the server tombstones and returns no body
      // (204/empty). `request` already normalizes an empty body to `{}`;
      // discard it. 401/403/404 flow through the shared `toApiError` mapping.
      await request<unknown>("DELETE", `/v1/pages/${encodeURIComponent(id)}`);
    },

    setVisibility(id: string, level: VisibilityLevel): Promise<PageSummary> {
      // PATCH /v1/pages/{id}/visibility { visibility } → the updated summary.
      return request<PageSummary>(
        "PATCH",
        `/v1/pages/${encodeURIComponent(id)}/visibility`,
        { visibility: level },
      );
    },

    bindDomain(hostname: string): Promise<DomainBindResult> {
      // POST /v1/domains { hostname } → the account-level bind state. A token
      // lacking `domains:bind` returns 403, which `toApiError` maps to a
      // `forbidden` ApiError — the bind-domain handler reads that as the signal
      // to drive the step-up grant flow (PRD §7.2) instead of failing flatly.
      return request<DomainBindResult>("POST", "/v1/domains", { hostname });
    },

    async listDomains(): Promise<ListDomainsResult> {
      // GET /v1/domains → the account's custom domains (empty → { domains: [] }).
      const result = await request<ListDomainsResult>("GET", "/v1/domains");
      return { domains: Array.isArray(result.domains) ? result.domains : [] };
    },

    approveDomain(hostname: string): Promise<DomainBindResult> {
      // POST /v1/domains/approve { hostname } → the provisioned bind state.
      return request<DomainBindResult>("POST", "/v1/domains/approve", {
        hostname,
      });
    },
  };
}
