import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyEdits, modify, parse as parseJsonc } from "jsonc-parser";
import { buildRegistry, parseRecipeFile, renderSkillMarkdown } from "@shortwind/core";
import type { Recipe, Registry } from "@shortwind/core";
import {
  computeBodySha,
  extractHeader,
  rewriteHeaderSha,
  verifyFetchedFamily,
} from "./fingerprint.js";
import { detectProject, skillAdapterFor, type Bundler, type PackageManager } from "./detect.js";
import {
  BUNDLED_ORIGIN,
  resolveSource,
  resolvePresetFamilies,
  type RegistrySource,
} from "./registry-source.js";
import {
  findTailwindEntryCssFiles,
  syncSafelistFile,
} from "@shortwind/tailwind";
import { readLockfile, writeLockfile } from "./lockfile.js";
import {
  buildToneBlock,
  convertMediaDarkToClass,
  ensureDarkClassVariant,
  findMissingThemeTokens,
  missingToneThemeTokens,
  scaffoldTheme,
  TONE_MARKER,
  upsertThemeSupplement,
  type ThemeAction,
} from "./theme.js";
import { wireBundler, type BundlerWireAction } from "./bundler-config.js";
import { wireAgentsInstructions, type AgentsFileAction } from "./agents-file.js";

// Default to the catalog bundled in the CLI — no network, always available.
// Pass --registry <url> (or a path) for a custom/BYO registry.
export const DEFAULT_REGISTRY = BUNDLED_ORIGIN;

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
  // Detected bundler — the CLI summary uses it to print the matching
  // per-framework setup-guide URL (#85).
  bundler: ReturnType<typeof detectProject>["bundler"];
  preset: string;
  registry: string;
  families: string[];
  installedPackages: string[];
  installedFamilies: string[];
  skippedFamilies: string[];
  configPath: string;
  vscodePath: string;
  // tsconfig the TS language-service plugin was added to; null for a non-TS
  // project (no tsconfig.json to wire).
  tsconfigPluginPath: string | null;
  // null when the target isn't a git repository (hook not installed).
  huskyPath: string | null;
  skillPath: string;
  themePath: string | null;
  themeAction: ThemeAction;
  // Entry CSS that received the default `[data-tone=…]` table consumed by
  // tone-aware recipes, and whether init wrote it ("skipped" = already present
  // or no entry CSS). null when there was no entry CSS to attach to.
  tonesPath: string | null;
  tonesAction: "written" | "skipped";
  // Tailwind entry CSS files that received the on-disk @source inline(...)
  // safelist (#73) — empty for Vite/Astro, which inject it in-memory.
  safelistCssPaths: string[];
  // Design tokens the installed recipes reference that the project's existing
  // (untouched) theme does not define AND the supplement could not provide —
  // empty when the theme was scaffolded or supplemented.
  missingThemeTokens: string[];
  // Tokens appended to an existing theme as a marked, additive supplement
  // block with the default placeholder values (themeAction "supplemented").
  supplementedThemeTokens: string[];
  bundlerConfigPath: string | null;
  bundlerConfigAction: BundlerWireAction;
  bundlerConfigSnippet?: string;
  agentsFilePath: string | null;
  agentsFileAction: AgentsFileAction;
  installOk: boolean;
  installError: string | null;
};

