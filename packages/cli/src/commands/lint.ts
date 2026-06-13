import { readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { glob } from "tinyglobby";
import { buildRegistry, isReservedRecipeName, looksLikeRecipeToken, parseRecipeFile } from "@shortwind/core";
import type { Recipe, Registry } from "@shortwind/core";
import { installedFamilies, readConfig } from "../project.js";

export const ALL_RULES = [
  "recipe/unknown",
  "recipe/cycle",
  "recipe/duplicate",
  "recipe/unused",
  "recipe/no-redundant-utility",
  "recipe/bad-suffix-order",
  "recipe/conflicting-intent",
  "recipe/dynamic-class",
  "recipe/no-sibling-overlap",
  "recipe/reserved-name",
] as const;

export type Rule = (typeof ALL_RULES)[number];

export type Severity = "error" | "warning" | "info";

export type Finding = {
  rule: Rule;
  severity: Severity;
  file: string;
  line: number;
  column: number;
  message: string;
};

export type LintOptions = {
  cwd: string;
  rules?: Rule[];
  fix?: boolean;
  content?: string[];
};

export type LintResult = {
  ok: boolean;
  findings: Finding[];
  filesFixed: string[];
  // How many files the content scan actually matched. Zero means usage-based
  // rules (recipe/unused in particular) had no evidence to work from — the
  // CLI surfaces that instead of letting an empty scan masquerade as "no
  // recipe is referenced anywhere".
  scannedFiles: number;
};

// Cover the common framework layouts, not just `src/**`: a default
// create-next-app App Router project keeps sources in root-level `app/`
// (plus `components/`, `lib/`), and Pages Router uses root `pages/` (#83).
// Project-specific layouts go in `shortwind.config.json` ("content") or
// `--content`.
export const DEFAULT_CONTENT = [
  "{src,app,pages,components,lib}/**/*.{html,js,jsx,ts,tsx,vue,svelte,astro,md,mdx}",
];

export async function lint(options: LintOptions): Promise<LintResult> {
  const cwd = path.resolve(options.cwd);
  const config = await readConfig(cwd);
  const recipesDir = path.join(cwd, config.recipesDir);
  const enabledRules = new Set<Rule>(options.rules ?? ALL_RULES);
  const findings: Finding[] = [];

  const { registry, parseFindings } = loadRegistry(recipesDir, enabledRules);
  findings.push(...parseFindings);
  findings.push(...checkRecipeNames(registry, recipesDir, enabledRules));
  findings.push(...checkReservedNames(registry, recipesDir, enabledRules));

  const contentGlobs = options.content ?? config.content ?? DEFAULT_CONTENT;
  // tinyglobby evaluates ignore patterns relative to `cwd`; an absolute
  // recipesDir path passed verbatim would either fail to match or match by
  // accident on case-folded filesystems. Use the project-relative form.
  const recipesIgnore = path.posix.join(
    path.relative(cwd, recipesDir).split(path.sep).join("/") || ".",
    "**",
  );
  const files = await glob(contentGlobs, {
    cwd,
    absolute: true,
    onlyFiles: true,
    ignore: ["**/node_modules/**", "**/dist/**", "**/.next/**", recipesIgnore],
  });

  const usedRecipes = new Set<string>();
  const filesFixed: string[] = [];

  for (const file of files) {
    const source = await readFile(file, "utf8");
    const usages = extractClassUsages(source);
    for (const u of usages) {
      for (const token of u.tokens) {
        if (!token.value.startsWith("@")) continue;
        const name = token.value.slice(1);
        // `Object.hasOwn`, never a truthy lookup: a token like `@constructor`
        // would otherwise resolve an inherited Object.prototype member and be
        // silently treated as a known recipe instead of flagged unknown.
        if (Object.hasOwn(registry.flattened, name)) usedRecipes.add(name);
        // Only flag tokens shaped like a recipe reference; Tailwind v4's own
        // `@`-utilities (`@container`, `@md:flex`, `@min-[400px]:grid`) are not
        // unknown recipes (shared with the editor plugin's diagnostic).
        else if (enabledRules.has("recipe/unknown") && looksLikeRecipeToken(token.value)) {
          findings.push({
            rule: "recipe/unknown",
            severity: "error",
            file,
            line: token.line,
            column: token.column,
            message: `unknown recipe @${name}`,
          });
        }
      }
      if (enabledRules.has("recipe/bad-suffix-order")) {
        findings.push(...checkUsageSuffixOrder(file, u.tokens, registry));
      }
      if (enabledRules.has("recipe/conflicting-intent")) {
        findings.push(...checkConflictingIntent(file, u.tokens, registry));
      }
      if (enabledRules.has("recipe/no-sibling-overlap")) {
        findings.push(...checkSiblingOverlap(file, u.tokens, registry));
      }
      if (enabledRules.has("recipe/dynamic-class")) {
        findings.push(...checkDynamicClass(file, u.dynamicTokens));
      }
    }

    if (enabledRules.has("recipe/no-redundant-utility")) {
      const result = checkRedundantUtility(file, source, registry, options.fix === true);
      findings.push(...result.findings);
      if (options.fix && result.fixed !== null && result.fixed !== source) {
        await writeFile(file, result.fixed);
        filesFixed.push(file);
      }
    }
  }

  // An empty scan carries no usage evidence; reporting every recipe as
  // unused from it would always be wrong (#83). The caller sees
  // scannedFiles === 0 and can tell the user to fix the content globs.
  if (enabledRules.has("recipe/unused") && files.length > 0) {
    const recipesByName = new Map<string, Recipe>();
    for (const recs of Object.values(registry.families)) {
      for (const r of recs) recipesByName.set(r.name, r);
    }
    for (const name of Object.keys(registry.flattened)) {
      if (usedRecipes.has(name)) continue;
      const recipe = recipesByName.get(name);
      if (!recipe) continue;
      findings.push({
        rule: "recipe/unused",
        severity: "info",
        file: path.join(recipesDir, recipe.sourceFile),
        line: recipe.sourceLine,
        column: 1,
        message: `recipe @${name} is defined but never referenced`,
      });
    }
  }

  findings.sort((a, b) => {
    if (a.file !== b.file) return a.file.localeCompare(b.file);
    if (a.line !== b.line) return a.line - b.line;
    return a.column - b.column;
  });

  const ok = !findings.some((f) => f.severity === "error");
  return { ok, findings, filesFixed, scannedFiles: files.length };
}

function loadRegistry(
  recipesDir: string,
  rules: Set<Rule>,
): { registry: Registry; parseFindings: Finding[] } {
  const families = installedFamilies(recipesDir);
  const allRecipes: Recipe[] = [];
  const parseFindings: Finding[] = [];

  for (const family of families) {
    const filePath = path.join(recipesDir, `${family}.css`);
    const source = readFileSync(filePath, "utf8");
    const parsed = parseRecipeFile(source, `${family}.css`);
    if (!parsed.ok) {
      for (const err of parsed.errors) {
        parseFindings.push({
          rule: "recipe/unknown",
          severity: "error",
          file: filePath,
          line: err.line,
          column: err.column ?? 1,
          message: err.message,
        });
      }
      continue;
    }
    for (const r of parsed.value.recipes) allRecipes.push(r);
  }

  const built = buildRegistry(allRecipes);
  if (!built.ok) {
    for (const err of built.errors) {
      const rule = mapErrorCodeToRule(err.code);
      if (!rules.has(rule)) continue;
      parseFindings.push({
        rule,
        severity: "error",
        file: path.join(recipesDir, err.file),
        line: err.line,
        column: err.column ?? 1,
        message: err.message,
      });
    }
    return { registry: { flattened: {}, families: {} }, parseFindings };
  }
  return { registry: built.value, parseFindings };
}

// Explicit table from core's diagnostic codes to lint rules. Keeps the
// mapping debuggable and prevents a typo in `err.code` from silently being
// classified as `recipe/unknown`.
const ERROR_CODE_RULE: Record<string, Rule> = {
  "resolve/cycle": "recipe/cycle",
  "resolve/duplicate-name": "recipe/duplicate",
  "resolve/unknown-reference": "recipe/unknown",
};

function mapErrorCodeToRule(code: string): Rule {
  return ERROR_CODE_RULE[code] ?? "recipe/unknown";
}

const SIZE_SUFFIXES = new Set(["xs", "sm", "md", "lg", "xl"]);
const INTENT_SUFFIXES = new Set([
  "primary",
  "secondary",
  "ghost",
  "danger",
  "warning",
  "success",
  "info",
]);

function recipeMeta(name: string, familyHint?: string): {
  family: string;
  intent: string | null;
  badOrder: string | null;
} {
  const family =
    familyHint && (name === familyHint || name.startsWith(`${familyHint}-`))
      ? familyHint
      : name.split("-")[0] ?? name;
  const suffix =
    name === family ? [] : name.slice(family.length + 1).split("-").filter(Boolean);
  let intent: string | null = null;
  let firstSizeIdx = -1;
  let laterIntentIdx = -1;

  for (let i = 0; i < suffix.length; i++) {
    const part = suffix[i] ?? "";
    if (SIZE_SUFFIXES.has(part)) {
      if (firstSizeIdx === -1) firstSizeIdx = i;
    }
    if (INTENT_SUFFIXES.has(part)) {
      intent ??= part;
      if (firstSizeIdx !== -1) laterIntentIdx = i;
    }
  }

  let badOrder: string | null = null;
  if (firstSizeIdx !== -1 && laterIntentIdx !== -1) {
    const reordered = [
      family,
      ...suffix.filter((p) => INTENT_SUFFIXES.has(p)),
      ...suffix.filter((p) => !INTENT_SUFFIXES.has(p) && !SIZE_SUFFIXES.has(p)),
      ...suffix.filter((p) => SIZE_SUFFIXES.has(p)),
    ];
    badOrder = reordered.join("-");
  }

  return { family, intent, badOrder };
}

function checkRecipeNames(
  registry: Registry,
  recipesDir: string,
  enabledRules: Set<Rule>,
): Finding[] {
  if (!enabledRules.has("recipe/bad-suffix-order")) return [];
  const findings: Finding[] = [];
  for (const [family, recipes] of Object.entries(registry.families)) {
    for (const recipe of recipes) {
      const meta = recipeMeta(recipe.name, family);
      if (!meta.badOrder) continue;
      findings.push({
        rule: "recipe/bad-suffix-order",
        severity: "warning",
        file: path.join(recipesDir, recipe.sourceFile),
        line: recipe.sourceLine,
        column: 1,
        message: `recipe @${recipe.name} uses size before intent; prefer @${meta.badOrder}`,
      });
    }
  }
  return findings;
}

function checkReservedNames(
  registry: Registry,
  recipesDir: string,
  enabledRules: Set<Rule>,
): Finding[] {
  if (!enabledRules.has("recipe/reserved-name")) return [];
  const findings: Finding[] = [];
  for (const recipes of Object.values(registry.families)) {
    for (const recipe of recipes) {
      if (!isReservedRecipeName(recipe.name)) continue;
      findings.push({
        rule: "recipe/reserved-name",
        severity: "error",
        file: path.join(recipesDir, recipe.sourceFile),
        line: recipe.sourceLine,
        column: 1,
        message: `recipe @${recipe.name} collides with a reserved Tailwind @-utility; rename it`,
      });
    }
  }
  return findings;
}

function checkUsageSuffixOrder(
  file: string,
  tokens: ClassUsage["tokens"],
  registry: Registry,
): Finding[] {
  const findings: Finding[] = [];
  for (const token of tokens) {
    if (!token.value.startsWith("@")) continue;
    const name = token.value.slice(1);
    if (!Object.hasOwn(registry.flattened, name)) continue;
    const meta = recipeMeta(name, familyForRecipe(registry, name));
    if (!meta.badOrder) continue;
    findings.push({
      rule: "recipe/bad-suffix-order",
      severity: "warning",
      file,
      line: token.line,
      column: token.column,
      message: `@${name} uses size before intent; prefer @${meta.badOrder}`,
    });
  }
  return findings;
}

function checkConflictingIntent(
  file: string,
  tokens: ClassUsage["tokens"],
  registry: Registry,
): Finding[] {
  const byFamily = new Map<
    string,
    Map<string, { token: ClassUsage["tokens"][number]; name: string }>
  >();
  for (const token of tokens) {
    if (!token.value.startsWith("@")) continue;
    const name = token.value.slice(1);
    if (!Object.hasOwn(registry.flattened, name)) continue;
    const meta = recipeMeta(name, familyForRecipe(registry, name));
    if (!meta.intent) continue;
    const familyIntents =
      byFamily.get(meta.family) ??
      new Map<string, { token: ClassUsage["tokens"][number]; name: string }>();
    familyIntents.set(meta.intent, { token, name });
    byFamily.set(meta.family, familyIntents);
  }

  const findings: Finding[] = [];
  for (const [family, intents] of byFamily) {
    if (intents.size < 2) continue;
    const intentNames = Array.from(intents.values())
      .map((entry) => `@${entry.name}`)
      .sort();
    const first = Array.from(intents.values())
      .map((entry) => entry.token)
      .sort((a, b) => a.column - b.column)[0]!;
    findings.push({
      rule: "recipe/conflicting-intent",
      severity: "warning",
      file,
      line: first.line,
      column: first.column,
      message: `multiple ${family} intents on one element: ${intentNames.join(", ")}`,
    });
  }
  return findings;
}

function familyForRecipe(registry: Registry, name: string): string | undefined {
  for (const [family, recipes] of Object.entries(registry.families)) {
    if (recipes.some((recipe) => recipe.name === name)) return family;
  }
  return undefined;
}

function checkSiblingOverlap(
  file: string,
  tokens: ClassUsage["tokens"],
  registry: Registry,
): Finding[] {
  const byFamily = new Map<string, Array<{ token: ClassUsage["tokens"][number]; name: string }>>();
  for (const token of tokens) {
    if (!token.value.startsWith("@")) continue;
    const name = token.value.slice(1);
    if (!Object.hasOwn(registry.flattened, name)) continue;
    const family = familyForRecipe(registry, name) ?? name.split("-")[0] ?? name;
    const arr = byFamily.get(family) ?? [];
    arr.push({ token, name });
    byFamily.set(family, arr);
  }

  const findings: Finding[] = [];
  for (const [family, entries] of byFamily) {
    const unique = new Set(entries.map((e) => e.name));
    if (unique.size < 2) continue;
    const first = entries.map((e) => e.token).sort((a, b) => a.column - b.column)[0]!;
    const names = Array.from(unique).map((n) => `@${n}`).sort();
    findings.push({
      rule: "recipe/no-sibling-overlap",
      severity: "warning",
      file,
      line: first.line,
      column: first.column,
      message: `multiple ${family} recipes on one element: ${names.join(", ")}`,
    });
  }
  return findings;
}

// Dynamic recipe names defeat unknown-reference checking and the safelist
// pass — Tailwind never sees the computed token, so the recipe's expanded
// utilities won't appear in the bundle unless they're already in another file.
function checkDynamicClass(
  file: string,
  dynamicTokens: ClassUsage["dynamicTokens"],
): Finding[] {
  const findings: Finding[] = [];
  for (const token of dynamicTokens) {
    if (!token.value.includes("@")) continue;
    findings.push({
      rule: "recipe/dynamic-class",
      severity: "warning",
      file,
      line: token.line,
      column: token.column,
      message: `dynamic recipe name ${token.value} — Tailwind cannot statically resolve this`,
    });
  }
  return findings;
}

type ClassUsage = {
  fileOffset: number;
  // Exact source offset of the first character inside the attribute value
  // (just past the opening quote). raw.length characters from here is the
  // closing quote. Used by the auto-fix writer; indexOf-based location
  // hunting is unsafe because two attributes can share the same raw text.
  valueStart: number;
  raw: string;
  tokens: Array<{ value: string; line: number; column: number }>;
  // Tokens that contain a `${...}` interpolation. Surfaced separately so the
  // dynamic-class rule can flag computed recipe names while the normal token
  // pipeline still treats them as opaque.
  dynamicTokens: Array<{ value: string; line: number; column: number }>;
  // Only string-literal attribute values can be auto-fixed in place;
  // JSX expression containers (className={...}) may wrap clsx() / template
  // literals where blind substring writes would be unsafe.
  fixable: boolean;
};

const CLASS_ATTR_STR_RE = /\b(?:class|className)\s*=\s*(["'])([^"']*)\1/g;
const CLASS_ATTR_BRACE_RE = /\b(?:class|className)\s*=\s*\{/g;
const STRING_LITERAL_RE = /(["'`])((?:\\.|(?!\1)[^\\])*)\1/g;
// The build's jsx-transform expands recipes inside variant-authoring calls
// (cva/tv), not just className attributes. Lint must see those too, or recipes
// referenced only from a `cva(...)` get falsely reported as recipe/unused.
const CALL_EXPANDER_RE = /\b(?:cva|tv)\s*\(/g;

export function extractClassUsages(source: string): ClassUsage[] {
  const usages: ClassUsage[] = [];
  for (const m of source.matchAll(CLASS_ATTR_STR_RE)) {
    const value = m[2] ?? "";
    const attrStart = m.index ?? 0;
    const valueStart = attrStart + m[0]!.length - 1 - value.length;
    const { tokens, dynamicTokens } = tokenizeClassString(source, value, valueStart);
    usages.push({
      fileOffset: attrStart,
      valueStart,
      raw: value,
      tokens,
      dynamicTokens,
      fixable: true,
    });
  }

  for (const m of source.matchAll(CLASS_ATTR_BRACE_RE)) {
    const openBrace = (m.index ?? 0) + m[0]!.length - 1;
    const close = findMatchingBrace(source, openBrace);
    if (close === -1) continue;
    const inner = source.slice(openBrace + 1, close);
    for (const sm of inner.matchAll(STRING_LITERAL_RE)) {
      const value = sm[2] ?? "";
      if (value.length === 0) continue;
      const literalStart = openBrace + 1 + (sm.index ?? 0);
      const valueStart = literalStart + 1;
      const { tokens, dynamicTokens } = tokenizeClassString(source, value, valueStart);
      if (tokens.length === 0 && dynamicTokens.length === 0) continue;
      usages.push({
        fileOffset: literalStart,
        valueStart,
        raw: value,
        tokens,
        dynamicTokens,
        fixable: false,
      });
    }
  }

  for (const m of source.matchAll(CALL_EXPANDER_RE)) {
    const openParen = (m.index ?? 0) + m[0]!.length - 1;
    const close = findMatchingDelimiter(source, openParen, "(", ")");
    if (close === -1) continue;
    const inner = source.slice(openParen + 1, close);
    for (const sm of inner.matchAll(STRING_LITERAL_RE)) {
      const value = sm[2] ?? "";
      if (value.length === 0) continue;
      const literalStart = openParen + 1 + (sm.index ?? 0);
      const valueStart = literalStart + 1;
      const { tokens, dynamicTokens } = tokenizeClassString(source, value, valueStart);
      // Only string args that actually reference a recipe matter here; plain
      // utility strings in cva (the common case) carry no @-tokens and are
      // ignored so we don't widen unrelated rules.
      if (!tokens.some((t) => t.value.startsWith("@")) && dynamicTokens.length === 0) continue;
      usages.push({
        fileOffset: literalStart,
        valueStart,
        raw: value,
        tokens,
        dynamicTokens,
        fixable: false,
      });
    }
  }

  return usages;
}

function tokenizeClassString(
  source: string,
  value: string,
  valueStart: number,
): {
  tokens: Array<{ value: string; line: number; column: number }>;
  dynamicTokens: Array<{ value: string; line: number; column: number }>;
} {
  const tokens: Array<{ value: string; line: number; column: number }> = [];
  const dynamicTokens: Array<{ value: string; line: number; column: number }> = [];
  let offset = 0;
  for (const piece of value.split(/(\s+)/)) {
    if (/^\s+$/.test(piece) || piece.length === 0) {
      offset += piece.length;
      continue;
    }
    const abs = valueStart + offset;
    const { line, column } = offsetToLineCol(source, abs);
    // Tokens containing `${...}` are opaque to the normal pipeline (no merge,
    // no unknown-reference check) but still surfaced separately so the
    // dynamic-class rule can warn on computed recipe names.
    if (piece.includes("${")) {
      dynamicTokens.push({ value: piece, line, column });
      offset += piece.length;
      continue;
    }
    tokens.push({ value: piece, line, column });
    offset += piece.length;
  }
  return { tokens, dynamicTokens };
}

function findMatchingBrace(source: string, openIdx: number): number {
  return findMatchingDelimiter(source, openIdx, "{", "}");
}

// Remove only the redundant tokens from the original attribute value, leaving
// every other character — interior whitespace/newlines AND `${...}` dynamic
// tokens — exactly as written. Rebuilding via `tokens.join(" ")` instead would
// delete dynamic tokens (they're tracked separately) and collapse whitespace in
// attributes that had nothing to fix.
function spliceRedundantTokens(raw: string, isRedundant: (token: string) => boolean): string {
  const pieces = raw.split(/(\s+)/); // alternating content / whitespace runs
  const drop = new Array<boolean>(pieces.length).fill(false);
  for (let i = 0; i < pieces.length; i++) {
    const piece = pieces[i] ?? "";
    if (piece.length === 0 || /^\s+$/.test(piece)) continue;
    if (piece.startsWith("@") || piece.includes("${")) continue; // never touch recipes/dynamic
    if (!isRedundant(piece)) continue;
    drop[i] = true;
    // Also drop one adjacent whitespace run so removing a token doesn't leave a
    // double gap; prefer the leading run (collapses cleanly against the
    // preceding token), fall back to the trailing one for a leading token.
    if (i > 0 && /^\s+$/.test(pieces[i - 1] ?? "")) drop[i - 1] = true;
    else if (/^\s+$/.test(pieces[i + 1] ?? "")) drop[i + 1] = true;
  }
  return pieces.filter((_, i) => !drop[i]).join("");
}

// Walks past the opening delimiter at openIdx to its match, skipping over
// string and template-literal contents (and nested `${...}` interpolations,
// which always use braces regardless of the outer delimiter).
function findMatchingDelimiter(
  source: string,
  openIdx: number,
  open: string,
  close: string,
): number {
  let depth = 1;
  let i = openIdx + 1;
  while (i < source.length && depth > 0) {
    const ch = source[i];
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i++;
      while (i < source.length) {
        if (source[i] === "\\") {
          i += 2;
          continue;
        }
        if (source[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (ch === "`") {
      i++;
      while (i < source.length) {
        if (source[i] === "\\") {
          i += 2;
          continue;
        }
        if (source[i] === "`") {
          i++;
          break;
        }
        if (source[i] === "$" && source[i + 1] === "{") {
          i += 2;
          let exprDepth = 1;
          while (i < source.length && exprDepth > 0) {
            if (source[i] === "{") exprDepth++;
            else if (source[i] === "}") exprDepth--;
            i++;
          }
          continue;
        }
        i++;
      }
      continue;
    }
    if (ch === open) depth++;
    else if (ch === close) depth--;
    i++;
  }
  return depth === 0 ? i - 1 : -1;
}

function offsetToLineCol(source: string, offset: number): { line: number; column: number } {
  const limit = Math.min(offset, source.length);
  let line = 1;
  let lastNl = -1;
  for (let i = 0; i < limit; i++) {
    if (source[i] === "\n") {
      line++;
      lastNl = i;
    }
  }
  return { line, column: offset - lastNl };
}

function checkRedundantUtility(
  file: string,
  source: string,
  registry: Registry,
  applyFix: boolean,
): { findings: Finding[]; fixed: string | null } {
  const findings: Finding[] = [];
  let fixed: string | null = applyFix ? "" : null;
  let cursor = 0;
  const usages = extractClassUsages(source).sort((a, b) => a.fileOffset - b.fileOffset);
  for (const usage of usages) {
    const expansions = new Set<string>();
    for (const tok of usage.tokens) {
      if (!tok.value.startsWith("@")) continue;
      const exp = registry.flattened[tok.value.slice(1)];
      if (!exp) continue;
      for (const t of exp) expansions.add(t);
    }
    if (expansions.size === 0) continue;

    for (const tok of usage.tokens) {
      if (!tok.value.startsWith("@") && expansions.has(tok.value)) {
        findings.push({
          rule: "recipe/no-redundant-utility",
          severity: "info",
          file,
          line: tok.line,
          column: tok.column,
          message: `${tok.value} is already included by a recipe on this element`,
        });
      }
    }

    if (fixed !== null && usage.fixable) {
      // valueStart is the exact offset of the first content char (just past
      // the opening quote); raw.length is the content length. Splice out only
      // the redundant tokens so dynamic tokens and whitespace survive verbatim.
      if (usage.valueStart < cursor) continue;
      fixed += source.slice(cursor, usage.valueStart);
      fixed += spliceRedundantTokens(usage.raw, (t) => expansions.has(t));
      cursor = usage.valueStart + usage.raw.length;
    }
  }
  if (fixed !== null) fixed += source.slice(cursor);
  return { findings, fixed };
}

export function formatFindingsText(findings: Finding[]): string {
  if (findings.length === 0) return "";
  return findings
    .map(
      (f) =>
        `${f.file}:${f.line}:${f.column} ${f.severity}  ${f.message}  [${f.rule}]`,
    )
    .join("\n");
}
