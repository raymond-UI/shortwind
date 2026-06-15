import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { glob } from "tinyglobby";
import { buildRegistry, parseRecipeFile } from "@shortwind/core";
import type { Recipe, Registry } from "@shortwind/core";
import {
  findResidualRecipeTokens,
  findTailwindEntryCssFiles,
  safelistFilePathFor,
} from "@shortwind/tailwind";
import { installedFamilies, readConfig } from "../project.js";
import { findThemeEntryCss, findMissingThemeTokens } from "../theme.js";
import { DEFAULT_CONTENT, extractClassUsages } from "./lint.js";

export type DoctorVerdict =
  // No raw recipe tokens in any scanned output file.
  | "clean"
  // Raw tokens found AND every recipe referenced in source is among them —
  // nothing was expanded, so the adapter almost certainly never ran.
  | "not-wired"
  // Raw tokens found but other recipes did expand — the transform ran and
  // these specific tokens escaped it (dynamic className, opaque region, …).
  | "leak"
  // No build output directory found to scan.
  | "no-output";

export type DoctorFinding = { file: string; tokens: string[] };

// An entry stylesheet importing a `*.shortwind.css` whose path doesn't resolve
// to the safelist sibling Shortwind manages for it — almost always a hand-edit
// of the generated import (#84-followup). `expected` is what the import should
// read; `found` is what's actually there.
export type StaleSafelistImport = { file: string; found: string; expected: string };

export type DoctorOptions = {
  cwd: string;
  // Output directories to scan, relative to cwd. Defaults to whichever of
  // .next/, dist/, out/, build/ exist.
  dirs?: string[];
  // Source globs for the "what does the project actually use" scan; same
  // semantics and fallback chain as lint's content option.
  content?: string[];
};

export type DoctorResult = {
  ok: boolean;
  verdict: DoctorVerdict;
  outputDirs: string[];
  scannedFiles: number;
  findings: DoctorFinding[];
  // Known recipes referenced from source files, as @-tokens, sorted.
  usedInSource: string[];
  // Theme color tokens the installed recipes reference but the project's theme
  // never defines (e.g. `bg-popover` with no `--color-popover`) — a recipe
  // whose utilities expand cleanly yet resolve to zero CSS. Token expansion can
  // be clean while these are broken, so this is its own signal.
  undefinedTokens: string[];
  // Entry stylesheets whose `@import "….shortwind.css"` points somewhere other
  // than the managed sibling — a hand-edit Shortwind can't auto-correct (it
  // re-adds the right import alongside, but can't recognize the mutated one).
  staleSafelistImports: StaleSafelistImport[];
};

const DEFAULT_OUTPUT_DIRS = [".next", "dist", "out", "build"];

// `@import "<anything>.shortwind.css"` — the generated safelist import. Capture
// the specifier so we can resolve it against the entry and compare to the
// sibling Shortwind manages.
const SAFELIST_IMPORT_RE = /@import\s+["']([^"']*\.shortwind\.css)["']/g;

// Only formats a framework emits markup/scripts into. Sourcemaps embed the
// original source (raw tokens are expected there) and are excluded by not
// being listed; CSS never legitimately carries an @recipe token but Tailwind
// output is full of @media/@container at-rules, so it stays out too.
const OUTPUT_GLOB = "**/*.{html,htm,js,mjs,cjs,rsc}";

// Bundler caches (.next/cache, .vite cache dirs) store pre-transform source.
// .next/dev is the dev-server's output, not a production artifact — and its
// chunks inline framework internals (e.g. Next's own `{@link …}` JSDoc, which
// collides with the @link recipe), so scanning it produces phantom leaks (#91).
const OUTPUT_IGNORE = ["**/node_modules/**", "**/cache/**", "**/dev/**"];

