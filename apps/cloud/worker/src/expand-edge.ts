// CLOUD-02 Phase-0 de-risking spike.
//
// Goal: prove that @shortwind/core's `expand()` (plus the `parseRecipeFile` →
// `buildRegistry` pipeline it consumes) runs cleanly inside the Cloudflare
// Workers (workerd) runtime, with NO Node built-ins and — hypothesis —
// WITHOUT the `nodejs_compat` compatibility flag. Core is documented as pure
// JS over plain data (see repo CLAUDE.md: "core has zero workspace deps and
// zero Node built-ins"); this module is the executable check of that claim.
//
// This is a SPIKE. It is deliberately NOT wired into the live serve path. The
// production decision (recorded in SPIKE.md) is that expansion happens
// server-side at publish via the Convex action (CLOUD-20); the Worker serve
// path never expands. This module exists only so a workerd test can call
// `expand()` and assert byte-identical parity with Node.
import { buildRegistry, expand, parseRecipeFile } from "@shortwind/core";
import type { ExpandOptions } from "@shortwind/core";

/** One recipe source file: its `<family>.css` name and raw `@recipe` text. */
export interface RecipeSource {
  /** e.g. "button.css" — used only for diagnostics/family derivation. */
  filename: string;
  /** Raw recipe file contents (the `@recipe` shorthand definitions). */
  source: string;
}

export type EdgeExpandResult =
  | { ok: true; html: string }
  | { ok: false; errors: string[] };

/**
 * Parse a set of recipe sources, build the registry, and expand the supplied
 * shorthand HTML against it — the whole core pipeline, end to end, callable
 * from inside workerd.
 *
 * Returns a serializable result (no class instances, no closures) so it is safe
 * to hand across a Worker boundary, mirroring core's own `Result` discipline.
 */
export function expandWithRecipes(
  html: string,
  recipes: readonly RecipeSource[],
  options: ExpandOptions = {},
): EdgeExpandResult {
  const errors: string[] = [];
  const allRecipes = [];

  for (const { source, filename } of recipes) {
    const parsed = parseRecipeFile(source, filename);
    if (!parsed.ok) {
      for (const e of parsed.errors) errors.push(`${filename}: ${e.message}`);
      continue;
    }
    allRecipes.push(...parsed.value.recipes);
  }

  if (errors.length > 0) return { ok: false, errors };

  const built = buildRegistry(allRecipes);
  if (!built.ok) {
    return { ok: false, errors: built.errors.map((e) => e.message) };
  }

  return { ok: true, html: expand(html, built.value, options) };
}

/**
 * Minimal `fetch` handler so this module is a valid Worker entrypoint for
 * `wrangler dev`/deploy during the spike. POST `{ html, recipes }` JSON and get
 * back `{ ok, html | errors }`. Not part of the production serve path.
 */
export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("POST { html, recipes } to expand (CLOUD-02 spike)", {
        status: 405,
      });
    }
    let body: { html?: string; recipes?: RecipeSource[] };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return Response.json({ ok: false, errors: ["invalid JSON body"] }, { status: 400 });
    }
    const result = expandWithRecipes(body.html ?? "", body.recipes ?? []);
    return Response.json(result, { status: result.ok ? 200 : 422 });
  },
};
