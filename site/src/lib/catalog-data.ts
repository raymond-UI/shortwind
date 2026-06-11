import { parseRecipeFile, buildRegistry } from "@shortwind/core";
import type { Recipe, Registry } from "@shortwind/core";

// Build-time only. Reads the recipe families this site OWNS (scaffolded by
// `shortwind init`, then edited) and resolves them with the published core —
// the same parse → resolve pipeline a real consumer's build runs. No network,
// no @shortwind/catalog runtime dep: the catalog page reflects exactly the
// recipes we ship.
const sources = import.meta.glob("../../recipes/*.css", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

export type CatalogRecipe = {
  name: string;
  description: string | null;
  expansion: string[];
};

export type CatalogFamily = {
  name: string;
  guidance: string | null;
  recipes: CatalogRecipe[];
};

// Curated lead order; anything not listed falls in alphabetically after.
const FAMILY_ORDER = [
  "text", "layout", "surface", "card", "button", "badge", "form",
  "navigation", "list", "table", "dialog", "tooltip", "feedback",
  "progress", "skeleton", "empty", "code", "icon", "media", "site",
];

function familyFromPath(p: string): string {
  return (p.split("/").pop() ?? p).replace(/\.css$/, "");
}

function orderIndex(name: string): number {
  const i = FAMILY_ORDER.indexOf(name);
  return i === -1 ? FAMILY_ORDER.length : i;
}

let cache: { families: CatalogFamily[]; registry: Registry } | null = null;

export function loadCatalog(): { families: CatalogFamily[]; registry: Registry } {
  if (cache) return cache;

  const recipes: Recipe[] = [];
  const guidance: Record<string, string> = {};

  for (const [filePath, source] of Object.entries(sources)) {
    const family = familyFromPath(filePath);
    const parsed = parseRecipeFile(source, `${family}.css`);
    if (!parsed.ok) {
      throw new Error(
        `Failed to parse recipes/${family}.css:\n` +
          parsed.errors.map((e) => `  ${e.line}: ${e.message}`).join("\n"),
      );
    }
    recipes.push(...parsed.value.recipes);
    if (parsed.value.guidance) guidance[family] = parsed.value.guidance;
  }

  const built = buildRegistry(recipes, { guidance });
  if (!built.ok) {
    throw new Error(
      "Registry build failed:\n" +
        built.errors.map((e) => `  ${e.file}:${e.line} ${e.message}`).join("\n"),
    );
  }
  const registry = built.value;

  const families: CatalogFamily[] = Object.entries(registry.families)
    .map(([name, recs]) => ({
      name,
      guidance: registry.guidance?.[name] ?? null,
      recipes: recs.map((r) => ({
        name: r.name,
        description: r.description,
        expansion: registry.flattened[r.name] ?? [],
      })),
    }))
    .sort(
      (a, b) => orderIndex(a.name) - orderIndex(b.name) || a.name.localeCompare(b.name),
    );

  cache = { families, registry };
  return cache;
}

// The flattened map (recipe name → expanded tokens) is the only field expand()
// reads, so it's all the playground island needs shipped to the browser.
export function flattenedRegistry(): Record<string, string[]> {
  return loadCatalog().registry.flattened;
}
