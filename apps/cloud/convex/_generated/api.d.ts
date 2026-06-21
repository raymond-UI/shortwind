/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import type * as auth from "../auth.js";
import type * as http from "../http.js";
// CLOUD-23 (manual, additive): `convex dev` could not be run offline (no
// CONVEX_DEPLOYMENT) so these two modules are declared by hand below so
// `internal.pages.*` / `internal.recipes.*` references in pages.ts typecheck.
// A real `convex dev` (CLOUD-30) regenerates this file and supersedes the edit.
import type * as moderation from "../moderation.js";
import type * as pages from "../pages.js";
// CLOUD-50 (manual, additive): the bundle publish module. Declared by hand for
// the same offline-codegen reason as `pages`/`recipes` — `internal.bundles.*`
// references in bundles.ts must typecheck without a live `convex dev`. A real
// `convex dev` (CLOUD-30b) regenerates this file and supersedes the edit.
import type * as bundles from "../bundles.js";
import type * as recipes from "../recipes.js";
import type * as tokens from "../tokens.js";
// CLOUD-35 (manual, additive): the oversight-dashboard query module. Declared by
// hand for the same offline-codegen reason — the dashboard's `api.dashboard.*`
// references must typecheck without a live `convex dev`. A real `convex dev`
// (CLOUD-30b) regenerates this file and supersedes the edit.
import type * as dashboard from "../dashboard.js";
// CLOUD-40 (manual, additive): the custom-domain bind module. Declared by hand
// for the same offline-codegen reason — `domains.bindDomain`/`internal.domains.*`
// references must typecheck without a live `convex dev`. A real `convex dev`
// (CLOUD-30b) regenerates this file and supersedes the edit.
import type * as domains from "../domains.js";

/**
 * A utility for referencing Convex functions in your app's API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  http: typeof http;
  moderation: typeof moderation;
  pages: typeof pages;
  bundles: typeof bundles;
  recipes: typeof recipes;
  tokens: typeof tokens;
  dashboard: typeof dashboard;
  domains: typeof domains;
}>;
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
  // CLOUD-33 (manual, additive): the rate-limiter component registered in
  // convex.config.ts. Declared by hand because `convex dev` can't run offline
  // (no CONVEX_DEPLOYMENT); a real `convex dev` (CLOUD-30) regenerates this and
  // supersedes the edit. Consumed by `lib/rate-limit.ts` (`components.rateLimiter`).
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
};
