import { existsSync, readdirSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRegistrySource } from "../registry-source.js";
import { computeBodySha, extractHeader, rewriteHeaderSha } from "../fingerprint.js";
import { readLockfile, writeLockfile, type Lockfile } from "../lockfile.js";
import {
  readConfig,
  regenerateSkillMd,
  renameFamilyInSource,
  parseInstalledFamily,
} from "../project.js";

export type AddOptions = {
  cwd: string;
  families: string[];
  as?: string;
  all?: boolean;
  force?: boolean;
  registry?: string;
};

export type AddResult = {
  added: string[];
  skipped: string[];
  overwritten: string[];
  missingDependencies: { family: string; references: string[] }[];
  lockfile: Lockfile;
  skillPath: string;
};

export async function add(options: AddOptions): Promise<AddResult> {
  const cwd = path.resolve(options.cwd);
  const config = await readConfig(cwd);
  const registry = options.registry ?? config.registry;
  const source = createRegistrySource(registry);
  const recipesDir = path.join(cwd, config.recipesDir);
  await mkdir(recipesDir, { recursive: true });

  const lock = await readLockfile(recipesDir);
  if (!lock.registry) lock.registry = registry;

  const requested = options.all ? await source.listAllFamilies() : options.families;
  if (options.all && options.as) {
    throw new Error("--as cannot be combined with --all");
  }
  if (options.as && requested.length !== 1) {
    throw new Error("--as requires exactly one family argument");
  }

  const added: string[] = [];
  const skipped: string[] = [];
  const overwritten: string[] = [];
  const missingDependencies: { family: string; references: string[] }[] = [];

  for (const family of requested) {
    const targetName = options.as ?? family;
    const targetPath = path.join(recipesDir, `${targetName}.css`);
    const exists = existsSync(targetPath);
    if (exists && !options.force) {
      skipped.push(targetName);
      continue;
    }

    const sourceCss = await source.loadFamily(family);
    const renamed = options.as ? renameFamilyInSource(sourceCss, family, options.as) : sourceCss;
    const sha = computeBodySha(renamed);
    const finalCss = rewriteHeaderSha(renamed, sha);
    await writeFile(targetPath, finalCss);

    const header = extractHeader(finalCss);
    if (header) {
      lock.families[targetName] = { version: header.version, sha };
    }

    if (exists) overwritten.push(targetName);
    else added.push(targetName);

    const missing = collectMissingCrossFamilyDeps(recipesDir, targetName);
    if (missing.length > 0) {
      missingDependencies.push({ family: targetName, references: missing });
    }
  }

  await writeLockfile(recipesDir, lock);
  const skillPath = await regenerateSkillMd(cwd, config);

  return { added, skipped, overwritten, missingDependencies, lockfile: lock, skillPath };
}

function collectMissingCrossFamilyDeps(recipesDir: string, family: string): string[] {
  const parsed = parseInstalledFamily(recipesDir, family);
  if (!parsed) return [];
  const ownNames = new Set(parsed.recipes.map((r) => r.name));
  const installedRecipeNames = new Set<string>();
  for (const fam of readDirFamilies(recipesDir)) {
    const p = parseInstalledFamily(recipesDir, fam);
    if (!p) continue;
    for (const r of p.recipes) installedRecipeNames.add(r.name);
  }
  const missing = new Set<string>();
  for (const recipe of parsed.recipes) {
    for (const ref of recipe.references) {
      if (ownNames.has(ref)) continue;
      if (installedRecipeNames.has(ref)) continue;
      missing.add(ref);
    }
  }
  return Array.from(missing).sort();
}

function readDirFamilies(recipesDir: string): string[] {
  if (!existsSync(recipesDir)) return [];
  return readdirSync(recipesDir)
    .filter((f) => f.endsWith(".css"))
    .map((f) => f.replace(/\.css$/, ""));
}
