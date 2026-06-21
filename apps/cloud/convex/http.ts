import { ConvexError } from "convex/values";
import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { authComponent, createAuth } from "./auth";

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
 * (`FORBIDDEN`). The mutating page verbs (publish/update/delete/visibility/
 * bind-domain) land on their own routes in later waves.
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

http.route({ path: "/v1/pages", method: "GET", handler: findHandler });
http.route({
  pathPrefix: "/v1/pages/",
  method: "GET",
  handler: getHandler,
});

export default http;
