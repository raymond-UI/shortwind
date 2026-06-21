import { ConvexError } from "convex/values";
import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { authComponent, createAuth } from "./auth";
import {
  API_CATALOG_PATH,
  OAUTH_AS_METADATA_PATH,
  buildApiCatalog,
  buildOAuthAuthorizationServerMetadata,
} from "./wellknown";

/**
 * Convex HTTP router (CLOUD-01 + CLOUD-24).
 *
 * Registers the `@convex-dev/better-auth` routes — including the RFC 8628
 * device-authorization endpoints (`/device/code`, `/device/token`) that
 * `cli/src/device-flow.ts` polls. `cors: true` adds the OPTIONS preflight +
 * CORS headers so a non-same-origin client (the CLI) can reach them.
 *
 * CLOUD-24 adds the page READ REST surface ADDITIVELY (the auth routes above are
 * untouched):
 *   - `GET /v1/pages`        → `api.pages.find`  (q / domain / tag query params)
 *   - `GET /v1/pages/{id}`   → `api.pages.get`   (metadata + version history)
 * Both read the bearer from the `Authorization: Bearer …` header and translate
 * the auth-guard `ConvexError` payload to 401 (`UNAUTHORIZED`) / 403
 * (`FORBIDDEN`).
 *
 * CLOUD-30a adds the page WRITE REST surface ADDITIVELY (the CLI api-client's two
 * mutating calls):
 *   - `POST  /v1/pages`      → `api.pages.publish` (create from HTML + lockfile +
 *                              touched recipe bodies). On the slug-collision
 *                              outcome the action returns `{ ok:false, 409,
 *                              existingId }`; this is surfaced as a 409 with a
 *                              TOP-LEVEL `existingId` field, which the api-client
 *                              parses to drive the "use update" hint.
 *   - `PATCH /v1/pages/{id}` → `api.pages.update`  (republish a new version,
 *                              same URL). The `{id}` rides in the path.
 * Both carry the JSON body the api-client sends (html / lockfile / recipes /
 * flags) and the bearer in the Authorization header, mapping the auth-guard
 * `ConvexError` to 401/403 the same way the read routes do. The remaining
 * mutating verbs (delete / visibility / bind-domain) land in later waves.
 */
const http = httpRouter();

authComponent.registerRoutes(http, createAuth, { cors: true });

// ---------------------------------------------------------------------------
// CLOUD-24 — page READ REST surface.
// ---------------------------------------------------------------------------

