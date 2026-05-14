import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { applyEdits, modify, parse as parseJsonc } from "jsonc-parser";
import { buildRegistry, parseRecipeFile, renderSkillMarkdown } from "@shortwind/core";
import type { Recipe, Registry } from "@shortwind/core";
import { computeBodySha, extractHeader, rewriteHeaderSha } from "./fingerprint.js";
import { detectProject, type PackageManager } from "./detect.js";
import {
  createRegistrySource,
  resolvePresetFamilies,
  type RegistrySource,
} from "./registry-source.js";
import { readLockfile, writeLockfile } from "./lockfile.js";

export const DEFAULT_REGISTRY = "https://shortwind.dev/registry";

export type InitOptions = {
  cwd: string;
  preset: string;
  registry?: string;
  installPackages?: InstallPackages;
};

export type InstallPackages = (
  pm: PackageManager,
  packages: string[],
  cwd: string,
) => Promise<void>;

export type InitResult = {
  packageManager: PackageManager;
  preset: string;
  registry: string;
  families: string[];
  installedPackages: string[];
  installedFamilies: string[];
  skippedFamilies: string[];
  configPath: string;
  vscodePath: string;
  huskyPath: string;
  skillPath: string;
};

export async function init(options: InitOptions): Promise<InitResult> {
  const cwd = path.resolve(options.cwd);
  const registry = options.registry ?? DEFAULT_REGISTRY;
  const source = createRegistrySource(registry);

  const shape = detectProject(cwd);

  const families = await resolveFamilies(options.preset, source);
  const pkgs = pickPackages(shape.bundler);

  const installer = options.installPackages ?? defaultInstall;
  if (pkgs.length > 0) {
    await installer(shape.packageManager, pkgs, cwd);
  }

  const recipesDir = path.join(cwd, "recipes");
  const { installed, skipped } = await copyRecipes(source, families, recipesDir);
  await updateLockfile(recipesDir, registry, installed);

  const configPath = path.join(cwd, "shortwind.config.json");
  await writeConfig(configPath, { registry, recipesDir: "recipes" });

  const vscodePath = path.join(cwd, ".vscode", "settings.json");
  await wireVscodeClassRegex(vscodePath);

  const huskyPath = path.join(cwd, ".husky", "pre-commit");
  await installHuskyHook(huskyPath);

  const skillPath = path.join(cwd, "skills", "shortwind", "SKILL.md");
  await writeSkillMd(skillPath, recipesDir, families);

  return {
    packageManager: shape.packageManager,
    preset: options.preset,
    registry,
    families,
    installedPackages: pkgs,
    installedFamilies: installed,
    skippedFamilies: skipped,
    configPath,
    vscodePath,
    huskyPath,
    skillPath,
  };
}

async function resolveFamilies(preset: string, source: RegistrySource): Promise<string[]> {
  if (preset === "none") return [];
  const presets = await source.loadPresets();
  const all = await source.listAllFamilies();
  return resolvePresetFamilies(preset, presets, all);
}

function pickPackages(bundler: ReturnType<typeof detectProject>["bundler"]): string[] {
  const base = ["@shortwind/tailwind"];
  switch (bundler) {
    case "vite":
      return [...base, "@shortwind/vite"];
    case "next":
      return [...base, "@shortwind/next"];
    case "astro":
      return [...base, "@shortwind/astro"];
    default:
      return base;
  }
}