export async function init(options: InitOptions): Promise<InitResult> {
  const cwd = path.resolve(options.cwd);
  const registry = options.registry ?? DEFAULT_REGISTRY;
  const source = await resolveSource(registry);

  const shape = detectProject(cwd);

  const families = await resolveFamilies(options.preset, source);
  const pkgs = pickPackages(shape.bundler);

  // Pin adapters to this CLI's own version so a released CLI always installs the
  // adapters it shipped with — `latest` can lag the `beta` tag (or vice-versa),
  // and a bare `add @shortwind/tailwind` would resolve `latest` and drift out of
  // sync with the CLI/core/catalog.
  const version = cliVersion();
  const specs = version ? pkgs.map((p) => `${p}@${version}`) : pkgs;

  // The adapter install is a convenience, not the point — copying recipes and
  // generating SKILL.md is. A peer-dep conflict or pnpm's non-zero exit on
  // ERR_PNPM_IGNORED_BUILDS must not abort the whole scaffold, so failures here
  // are surfaced (installOk/installError) rather than thrown.
  const installer = options.installPackages ?? defaultInstall;
  let installOk = true;
  let installError: string | null = null;
  if (specs.length > 0) {
    try {
      await installer(shape.packageManager, specs, cwd);
    } catch (err) {
      installOk = false;
      installError = err instanceof Error ? err.message : String(err);
    }
  }

  const recipesDir = path.join(cwd, "recipes");
  let copied: { installed: string[]; skipped: string[] };
  try {
    copied = await copyRecipes(source, families, recipesDir);
  } catch (err) {
    // A mid-copy abort (e.g. a registry fetch that timed out even after
    // retries) used to surface as a bare TimeoutError, leaving a silently
    // half-initialized project — recipes but no config/SKILL.md/theme (#78).
    // Report exactly what landed and that re-running resumes: copyRecipes
    // skips families already on disk, and everything after this point is
    // idempotent.
    const done = families.filter((f) => existsSync(path.join(recipesDir, `${f}.css`)));
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `init aborted while copying recipe families (${done.length}/${families.length} copied` +
        `${done.length > 0 ? `: ${done.join(", ")}` : ""}) — ${reason}\n` +
        `The project is incomplete (no config/SKILL.md/theme yet). ` +
        `Re-run the same init command to resume; already-copied families are skipped.`,
    );
  }
  const { installed, skipped } = copied;
  await updateLockfile(recipesDir, registry, installed);

  const configPath = path.join(cwd, "shortwind.config.json");
  await writeConfig(configPath, { registry, recipesDir: "recipes" });

  // Enable recipe-token IntelliSense (completion/hover/go-to-def) by adding the
  // TS language-service plugin to tsconfig — no extension, since init installs
  // @shortwind/cli which provides it as `./ts-plugin`.
  const tsconfigPluginPath = await wireTsconfigPlugin(cwd);

  const vscodePath = path.join(cwd, ".vscode", "settings.json");
  await wireVscodeClassRegex(vscodePath, { tsProject: tsconfigPluginPath !== null });

  const huskyPath = await installHuskyHook(cwd, path.join(cwd, ".husky", "pre-commit"));

  const skillPath = path.join(cwd, "skills", "shortwind", "SKILL.md");
  const skillRegistry = await writeSkillMd(skillPath, recipesDir, families, shape.bundler);

  // Recipes reference semantic color tokens; scaffold the default theme so they
  // render with color on first run instead of as colorless markup.
  const theme = await scaffoldTheme(cwd);

  // When an existing theme was left untouched, it may define none of the
  // tokens the installed recipes reference (create-next-app's @theme has only
  // background/foreground) — every @card/@badge would render colorless with no
  // signal (#62). Diff what the recipes use against what the theme defines,
  // then APPEND a marked block providing just the missing tokens: a terminal
  // warning alone doesn't persist anywhere, and dogfooding showed it gets
  // answered by invented color values. The append is purely additive (only
  // absent tokens), so the user's theme is never overridden; the warn-only
  // path remains for anything the supplement can't cover.
  let themeAction: ThemeAction = theme.action;
  let missingThemeTokens: string[] = [];
  let supplementedThemeTokens: string[] = [];
  if (theme.action === "skipped" && theme.themePath && skillRegistry) {
    const css = await readFile(theme.themePath, "utf8");
    // Recipe-referenced tokens plus the tone table's own theme tokens — init
    // always writes the tone block, and on a minimal existing theme its
    // `var(--success)`/`var(--warning)` would resolve to nothing unless those
    // tokens are supplemented alongside the recipe-referenced ones.
    missingThemeTokens = [
      ...new Set([
        ...findMissingThemeTokens(css, skillRegistry.flattened),
        ...missingToneThemeTokens(css),
      ]),
    ].sort();
    const { css: next, added } = upsertThemeSupplement(css, missingThemeTokens);
    if (added.length > 0) {
      await writeFile(theme.themePath, next);
      supplementedThemeTokens = added;
      missingThemeTokens = [];
      themeAction = "supplemented";
    }
  }

  // Make dark mode toggle-ready, class-only (#96). A stock create-next-app
  // theme drives dark from `@media (prefers-color-scheme)`, which a `.dark`
  // class can't reach — and which overrides a force-light choice when the OS is
  // dark. Ensure `@custom-variant dark`, then CONVERT that media block into
  // `.dark` (move the declarations, drop the wrapper) so the toggle is the
  // single source of truth. Idempotent; only the simple single-`:root` shape is
  // touched. System-preference seeding moves to the inline script in the setup
  // docs.
  if (theme.themePath) {
    const css = await readFile(theme.themePath, "utf8");
    const { css: next } = convertMediaDarkToClass(ensureDarkClassVariant(css));
    if (next !== css) await writeFile(theme.themePath, next);
  }

  // Tone-aware recipes (@badge, …) read --tone-bg/--tone-fg, selected by a
  // data-tone attribute — the static-name explosion (@badge-success/danger/…)
  // collapses to one recipe + a data attribute, and data-driven coloring works
  // without dynamic class names. Append a default tone table (neutral/success/
  // warning/danger/info) the user extends; marker-guarded and append-only like
  // the theme supplement, so re-running init is a no-op. Reads the entry CSS
  // after the supplement write so dark-strategy detection sees the final file.
  let tonesPath: string | null = null;
  let tonesAction: "written" | "skipped" = "skipped";
  if (theme.themePath) {
    const css = await readFile(theme.themePath, "utf8");
    tonesPath = theme.themePath;
    if (!css.includes(TONE_MARKER)) {
      await writeFile(theme.themePath, `${css.replace(/\s*$/, "")}\n\n${buildToneBlock()}\n`);
      tonesAction = "written";
    }
  }

  // Bundlers without an in-build CSS hook (Next; bare Tailwind CLI) need the
  // recipe-derived `@source inline(...)` safelist ON disk — Tailwind v4 reads
  // the entry CSS from disk and never sees loader output, so recipe-body-only
  // utilities would silently never generate (#73). The safelist lands in a
  // sibling `*.shortwind.css` pulled in via one injected `@import`, so the
  // entry the user edits stays clean. Vite/Astro inject the same directive
  // in-memory at build time, so their projects are left untouched. Runs after
  // scaffoldTheme, which may have just created the entry CSS.
  const safelistCssPaths: string[] = [];
  if (shape.bundler !== "vite" && shape.bundler !== "astro" && skillRegistry) {
    for (const file of findTailwindEntryCssFiles(cwd)) {
      syncSafelistFile(file, skillRegistry);
      safelistCssPaths.push(file);
    }
  }

  // Wire the plugin into the bundler config (Vite auto-patches; Next/Astro
  // return a snippet for the summary).
  const bundlerConfig = await wireBundler(cwd, shape.bundler);

  // Point coding agents at the recipe catalog with a one-liner.
  const agentsFile = await wireAgentsInstructions(cwd, skillPath);

  return {
    packageManager: shape.packageManager,
    bundler: shape.bundler,
    preset: options.preset,
    registry,
    families,
    installedPackages: pkgs,
    installedFamilies: installed,
    skippedFamilies: skipped,
    configPath,
    vscodePath,
    tsconfigPluginPath,
    huskyPath,
    skillPath,
    themePath: theme.themePath,
    themeAction,
    tonesPath,
    tonesAction,
    supplementedThemeTokens,
    safelistCssPaths,
    missingThemeTokens,
    bundlerConfigPath: bundlerConfig.configPath,
    bundlerConfigAction: bundlerConfig.action,
    ...(bundlerConfig.snippet ? { bundlerConfigSnippet: bundlerConfig.snippet } : {}),
    agentsFilePath: agentsFile.path,
    agentsFileAction: agentsFile.action,
    installOk,
    installError,
  };
}

