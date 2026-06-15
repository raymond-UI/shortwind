import { readdirSync, readFileSync, writeFileSync, rmSync, existsSync, type Dirent } from "node:fs";
import path from "node:path";
import {
  buildRegistry,
  expand,
  parseRecipeFile,
  type ExpandMode,
  type Recipe,
  type Registry,
} from "@shortwind/core";
import { transformJsxContent } from "./jsx-transform.js";

export type TransformOptions = {
  mode?: ExpandMode;
  mergeConflicts?: boolean;
  callExpanders?: readonly string[];
};

export type TailwindMajor = 3 | 4;

export class TailwindAdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TailwindAdapterError";
  }
}

export function transformContent(
  content: string,
  registry: Registry,
  options: TransformOptions = {},
): string {
  const mode = options.mode ?? "jsx";
  const mergeConflicts = options.mergeConflicts ?? true;
  if (mode === "jsx") {
    return transformJsxContent(content, registry, {
      mergeConflicts,
      callExpanders: options.callExpanders ?? ["cva", "tv"],
    });
  }
  return expand(content, registry, {
    mode,
    mergeConflicts,
    ...(options.callExpanders ? { callExpanders: options.callExpanders } : {}),
  });
}

// Diagnostic: after a transform, any *known* recipe name still sitting in a
// class/className value means the expander missed it (e.g. a recipe inside a
// dynamic className the static transform can't reach) — it won't render. We
// only flag names that are real recipes, so genuine Tailwind `@`-utilities like
// `@container` are never false-positived. Heuristic by design (a warning, not a
// hard error): the regex covers string, template-literal, and `{...}` class
// values, plus Astro's `class:list={...}` directive — all the shapes where the
// static transform can't reach a recipe and it silently ships as raw text.
// `class:list` is listed first so the longer attribute name wins the match.
const CLASS_VALUE_RE =
  /\b(?:class:list|class|className)\s*=\s*(?:(["'`])([\s\S]*?)\1|\{([\s\S]*?)\})/g;
const RECIPE_TOKEN_RE = /@[A-Za-z0-9][\w-]*/g;

export function findUnexpandedRecipes(code: string, registry: Registry): string[] {
  const known = registry.flattened;
  const found = new Set<string>();
  // Blank comments first (#92): a recipe named inside a `{/* @badge */}` JSX
  // comment within a className expression is documentation, not a leak.
  // Then the rc()/expandClassList exemption (#75): `class={rc("@nav-link")}`
  // is the documented runtime pattern.
  code = stripComments(code).replace(RUNTIME_EXPANDER_ARG_RE, "");
  for (const m of code.matchAll(CLASS_VALUE_RE)) {
    const value = m[2] ?? m[3] ?? "";
    for (const token of value.match(RECIPE_TOKEN_RE) ?? []) {
      if (known[token.slice(1)]) found.add(token);
    }
  }
  return [...found].sort();
}

// Strict-mode detector (#67): every known recipe name appearing as an
// `@<name>` token ANYWHERE in transformed output, not just inside class
// values. The class-value scan above misses the leak that bit every
// dogfooding build — a recipe assigned to a variable/prop, where the token
// sits at the assignment site (`const cfg = { recipe: "@badge" }`) and only
// reaches the attribute at runtime. Still keyed on known recipe names so
// Tailwind container-query variants (`@md:flex`) and unrelated `@`-mentions
// never false-positive. Comments are stripped first (#92) so a recipe named
// in prose — a JSDoc `{@link}` tag (which collides with the @link recipe) or a
// `/* uses @badge */` note — doesn't fail an otherwise-clean strict build.
export function findResidualRecipeTokens(code: string, registry: Registry): string[] {
  const known = registry.flattened;
  const found = new Set<string>();
  // A recipe handed to the documented runtime escape hatch is expanded at
  // RUNTIME by design — the literal surviving into build output is the
  // feature, not a leak. Blank those call arguments so strict mode and
  // rc()/expandClassList compose (#75). Comments go first (#92).
  const scannable = stripComments(code).replace(RUNTIME_EXPANDER_ARG_RE, "");
  for (const m of scannable.matchAll(RESIDUAL_TOKEN_RE)) {
    const token = m[0];
    if (Object.hasOwn(known, token.slice(1))) found.add(token);
  }
  return [...found].sort();
}

// Like RECIPE_TOKEN_RE, plus a lookbehind so an email-like `user@card.com`
// never reads as the recipe `@card`.
const RESIDUAL_TOKEN_RE = /(?<![\w.@-])@[A-Za-z0-9][\w-]*/g;

// String-literal first argument of the documented runtime expanders:
// `rc("@badge")` / `expandClassList("@badge", registry, true)`. Deliberately
// literal-only — a recipe reaching the call through a variable is still
// invisible to the build and stays flagged.
const RUNTIME_EXPANDER_ARG_RE = /\b(?:rc|expandClassList)\s*\(\s*(["'`])[^"'`\n]*\1/g;

// Blank comments so a recipe named in prose isn't read as a leak (#92): block
// comments cover `/* … */`, JSDoc `/** {@link foo} */`, and JSX `{/* … */}`;
// line comments are stripped only when not part of a `://` URL or escaped
// `\//`. Class strings never contain these, so real leaks are unaffected.
function stripComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(?<![:\\])\/\/[^\n]*/g, " ");
}

// One message for every adapter, so Vite/Next/Astro report leaks identically.
export function residualRecipeMessage(id: string, tokens: string[]): string {
  return (
    `[shortwind] ${id}: unexpanded recipe ${tokens.join(", ")} — the token never reached ` +
    `the expander as a literal class value (a className built from a variable/prop/template, ` +
    `or markup inside a region the expander treats as opaque, e.g. a <script> block); ` +
    `it will render as raw text. See https://shortwind.dev/docs/dynamic-classes`
  );
}

// Recipe expansions only ever appear in build-time-transformed JSX/HTML, which
// Tailwind v4's content scanner never reads — it walks files on disk. We hand
// Tailwind the bounded candidate set via `@source inline(...)`, its official
// safelist primitive for dynamic class generation. JIT still applies; we just
// add registry-derived candidates to the scan results.
export function computeSafelistTokens(registry: Registry): string[] {
  const set = new Set<string>();
  for (const tokens of Object.values(registry.flattened)) {
    // A double-quote would break out of the `@source inline("…")` string and
    // inject arbitrary CSS. buildRegistry already rejects such tokens, but a
    // registry assembled by other means might not have — drop them defensively.
    for (const t of tokens) if (!t.includes('"')) set.add(t);
  }
  return [...set].sort();
}

// Characters that can confuse `@source inline("…")` parsing: arbitrary values
// (`tracking-[0.2em]`), nested quotes (`before:content-['']`), backslashes.
// Tailwind 4.3 parses all of these inside one big directive, but the beta.11
// Astro dogfooding round (older v4 minor) saw a single such token silently
// kill every token AFTER it in the same directive string — looking like
// "variants don't work at all" with no error anywhere (#79).
const FRAGILE_TOKEN_RE = /[[\]'`\\]/;

export function buildSourceDirective(registry: Registry): string {
  const tokens = computeSafelistTokens(registry);
  if (tokens.length === 0) return "";
  // Plain tokens share one directive; each fragile token gets a directive of
  // its own, so a token Tailwind's inline-source parser chokes on can only
  // ever lose itself — never the tokens behind it (#79).
  const plain = tokens.filter((t) => !FRAGILE_TOKEN_RE.test(t));
  const fragile = tokens.filter((t) => FRAGILE_TOKEN_RE.test(t));
  const directives: string[] = [];
  if (plain.length > 0) directives.push(`@source inline("${plain.join(" ")}");`);
  for (const t of fragile) directives.push(`@source inline("${t}");`);
  return directives.join("\n");
}

export const SHORTWIND_INJECT_MARKER = "/* shortwind:source-inject:start */";
export const SHORTWIND_INJECT_END_MARKER = "/* shortwind:source-inject:end */";
// beta.11 wrote a single-line marker with no end delimiter, so an injected
// block could never be refreshed — a stale on-disk safelist would silently pin
// the candidate set forever (#74). Recognize the old marker (some dogfooding
// projects wrote it to disk via hand-rolled injectSourceDirective scripts) and
// leave such files alone rather than double-injecting.
const LEGACY_INJECT_MARKER = "/* shortwind:source-inject */";

const TAILWIND_IMPORT_RE = /@import\s+["']tailwindcss["'][^;\n]*;?/;

export function hasTailwindImport(css: string): boolean {
  return TAILWIND_IMPORT_RE.test(css);
}

// Upsert, not insert-once: when the CSS already carries an injected block the
// `body` is REPLACED if it changed, so callers can re-run this on every build
// (in-memory or on-disk) and the injected content always tracks recipes/. An
// empty `body` removes the block. Insertion lands right after the
// `@import "tailwindcss"` line so an injected `@import` stays above all plain
// rules — CSS requires `@import` to precede everything but `@charset`/`@layer`.
function upsertInjectedBlock(css: string, body: string): string {
  const start = css.indexOf(SHORTWIND_INJECT_MARKER);
  if (start !== -1) {
    const end = css.indexOf(SHORTWIND_INJECT_END_MARKER, start);
    if (end === -1) return css; // half a block — refuse to guess its boundary
    const blockEnd = end + SHORTWIND_INJECT_END_MARKER.length;
    if (!body.trim()) {
      // Nothing to inject — drop the whole block (markers and the surrounding
      // newlines the original insertion added) rather than leave an empty
      // `start`/`end` pair that does nothing but clutter the file.
      return css.slice(0, start).replace(/\n$/, "") + css.slice(blockEnd).replace(/^\n/, "");
    }
    const next = `${SHORTWIND_INJECT_MARKER}\n${body}\n${SHORTWIND_INJECT_END_MARKER}`;
    if (css.slice(start, blockEnd) === next) return css;
    return css.slice(0, start) + next + css.slice(blockEnd);
  }
  if (css.includes(LEGACY_INJECT_MARKER)) return css;
  if (!body.trim()) return css;
  const m = css.match(TAILWIND_IMPORT_RE);
  if (!m) return css;
  const insertAt = (m.index ?? 0) + m[0].length;
  return (
    css.slice(0, insertAt) +
    `\n${SHORTWIND_INJECT_MARKER}\n${body}\n${SHORTWIND_INJECT_END_MARKER}\n` +
    css.slice(insertAt)
  );
}

// In-memory injection (Vite/Astro): the `@source inline(...)` directives live
// directly in the served CSS string — nothing reaches disk, so there is no
// file to keep clean.
export function injectSourceDirective(css: string, registry: Registry): string {
  return upsertInjectedBlock(css, buildSourceDirective(registry));
}

// Build output and dependency directories that never hold the user's Tailwind
// entry CSS. Dot-directories (.next, .astro, .git, …) are skipped wholesale.
const ENTRY_SCAN_IGNORE = new Set([
  "node_modules",
  "dist",
  "build",
  "out",
  "coverage",
  "recipes",
]);
const ENTRY_SCAN_MAX_DEPTH = 6;

// Locate the Tailwind v4 entry stylesheets — every .css under cwd with an
// `@import "tailwindcss"` — for adapters that have no in-build CSS hook (Next:
// Tailwind reads the entry from disk via PostCSS/Turbopack, so the safelist
// must live ON disk; Vite-based adapters inject in-memory instead). Bounded
// depth keeps the walk cheap on big repos.
export function findTailwindEntryCssFiles(cwd: string): string[] {
  const found: string[] = [];
  const walk = (dir: string, depth: number): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth >= ENTRY_SCAN_MAX_DEPTH) continue;
        if (entry.name.startsWith(".") || ENTRY_SCAN_IGNORE.has(entry.name)) continue;
        walk(full, depth + 1);
      } else if (entry.name.endsWith(".css")) {
        try {
          if (hasTailwindImport(readFileSync(full, "utf8"))) found.push(full);
        } catch {
          // unreadable — not a usable entry
        }
      }
    }
  };
  walk(path.resolve(cwd), 0);
  return found.sort();
}

// The sibling safelist file for an entry stylesheet: `app/globals.css` →
// `app/globals.shortwind.css`. A SIBLING (not a `.shortwind/` dir) so the
// injected `@import` is always a flat `./name.css` — no `../` path math that
// breaks across nested entries, monorepos, or pnpm symlinks, and the file
// resolves relative to the entry that imports it.
export function safelistFilePathFor(cssPath: string): string {
  const dir = path.dirname(cssPath);
  const base = path.basename(cssPath, ".css");
  return path.join(dir, `${base}.shortwind.css`);
}

const SAFELIST_FILE_HEADER =
  "/* shortwind:generated — recipe-utility safelist. Regenerated on every build/dev and committed,\n" +
  "   so a fresh clone renders styled before the first build runs. Do not edit by hand. */";

// Full contents of the sibling safelist file, or "" when there are no tokens
// (caller deletes the file and drops the import).
export function buildSafelistFile(registry: Registry): string {
  const directive = buildSourceDirective(registry);
  if (!directive) return "";
  return `${SAFELIST_FILE_HEADER}\n${directive}\n`;
}

// Drop a legacy marker-wrapped block (and the surrounding newlines the
// original insertion added) wholesale — used to migrate entries written by
// earlier versions, which guarded the injected content with start/end markers
// (the inline `@source` block, or the marker-wrapped `@import`). Nothing on
// disk carries markers anymore; the disk path injects a bare import instead.
function stripMarkerBlock(css: string): string {
  const start = css.indexOf(SHORTWIND_INJECT_MARKER);
  if (start === -1) return css;
  const end = css.indexOf(SHORTWIND_INJECT_END_MARKER, start);
  if (end === -1) return css; // half a block — refuse to guess its boundary
  const blockEnd = end + SHORTWIND_INJECT_END_MARKER.length;
  return css.slice(0, start).replace(/\n$/, "") + css.slice(blockEnd).replace(/^\n/, "");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Insert / refresh / remove the single managed `@import "<spec>";` line in an
// entry stylesheet. No marker comments: the import is deterministic (its path
// is derived from the entry's own name), so we locate our own line by matching
// the import itself — anything shortwind manages can be found, updated, and
// removed without leaving bookkeeping comments in the file the user edits.
function upsertImportLine(css: string, importSpec: string, present: boolean): string {
  // Refuse to touch a file carrying the old single-line marker (no end
  // delimiter to bound) — same caution the marker path always took.
  if (css.includes(LEGACY_INJECT_MARKER)) return css;
  // Migrate away any marker-wrapped block, then strip any existing managed
  // import so re-runs don't duplicate it and an emptied registry drops it.
  let out = stripMarkerBlock(css);
  const lineRe = new RegExp(`\\n?[ \\t]*@import\\s+["']${escapeRegExp(importSpec)}["']\\s*;?[ \\t]*`);
  out = out.replace(lineRe, "");
  if (!present) return out;
  const m = out.match(TAILWIND_IMPORT_RE);
  if (!m) return out; // no `@import "tailwindcss"` to anchor to — leave alone
  const insertAt = (m.index ?? 0) + m[0].length;
  // Set the import on its own line and leave a blank line before the user's
  // content (collapsing any leading blank lines that already followed the
  // Tailwind import to exactly one). At end-of-file there's nothing to
  // separate from, so no trailing blank line is added.
  const rest = out.slice(insertAt).replace(/^(?:[ \t]*\n)+/, "");
  const separator = rest === "" ? "\n" : "\n\n";
  return out.slice(0, insertAt) + `\n@import "${importSpec}";` + separator + rest;
}

// On-disk safelist for adapters where Tailwind reads the entry CSS FROM DISK
// (Next, bare Tailwind CLI) and has no in-build CSS hook. Instead of injecting
// the (often dozens of lines) `@source inline(...)` block straight into the
// user's stylesheet, write it to a sibling `*.shortwind.css` and add a single
// bare `@import` to the entry — keeping the file the user actually edits down
// to one managed line, no marker comments. Verified: Tailwind v4 honors
// `@source inline(...)` reached through an `@import`. Idempotent and
// self-migrating — an entry still carrying the old marker block (inline
// `@source` or marker-wrapped import) has it collapsed to the bare import on
// the next run. Returns whether anything changed.
export function syncSafelistFile(cssPath: string, registry: Registry): boolean {
  const css = readFileSync(cssPath, "utf8");
  const safelistPath = safelistFilePathFor(cssPath);
  const fileContent = buildSafelistFile(registry);
  let changed = false;

  if (fileContent) {
    const existing = existsSync(safelistPath) ? readFileSync(safelistPath, "utf8") : null;
    if (existing !== fileContent) {
      writeFileSync(safelistPath, fileContent);
      changed = true;
    }
  } else if (existsSync(safelistPath)) {
    // Registry emptied out (every recipe removed) — don't leave a stale,
    // orphaned safelist next to the entry.
    rmSync(safelistPath);
    changed = true;
  }

  const next = upsertImportLine(css, `./${path.basename(safelistPath)}`, Boolean(fileContent));
  if (next !== css) {
    writeFileSync(cssPath, next);
    changed = true;
  }
  return changed;
}

// Single source of truth for the html-vs-jsx decision, shared by every adapter
// (vite/next/cli) so they can't drift. Real JSX/TSX (and MD/MDX, which compile
// to JSX) use `className` and parse with the JSX AST transform; template
// formats (.astro/.vue/.svelte) and .html are HTML-shaped (`class=`, not valid
// JSX) and go through the regex html-mode expander.
const JSX_LIKE_EXTS = new Set(["ts", "tsx", "js", "jsx", "md", "mdx"]);

export function modeForFile(filePath: string): ExpandMode {
  const ext = path.extname(filePath.split("?")[0] ?? filePath).slice(1).toLowerCase();
  return JSX_LIKE_EXTS.has(ext) ? "jsx" : "html";
}

// Single source of truth for "which files in this dir are recipes" — the
// sorted absolute paths of every `.css` file. Used by loadRegistryFromDir and
// by the adapters' change-watchers so they agree on the recipe set.
export function listRecipeFiles(recipesDir: string): string[] {
  if (!existsSync(recipesDir)) return [];
  return readdirSync(recipesDir)
    .filter((f) => f.endsWith(".css"))
    .sort()
    .map((f) => path.join(recipesDir, f));
}

export function loadRegistryFromDir(recipesDir: string): Registry {
  if (!existsSync(recipesDir)) return { families: {}, flattened: {} };
  const recipes: Recipe[] = [];
  for (const filePath of listRecipeFiles(recipesDir)) {
    const file = path.basename(filePath);
    const source = readFileSync(filePath, "utf8");
    const parsed = parseRecipeFile(source, file);
    if (!parsed.ok) {
      throw new TailwindAdapterError(
        `Failed to parse ${file}: ${parsed.errors.map((e) => e.message).join("; ")}`,
      );
    }
    recipes.push(...parsed.value.recipes);
  }
  const result = buildRegistry(recipes);
  if (!result.ok) {
    throw new TailwindAdapterError(
      `Failed to resolve recipes: ${result.errors.map((e) => e.message).join("; ")}`,
    );
  }
  return result.value;
}

export function detectTailwindMajor(cwd: string): TailwindMajor | null {
  const pkgPath = path.join(cwd, "package.json");
  if (!existsSync(pkgPath)) return null;
  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try {
    pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  } catch {
    return null;
  }
  const range =
    pkg.dependencies?.["tailwindcss"] ?? pkg.devDependencies?.["tailwindcss"] ?? null;
  if (!range) return null;
  // tailwindcss is declared but pinned with a non-semver range we can't read
  // a major out of (e.g. "latest", "workspace:*", or "npm:tw-fork@*"). Silently
  // returning null would surface the misleading "tailwindcss not found" error;
  // throw so the user fixes the range explicitly.
  const m = range.match(/(\d+)/);
  if (!m) {
    throw new TailwindAdapterError(
      `tailwindcss is declared as "${range}" — pin a numeric major (^3 or ^4) so Shortwind can pick the right adapter.`,
    );
  }
  const major = Number(m[1]);
  if (major === 3) return 3;
  if (major === 4) return 4;
  throw new TailwindAdapterError(
    `tailwindcss major ${major} is not supported. Shortwind supports Tailwind v3 and v4.`,
  );
}

export type ShortwindPluginOptions = {
  recipesDir?: string;
  cwd?: string;
};

export type ShortwindV3Plugin = {
  major: 3;
  content: { transform: Record<string, (content: string) => string> };
  transform: (content: string) => string;
};

// Tailwind v4 collects utilities by parsing source files directly; it does not
// invoke a JS plugin handler the way v3 did. Shortwind expands `@recipe` tokens
// upstream of Tailwind's scan via the Vite/Next adapters (which call
// `transform` on each source file). The `handler` field is kept as a no-op so
// the returned object satisfies the v4 Plugin shape without claiming behavior
// it doesn't deliver — users should not depend on it doing anything.
export type ShortwindV4Plugin = {
  major: 4;
  handler: () => void;
  transform: (content: string) => string;
};

export function shortwindPlugin(
  options: ShortwindPluginOptions = {},
): ShortwindV3Plugin | ShortwindV4Plugin {
  const cwd = options.cwd ?? process.cwd();
  const recipesDir = options.recipesDir ?? path.join(cwd, "recipes");
  const major = detectTailwindMajor(cwd);
  if (major === null) {
    throw new TailwindAdapterError(
      "tailwindcss not found in package.json. Install with `npm install -D tailwindcss` (v3 or v4).",
    );
  }
  const registry = loadRegistryFromDir(recipesDir);
  const transform = (content: string): string => transformContent(content, registry);

  if (major === 3) {
    const exts = ["html", "js", "jsx", "ts", "tsx", "vue", "svelte", "astro", "md", "mdx"];
    const transforms: Record<string, (c: string) => string> = {};
    for (const ext of exts) transforms[ext] = transform;
    return { major: 3, content: { transform: transforms }, transform };
  }
  return { major: 4, handler: () => {}, transform };
}

export function shortwindV3Content(
  files: string[],
  options: ShortwindPluginOptions = {},
): { files: string[]; transform: Record<string, (c: string) => string> } {
  const plugin = shortwindPlugin(options);
  if (plugin.major !== 3) {
    throw new TailwindAdapterError(
      "shortwindV3Content is only valid in a Tailwind v3 project. Use the v4 plugin form instead.",
    );
  }
  return { files, transform: plugin.content.transform };
}
