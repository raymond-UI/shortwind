import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { glob } from "tinyglobby";
import { Tiktoken } from "js-tiktoken/lite";
import cl100k_base from "js-tiktoken/ranks/cl100k_base";
import { buildRegistry, parseRecipeFile, type Registry, type Recipe } from "@shortwind/core";
import { transformContent, loadRegistryFromDir, modeForFile } from "@shortwind/tailwind";
import { readConfig } from "../project.js";
import { DEFAULT_RECIPES_CSS } from "../bench-corpus/default-recipes.js";
import { CORPUS_FILES } from "../bench-corpus/corpus.js";
import { extractClassUsages } from "./lint.js";

export type BenchOptions = {
  cwd: string;
  corpus?: boolean;
  path?: string;
};

export type FileBenchResult = {
  filename: string;
  compactClassTokens: number;
  expandedClassTokens: number;
  compactClassBytes: number;
  expandedClassBytes: number;
  compactFileBytes: number;
  expandedFileBytes: number;
  compactLlmTokens: number;
  expandedLlmTokens: number;
};

export type BenchTotals = Omit<FileBenchResult, "filename">;

export type BenchResult = {
  files: FileBenchResult[];
  totals: BenchTotals;
};

const DEFAULT_CONTENT_GLOBS = [
  "src/**/*.{html,js,jsx,ts,tsx,vue,svelte,astro,md,mdx}",
];

export async function bench(options: BenchOptions): Promise<BenchResult> {
  const cwd = path.resolve(options.cwd);
  let registry: Registry;

  const runOnCorpus = options.corpus || !hasShortwindConfig(cwd);

  if (runOnCorpus) {
    registry = loadDefaultRegistry();
  } else {
    const config = await readConfig(cwd);
    const recipesDir = path.join(cwd, config.recipesDir);
    registry = loadRegistryFromDir(recipesDir);
  }

  const filesToBench: Array<{ filename: string; content: string }> = [];

  if (runOnCorpus) {
    for (const [filename, content] of Object.entries(CORPUS_FILES)) {
      filesToBench.push({ filename, content });
    }
  } else {
    const config = await readConfig(cwd);
    const recipesDir = path.join(cwd, config.recipesDir);
    const recipesIgnore = path.posix.join(
      path.relative(cwd, recipesDir).split(path.sep).join("/") || ".",
      "**",
    );
    const contentGlobs = options.path ? [options.path] : DEFAULT_CONTENT_GLOBS;
    const matchedFiles = await glob(contentGlobs, {
      cwd,
      absolute: true,
      onlyFiles: true,
      ignore: ["**/node_modules/**", "**/dist/**", "**/.next/**", recipesIgnore],
    });

    for (const file of matchedFiles) {
      const content = await readFile(file, "utf8");
      const relative = path.relative(cwd, file);
      filesToBench.push({ filename: relative, content });
    }
  }

  const results: FileBenchResult[] = [];
  const totals: BenchTotals = {
    compactClassTokens: 0,
    expandedClassTokens: 0,
    compactClassBytes: 0,
    expandedClassBytes: 0,
    compactFileBytes: 0,
    expandedFileBytes: 0,
    compactLlmTokens: 0,
    expandedLlmTokens: 0,
  };

  for (const { filename, content } of filesToBench) {
    const expanded = transformContent(content, registry, { mode: modeForFile(filename) });

    const compactUsages = extractClassUsages(content);
    const expandedUsages = extractClassUsages(expanded);

    const fileResult: FileBenchResult = {
      filename,
      compactClassTokens: sumTokens(compactUsages),
      expandedClassTokens: sumTokens(expandedUsages),
      compactClassBytes: sumBytes(compactUsages),
      expandedClassBytes: sumBytes(expandedUsages),
      compactFileBytes: Buffer.byteLength(content, "utf8"),
      expandedFileBytes: Buffer.byteLength(expanded, "utf8"),
      compactLlmTokens: countLlmTokens(content),
      expandedLlmTokens: countLlmTokens(expanded),
    };

    results.push(fileResult);

    totals.compactClassTokens += fileResult.compactClassTokens;
    totals.expandedClassTokens += fileResult.expandedClassTokens;
    totals.compactClassBytes += fileResult.compactClassBytes;
    totals.expandedClassBytes += fileResult.expandedClassBytes;
    totals.compactFileBytes += fileResult.compactFileBytes;
    totals.expandedFileBytes += fileResult.expandedFileBytes;
    totals.compactLlmTokens += fileResult.compactLlmTokens;
    totals.expandedLlmTokens += fileResult.expandedLlmTokens;
  }

  return { files: results, totals };
}

