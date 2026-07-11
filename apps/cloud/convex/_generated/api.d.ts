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
import type * as billingStripe_actions from "../billingStripe/actions.js";
import type * as billingStripe_http from "../billingStripe/http.js";
import type * as billingStripe_lib from "../billingStripe/lib.js";
import type * as billingStripe_plan from "../billingStripe/plan.js";
import type * as billingStripe_plans from "../billingStripe/plans.js";
import type * as billingStripe_queries from "../billingStripe/queries.js";
import type * as bundles from "../bundles.js";
import type * as crons from "../crons.js";
import type * as dashboard from "../dashboard.js";
import type * as device from "../device.js";
import type * as domains from "../domains.js";
import type * as expand from "../expand.js";
import type * as http from "../http.js";
import type * as lib_abuse_notify from "../lib/abuse_notify.js";
import type * as lib_auth_guard from "../lib/auth_guard.js";
import type * as lib_billing_limits from "../lib/billing_limits.js";
import type * as lib_billing_plans from "../lib/billing_plans.js";
import type * as lib_billing_scope from "../lib/billing_scope.js";
import type * as lib_bundle_path from "../lib/bundle_path.js";
import type * as lib_cloudflare_cache from "../lib/cloudflare_cache.js";
import type * as lib_cloudflare_saas from "../lib/cloudflare_saas.js";
import type * as lib_content_scan from "../lib/content_scan.js";
import type * as lib_device_grant from "../lib/device_grant.js";
import type * as lib_edge_kv from "../lib/edge_kv.js";
import type * as lib_ncmec from "../lib/ncmec.js";
import type * as lib_operator_auth from "../lib/operator_auth.js";
import type * as lib_plan_resolver from "../lib/plan_resolver.js";
import type * as lib_publish_core from "../lib/publish_core.js";
import type * as lib_r2_seal from "../lib/r2_seal.js";
import type * as lib_rate_limit from "../lib/rate_limit.js";
import type * as lib_scan_config from "../lib/scan_config.js";
import type * as lib_theme_preamble from "../lib/theme_preamble.js";
import type * as migrations from "../migrations.js";
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
  "billingStripe/actions": typeof billingStripe_actions;
  "billingStripe/http": typeof billingStripe_http;
  "billingStripe/lib": typeof billingStripe_lib;
  "billingStripe/plan": typeof billingStripe_plan;
  "billingStripe/plans": typeof billingStripe_plans;
  "billingStripe/queries": typeof billingStripe_queries;
  bundles: typeof bundles;
  crons: typeof crons;
  dashboard: typeof dashboard;
  device: typeof device;
  domains: typeof domains;
  expand: typeof expand;
  http: typeof http;
  "lib/abuse_notify": typeof lib_abuse_notify;
  "lib/auth_guard": typeof lib_auth_guard;
  "lib/billing_limits": typeof lib_billing_limits;
  "lib/billing_plans": typeof lib_billing_plans;
  "lib/billing_scope": typeof lib_billing_scope;
  "lib/bundle_path": typeof lib_bundle_path;
  "lib/cloudflare_cache": typeof lib_cloudflare_cache;
  "lib/cloudflare_saas": typeof lib_cloudflare_saas;
  "lib/content_scan": typeof lib_content_scan;
  "lib/device_grant": typeof lib_device_grant;
  "lib/edge_kv": typeof lib_edge_kv;
  "lib/ncmec": typeof lib_ncmec;
  "lib/operator_auth": typeof lib_operator_auth;
  "lib/plan_resolver": typeof lib_plan_resolver;
  "lib/publish_core": typeof lib_publish_core;
  "lib/r2_seal": typeof lib_r2_seal;
  "lib/rate_limit": typeof lib_rate_limit;
  "lib/scan_config": typeof lib_scan_config;
  "lib/theme_preamble": typeof lib_theme_preamble;
  migrations: typeof migrations;
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
  stripe: import("@convex-dev/stripe/_generated/component.js").ComponentApi<"stripe">;
};
