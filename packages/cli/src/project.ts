import { existsSync, readdirSync, readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildRegistry, parseRecipeFile, renderSkillMarkdown } from "@shortwind/core";
import type { Recipe, Registry } from "@shortwind/core";

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

// shortwind.config.json is committed to a repo and read when the tool runs in a
// fresh checkout, so it's untrusted input. `recipesDir`/`outputPath` are joined
// with cwd and then read/written/`rm`'d — a `../` or absolute value would let a
// cloned repo make `shortwind build`/`add` clobber files outside the project.
function assertConfigString(value: unknown, field: string, configPath: string): string {
  if (typeof value !== "string") {
    throw new Error(`${configPath}: "${field}" must be a string`);
  }
  return value;
}

function assertWithinCwd(cwd: string, value: string, field: string, configPath: string): string {
  const rel = path.relative(cwd, path.resolve(cwd, value));
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(
      `${configPath}: "${field}" (${JSON.stringify(value)}) must be a path inside the project directory`,
    );
  }
  return value;
}

export async function readConfig(cwd: string): Promise<ShortwindConfig> {
  const configPath = path.join(cwd, "shortwind.config.json");
  if (!existsSync(configPath)) return DEFAULT_CONFIG;
  const body = await readFile(configPath, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (err) {
    throw new Error(`${configPath}: invalid JSON — ${(err as Error).message}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${configPath}: expected a JSON object`);
  }
  const merged = { ...DEFAULT_CONFIG, ...(parsed as Partial<ShortwindConfig>) };
  const registry = assertConfigString(merged.registry, "registry", configPath);
  const recipesDir = assertWithinCwd(
    cwd,
    assertConfigString(merged.recipesDir, "recipesDir", configPath),
    "recipesDir",
    configPath,
  );
  const outputPath = assertWithinCwd(
    cwd,
    assertConfigString(merged.outputPath, "outputPath", configPath),
    "outputPath",
    configPath,
  );
  return { registry, recipesDir, outputPath };
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

  const allRecipes: Recipe[] = [];
  const guidance: Record<string, string> = {};
  for (const family of families) {
    const filePath = path.join(recipesDir, `${family}.css`);
    const source = readFileSync(filePath, "utf8");
    const parsed = parseRecipeFile(source, `${family}.css`);
    if (parsed.ok) {
      allRecipes.push(...parsed.value.recipes);
      if (parsed.value.guidance) guidance[family] = parsed.value.guidance;
    }
  }
  let registry: Registry = { families: {}, flattened: {} };
  const resolved = buildRegistry(allRecipes, { guidance });
  if (resolved.ok) registry = resolved.value;
  const order = families;
  await writeFile(skillPath, renderSkillMarkdown(registry, { order }));
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
