import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildRegistry,
  parseRecipeFile,
  renderSkillMarkdown,
  type Recipe,
  type Registry,
} from "@shortwind/core";

const here = path.dirname(fileURLToPath(import.meta.url));
// packages/eval/src -> packages/registry/recipes
export const RECIPES_DIR = path.resolve(here, "..", "..", "registry", "recipes");

export type LoadedCatalog = {
  recipesDir: string;
  families: string[];
  registry: Registry;
};

export function loadCatalog(recipesDir = RECIPES_DIR): LoadedCatalog {
  const files = readdirSync(recipesDir)
    .filter((f) => f.endsWith(".css"))
    .sort();
  const recipes: Recipe[] = [];
  const guidance: Record<string, string> = {};
  const families: string[] = [];
  for (const file of files) {
    const family = file.replace(/\.css$/, "");
    const source = readFileSync(path.join(recipesDir, file), "utf8");
    const parsed = parseRecipeFile(source, file);
    if (!parsed.ok) {
      throw new Error(`failed to parse ${file}: ${parsed.errors.map((e) => e.message).join("; ")}`);
    }
    recipes.push(...parsed.value.recipes);
    if (parsed.value.guidance) guidance[family] = parsed.value.guidance;
    families.push(family);
  }
  const built = buildRegistry(recipes, { guidance });
  if (!built.ok) {
    throw new Error(`failed to resolve recipes: ${built.errors.map((e) => e.message).join("; ")}`);
  }
  return { recipesDir, families, registry: built.value };
}

export type Condition = "control" | "guided";

// The two prompt conditions differ only in the SKILL.md they hand the model:
//   control — recipe names + expansions, no selection guidance (the old format)
//   guided  — the same, plus the @guide blocks
// Toggling is a one-line strip of registry.guidance, so the A/B is otherwise
// byte-identical and the only variable is the guidance.
export function renderSkill(catalog: LoadedCatalog, condition: Condition): string {
  const order = catalog.families;
  if (condition === "guided") {
    return renderSkillMarkdown(catalog.registry, { order });
  }
  const stripped: Registry = {
    flattened: catalog.registry.flattened,
    families: catalog.registry.families,
  };
  return renderSkillMarkdown(stripped, { order });
}