async function resolveFamilies(preset: string, source: RegistrySource): Promise<string[]> {
  if (preset === "none") return [];
  const presets = await source.loadPresets();
  const all = await source.listAllFamilies();
  return resolvePresetFamilies(preset, presets, all);
}

// The CLI's own version, read from its package.json at runtime (one dir above
// the compiled dist/ — and above src/ under vitest). Returns null if it can't be
// read, in which case install falls back to bare (latest-tag) specs.
export function cliVersion(): string | null {
  try {
    const pkgUrl = new URL("../package.json", import.meta.url);
    const pkg = JSON.parse(readFileSync(fileURLToPath(pkgUrl), "utf8")) as { version?: string };
    return pkg.version ?? null;
  } catch {
    return null;
  }
}

function pickPackages(bundler: ReturnType<typeof detectProject>["bundler"]): string[] {
  // @shortwind/cli is installed so `npx shortwind <cmd>` resolves the local
  // bin (the package provides the `shortwind` bin). Without it the guidance to
  // run `npx shortwind doctor` / `build` 404s, since npx tries to download a
  // nonexistent `shortwind` package (#97).
  const base = ["@shortwind/cli", "@shortwind/tailwind"];
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
    if (!header) {
      // Recipes without a fingerprint header are not lockable — fail
      // loudly so the user can fix the recipe rather than discover
      // later that `shortwind upgrade` skips this family silently.
      throw new Error(
        `recipe "${family}" has no fingerprint header — refusing to add to lockfile`,
      );
    }
    lock.families[family] = { version: header.version, sha: header.sha };
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
    // Reject a tampered/corrupted registry response before resealing.
    verifyFetchedFamily(body, family);
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
  let current: unknown;
  try {
    current = JSON.parse(await readFile(configPath, "utf8"));
  } catch (err) {
    throw new Error(`${configPath}: invalid JSON — ${(err as Error).message}`);
  }
  const base =
    current !== null && typeof current === "object" && !Array.isArray(current)
      ? (current as Record<string, unknown>)
      : {};
  const merged = { ...base, ...desired };
  await writeFile(configPath, JSON.stringify(merged, null, 2) + "\n");
}

