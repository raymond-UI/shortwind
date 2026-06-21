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

import type { Lockfile } from "../../shared/src/lockfile-diff.js";

// ---------------------------------------------------------------------------
// Wire shapes — mirror the CLOUD-23/24 contracts as plain serializable data.
// ---------------------------------------------------------------------------

/** A page summary as returned by `find` and embedded in `get` (CLOUD-24). */
export interface PageSummary {
  id: string;
  slug: string;
  url: string;
  visibility: "public" | "unlisted" | "private";
  customDomain: string | null;
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
  domain?: string | undefined;
  /** Repeatable tag filter — each becomes a `tag=` query param. */
  tags?: string[] | undefined;
}

/** The four verbs the CLI handlers call. Injected as a fake in tests. */
export interface ApiClient {
  findPages(query: FindQuery): Promise<FindResult>;
  getPage(id: string): Promise<GetResult>;
  publishPage(payload: PublishPayload): Promise<PublishResult>;
  updatePage(id: string, payload: UpdatePayload): Promise<PublishResult>;
}

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

/** The production base URL when neither config nor env overrides it. */
export const DEFAULT_BASE_URL = "https://shortwind.dev";

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
  code?: string;
  message?: string;
  existingId?: string;
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
      if (query.domain) params.set("domain", query.domain);
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
  };
}
