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

  for (const family of options.families) {
    const target = path.join(recipesDir, `${family}.css`);
    if (!existsSync(target)) {
      notFound.push(family);
      continue;
    }
    await rm(target);
    delete lock.families[family];
    removed.push(family);
  }

  await writeLockfile(recipesDir, lock);

  const brokenDependents = collectBrokenDependents(recipesDir, removed);
  const skillPath = await regenerateSkillMd(cwd, config);

  return { removed, notFound, brokenDependents, lockfile: lock, skillPath };
}

function collectBrokenDependents(
  recipesDir: string,
  removed: string[],
): { dependent: string; references: string[] }[] {
  if (removed.length === 0) return [];
  // gather the set of recipe names that *were* in the removed families. we approximate
  // by treating any reference matching `<removed-family>` or `<removed-family>-*` as a hit.
  const removedSet = new Set(removed);
  const out: { dependent: string; references: string[] }[] = [];
  for (const family of installedFamilies(recipesDir)) {
    const parsed = parseInstalledFamily(recipesDir, family);
    if (!parsed) continue;
    const broken = new Set<string>();
    for (const recipe of parsed.recipes) {
      for (const ref of recipe.references) {
        const refRoot = ref.split("-")[0] ?? "";
        if (removedSet.has(ref) || removedSet.has(refRoot)) broken.add(ref);
      }
    }
    if (broken.size > 0) out.push({ dependent: family, references: Array.from(broken).sort() });
  }
  return out;
}
