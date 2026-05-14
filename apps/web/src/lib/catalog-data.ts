import { buildRegistry, parseRecipeFile } from "@shortwind/core";
import type { Recipe } from "@shortwind/core";

export type CatalogRecipe = {
  name: string;
  description: string | null;
  tokens: string[];
  references: string[];
  expansion: string[];
};

export type CatalogFamily = {
  name: string;
  recipes: CatalogRecipe[];
};

export type CatalogData = {
  families: CatalogFamily[];
};

const recipeSources = import.meta.glob(
  "../../../../packages/registry/recipes/*.css",
  { eager: true, query: "?raw", import: "default" },
) as Record<string, string>;

let cached: CatalogData | null = null;

export function buildCatalogFromSources(
  sources: Record<string, string>,
): CatalogData {
  const recipes: Recipe[] = [];
  const entries = Object.entries(sources).sort(([a], [b]) => a.localeCompare(b));
  for (const [filePath, source] of entries) {
    const fileName = filePath.split("/").pop() ?? filePath;
    const parsed = parseRecipeFile(source, fileName);
    if (!parsed.ok) continue;
    for (const r of parsed.value.recipes) recipes.push(r);
  }

  const built = buildRegistry(recipes);
  if (!built.ok) return { families: [] };

  const families: CatalogFamily[] = Object.entries(built.value.families)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([family, recs]) => ({
      name: family,
      recipes: recs.map((r) => ({
        name: r.name,
        description: r.description,
        tokens: r.tokens,
        references: r.references,
        expansion: built.value.flattened[r.name] ?? [],
      })),
    }));

  return { families };
}

export function loadCatalog(): CatalogData {
  if (cached) return cached;
  cached = buildCatalogFromSources(recipeSources);
  return cached;
}
