import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type { SkillAdapter } from "@shortwind/core";

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";
export type Bundler = "vite" | "next" | "astro" | "unknown";

// The detected bundler doubles as the adapter flavor for the generated
// SKILL.md's escape-hatch/strict snippets (#81); "unknown" means generic.
export function skillAdapterFor(bundler: Bundler): SkillAdapter | undefined {
  return bundler === "unknown" ? undefined : bundler;
}
export type Framework = "react" | "vue" | "svelte" | "astro" | "plain";

export type ProjectShape = {
  packageManager: PackageManager;
  tailwindVersion: string | null;
  tailwindMajor: 3 | 4 | null;
  bundler: Bundler;
  framework: Framework;
  hasPackageJson: boolean;
};

// Parse a local package.json into a plain object, attaching the file path to a
// malformed-JSON error so the user sees what to fix rather than a bare
// `Unexpected token` with no context. A non-object payload is treated as empty.
function parsePackageJson(pkgPath: string): {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  packageManager?: string;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(pkgPath, "utf8"));
  } catch (err) {
    throw new Error(`${pkgPath}: invalid JSON — ${(err as Error).message}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return parsed as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    packageManager?: string;
  };
}

export function detectProject(cwd: string): ProjectShape {
  const pkgPath = path.join(cwd, "package.json");
  const hasPackageJson = existsSync(pkgPath);
  type Pkg = {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    packageManager?: string;
  };
  const pkg: Pkg = hasPackageJson ? parsePackageJson(pkgPath) : {};

  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };

  const packageManager = detectPackageManager(cwd, pkg.packageManager);
  const tailwindVersion = deps["tailwindcss"] ?? null;
  const tailwindMajor = parseMajor(tailwindVersion);
  const bundler = detectBundler(deps);
  const framework = detectFramework(deps);

  return {
    packageManager,
    tailwindVersion,
    tailwindMajor,
    bundler,
    framework,
    hasPackageJson,
  };
}

function detectPackageManager(cwd: string, declared: string | undefined): PackageManager {
  if (declared) {
    const name = declared.split("@")[0];
    if (name === "pnpm" || name === "yarn" || name === "bun" || name === "npm") return name;
  }
  if (existsSync(path.join(cwd, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(path.join(cwd, "yarn.lock"))) return "yarn";
  if (existsSync(path.join(cwd, "bun.lockb"))) return "bun";
  if (existsSync(path.join(cwd, "package-lock.json"))) return "npm";
  return "npm";
}

function parseMajor(version: string | null): 3 | 4 | null {
  if (!version) return null;
  const m = version.match(/(\d+)/);
  if (!m) return null;
  const n = Number(m[1]);
  if (n === 3) return 3;
  if (n === 4) return 4;
  return null;
}

function detectBundler(deps: Record<string, string>): Bundler {
  if (deps["next"]) return "next";
  if (deps["astro"]) return "astro";
  if (deps["vite"] || deps["@vitejs/plugin-react"] || deps["@vitejs/plugin-vue"]) return "vite";
  return "unknown";
}

function detectFramework(deps: Record<string, string>): Framework {
  if (deps["astro"]) return "astro";
  if (deps["react"] || deps["next"]) return "react";
  if (deps["vue"]) return "vue";
  if (deps["svelte"] || deps["@sveltejs/kit"]) return "svelte";
  return "plain";
}
