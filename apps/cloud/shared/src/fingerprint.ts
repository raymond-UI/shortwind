/**
 * Recipe fingerprint port for cloud publish (PRD 5.3: "touched recipes = body
 * hash diverges from fingerprint header").
 *
 * The CLI (`packages/cli/src/fingerprint.ts`) owns this rule for the local repo;
 * this module ports the *pure* part of it for the worker / convex publish path.
 * The two MUST hash identically — a family edited locally and one detected
 * cloud-side have to agree — so the security-relevant inputs (body
 * normalization, sha width) are imported from `@shortwind/core`, not re-derived.
 *
 * Difference from the CLI: the digest uses the Web Crypto `crypto.subtle` API
 * (available in Workers, Convex, and Node 18+) instead of `node:crypto`, since
 * apps/cloud must never take a Node built-in dependency. `crypto.subtle` is
 * async, so `computeBodySha` / `isTouched` / `selectTouchedRecipes` are async.
 * Output is byte-identical to the CLI (verified in fingerprint.test.ts).
 *
 * No classes, no closures in public types — plain data and result-ish values.
 */

import {
  normalizeRecipeBody,
  PLACEHOLDER_SHA,
  RECIPE_SHA_HEX_LENGTH,
} from "@shortwind/core";

// Ported verbatim from packages/cli/src/fingerprint.ts: accept the canonical
// short form and the em-dash "DO NOT EDIT THIS LINE" trailer; reject the
// two-hyphen ASCII variant on purpose (writeFamily never emits it).
const HEADER_PATTERN =
  /^\/\*\s*shortwind:\s+(\S+)@(\S+)\s+sha:([^\s*]+)(?:\s+—\s+DO NOT EDIT THIS LINE)?\s*\*\/\s*$/;

/** The parsed first-line seal of a sealed recipe file. Plain data. */
export type RecipeHeader = {
  family: string;
  version: string;
  sha: string;
};

/** Parse the seal on the first line, or `null` if the file is unsealed. */
export function extractHeader(source: string): RecipeHeader | null {
  const eol = source.indexOf("\n");
  const firstLine = (eol === -1 ? source : source.slice(0, eol)).replace(/\r$/, "");
  const m = firstLine.match(HEADER_PATTERN);
  if (!m) return null;
  return { family: m[1]!, version: m[2]!, sha: m[3]! };
}

/** Everything after the first line (the recipe body the sha is computed over). */
export function bodyAfterHeader(source: string): string {
  const eol = source.indexOf("\n");
  return eol === -1 ? "" : source.slice(eol + 1);
}

function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i]!.toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * Body sha of a recipe source — normalize (core) then SHA-256, truncated to the
 * core width. Mirrors the CLI's `computeBodySha`; the only difference is the
 * async Web Crypto digest. Pass a full sealed file: the header line is stripped
 * before hashing, exactly like the CLI.
 */
export async function computeBodySha(source: string): Promise<string> {
  const normalized = normalizeRecipeBody(bodyAfterHeader(source));
  const data = new TextEncoder().encode(normalized);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return toHex(digest).slice(0, RECIPE_SHA_HEX_LENGTH);
}

/**
 * Body sha of an already-stripped recipe *body* (no header line). Used when a
 * caller has the header sha and body as separate plain fields rather than a
 * single sealed source.
 */
export async function computeBodyShaFromBody(body: string): Promise<string> {
  const normalized = normalizeRecipeBody(body);
  const data = new TextEncoder().encode(normalized);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return toHex(digest).slice(0, RECIPE_SHA_HEX_LENGTH);
}

/**
 * Input to the touched-recipe check. Either:
 *  - `{ source }` — a full sealed recipe file (header + body); or
 *  - `{ headerSha, body }` — the seal sha and body already split out.
 */
export type TouchInput =
  | { source: string; family?: string }
  | { headerSha: string; body: string; family?: string };

/**
 * A recipe is "touched" when its normalized body sha diverges from the sha
 * recorded in its fingerprint header (PRD 5.3). Unsealed content (no header)
 * and the `000000` placeholder are NOT touched — there is no real seal to
 * diverge from.
 */
export async function isTouched(input: TouchInput): Promise<boolean> {
  if ("source" in input) {
    const header = extractHeader(input.source);
    if (header === null || header.sha === PLACEHOLDER_SHA) return false;
    const actual = await computeBodySha(input.source);
    return header.sha !== actual;
  }
  if (input.headerSha === PLACEHOLDER_SHA) return false;
  const actual = await computeBodyShaFromBody(input.body);
  return input.headerSha !== actual;
}

/** A recipe carried into a publish: family name + its sealed source. */
export type CandidateRecipe = { family: string; source: string };

/** A recipe the publish detected as edited, with its recomputed seal. */
export type TouchedRecipe = {
  family: string;
  /** The stale sha recorded in the header. */
  headerSha: string;
  /** The freshly recomputed body sha (the new seal to record). */
  bodySha: string;
  /** The version recorded in the header, if any. */
  version: string | null;
};

/**
 * Select the touched subset of `recipes`, each annotated with its stale header
 * sha and freshly recomputed body sha. Returned sorted by family for a
 * deterministic publish/audit order.
 */
export async function selectTouchedRecipes(
  recipes: readonly CandidateRecipe[],
): Promise<TouchedRecipe[]> {
  const out: TouchedRecipe[] = [];
  for (const recipe of recipes) {
    const header = extractHeader(recipe.source);
    if (header === null || header.sha === PLACEHOLDER_SHA) continue;
    const bodySha = await computeBodySha(recipe.source);
    if (header.sha !== bodySha) {
      out.push({
        family: recipe.family,
        headerSha: header.sha,
        bodySha,
        version: header.version,
      });
    }
  }
  out.sort((a, b) => a.family.localeCompare(b.family));
  return out;
}
