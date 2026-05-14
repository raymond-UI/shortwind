import { existsSync, readdirSync, readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseRecipeFile } from "@shortwind/core";
import type { Recipe } from "@shortwind/core";
import { renderSkillMd } from "./skill-template.js";

export type ShortwindConfig = {
  registry: string;
  recipesDir: string;
  outputPath: string;
};

export const DEFAULT_CONFIG: ShortwindConfig = {
  registry: "https://shortwind.dev/registry",
  recipesDir: "recipes",
  outputPath: "skills/shortwind/SKILL.md",
};

export async function readConfig(cwd: string): Promise<ShortwindConfig> {
  const configPath = path.join(cwd, "shortwind.config.json");
  if (!existsSync(configPath)) return DEFAULT_CONFIG;
  const body = await readFile(configPath, "utf8");
  const parsed = JSON.parse(body) as Partial<ShortwindConfig>;
  return { ...DEFAULT_CONFIG, ...parsed };
}

export function installedFamilies(recipesDir: string): string[] {
  if (!existsSync(recipesDir)) return [];
  return readdirSync(recipesDir)
    .filter((f) => f.endsWith(".css"))
    .map((f) => f.replace(/\.css$/, ""))
    .sort();
}

export function parseInstalledFamily(
  recipesDir: string,
  family: string,
): { recipes: Recipe[]; header: { family: string; version: string; sha: string } | null } | null {
  const filePath = path.join(recipesDir, `${family}.css`);
  if (!existsSync(filePath)) return null;
  const source = readFileSync(filePath, "utf8");
  const result = parseRecipeFile(source, `${family}.css`);
  if (!result.ok) return null;
  return { recipes: result.value.recipes, header: result.value.header };
}

export async function regenerateSkillMd(cwd: string, config: ShortwindConfig): Promise<string> {
  const recipesDir = path.join(cwd, config.recipesDir);
  const families = installedFamilies(recipesDir);
  const skillPath = path.join(cwd, config.outputPath);
  const { mkdir } = await import("node:fs/promises");
  await mkdir(path.dirname(skillPath), { recursive: true });
  await writeFile(skillPath, renderSkillMd(families));
  return skillPath;
}

/**
 * Rewrite a recipe file so that every occurrence of `<from>` is replaced with `<to>`:
 *   - fingerprint header family slot
 *   - recipe names (after `@recipe `)
 *   - cross-recipe `@from` / `@from-*` references in bodies
 *
 * Descriptions and unrelated text are untouched.
 */
export function renameFamilyInSource(source: string, from: string, to: string): string {
  const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const f = escape(from);
  let out = source;
  out = out.replace(new RegExp(`(\\bshortwind:\\s+)${f}(\\b|@)`, "g"), `$1${to}$2`);
  out = out.replace(new RegExp(`(@recipe\\s+)${f}(\\b|-)`, "g"), `$1${to}$2`);
  out = out.replace(new RegExp(`@${f}(\\b|-)`, "g"), `@${to}$1`);
  return out;
}