function hasShortwindConfig(cwd: string): boolean {
  return existsSync(path.join(cwd, "shortwind.config.json"));
}

function loadDefaultRegistry(): Registry {
  const allRecipes: Recipe[] = [];
  for (const [filename, source] of Object.entries(DEFAULT_RECIPES_CSS)) {
    const parsed = parseRecipeFile(source, filename);
    if (parsed.ok) {
      allRecipes.push(...parsed.value.recipes);
    }
  }
  const resolved = buildRegistry(allRecipes);
  if (!resolved.ok) {
    throw new Error(
      `Failed to build default registry: ${resolved.errors.map((e) => e.message).join("; ")}`,
    );
  }
  return resolved.value;
}

function sumTokens(usages: ReturnType<typeof extractClassUsages>): number {
  let count = 0;
  for (const u of usages) {
    count += u.tokens.length;
  }
  return count;
}

function sumBytes(usages: ReturnType<typeof extractClassUsages>): number {
  let count = 0;
  for (const u of usages) {
    count += Buffer.byteLength(u.raw, "utf8");
  }
  return count;
}

// cl100k_base is the encoding used by GPT-4 and the closest broadly-available
// proxy for modern frontier-model tokenization. Anthropic's tokenizer isn't
// public, but the *ratio* between compact and expanded forms is what backs the
// README claim, and BPE schemes agree on that ratio within a few percent.
let _encoder: Tiktoken | null = null;
function getEncoder(): Tiktoken {
  if (!_encoder) _encoder = new Tiktoken(cl100k_base);
  return _encoder;
}

export function countLlmTokens(str: string): number {
  return getEncoder().encode(str).length;
}

export function formatBenchTable(result: BenchResult): string {
  const lines: string[] = [];
  const colWidths = {
    file: 20,
    metric: 12,
    shortwind: 12,
    expanded: 12,
    saved: 10,
  };

  for (const f of result.files) {
    colWidths.file = Math.max(colWidths.file, f.filename.length);
  }

  const padR = (str: string, width: number): string => str.padEnd(width);
  const padL = (str: string, width: number): string => str.padStart(width);

  // Percent the expanded form would grow over compact, framed as "saved" from
  // the compact side. exp == 0 short-circuits to avoid divide-by-zero on files
  // with no class usage.
  const formatPct = (compact: number, exp: number): string => {
    if (exp === 0) return "0.0%";
    return `${((1 - compact / exp) * 100).toFixed(1)}%`;
  };

  const row = (file: string, metric: string, compact: number, exp: number): string =>
    [
      padR(file, colWidths.file),
      padR(metric, colWidths.metric),
      padL(compact.toString(), colWidths.shortwind),
      padL(exp.toString(), colWidths.expanded),
      padL(formatPct(compact, exp), colWidths.saved),
    ].join("  ");

  const header = [
    padR("File", colWidths.file),
    padR("Metric", colWidths.metric),
    padL("Shortwind", colWidths.shortwind),
    padL("Expanded", colWidths.expanded),
    padL("Saved", colWidths.saved),
  ].join("  ");

  lines.push(header);
  lines.push("-".repeat(header.length));

  for (const f of result.files) {
    lines.push(row(f.filename, "Class Words", f.compactClassTokens, f.expandedClassTokens));
    lines.push(row("", "Class Bytes", f.compactClassBytes, f.expandedClassBytes));
    lines.push(row("", "File Bytes", f.compactFileBytes, f.expandedFileBytes));
    lines.push(row("", "File Tokens", f.compactLlmTokens, f.expandedLlmTokens));
    lines.push("-".repeat(header.length));
  }

  lines.push(row("TOTAL", "Class Words", result.totals.compactClassTokens, result.totals.expandedClassTokens));
  lines.push(row("", "Class Bytes", result.totals.compactClassBytes, result.totals.expandedClassBytes));
  lines.push(row("", "File Bytes", result.totals.compactFileBytes, result.totals.expandedFileBytes));
  lines.push(row("", "File Tokens", result.totals.compactLlmTokens, result.totals.expandedLlmTokens));
  lines.push("-".repeat(header.length));

  return lines.join("\n");
}
