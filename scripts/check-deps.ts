#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

type Pkg = {
  name: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

const ROOT = new URL("..", import.meta.url).pathname;

const LAYERS: Record<string, number> = {
  "@shortwind/core": 0,
  "@shortwind/tailwind": 1,
  "@shortwind/registry": 1,
  "@shortwind/vite": 2,
  "@shortwind/next": 2,
  "@shortwind/runtime": 2,
  "@shortwind/astro": 3,
  shortwind: 3,
  web: 4,
};

function readPkg(dir: string): Pkg | null {
  try {
    return JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as Pkg;
  } catch {
    return null;
  }
}

function workspacePkgs(): { dir: string; pkg: Pkg }[] {
  const result: { dir: string; pkg: Pkg }[] = [];
  for (const group of ["packages", "apps"]) {
    const base = join(ROOT, group);
    for (const name of readdirSync(base)) {
      const dir = join(base, name);
      if (!statSync(dir).isDirectory()) continue;
      const pkg = readPkg(dir);
      if (pkg) result.push({ dir, pkg });
    }
  }
  return result;
}

const errors: string[] = [];
const pkgs = workspacePkgs();

for (const { pkg } of pkgs) {
  const layer = LAYERS[pkg.name];
  if (layer === undefined) {
    errors.push(`${pkg.name}: not assigned to a layer in scripts/check-deps.ts`);
    continue;
  }
  const allDeps = {
    ...(pkg.dependencies ?? {}),
    ...(pkg.peerDependencies ?? {}),
  };
  for (const dep of Object.keys(allDeps)) {
    const depLayer = LAYERS[dep];
    if (depLayer === undefined) continue;
    if (depLayer >= layer) {
      errors.push(
        `${pkg.name} (layer ${layer}) depends on ${dep} (layer ${depLayer}) — arrows must point inward.`,
      );
    }
  }
}

if (errors.length > 0) {
  console.error("Dependency direction violations:");
  for (const e of errors) console.error("  " + e);
  process.exit(1);
}

console.log(`OK — ${pkgs.length} packages, dependency arrows point inward.`);
