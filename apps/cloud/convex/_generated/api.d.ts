/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as billing from "../billing.js";
import type * as bundles from "../bundles.js";
import type * as crons from "../crons.js";
import type * as dashboard from "../dashboard.js";
import type * as domains from "../domains.js";
import type * as expand from "../expand.js";
import type * as http from "../http.js";
import type * as lib_auth_guard from "../lib/auth_guard.js";
import type * as lib_content_scan from "../lib/content_scan.js";
import type * as lib_publish_core from "../lib/publish_core.js";
import type * as lib_rate_limit from "../lib/rate_limit.js";
import type * as moderation from "../moderation.js";
import type * as pages from "../pages.js";
import type * as recipes from "../recipes.js";
import type * as serve from "../serve.js";
import type * as tokens from "../tokens.js";
import type * as wellknown from "../wellknown.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  billing: typeof billing;
  bundles: typeof bundles;
  crons: typeof crons;
  dashboard: typeof dashboard;
  domains: typeof domains;
  expand: typeof expand;
  http: typeof http;
  "lib/auth_guard": typeof lib_auth_guard;
  "lib/content_scan": typeof lib_content_scan;
  "lib/publish_core": typeof lib_publish_core;
  "lib/rate_limit": typeof lib_rate_limit;
  moderation: typeof moderation;
  pages: typeof pages;
  recipes: typeof recipes;
  serve: typeof serve;
  tokens: typeof tokens;
  wellknown: typeof wellknown;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
};