export async function doctor(options: DoctorOptions): Promise<DoctorResult> {
  const cwd = path.resolve(options.cwd);
  const config = await readConfig(cwd);
  const recipesDir = path.join(cwd, config.recipesDir);
  const registry = loadRegistryLenient(recipesDir);

  // Independent of the build-output scan: do the installed recipes reference any
  // theme color token the project never defined? `bg-popover` with no
  // `--color-popover` expands fine but emits zero CSS — a green build + clean
  // token scan that still ships unstyled markup. Caught here regardless of build.
  const undefinedTokens = await findUndefinedThemeTokens(cwd, registry);

  // Independent of build output too: has the generated safelist import been
  // hand-edited to point at the wrong file? Self-healing re-adds the correct
  // import, but a mutated one it can't recognize lingers as a dead/broken
  // `@import` — surface it so the silent edge becomes visible.
  const staleSafelistImports = findStaleSafelistImports(cwd);

  const outputDirs = (options.dirs ?? DEFAULT_OUTPUT_DIRS).filter((d) =>
    existsSync(path.join(cwd, d)),
  );
  if (outputDirs.length === 0) {
    return {
      ok: false,
      verdict: "no-output",
      outputDirs: [],
      scannedFiles: 0,
      findings: [],
      usedInSource: [],
      undefinedTokens,
      staleSafelistImports,
    };
  }

  const files = await glob(
    outputDirs.map((d) => path.posix.join(d.split(path.sep).join("/"), OUTPUT_GLOB)),
    // dot: true so the ignore globs cross dot-segments — without it `**/dev/**`
    // and `**/cache/**` never match `.next/dev` / `.next/cache` (the leading
    // `**` won't span a dot dir), and those caches get scanned anyway (#91).
    { cwd, absolute: true, onlyFiles: true, dot: true, ignore: OUTPUT_IGNORE },
  );

  const findings: DoctorFinding[] = [];
  for (const file of files.sort()) {
    const code = await readFile(file, "utf8");
    const tokens = findResidualRecipeTokens(code, registry);
    if (tokens.length > 0) findings.push({ file, tokens });
  }

  const usedInSource = await scanSourceUsage(cwd, recipesDir, registry, options.content ?? config.content);

  let verdict: DoctorVerdict = "clean";
  if (findings.length > 0) {
    const raw = new Set(findings.flatMap((f) => f.tokens));
    verdict =
      usedInSource.length > 0 && usedInSource.every((t) => raw.has(t))
        ? "not-wired"
        : "leak";
  }

  return {
    ok: verdict === "clean" && undefinedTokens.length === 0 && staleSafelistImports.length === 0,
    verdict,
    outputDirs,
    scannedFiles: files.length,
    findings,
    usedInSource,
    undefinedTokens,
    staleSafelistImports,
  };
}

// Walk the Tailwind entry stylesheets and flag any `@import "….shortwind.css"`
// that doesn't resolve to the sibling Shortwind manages for that entry.
// Comparison is by resolved absolute path, so `./x.shortwind.css` and
// `x.shortwind.css` (same target) are treated as equal — only a genuinely
// different target is reported.
function findStaleSafelistImports(cwd: string): StaleSafelistImport[] {
  const stale: StaleSafelistImport[] = [];
  for (const entry of findTailwindEntryCssFiles(cwd)) {
    const expectedPath = safelistFilePathFor(entry);
    let css: string;
    try {
      css = readFileSync(entry, "utf8");
    } catch {
      continue;
    }
    for (const m of css.matchAll(SAFELIST_IMPORT_RE)) {
      const found = m[1] ?? "";
      const resolved = path.resolve(path.dirname(entry), found);
      if (resolved !== expectedPath) {
        stale.push({
          file: entry,
          found,
          expected: `./${path.basename(expectedPath)}`,
        });
      }
    }
  }
  return stale;
}

// Theme color tokens the installed recipes reference but the project's theme
// entry doesn't define. Empty when there's no theme entry to validate against.
async function findUndefinedThemeTokens(cwd: string, registry: Registry): Promise<string[]> {
  const themePath = await findThemeEntryCss(cwd);
  if (!themePath) return [];
  const css = await readFile(themePath, "utf8");
  return findMissingThemeTokens(css, registry.flattened);
}

// Doctor's job is scanning build output, not validating recipes — a registry
// that fails to resolve (cycle, unknown ref: lint's territory) must not stop
// the leak scan. Fall back to a name-only registry so known-token matching
// still works.
function loadRegistryLenient(recipesDir: string): Registry {
  const allRecipes: Recipe[] = [];
  for (const family of installedFamilies(recipesDir)) {
    const source = readFileSync(path.join(recipesDir, `${family}.css`), "utf8");
    const parsed = parseRecipeFile(source, `${family}.css`);
    if (parsed.ok) allRecipes.push(...parsed.value.recipes);
  }
  const built = buildRegistry(allRecipes);
  if (built.ok) return built.value;
  return {
    flattened: Object.fromEntries(allRecipes.map((r) => [r.name, []])),
    families: {},
  };
}

async function scanSourceUsage(
  cwd: string,
  recipesDir: string,
  registry: Registry,
  content: string[] | undefined,
): Promise<string[]> {
  // Same project-relative recipes ignore as lint (see lint.ts for why the
  // absolute form is unsafe with tinyglobby).
  const recipesIgnore = path.posix.join(
    path.relative(cwd, recipesDir).split(path.sep).join("/") || ".",
    "**",
  );
  const files = await glob(content ?? DEFAULT_CONTENT, {
    cwd,
    absolute: true,
    onlyFiles: true,
    ignore: ["**/node_modules/**", "**/dist/**", "**/.next/**", recipesIgnore],
  });
  const used = new Set<string>();
  for (const file of files) {
    const source = await readFile(file, "utf8");
    for (const usage of extractClassUsages(source)) {
      for (const token of usage.tokens) {
        if (!token.value.startsWith("@")) continue;
        if (Object.hasOwn(registry.flattened, token.value.slice(1))) used.add(token.value);
      }
    }
  }
  return [...used].sort();
}
