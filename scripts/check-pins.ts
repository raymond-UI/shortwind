#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;

const PINNED_PACKAGES = ["@tanstack/react-router", "@tanstack/react-start"];

type Pkg = {
  name: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

function packageJsons(): { path: string; pkg: Pkg }[] {
  const result: { path: string; pkg: Pkg }[] = [];
  const rootPath = join(ROOT, "package.json");
  result.push({ path: rootPath, pkg: JSON.parse(readFileSync(rootPath, "utf8")) });
  for (const group of ["packages", "apps"]) {
    const base = join(ROOT, group);
    for (const name of readdirSync(base)) {
      const dir = join(base, name);
      if (!statSync(dir).isDirectory()) continue;
      const pkgPath = join(dir, "package.json");
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as Pkg;
        result.push({ path: pkgPath, pkg });
      } catch {
        // skip missing package.json
      }
    }
  }
  return result;
}

export type PinViolation = {
  file: string;
  packageName: string;
  field: "dependencies" | "devDependencies" | "peerDependencies";
  range: string;
};

export function findPinViolations(
  files: { path: string; pkg: Pkg }[],
  pinned: string[] = PINNED_PACKAGES,
): PinViolation[] {
  const violations: PinViolation[] = [];
  for (const { path: file, pkg } of files) {
    for (const field of ["dependencies", "devDependencies", "peerDependencies"] as const) {
      const deps = pkg[field];
      if (!deps) continue;
      for (const pkgName of pinned) {
        const range = deps[pkgName];
        if (range === undefined) continue;
        if (!isExactPin(range)) {
          violations.push({ file, packageName: pkgName, field, range });
        }
      }
    }
  }
  return violations;
}

// Strict semver: digits with no leading zeros, optional prerelease (-x.y),
// optional build metadata (+x.y). Refuses range operators (^ ~ > < = || x *),
// dist-tags, workspace specifiers, git/file URLs, npm: aliases, whitespace,
// or anything else that is not an exact published version.
const EXACT_SEMVER = new RegExp(
  "^(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)\\.(?:0|[1-9]\\d*)" +
    "(?:-(?:0|[1-9]\\d*|\\d*[a-zA-Z-][\\w-]*)(?:\\.(?:0|[1-9]\\d*|\\d*[a-zA-Z-][\\w-]*))*)?" +
    "(?:\\+[\\w-]+(?:\\.[\\w-]+)*)?$",
);

export function isExactPin(range: string): boolean {
  return EXACT_SEMVER.test(range);
}

const isMain = (() => {
  try {
    const fileURLToPath = (u: string): string => new URL(u).pathname;
    return fileURLToPath(import.meta.url) === process.argv[1];
  } catch {
    return false;
  }
})();

if (isMain) {
  const violations = findPinViolations(packageJsons());
  if (violations.length > 0) {
    console.error("Pin policy violations (must be exact version, no ^ or ~):");
    for (const v of violations) {
      console.error(`  ${v.file}: ${v.packageName} = "${v.range}" in ${v.field}`);
    }
    console.error(
      "\nThese packages have been actively targeted in supply-chain attacks. " +
        "Loosening a pin requires explicit PR justification.",
    );
    process.exit(1);
  }
  console.log(`OK — ${PINNED_PACKAGES.join(", ")} are exact-pinned everywhere.`);
}