const defaultInstall: InstallPackages = async (pm, packages, cwd) => {
  const { spawn } = await import("node:child_process");
  const args = installArgs(pm, packages);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(pm, args, { cwd, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${pm} ${args.join(" ")} exited ${code}`)),
    );
  });
};

function installArgs(pm: PackageManager, packages: string[]): string[] {
  switch (pm) {
    case "pnpm":
      return ["add", "-D", ...packages];
    case "yarn":
      return ["add", "-D", ...packages];
    case "bun":
      return ["add", "-d", ...packages];
    case "npm":
    default:
      return ["install", "-D", ...packages];
  }
}

async function updateLockfile(
  recipesDir: string,
  registry: string,
  newlyInstalled: string[],
): Promise<void> {
  const lock = await readLockfile(recipesDir);
  if (!lock.registry) lock.registry = registry;
  for (const family of newlyInstalled) {
    const target = path.join(recipesDir, `${family}.css`);
    if (!existsSync(target)) continue;
    const source = readFileSync(target, "utf8");
    const header = extractHeader(source);
    if (header) {
      lock.families[family] = { version: header.version, sha: header.sha };
    }
  }
  await writeLockfile(recipesDir, lock);
}

async function copyRecipes(
  source: RegistrySource,
  families: string[],
  recipesDir: string,
): Promise<{ installed: string[]; skipped: string[] }> {
  await mkdir(recipesDir, { recursive: true });
  const installed: string[] = [];
  const skipped: string[] = [];
  for (const family of families) {
    const target = path.join(recipesDir, `${family}.css`);
    if (existsSync(target)) {
      skipped.push(family);
      continue;
    }
    const body = await source.loadFamily(family);
    const sha = computeBodySha(body);
    const sealed = rewriteHeaderSha(body, sha);
    await writeFile(target, sealed);
    installed.push(family);
  }
  return { installed, skipped };
}

async function writeConfig(
  configPath: string,
  next: { registry: string; recipesDir: string },
): Promise<void> {
  const desired = {
    registry: next.registry,
    recipesDir: next.recipesDir,
    outputPath: "skills/shortwind/SKILL.md",
  };
  if (!existsSync(configPath)) {
    await writeFile(configPath, JSON.stringify(desired, null, 2) + "\n");
    return;
  }
  const current = JSON.parse(await readFile(configPath, "utf8")) as Record<string, unknown>;
  const merged = { ...current, ...desired };
  await writeFile(configPath, JSON.stringify(merged, null, 2) + "\n");
}

const CLASS_REGEX_KEY = ["tailwindCSS.experimental.classRegex"];
const CLASS_REGEX_VALUE = [
  ["class\\s*[=:]\\s*['\"]([^'\"]*)['\"]", "([\\w-@/:]+)"],
  ["className\\s*=\\s*['\"]([^'\"]*)['\"]", "([\\w-@/:]+)"],
];

async function wireVscodeClassRegex(vscodePath: string): Promise<void> {
  await mkdir(path.dirname(vscodePath), { recursive: true });
  let body: string;
  if (existsSync(vscodePath)) {
    body = await readFile(vscodePath, "utf8");
  } else {
    body = "{}\n";
  }
  const edits = modify(body, CLASS_REGEX_KEY, CLASS_REGEX_VALUE, {
    formattingOptions: { tabSize: 2, insertSpaces: true },
  });
  const next = applyEdits(body, edits);
  // sanity — make sure it's parseable
  parseJsonc(next);
  await writeFile(vscodePath, next.endsWith("\n") ? next : next + "\n");
}

const HUSKY_LINE = "npx shortwind build";

async function installHuskyHook(huskyPath: string): Promise<void> {
  await mkdir(path.dirname(huskyPath), { recursive: true });
  if (!existsSync(huskyPath)) {
    await writeFile(huskyPath, `${HUSKY_LINE}\n`, { mode: 0o755 });
    return;
  }
  const current = await readFile(huskyPath, "utf8");
  if (current.includes(HUSKY_LINE)) return;
  const next = current.endsWith("\n") ? current + HUSKY_LINE + "\n" : current + "\n" + HUSKY_LINE + "\n";
  await writeFile(huskyPath, next, { mode: 0o755 });
}

async function writeSkillMd(
  skillPath: string,
  recipesDir: string,
  families: string[],
): Promise<void> {
  await mkdir(path.dirname(skillPath), { recursive: true });
  const allRecipes: Recipe[] = [];
  for (const family of families) {
    const filePath = path.join(recipesDir, `${family}.css`);
    if (!existsSync(filePath)) continue;
    const source = readFileSync(filePath, "utf8");
    const parsed = parseRecipeFile(source, `${family}.css`);
    if (parsed.ok) allRecipes.push(...parsed.value.recipes);
  }
  let registry: Registry = { families: {}, flattened: {} };
  const resolved = buildRegistry(allRecipes);
  if (resolved.ok) registry = resolved.value;
  await writeFile(skillPath, renderSkillMarkdown(registry, { order: families }));
}
