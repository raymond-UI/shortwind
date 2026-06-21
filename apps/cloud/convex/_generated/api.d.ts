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
import type * as recipes from "../recipes.js";
import type * as tokens from "../tokens.js";

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
  recipes: typeof recipes;
  tokens: typeof tokens;
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
};
