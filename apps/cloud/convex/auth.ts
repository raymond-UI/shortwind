import { betterAuth } from "better-auth";
import type { BetterAuthOptions } from "better-auth";
import { bearer } from "better-auth/plugins";
import { deviceAuthorization } from "better-auth/plugins/device-authorization";
import { convex } from "@convex-dev/better-auth/plugins";
import { getAuthConfigProvider } from "@convex-dev/better-auth/auth-config";
import {
  createClient,
  type GenericCtx,
} from "@convex-dev/better-auth";
import type { AuthConfig } from "convex/server";
import { components } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";

/**
 * Minimal ambient `process` declaration. The Convex runtime exposes
 * `process.env`, but this workspace types against `@cloudflare/workers-types`
 * (not `@types/node`), so the global isn't declared. We read env directly (see
 * `createAuthOptions`) — Better Auth's `createApi` calls it at the top level
 * during Convex's analyze pass, where a lazy env getter would throw.
 */
declare const process: { env: Record<string, string | undefined> };

/**
 * Better Auth server configuration for Shortwind Cloud (CLOUD-01).
 *
 * Mirrors the `@convex-dev/better-auth` wiring in nyxe-mail: a component
 * `createClient` provides the Convex database adapter, and `createAuth(ctx)`
 * builds a per-request Better Auth instance. `http.ts` registers the auth
 * routes via `authComponent.registerRoutes`.
 *
 * Scope vs. nyxe-mail: Shortwind Cloud is an agent-native, address-less surface.
 * We do NOT load email/OTP/magic-link/social/organization plugins. The auth
 * surface is exactly two things:
 *   - the RFC 8628 device-authorization grant (`deviceAuthorization`), which
 *     mints the device-flow + refresh tokens the CLI consumes (see
 *     `cli/src/device-flow.ts`), and
 *   - `bearer`, so a minted token authenticates subsequent API calls.
 *
 * Application-level *scoped* API tokens (pages:read / pages:write /
 * domains:bind) are a separate concern handled in `convex/tokens.ts`; this file
 * owns the identity/session/device-grant layer only.
 */

/**
 * The Convex-backed Better Auth client. Uses the component's default schema
 * (no `local.schema`) — Shortwind Cloud does not extend the auth tables, so the
 * component owns user/session/account/verification + the device-authorization
 * rows entirely.
 */
export const authComponent = createClient<DataModel>(components.betterAuth);

/**
 * The Convex auth config (`auth.config.ts` equivalent), inlined here to keep
 * the CLOUD-01 file set minimal. `getAuthConfigProvider()` wires the JWKS
 * provider the `convex()` plugin needs for token verification.
 */
const authConfig: AuthConfig = {
  providers: [getAuthConfigProvider()],
};

/**
 * The device-authorization grant lifetimes. RFC 8628 §3.2: `expiresIn` bounds
 * how long a user code is valid; `interval` is the minimum client poll cadence
 * (the CLI honors `slow_down` on top of it). `userCodeLength` keeps the human
 * code short and typeable.
 */
const DEVICE_CODE_EXPIRES_IN = "30m";
const DEVICE_CODE_POLL_INTERVAL = "5s";
const USER_CODE_LENGTH = 8;

/**
 * Build the Better Auth options for a given Convex ctx. Reads `process.env`
 * directly (not a config helper): `createApi` invokes this at module top-level
 * during Convex's analyze pass, where lazy env getters would throw.
 */
export const createAuthOptions = (
  ctx: GenericCtx<DataModel>,
): BetterAuthOptions => {
  const siteUrl = process.env.SITE_URL ?? "http://localhost:3000";
  // The operator dashboard is a SEPARATE origin (a TanStack Start app on
  // Cloudflare) that proxies `/api/auth/*` to this Convex Better Auth origin.
  // Its requests carry an `Origin` header of the dashboard host, so that origin
  // must be trusted or Better Auth rejects the web sign-in with "Invalid
  // origin". `DASHBOARD_URL` (Convex env) is that origin; comma-separated extras
  // are allowed for preview deployments. Falls back to the localhost dev origin.
  const dashboardOrigins = (
    process.env.DASHBOARD_URL ?? "http://localhost:5179"
  )
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  return {
    baseURL: siteUrl,
    trustedOrigins: [siteUrl, ...dashboardOrigins],
    database: authComponent.adapter(ctx),
    // The device flow issues short-lived access tokens plus refresh tokens; a
    // generous-but-bounded session keeps a CLI authenticated between polls.
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
    // Human OPERATORS sign in to the oversight dashboard with email + password
    // (the simplest working web login — no external email/OAuth creds needed).
    // Agents still authenticate entirely through the device-authorization grant
    // below; the two paths coexist. `requireEmailVerification` stays off so a
    // freshly-created operator can sign in immediately (no SMTP configured).
    emailAndPassword: { enabled: true, requireEmailVerification: false },
    plugins: [
      convex({ authConfig }),
      // RFC 8628 device authorization grant. The CLI is a public client (no
      // secret): every client_id is accepted here; the human's approval at the
      // verification URI is the gate. CLOUD-12's auth guard + tokens.ts scoping
      // enforce what an approved token may actually do.
      deviceAuthorization({
        expiresIn: DEVICE_CODE_EXPIRES_IN,
        interval: DEVICE_CODE_POLL_INTERVAL,
        userCodeLength: USER_CODE_LENGTH,
        validateClient: () => true,
        // better-auth@1.5.3 declares `schema` as a non-optional field in the
        // plugin's Zod options validator (device-authorization/index.mjs:29 has
        // no `.optional()`), so omitting it throws a ZodError during Convex's
        // module analysis. `mergeSchema(schema, {})` is a no-op, so passing an
        // empty object satisfies the validator without altering the schema.
        schema: {},
      }),
      // Lets a minted bearer token authenticate subsequent API requests.
      bearer(),
    ],
  } satisfies BetterAuthOptions;
};

/** Build a per-request Better Auth instance. Consumed by `http.ts`. */
export const createAuth = (ctx: GenericCtx<DataModel>) =>
  betterAuth(createAuthOptions(ctx));
