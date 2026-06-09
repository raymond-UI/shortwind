import { copyFileSync, mkdtempSync, readdirSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { lint, extractClassUsages, type Rule } from "shortwind";
import { RECIPES_DIR } from "./registry.js";

// What a single generation is scored on. The headline metric is unknownRate —
// the share of @-tokens that name a recipe the catalog doesn't define (the
// "@flex-row when it's @row" failure). conflicts/redundant come straight from
// the lint rules; density measures how much the model leaned on recipes at all.
export type GenerationScore = {
  recipeTokens: number;
  rawTokens: number;
  unknown: number;
  conflicts: number;
  redundant: number;
  unknownRate: number;
  recipeDensity: number;
};

// Rules that indicate a *selection* mistake (wrong recipe / wrong combination),
// as opposed to unknown (invented name) which we count on its own.
const CONFLICT_RULES: ReadonlySet<Rule> = new Set<Rule>([
  "recipe/conflicting-intent",
  "recipe/no-sibling-overlap",
  "recipe/bad-suffix-order",
  "recipe/dynamic-class",
]);

export type Grader = {
  grade(output: string): Promise<GenerationScore>;
  dispose(): void;
};

// Sets up one throwaway project (recipes + config) and grades many generations
// against it by rewriting a single source file and running the real linter.
export function createGrader(recipesDir = RECIPES_DIR): Grader {
  const dir = mkdtempSync(path.join(tmpdir(), "shortwind-eval-"));
  const projRecipes = path.join(dir, "recipes");
  mkdirSync(projRecipes, { recursive: true });
  for (const f of readdirSync(recipesDir).filter((n) => n.endsWith(".css"))) {
    copyFileSync(path.join(recipesDir, f), path.join(projRecipes, f));
  }
  writeFileSync(
    path.join(dir, "shortwind.config.json"),
    JSON.stringify({ recipesDir: "recipes", outputPath: "SKILL.md" }, null, 2),
  );
  const srcDir = path.join(dir, "src");
  mkdirSync(srcDir, { recursive: true });
  const genFile = path.join(srcDir, "gen.tsx");

  return {
    async grade(output: string): Promise<GenerationScore> {
      // Wrap bare JSX so it parses as a module the linter's extractor reads.
      const source = `export default function Gen() {\n  return (\n${output}\n  );\n}\n`;
      writeFileSync(genFile, source);

      const result = await lint({ cwd: dir });

      let recipeTokens = 0;
      let rawTokens = 0;
      for (const usage of extractClassUsages(source)) {
        for (const tok of usage.tokens) {
          if (tok.value.startsWith("@")) recipeTokens++;
          else rawTokens++;
        }
      }

      let unknown = 0;
      let conflicts = 0;
      let redundant = 0;
      for (const f of result.findings) {
        if (f.file !== genFile) continue; // ignore catalog-level findings
        if (f.rule === "recipe/unknown") unknown++;
        else if (f.rule === "recipe/no-redundant-utility") redundant++;
        else if (CONFLICT_RULES.has(f.rule)) conflicts++;
      }

      return {
        recipeTokens,
        rawTokens,
        unknown,
        conflicts,
        redundant,
        unknownRate: recipeTokens === 0 ? 0 : unknown / recipeTokens,
        recipeDensity:
          recipeTokens + rawTokens === 0 ? 0 : recipeTokens / (recipeTokens + rawTokens),
      };
    },
    dispose(): void {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
