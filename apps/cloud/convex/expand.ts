import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import {
  buildRegistry,
  expand,
  parseRecipeFile,
  RECIPE_SHA_HEX_LENGTH,
} from "@shortwind/core";
import type { ExpandOptions, Recipe } from "@shortwind/core";

/**
 * Server-side expansion (CLOUD-20, PRD §5.1 / §6.2).
 *
 * Expansion happens ONCE, server-side, at publish: the platform resolves the
 * page's recipe set and runs the @shortwind/core engine to freeze the shorthand
 * HTML into plain Tailwind, which is what the CDN serves. This is the DEFAULT
 * (and only) expansion host — the CLOUD-02 spike proved core *can* run inside
 * workerd, but the production decision (worker/SPIKE.md) is that the Worker
 * serve path NEVER expands; it serves the already-frozen artifact.
 *
 * Per CLAUDE.md the decision logic is a PURE function (`expandPage`) over plain
 * serializable data — no class instances, no closures — so it is unit-testable
 * with no Convex harness and importable directly by the publish pipeline
 * (CLOUD-23). The Convex `internalAction` below is a thin shell around it.
 *
 * The recipe set is passed as plain data (family file name + raw `@recipe`
 * source), NOT a pre-built `Registry` class — the registry is rebuilt here so
 * the whole parse → resolve → expand pipeline runs in one deterministic place.
 */

// ---------------------------------------------------------------------------
// Plain-data boundary types
// ---------------------------------------------------------------------------

/** One recipe source file: its `<family>.css` name + raw `@recipe` text. */
export interface RecipeSource {
  /** e.g. "button.css" — used for diagnostics and family derivation. */
  filename: string;
  /** Raw recipe file contents (the sealed `@recipe` shorthand definitions). */
  source: string;
}

/** Input to a server-side expansion. All fields are plain serializable data. */
export interface ExpandPageInput {
  /** The page's shorthand HTML/source (recipe tokens in `class=`/`className=`). */
  html: string;
  /** The resolved recipe set — family file name + raw source, plain data. */
  recipes: readonly RecipeSource[];
  /**
   * Expansion options forwarded to core (`mode`, `mergeConflicts`,
   * `callExpanders`). Defaults to core's defaults (html mode, merge on).
   */
  options?: ExpandOptions;
  /**
   * Scoped CSS preamble stored alongside the frozen HTML (PRD §5.1: "store the
   * frozen Tailwind HTML + scoped CSS as the served artifact"). The browser
   * Tailwind build (`@tailwindcss/browser@4`) compiles utilities from this
   * preamble + the frozen HTML at serve time; core itself emits no stylesheet.
   * Defaults to the standard `@import "tailwindcss"` block. Folded into
   * `expandedHash` so a theme/preamble change versions a new artifact.
   */
  css?: string;
}

/** Output of a server-side expansion. Field names mirror `PageVersion`. */
export interface ExpandPageOutput {
  /** Frozen Tailwind HTML — byte-identical to core `expand(html, registry)`. */
  expandedHtml: string;
  /** The scoped CSS preamble stored alongside the frozen HTML. */
  css: string;
  /** Content hash of the frozen artifact; deterministic per input+registry. */
  expandedHash: string;
}

/**
 * The default scoped-CSS preamble. The frozen HTML carries no runtime expander
 * and no live link back to recipes (PRD §5.6); the served artifact pairs it
 * with this Tailwind directive block so the CDN's browser Tailwind build can
 * generate the stylesheet. Theme variables are layered in by the caller via
 * `input.css` when a page overrides the palette.
 */
export const DEFAULT_CSS_PREAMBLE = '@import "tailwindcss";';

// ---------------------------------------------------------------------------
// Pure logic (no Convex, no IO) — directly unit-tested for byte-identical
// parity with @shortwind/core and for determinism.
// ---------------------------------------------------------------------------

/**
 * SHA-256 hex of a UTF-8 string via Web Crypto (present in the Convex default
 * V8 runtime, workerd, and Node 18+ / the test environment), truncated to the
 * core fingerprint width so artifact hashes read the same as recipe shas.
 * Lowercase hex, matching `@shortwind/core` fingerprint output.
 */
export async function hashFrozenArtifact(expandedHtml: string, css: string): Promise<string> {
  // Length-prefix the two parts so no `expandedHtml`/`css` boundary collision is
  // possible (e.g. ("ab","c") vs ("a","bc")).
  const payload = `${expandedHtml.length}\n${expandedHtml}\n${css}`;
  const bytes = new TextEncoder().encode(payload);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  let hex = "";
  for (const b of new Uint8Array(digest)) hex += b.toString(16).padStart(2, "0");
  return hex.slice(0, RECIPE_SHA_HEX_LENGTH);
}

/**
 * Parse the recipe set, build the registry, and expand the shorthand HTML into
 * frozen Tailwind — the whole core pipeline in one deterministic place.
 *
 * Throws on a recipe parse or registry-resolution failure. Per core's Result
 * discipline a malformed recipe set is a caller bug (the publish pipeline
 * validates and lints recipes before reaching expansion), so it surfaces as a
 * thrown `Error` rather than a silent partial expansion.
 */
export async function expandPage(input: ExpandPageInput): Promise<ExpandPageOutput> {
  const recipes: Recipe[] = [];
  const errors: string[] = [];

  for (const { source, filename } of input.recipes) {
    const parsed = parseRecipeFile(source, filename);
    if (!parsed.ok) {
      for (const e of parsed.errors) errors.push(`${filename}: ${e.message}`);
      continue;
    }
    recipes.push(...parsed.value.recipes);
  }

  if (errors.length > 0) {
    throw new Error(`shortwind expand: recipe parse failed:\n${errors.join("\n")}`);
  }

  const built = buildRegistry(recipes);
  if (!built.ok) {
    throw new Error(
      `shortwind expand: registry resolution failed:\n${built.errors
        .map((e) => e.message)
        .join("\n")}`,
    );
  }

  const expandedHtml = expand(input.html, built.value, input.options ?? {});
  const css = input.css ?? DEFAULT_CSS_PREAMBLE;
  const expandedHash = await hashFrozenArtifact(expandedHtml, css);

  return { expandedHtml, css, expandedHash };
}

// ---------------------------------------------------------------------------
// Convex wrapper — a thin shell over `expandPage`.
//
// Kept self-contained (no `api.*`/`internal.*` cross-module references) so tsc
// passes offline without fresh `convex codegen`. CLOUD-23's publish path can
// either import `expandPage` directly (pure, in-process) or invoke this action
// via the scheduler / `runAction`. Runs in Convex's DEFAULT V8 runtime — no
// `"use node"` — because core has zero Node built-ins (worker/SPIKE.md).
// ---------------------------------------------------------------------------

export const expandPageAction = internalAction({
  args: {
    html: v.string(),
    recipes: v.array(v.object({ filename: v.string(), source: v.string() })),
    options: v.optional(
      v.object({
        mode: v.optional(v.union(v.literal("html"), v.literal("jsx"))),
        mergeConflicts: v.optional(v.boolean()),
        callExpanders: v.optional(v.array(v.string())),
      }),
    ),
    css: v.optional(v.string()),
  },
  returns: v.object({
    expandedHtml: v.string(),
    css: v.string(),
    expandedHash: v.string(),
  }),
  handler: async (_ctx, args): Promise<ExpandPageOutput> => {
    return expandPage({
      html: args.html,
      recipes: args.recipes,
      options: args.options as ExpandOptions | undefined,
      css: args.css,
    });
  },
});