const CLASS_REGEX_KEY = ["tailwindCSS.experimental.classRegex"];
// Per-token charclass shared by every container pattern. Beyond word chars it
// allows the punctuation Tailwind utilities use — `:` (variants), `/` (opacity),
// and `[]().,%#!` (arbitrary values like `bg-[var(--tone-bg,var(--muted))]`) —
// so those match whole instead of truncating at the first `(`.
const CLASS_TOKEN = "([\\w-@/:\\[\\]().,%#!]+)";
const CLASS_REGEX_VALUE = [
  ["class\\s*[=:]\\s*['\"]([^'\"]*)['\"]", CLASS_TOKEN],
  ["className\\s*=\\s*['\"]([^'\"]*)['\"]", CLASS_TOKEN],
  // Recipe authoring: light up Tailwind IntelliSense on the bare utilities
  // inside a `@recipe <name> { … }` body in recipes/*.css. The Tailwind engine
  // only walks directives it knows in CSS (@apply/@theme/…), so a custom
  // at-rule needs this classRegex bridge — verified to complete + hover once the
  // project's own Tailwind is active (true in every real Shortwind project).
  ["@recipe\\s+[\\w-]+\\s*\\{([^}]*)\\}", CLASS_TOKEN],
];

// VS Code's default word separators minus `-`, so hyphenated tokens count as one
// word and quick-suggest re-fires on `-`. Applied only to the TS/JS(X) languages
// where recipe/Tailwind tokens are typed.
const WORD_SEPARATORS = "`~!@#$%^&*()=+[{]}\\|;:'\",.<>/?";
const WORD_SEPARATOR_LANGS = ["typescriptreact", "javascriptreact", "typescript", "javascript"];