/** Read the raw `swc_…` secret from `Authorization: Bearer <token>`. */
function bearerFromRequest(request: Request): string {
  const header = request.headers.get("Authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : "";
}

/** JSON response helper. */
function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Map a thrown error to an HTTP response. The auth guard throws
 * `ConvexError<{ code: "UNAUTHORIZED" | "FORBIDDEN", … }>`; `UNAUTHORIZED` → 401,
 * `FORBIDDEN` → 403, and the structured payload is echoed as the error body so
 * the CLI can surface the actionable reason. Anything else → 500.
 */
function errorResponse(err: unknown): Response {
  if (err instanceof ConvexError) {
    const data = err.data as { code?: string } | undefined;
    if (data?.code === "UNAUTHORIZED") return json({ error: data }, 401);
    if (data?.code === "FORBIDDEN") return json({ error: data }, 403);
    return json({ error: data ?? { message: "Bad request" } }, 400);
  }
  return json({ error: { code: "INTERNAL", message: "Internal error" } }, 500);
}

/** GET /v1/pages?q=&domain=&tag= → list page summaries (find). */
const findHandler = httpAction(async (ctx, request) => {
  const url = new URL(request.url);
  const bearer = bearerFromRequest(request);
  try {
    const pages = await ctx.runQuery(api.pages.find, {
      bearer,
      q: url.searchParams.get("q") ?? undefined,
      domain: url.searchParams.get("domain") ?? undefined,
      tag: url.searchParams.get("tag") ?? undefined,
    });
    return json({ pages }, 200);
  } catch (err) {
    return errorResponse(err);
  }
});

/** GET /v1/pages/{id} → page metadata + version history (get). */
const getHandler = httpAction(async (ctx, request) => {
  const url = new URL(request.url);
  // Path: /v1/pages/<id>
  const id = url.pathname.split("/").filter(Boolean).pop() ?? "";
  const bearer = bearerFromRequest(request);
  try {
    const result = await ctx.runQuery(api.pages.get, {
      bearer,
      id: id as Id<"pages">,
    });
    if (result === null) {
      return json({ error: { code: "NOT_FOUND", message: "Page not found" } }, 404);
    }
    return json(result, 200);
  } catch (err) {
    return errorResponse(err);
  }
});

// ---------------------------------------------------------------------------
// CLOUD-30a — page WRITE REST surface (publish / update).
// ---------------------------------------------------------------------------

/** Parse a request's JSON body, tolerating an empty/garbage body as `{}`. */
async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const parsed = (await request.json()) as unknown;
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * POST /v1/pages → create a page (publish). The body is the api-client's
 * `PublishPayload` (html / lockfile / recipes / slug / tags / visibility /
 * idempotencyKey / css); the bearer rides in the Authorization header. The
 * publish action's slug-collision outcome (`{ ok:false, status:409, existingId }`)
 * becomes a 409 with a TOP-LEVEL `existingId` so the client surfaces the
 * "use update" hint.
 */
const publishHandler = httpAction(async (ctx, request) => {
  const bearer = bearerFromRequest(request);
  const body = await readJsonBody(request);
  try {
    const outcome = await ctx.runAction(api.pages.publish, {
      bearer,
      html: body["html"] as string,
      slug: body["slug"] as string | undefined,
      title: body["title"] as string | undefined,
      recipes: (body["recipes"] ?? []) as { family: string; source: string }[],
      lockfile: body["lockfile"] as never,
      tags: body["tags"] as string[] | undefined,
      visibility: body["visibility"] as never,
      idempotencyKey: body["idempotencyKey"] as string | undefined,
      css: body["css"] as string | undefined,
    });
    if (!outcome.ok) {
      // Slug taken — 409 with the existing id at the top level (CLOUD-23 shape).
      return json({ existingId: outcome.existingId }, outcome.status);
    }
    return json(
      { id: outcome.id, url: outcome.url, version: outcome.version },
      200,
    );
  } catch (err) {
    return errorResponse(err);
  }
});

/** Split a `/v1/pages/...` path into its trailing segments after `pages`. */
function pagesPathSegments(pathname: string): string[] {
  const parts = pathname.split("/").filter(Boolean); // ["v1","pages",id,...]
  return parts.slice(2);
}

/**
 * PATCH /v1/pages/{id} → republish a new version (update). The `{id}` rides in
 * the path; the body is the api-client's `UpdatePayload` (no `slug` — the URL is
 * fixed to the page). Returns `{ id, url, version }`.
 *
 * CLOUD-31: the same PATCH prefix also serves `/v1/pages/{id}/visibility`; this
 * handler dispatches the `/visibility` sub-route to `setVisibility` and falls
 * through to `update` otherwise (Convex routes by prefix, so the disambiguation
 * happens here rather than via two overlapping prefixes).
 */
const updateHandler = httpAction(async (ctx, request) => {
  const url = new URL(request.url);
  const segments = pagesPathSegments(url.pathname);
  // /v1/pages/{id}/visibility → the visibility sub-route.
  if (segments.length >= 2 && segments[1] === "visibility") {
    return setVisibilityHandlerImpl(ctx, request, segments[0]!);
  }
  const id = url.pathname.split("/").filter(Boolean).pop() ?? "";
  const bearer = bearerFromRequest(request);
  const body = await readJsonBody(request);
  try {
    const outcome = await ctx.runAction(api.pages.update, {
      bearer,
      pageId: id as Id<"pages">,
      html: body["html"] as string,
      recipes: (body["recipes"] ?? []) as { family: string; source: string }[],
      lockfile: body["lockfile"] as never,
      tags: body["tags"] as string[] | undefined,
      visibility: body["visibility"] as never,
      idempotencyKey: body["idempotencyKey"] as string | undefined,
      css: body["css"] as string | undefined,
    });
    if (!outcome.ok) {
      // update has no slug collision; treat any non-ok defensively as a 409.
      return json({ existingId: outcome.existingId }, outcome.status);
    }
    return json(
      { id: outcome.id, url: outcome.url, version: outcome.version },
      200,
    );
  } catch (err) {
    return errorResponse(err);
  }
});

// ---------------------------------------------------------------------------
// CLOUD-31 — delete (→ tombstone) + visibility.
// ---------------------------------------------------------------------------

/**
 * DELETE /v1/pages/{id} → tombstone the page (NOT a hard delete; the record +
 * versions are retained, PRD §8.2). Returns the new lifecycle. requireWrite;
 * account-scoped not-found → 404; auth errors → 401/403.
 */
const deleteHandler = httpAction(async (ctx, request) => {
  const url = new URL(request.url);
  const id = pagesPathSegments(url.pathname)[0] ?? "";
  const bearer = bearerFromRequest(request);
  try {
    const result = await ctx.runMutation(api.pages.deletePage, {
      bearer,
      id: id as Id<"pages">,
    });
    return json(result, 200);
  } catch (err) {
    return errorResponse(err);
  }
});

/** Shared body for PATCH /v1/pages/{id}/visibility (dispatched from the PATCH
 * prefix handler). Reads `{ visibility }` from the JSON body. */
async function setVisibilityHandlerImpl(
  ctx: Parameters<Parameters<typeof httpAction>[0]>[0],
  request: Request,
  id: string,
): Promise<Response> {
  const bearer = bearerFromRequest(request);
  const body = await readJsonBody(request);
  try {
    const result = await ctx.runMutation(api.pages.setVisibility, {
      bearer,
      id: id as Id<"pages">,
      visibility: body["visibility"] as never,
    });
    return json(result, 200);
  } catch (err) {
    return errorResponse(err);
  }
}

// ---------------------------------------------------------------------------
// CLOUD-32 — abuse-report intake (PRD §8.2). The reachable, monitored endpoint
// NCMEC reporting flows through. NO auth (anyone can report); maps to
// reportAbuse, which opens a `reported` case without pulling the page.
// ---------------------------------------------------------------------------

/** Narrow an unknown to the accepted abuse categories. */
function asAbuseCategory(
  value: unknown,
): "csam" | "phishing" | "malware" | "other" {
  return value === "csam" ||
    value === "phishing" ||
    value === "malware" ||
    value === "other"
    ? value
    : "other";
}

/**
 * POST /v1/abuse → file an abuse report against a page (PRD §8.2). Public (no
 * Authorization required). Body: `{ pageId, reason, category?, reporterContact? }`.
 * Returns `{ state: "reported" }` on success; a malformed body (missing pageId /
 * reason) → 400; an unknown page → 404.
 */
const abuseHandler = httpAction(async (ctx, request) => {
  const body = await readJsonBody(request);
  const pageId = body["pageId"];
  const reason = body["reason"];
  if (typeof pageId !== "string" || typeof reason !== "string" || !reason) {
    return json(
      {
        error: {
          code: "BAD_REQUEST",
          message: "`pageId` and `reason` are required",
        },
      },
      400,
    );
  }
  const reporterContact = body["reporterContact"];
  try {
    const result = await ctx.runMutation(api.moderation.reportAbuse, {
      pageId: pageId as Id<"pages">,
      reason,
      category: asAbuseCategory(body["category"]),
      reporterContact:
        typeof reporterContact === "string" ? reporterContact : null,
    });
    return json(result, 202);
  } catch (err) {
    if (err instanceof ConvexError) {
      const data = err.data as { code?: string } | undefined;
      if (data?.code === "NOT_FOUND") return json({ error: data }, 404);
    }
    return errorResponse(err);
  }
});

// ---------------------------------------------------------------------------
// CLOUD-40 — custom-domain bind (POST /v1/pages/{id}/domain). ADDITIVE: the
// publish POST stays on the EXACT `/v1/pages` path; this binds on the
// `/v1/pages/` PREFIX (a sub-path), so it never shadows publish.
// ---------------------------------------------------------------------------

/**
 * POST /v1/pages/{id}/domain → bind a custom hostname to a page (bindDomain).
 * Body: `{ hostname }`; the bearer rides in Authorization. Requires the
 * `domains:bind` scope — a token without it maps to 403 (the auth guard throws
 * `FORBIDDEN`, translated by {@link errorResponse}). Returns the bind
 * {@link DomainBindResult} (state machine: pending-human / queued / pending-cert
 * / active / failed).
 */
const bindDomainHandler = httpAction(async (ctx, request) => {
  const url = new URL(request.url);
  const segments = pagesPathSegments(url.pathname); // [id, "domain"]
  const id = segments[0] ?? "";
  const bearer = bearerFromRequest(request);
  const body = await readJsonBody(request);
  const hostname = body["hostname"];
  if (typeof hostname !== "string" || !hostname.trim()) {
    return json(
      { error: { code: "BAD_REQUEST", message: "`hostname` is required" } },
      400,
    );
  }
  try {
    const result = await ctx.runAction(api.domains.bindDomain, {
      bearer,
      pageId: id as Id<"pages">,
      hostname,
    });
    return json(result, 200);
  } catch (err) {
    if (err instanceof ConvexError) {
      const data = err.data as { code?: string } | undefined;
      if (data?.code === "NOT_FOUND") return json({ error: data }, 404);
    }
    return errorResponse(err);
  }
});

// ---------------------------------------------------------------------------
// CLOUD-42 — standards-based discovery (PRD §7.3). PUBLIC, no auth. Two
// `/.well-known/...` documents let a modern agent self-discover HOW to
// authenticate (RFC 8414/9728 authorization-server metadata → the RFC 8628
// device grant in auth.ts) and WHAT verbs exist (RFC 9727 endpoint catalog →
// the `/v1/pages` routes above). The builders are PURE (convex/wellknown.ts);
// the issuer/base URL is env-injected at deploy (CLOUD-30b sets the public base
// URL via `SITE_URL`, the same origin auth.ts uses).
// ---------------------------------------------------------------------------

/** Minimal ambient `process` — this workspace types against workers-types. */
declare const process: { env: Record<string, string | undefined> };

/**
 * The public discovery issuer/base URL. Same origin the auth layer uses
 * (`SITE_URL`); falls back to localhost for dev. CLOUD-30b injects the real
 * deployed origin so the advertised endpoints resolve.
 */
function discoveryBaseUrl(): string {
  return process.env.SITE_URL ?? "http://localhost:3000";
}

/** GET /.well-known/oauth-authorization-server → RFC 8414/9728 metadata. */
const oauthMetadataHandler = httpAction(async () => {
  return json(buildOAuthAuthorizationServerMetadata(discoveryBaseUrl()), 200);
});

/** GET /.well-known/api-catalog → RFC 9727 endpoint catalog (the REST verbs). */
const apiCatalogHandler = httpAction(async () => {
  return json(buildApiCatalog(discoveryBaseUrl()), 200);
});

http.route({
  path: OAUTH_AS_METADATA_PATH,
  method: "GET",
  handler: oauthMetadataHandler,
});
http.route({
  path: API_CATALOG_PATH,
  method: "GET",
  handler: apiCatalogHandler,
});

http.route({ path: "/v1/abuse", method: "POST", handler: abuseHandler });

http.route({ path: "/v1/pages", method: "GET", handler: findHandler });
http.route({ path: "/v1/pages", method: "POST", handler: publishHandler });
// CLOUD-40: POST on the `/v1/pages/` PREFIX is the bind-domain sub-route
// (`/v1/pages/{id}/domain`). The publish POST above is the EXACT `/v1/pages`
// path, so the two never collide.
http.route({
  pathPrefix: "/v1/pages/",
  method: "POST",
  handler: bindDomainHandler,
});
http.route({
  pathPrefix: "/v1/pages/",
  method: "GET",
  handler: getHandler,
});
http.route({
  pathPrefix: "/v1/pages/",
  method: "PATCH",
  handler: updateHandler,
});
http.route({
  pathPrefix: "/v1/pages/",
  method: "DELETE",
  handler: deleteHandler,
});

export default http;
