import { existsSync, readdirSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveSource, assertValidFamilyName } from "../registry-source.js";
import {
  computeBodySha,
  extractHeader,
  rewriteHeaderSha,
  verifyFetchedFamily,
} from "../fingerprint.js";
import { readLockfile, writeLockfile, type Lockfile } from "../lockfile.js";
import {
  readConfig,
  regenerateSkillMd,
  renameFamilyInSource,
  parseInstalledFamily,
  loadInstalledRegistry,
} from "../project.js";
import { appendMissingThemeTokens } from "../theme.js";

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
  // Theme entry the missing-token supplement was appended to, and which color
  // tokens it defined — so newly-installed families don't reference undefined
  // `--color-*` vars. null/[] when there was no theme or nothing was missing.
  themePath: string | null;
  supplementedTokens: string[];
};

export async function add(options: AddOptions): Promise<AddResult> {
  const cwd = path.resolve(options.cwd);
  const config = await readConfig(cwd);
  const registry = options.registry ?? config.registry;
  const source = await resolveSource(registry);
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
  // The source family is validated by loadFamily, but the --as target flows
  // into the written filename and into renameFamilyInSource's replacement
  // strings — an unvalidated `../../x` writes outside recipesDir and `$&`/`$1`
  // patterns corrupt the output. Hold it to the same family-name alphabet.
  if (options.as !== undefined) assertValidFamilyName(options.as);

  const added: string[] = [];
  const skipped: string[] = [];
  const overwritten: string[] = [];
  const missingDependencies: { family: string; references: string[] }[] = [];

  // Scan the installed-recipe namespace once before the loop, then update
  // it as each family lands. Previously collectMissingCrossFamilyDeps()
  // re-walked the whole recipes dir for every requested family, which is
  // O(n²) on `--all` installs.
  const installedRecipeNames = readAllInstalledRecipeNames(recipesDir);

  for (const family of requested) {
    const targetName = options.as ?? family;
    const targetPath = path.join(recipesDir, `${targetName}.css`);
    const exists = existsSync(targetPath);
    if (exists && !options.force) {
      skipped.push(targetName);
      continue;
    }

    const sourceCss = await source.loadFamily(family);
    // Verify the publisher's seal on the bytes that arrived before resealing
    // them under our own header — a tampered registry/CDN response must not be
    // silently re-sealed and trusted.
    verifyFetchedFamily(sourceCss, family);
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

    const parsed = parseInstalledFamily(recipesDir, targetName);
    if (parsed) {
      for (const r of parsed.recipes) installedRecipeNames.add(r.name);
      const ownNames = new Set(parsed.recipes.map((r) => r.name));
      const missing = new Set<string>();
      for (const recipe of parsed.recipes) {
        for (const ref of recipe.references) {
          if (ownNames.has(ref)) continue;
          if (installedRecipeNames.has(ref)) continue;
          missing.add(ref);
        }
      }
      if (missing.size > 0) {
        missingDependencies.push({
          family: targetName,
          references: Array.from(missing).sort(),
        });
      }
    }
  }

  await writeLockfile(recipesDir, lock);
  const skillPath = await regenerateSkillMd(cwd, config);

  // Newly-installed families may reference theme color tokens (e.g. popover)
  // that init never added — only the starter set is supplemented at init time.
  // Append the now-missing tokens so `bg-popover` resolves instead of emitting
  // zero CSS (the transparent-panel trap). No-op when nothing landed.
  let themePath: string | null = null;
  let supplementedTokens: string[] = [];
  if (added.length > 0 || overwritten.length > 0) {
    const registry = loadInstalledRegistry(recipesDir);
    const supplement = await appendMissingThemeTokens(cwd, registry.flattened);
    themePath = supplement.themePath;
    supplementedTokens = supplement.added;
  }

  return {
    added,
    skipped,
    overwritten,
    missingDependencies,
    lockfile: lock,
    skillPath,
    themePath,
    supplementedTokens,
  };
}

function readAllInstalledRecipeNames(recipesDir: string): Set<string> {
  const names = new Set<string>();
  for (const fam of readDirFamilies(recipesDir)) {
    const p = parseInstalledFamily(recipesDir, fam);
    if (!p) continue;
    for (const r of p.recipes) names.add(r.name);
  }
  return names;
}

function readDirFamilies(recipesDir: string): string[] {
  if (!existsSync(recipesDir)) return [];
  return readdirSync(recipesDir)
    .filter((f) => f.endsWith(".css"))
    .map((f) => f.replace(/\.css$/, ""));
}
