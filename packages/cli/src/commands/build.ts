import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildRegistry, parseRecipeFile, renderSkillMarkdown } from "@shortwind/core";
import type { Diagnostic, Recipe } from "@shortwind/core";
import { installedFamilies, readConfig } from "../project.js";

export type BuildOptions = {
  cwd: string;
};

export type BuildResult = {
  changed: boolean;
  families: string[];
  skillPath: string;
};

export class BuildError extends Error {
  readonly diagnostics: Diagnostic[];

  constructor(diagnostics: Diagnostic[]) {
    super(
      `shortwind build failed:\n${diagnostics
        .map((d) => `  ${d.file}:${d.line}${d.column ? `:${d.column}` : ""} ${d.code} — ${d.message}`)
        .join("\n")}`,
    );
    this.diagnostics = diagnostics;
    this.name = "BuildError";
  }
}

export async function build(options: BuildOptions): Promise<BuildResult> {
  const cwd = path.resolve(options.cwd);
  const config = await readConfig(cwd);
  const recipesDir = path.join(cwd, config.recipesDir);
  const families = installedFamilies(recipesDir);

  const allRecipes: Recipe[] = [];
  const errors: Diagnostic[] = [];

  for (const family of families) {
    const filePath = path.join(recipesDir, `${family}.css`);
    const source = readFileSync(filePath, "utf8");
    const parsed = parseRecipeFile(source, `${family}.css`);
    if (!parsed.ok) {
      errors.push(...parsed.errors);
      continue;
    }
    allRecipes.push(...parsed.value.recipes);
  }

  if (errors.length > 0) throw new BuildError(errors);

  const resolved = buildRegistry(allRecipes);
  if (!resolved.ok) throw new BuildError(resolved.errors);

  const skillPath = path.join(cwd, config.outputPath);
  const next = renderSkillMarkdown(resolved.value, { order: families });
  const current = existsSync(skillPath) ? readFileSync(skillPath, "utf8") : null;
  let changed = false;
  if (current !== next) {
    await mkdir(path.dirname(skillPath), { recursive: true });
    await writeFile(skillPath, next);
    changed = true;
  }

  return { changed, families, skillPath };
}
