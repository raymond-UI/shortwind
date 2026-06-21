import { httpRouter } from "convex/server";
import { authComponent, createAuth } from "./auth";

/**
 * Convex HTTP router (CLOUD-01).
 *
 * Registers the `@convex-dev/better-auth` routes — including the RFC 8628
 * device-authorization endpoints (`/device/code`, `/device/token`) that
 * `cli/src/device-flow.ts` polls. `cors: true` adds the OPTIONS preflight +
 * CORS headers so a non-same-origin client (the CLI) can reach them.
 *
 * Kept intentionally minimal: feature routes (page serve, abuse intake, domain
 * webhooks) land in later waves on their own surfaces.
 */
const http = httpRouter();

authComponent.registerRoutes(http, createAuth, { cors: true });

export default http;
