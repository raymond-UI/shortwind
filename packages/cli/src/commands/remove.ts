import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import {
  readConfig,
  regenerateSkillMd,
  installedFamilies,
  parseInstalledFamily,
} from "../project.js";
import { readLockfile, writeLockfile, type Lockfile } from "../lockfile.js";

export type RemoveOptions = {
  cwd: string;
  families: string[];
};

export type RemoveResult = {
  removed: string[];
  notFound: string[];
  brokenDependents: { dependent: string; references: string[] }[];
  lockfile: Lockfile;
  skillPath: string;
};

export async function remove(options: RemoveOptions): Promise<RemoveResult> {
  const cwd = path.resolve(options.cwd);
  const config = await readConfig(cwd);
  const recipesDir = path.join(cwd, config.recipesDir);

  const lock = await readLockfile(recipesDir);
  const removed: string[] = [];
  const notFound: string[] = [];
  // Snapshot every recipe name in each family *before* deleting the file, so
  // broken-dependent detection can look for exact ref matches instead of
  // splitting the ref on the first `-` (which mis-classifies hyphenated
  // family names like `text-stack`).
  const removedRecipeNames = new Set<string>();

  for (const family of options.families) {
    const target = path.join(recipesDir, `${family}.css`);
    if (!existsSync(target)) {
      notFound.push(family);
      continue;
    }
    const parsed = parseInstalledFamily(recipesDir, family);
    if (parsed) {
      for (const r of parsed.recipes) removedRecipeNames.add(r.name);
    }
    await rm(target);
    delete lock.families[family];
    removed.push(family);
  }

  await writeLockfile(recipesDir, lock);

  const brokenDependents = collectBrokenDependents(recipesDir, removedRecipeNames);
  const skillPath = await regenerateSkillMd(cwd, config);

  return { removed, notFound, brokenDependents, lockfile: lock, skillPath };
}

function collectBrokenDependents(
  recipesDir: string,
  removedRecipeNames: Set<string>,
): { dependent: string; references: string[] }[] {
  if (removedRecipeNames.size === 0) return [];
  const out: { dependent: string; references: string[] }[] = [];
  for (const family of installedFamilies(recipesDir)) {
    const parsed = parseInstalledFamily(recipesDir, family);
    if (!parsed) continue;
    const broken = new Set<string>();
    for (const recipe of parsed.recipes) {
      for (const ref of recipe.references) {
        if (removedRecipeNames.has(ref)) broken.add(ref);
      }
    }
    if (broken.size > 0) out.push({ dependent: family, references: Array.from(broken).sort() });
  }
  return out;
}
