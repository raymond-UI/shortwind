import { readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { glob } from "tinyglobby";
import { buildRegistry, parseRecipeFile } from "@shortwind/core";
import type { Recipe, Registry } from "@shortwind/core";
import { installedFamilies, readConfig } from "../project.js";

export const ALL_RULES = [
  "recipe/unknown",
  "recipe/cycle",
  "recipe/duplicate",
  "recipe/unused",
  "recipe/no-redundant-utility",
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
};

const DEFAULT_CONTENT = [
  "src/**/*.{html,js,jsx,ts,tsx,vue,svelte,astro,md,mdx}",
];

export async function lint(options: LintOptions): Promise<LintResult> {
  const cwd = path.resolve(options.cwd);
  const config = await readConfig(cwd);
  const recipesDir = path.join(cwd, config.recipesDir);
  const enabledRules = new Set<Rule>(options.rules ?? ALL_RULES);
  const findings: Finding[] = [];

  const { registry, parseFindings } = loadRegistry(recipesDir, enabledRules);
  findings.push(...parseFindings);

  const contentGlobs = options.content ?? DEFAULT_CONTENT;
  const files = await glob(contentGlobs, {
    cwd,
    absolute: true,
    onlyFiles: true,
    ignore: ["**/node_modules/**", "**/dist/**", "**/.next/**", recipesDir + "/**"],
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
        if (registry.flattened[name]) usedRecipes.add(name);
        else if (enabledRules.has("recipe/unknown")) {
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

  if (enabledRules.has("recipe/unused")) {
    for (const name of Object.keys(registry.flattened)) {
      if (usedRecipes.has(name)) continue;
      const recipe = findRecipeByName(registry, name);
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
  return { ok, findings, filesFixed };
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
      const rule: Rule = err.code.includes("cycle")
        ? "recipe/cycle"
        : err.code.includes("duplicate")
          ? "recipe/duplicate"
          : "recipe/unknown";
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

type ClassUsage = {
  fileOffset: number;
  // Exact source offset of the first character inside the attribute value
  // (just past the opening quote). raw.length characters from here is the
  // closing quote. Used by the auto-fix writer; indexOf-based location
  // hunting is unsafe because two attributes can share the same raw text.
  valueStart: number;
  raw: string;
  tokens: Array<{ value: string; line: number; column: number }>;
  // Only string-literal attribute values can be auto-fixed in place;
  // JSX expression containers (className={...}) may wrap clsx() / template
  // literals where blind substring writes would be unsafe.
  fixable: boolean;
};

const CLASS_ATTR_STR_RE = /\b(?:class|className)\s*=\s*(["'])([^"']*)\1/g;
const CLASS_ATTR_BRACE_RE = /\b(?:class|className)\s*=\s*\{/g;
const STRING_LITERAL_RE = /(["'`])((?:\\.|(?!\1)[^\\])*)\1/g;

export function extractClassUsages(source: string): ClassUsage[] {
  const usages: ClassUsage[] = [];
  for (const m of source.matchAll(CLASS_ATTR_STR_RE)) {
    const value = m[2] ?? "";
    const attrStart = m.index ?? 0;
    const valueStart = attrStart + m[0]!.length - 1 - value.length;
    usages.push({
      fileOffset: attrStart,
      valueStart,
      raw: value,
      tokens: tokenizeClassString(source, value, valueStart),
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
      const tokens = tokenizeClassString(source, value, valueStart);
      if (tokens.length === 0) continue;
      usages.push({
        fileOffset: literalStart,
        valueStart,
        raw: value,
        tokens,
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
): Array<{ value: string; line: number; column: number }> {
  const tokens: Array<{ value: string; line: number; column: number }> = [];
  let offset = 0;
  for (const piece of value.split(/(\s+)/)) {
    if (/^\s+$/.test(piece) || piece.length === 0) {
      offset += piece.length;
      continue;
    }
    // Inside template literals the regex captures `${expr}` as part of
    // the value; treat any token containing an interpolation marker as
    // opaque so we don't try to lint dynamic content.
    if (piece.includes("${")) {
      offset += piece.length;
      continue;
    }
    const abs = valueStart + offset;
    const { line, column } = offsetToLineCol(source, abs);
    tokens.push({ value: piece, line, column });
    offset += piece.length;
  }
  return tokens;
}

function findMatchingBrace(source: string, openIdx: number): number {
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
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    i++;
  }
  return depth === 0 ? i - 1 : -1;
}

function offsetToLineCol(source: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lastNl = -1;
  for (let i = 0; i < offset && i < source.length; i++) {
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

    const kept: string[] = [];
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
        continue;
      }
      kept.push(tok.value);
    }

    if (fixed !== null && usage.fixable) {
      // valueStart is the exact offset of the first content char (just past
      // the opening quote); raw.length is the content length.
      if (usage.valueStart < cursor) continue;
      fixed += source.slice(cursor, usage.valueStart);
      fixed += kept.join(" ");
      cursor = usage.valueStart + usage.raw.length;
    }
  }
  if (fixed !== null) fixed += source.slice(cursor);
  return { findings, fixed };
}

function findRecipeByName(registry: Registry, name: string): Recipe | null {
  for (const recs of Object.values(registry.families)) {
    for (const r of recs) {
      if (r.name === name) return r;
    }
  }
  return null;
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