const FMT = { formattingOptions: { tabSize: 2, insertSpaces: true } } as const;

async function wireVscodeClassRegex(
  vscodePath: string,
  opts: { tsProject: boolean } = { tsProject: false },
): Promise<void> {
  await mkdir(path.dirname(vscodePath), { recursive: true });
  let body = existsSync(vscodePath) ? await readFile(vscodePath, "utf8") : "{}\n";
  // (1) Tailwind IntelliSense gets a classRegex covering BOTH className strings
  // and `@recipe { … }` bodies, so utilities complete/hover in JSX and in
  // recipes/*.css alike (recipe authoring). (2) The Shortwind TS plugin
  // completes recipe TOKENS inside className strings, but VS Code won't
  // auto-trigger completion in a string unless quickSuggestions.strings is on
  // (TS plugins can't add trigger chars).
  body = applyEdits(body, modify(body, CLASS_REGEX_KEY, CLASS_REGEX_VALUE, FMT));
  body = applyEdits(body, modify(body, ["editor.quickSuggestions", "strings"], true, FMT));
  // Make `-` a word character in TS/JS(X) so VS Code re-fires string
  // quick-suggest when you retype a dash inside a recipe/Tailwind token
  // (`@btn-` → variants) AFTER dismissing the dropdown — its string completion
  // only retriggers on word chars, and a TS plugin can't register `-` as a
  // trigger char. Scoped per-language so word selection elsewhere is untouched;
  // best-effort (Ctrl+Space always re-opens the list regardless).
  for (const lang of WORD_SEPARATOR_LANGS) {
    body = applyEdits(body, modify(body, [`[${lang}]`, "editor.wordSeparators"], WORD_SEPARATORS, FMT));
  }
  // A tsconfig language-service plugin loads ONLY under the workspace
  // TypeScript, not the editor's bundled copy (3) — so point the editor at the
  // local TS and prompt to use it. tsserver then resolves the plugin with
  // classic node10 resolution from where TypeScript is installed; the plugin
  // ships as a real `@shortwind/cli/ts-plugin/` directory precisely so that
  // resolution finds it (it ignores the package.json `exports` map). With a
  // flat node_modules (npm/yarn) that's all it takes. pnpm hides the plugin in
  // its isolated `.pnpm` store (TS#42688), so add the project as a best-effort
  // plugin probe location (honored by VS Code's --pluginProbeLocations).
  if (opts.tsProject) {
    body = applyEdits(body, modify(body, ["typescript.tsdk"], "node_modules/typescript/lib", FMT));
    body = applyEdits(body, modify(body, ["typescript.enablePromptUseWorkspaceTsdk"], true, FMT));
    body = applyEdits(body, modify(body, ["typescript.tsserver.pluginPaths"], ["."], FMT));
  }
  parseJsonc(body); // sanity — must stay parseable
  await writeFile(vscodePath, body.endsWith("\n") ? body : body + "\n");
}

const TS_PLUGIN_NAME = "@shortwind/cli/ts-plugin";

