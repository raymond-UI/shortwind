import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";
export type Bundler = "vite" | "next" | "astro" | "unknown";
export type Framework = "react" | "vue" | "svelte" | "astro" | "plain";

export type ProjectShape = {
  packageManager: PackageManager;
  tailwindVersion: string | null;
  tailwindMajor: 3 | 4 | null;
  bundler: Bundler;
  framework: Framework;
  hasPackageJson: boolean;
};

export function detectProject(cwd: string): ProjectShape {
  const pkgPath = path.join(cwd, "package.json");
  const hasPackageJson = existsSync(pkgPath);
  const pkg: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    packageManager?: string;
  } = hasPackageJson
    ? (JSON.parse(readFileSync(pkgPath, "utf8")) as never)
    : { dependencies: {}, devDependencies: {} };

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
