import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { computeBodySha, extractHeader, rewriteHeaderSha } from "../fingerprint.js";
import { readLockfile, writeLockfile } from "../lockfile.js";
import { installedFamilies, readConfig } from "../project.js";

export type ResealOptions = {
  cwd: string;
  families?: string[];
};

export type ResealResult = {
  resealed: string[];
  unchanged: string[];
  notFound: string[];
  noHeader: string[];
};

// You own the recipes (shadcn-style), but `verify` fingerprints them — so an
// intentional edit trips the header sha + lockfile. `reseal` recomputes each
// family's body sha and rewrites the header and lockfile to match, making
// `verify` pass again. The clean way to bless an edit instead of hand-patching
// hashes.
export async function reseal(options: ResealOptions): Promise<ResealResult> {
  const cwd = path.resolve(options.cwd);
  const config = await readConfig(cwd);
  const recipesDir = path.join(cwd, config.recipesDir);
  const families =
    options.families && options.families.length > 0
      ? options.families
      : installedFamilies(recipesDir);

  const lock = await readLockfile(recipesDir);
  const resealed: string[] = [];
  const unchanged: string[] = [];
  const notFound: string[] = [];
  const noHeader: string[] = [];

  for (const family of families) {
    const file = path.join(recipesDir, `${family}.css`);
    if (!existsSync(file)) {
      notFound.push(family);
      continue;
    }
    const source = readFileSync(file, "utf8");
    const header = extractHeader(source);
    if (!header) {
      noHeader.push(family);
      continue;
    }
    const sha = computeBodySha(source);
    if (sha === header.sha && lock.families[family]?.sha === sha) {
      unchanged.push(family);
      continue;
    }
    await writeFile(file, rewriteHeaderSha(source, sha));
    lock.families[family] = { version: header.version, sha };
    resealed.push(family);
  }

  await writeLockfile(recipesDir, lock);
  return { resealed, unchanged, notFound, noHeader };
}