// Turn on the language-service plugin by adding it to the project's tsconfig
// `compilerOptions.plugins`. Recipe completion/hover/go-to-def then ride the
// editor's built-in TypeScript — no marketplace extension. Skips non-TS
// projects; idempotent. Returns the tsconfig path when wired.
async function wireTsconfigPlugin(cwd: string): Promise<string | null> {
  const tsconfigPath = path.join(cwd, "tsconfig.json");
  if (!existsSync(tsconfigPath)) return null;
  const body = await readFile(tsconfigPath, "utf8");
  const parsed = parseJsonc(body) as { compilerOptions?: { plugins?: unknown } } | undefined;
  const plugins = parsed?.compilerOptions?.plugins;
  if (Array.isArray(plugins) && plugins.some((p) => (p as { name?: string })?.name === TS_PLUGIN_NAME)) {
    return tsconfigPath; // already wired
  }
  const next = Array.isArray(plugins)
    ? applyEdits(
        body,
        modify(body, ["compilerOptions", "plugins", plugins.length], { name: TS_PLUGIN_NAME }, {
          ...FMT,
          isArrayInsertion: true,
        }),
      )
    : applyEdits(body, modify(body, ["compilerOptions", "plugins"], [{ name: TS_PLUGIN_NAME }], FMT));
  parseJsonc(next);
  await writeFile(tsconfigPath, next.endsWith("\n") ? next : next + "\n");
  return tsconfigPath;
}

// init installs @shortwind/cli (which provides the `shortwind` bin), so the
// hook can invoke the short form — npx resolves the local bin without a
// network round-trip (#76, #97).
const HUSKY_LINE = "npx shortwind build";

// Returns the hook path, or null when the target isn't a git repository —
// installing a pre-commit hook into a non-repo is presumptuous and husky
// itself has nothing to wire it into (#76).
async function installHuskyHook(cwd: string, huskyPath: string): Promise<string | null> {
  if (!existsSync(path.join(cwd, ".git"))) return null;
  await mkdir(path.dirname(huskyPath), { recursive: true });
  if (!existsSync(huskyPath)) {
    await writeFile(huskyPath, `${HUSKY_LINE}\n`, { mode: 0o755 });
    return huskyPath;
  }
  const current = await readFile(huskyPath, "utf8");
  if (current.includes(HUSKY_LINE)) return huskyPath;
  const next = current.endsWith("\n") ? current + HUSKY_LINE + "\n" : current + "\n" + HUSKY_LINE + "\n";
  await writeFile(huskyPath, next, { mode: 0o755 });
  return huskyPath;
}

// Writes SKILL.md and returns the resolved registry (null when recipes were
// broken) so init can reuse it for the missing-theme-token diff without
// parsing the catalog twice.
async function writeSkillMd(
  skillPath: string,
  recipesDir: string,
  families: string[],
  bundler: Bundler,
): Promise<Registry | null> {
  const allRecipes: Recipe[] = [];
  const guidance: Record<string, string> = {};
  const problems: string[] = [];
  for (const family of families) {
    const filePath = path.join(recipesDir, `${family}.css`);
    if (!existsSync(filePath)) continue;
    const source = readFileSync(filePath, "utf8");
    const parsed = parseRecipeFile(source, `${family}.css`);
    if (parsed.ok) {
      allRecipes.push(...parsed.value.recipes);
      if (parsed.value.guidance) guidance[family] = parsed.value.guidance;
    } else {
      problems.push(`${family}.css: ${parsed.errors.map((e) => e.message).join("; ")}`);
    }
  }
  const resolved = buildRegistry(allRecipes, { guidance });
  if (problems.length > 0 || !resolved.ok) {
    // Don't write a degraded/empty SKILL.md from broken recipes; surface the
    // problem instead (the installed catalog should always be valid here).
    const all = resolved.ok ? problems : [...problems, ...resolved.errors.map((e) => e.message)];
    console.warn(`[shortwind] SKILL.md not generated — recipe errors:\n  ${all.join("\n  ")}`);
    return null;
  }
  await mkdir(path.dirname(skillPath), { recursive: true });
  const adapter = skillAdapterFor(bundler);
  await writeFile(
    skillPath,
    renderSkillMarkdown(resolved.value, { order: families, ...(adapter ? { adapter } : {}) }),
  );
  return resolved.value;
}
