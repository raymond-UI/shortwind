// Shortwind TypeScript language-service plugin.
//
// Recipe-token IntelliSense inside `class`/`className` strings — completion,
// hover-to-expand, and go-to-definition — driven by the project's real recipe
// registry, in any TS-powered editor, with no extension. Ships inside
// @shortwind/cli as the `./ts-plugin` subpath (see packages/cli/src/ts-plugin.cts).

import { dirname } from "node:path";
import type * as tsmod from "typescript";
import { looksLikeRecipeToken } from "@shortwind/core";
import { findRecipeDefinition, loadProjectRegistry } from "./registry.js";

const CLASS_ATTRS = new Set(["class", "className", "class:list"]);

// Custom diagnostic code for unknown-recipe warnings (high, won't collide with
// TS's own); the quick-fix matches on it.
const UNKNOWN_RECIPE_CODE = 990001;

function levenshtein(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length]!;
}

// Nearest recipe name within a length-scaled edit distance; null when none is
// close enough or two are equally close (ambiguous — better to say nothing).
function suggest(name: string, names: string[]): string | null {
  const max = name.length <= 4 ? 1 : name.length <= 8 ? 2 : 3;
  let best: string | null = null;
  let bestD = max + 1;
  let tie = false;
  for (const n of names) {
    const d = levenshtein(name, n);
    if (d < bestD) {
      bestD = d;
      best = n;
      tie = false;
    } else if (d === bestD) {
      tie = true;
    }
  }
  return best !== null && bestD <= max && !tie ? best : null;
}

// Visit every `@`-token sitting in a class/className string literal, with span.
function forEachClassToken(
  ts: typeof tsmod,
  sf: tsmod.SourceFile,
  cb: (t: { token: string; name: string; start: number; length: number }) => void,
): void {
  const visit = (node: tsmod.Node) => {
    if (ts.isJsxAttribute(node) && CLASS_ATTRS.has(node.name.getText(sf))) {
      const init = node.initializer;
      let str: tsmod.StringLiteralLike | undefined;
      if (init && ts.isStringLiteralLike(init)) str = init;
      else if (init && ts.isJsxExpression(init) && init.expression && ts.isStringLiteralLike(init.expression)) {
        str = init.expression;
      }
      if (str) {
        const contentStart = str.getStart(sf) + 1;
        const value = str.getText(sf).slice(1, -1);
        let offset = 0;
        for (const piece of value.split(/(\s+)/)) {
          if (piece.startsWith("@") && !piece.includes("${")) {
            cb({ token: piece, name: piece.slice(1), start: contentStart + offset, length: piece.length });
          }
          offset += piece.length;
        }
      }
    }
    node.forEachChild(visit);
  };
  sf.forEachChild(visit);
}

// Innermost AST node containing `pos`.
function nodeAt(sf: tsmod.SourceFile, pos: number): tsmod.Node {
  let found: tsmod.Node = sf;
  const visit = (node: tsmod.Node) => {
    if (pos >= node.getStart(sf) && pos <= node.getEnd()) {
      found = node;
      node.forEachChild(visit);
    }
  };
  sf.forEachChild(visit);
  return found;
}

// Is `pos` inside the string value of a class/className attribute? Handles both
// `className="…"` and `className={"…"}`.
function classStringAt(
  ts: typeof tsmod,
  sf: tsmod.SourceFile,
  pos: number,
): tsmod.StringLiteralLike | null {
  let node: tsmod.Node | undefined = nodeAt(sf, pos);
  while (node) {
    if (ts.isStringLiteralLike(node)) {
      let p: tsmod.Node | undefined = node.parent;
      if (p && ts.isJsxExpression(p)) p = p.parent;
      if (p && ts.isJsxAttribute(p) && CLASS_ATTRS.has(p.name.getText(sf))) return node;
      return null;
    }
    node = node.parent;
  }
  return null;
}

// The `@recipe` token under the cursor in a class string, with its span.
function recipeTokenAt(
  ts: typeof tsmod,
  sf: tsmod.SourceFile,
  pos: number,
): { name: string; start: number; length: number } | null {
  const str = classStringAt(ts, sf, pos);
  if (!str) return null;
  const text = sf.text;
  let start = pos;
  while (start > str.getStart(sf) + 1 && !/\s|["'`]/.test(text[start - 1]!)) start--;
  let end = pos;
  while (end < str.getEnd() - 1 && !/\s|["'`]/.test(text[end]!)) end++;
  const word = text.slice(start, end);
  if (!word.startsWith("@")) return null;
  return { name: word.slice(1), start, length: end - start };
}

export function init(modules: { typescript: typeof tsmod }) {
  const ts = modules.typescript;

  function create(info: { languageService: tsmod.LanguageService }) {
    const ls = info.languageService;
    const lsAny = ls as unknown as Record<string, (...a: unknown[]) => unknown>;
    const proxyAny = Object.create(null) as Record<string, unknown>;
    for (const k of Object.keys(ls)) {
      const orig = lsAny[k];
      if (typeof orig === "function") proxyAny[k] = (...a: unknown[]) => orig.apply(ls, a);
    }
    const proxy = proxyAny as unknown as tsmod.LanguageService;
    const sourceFile = (fileName: string) => ls.getProgram()?.getSourceFile(fileName);

    proxy.getCompletionsAtPosition = (fileName, position, options, formattingSettings) => {
      const prior = ls.getCompletionsAtPosition(fileName, position, options, formattingSettings);
      const sf = sourceFile(fileName);
      if (!sf || !classStringAt(ts, sf, position)) return prior;
      const { registry } = loadProjectRegistry(dirname(fileName));
      const names = Object.keys(registry.flattened).sort();
      if (names.length === 0) return prior;
      const entries: tsmod.CompletionEntry[] = names.map((n) => ({
        name: `@${n}`,
        kind: ts.ScriptElementKind.constElement,
        kindModifiers: "shortwind",
        sortText: "0",
        insertText: `@${n}`,
      }));
      if (prior) {
        prior.entries = [...entries, ...prior.entries];
        return prior;
      }
      return { isGlobalCompletion: false, isMemberCompletion: false, isNewIdentifierLocation: true, entries };
    };

    proxy.getQuickInfoAtPosition = (fileName, position) => {
      const sf = sourceFile(fileName);
      const tok = sf ? recipeTokenAt(ts, sf, position) : null;
      const expansion = tok ? loadProjectRegistry(dirname(fileName)).registry.flattened[tok.name] : undefined;
      if (tok && expansion) {
        return {
          kind: ts.ScriptElementKind.constElement,
          kindModifiers: "shortwind",
          textSpan: { start: tok.start, length: tok.length },
          documentation: [{ text: expansion.join(" "), kind: "text" }],
          displayParts: [
            { text: "(shortwind recipe) ", kind: "text" },
            { text: `@${tok.name}`, kind: "className" },
          ],
        };
      }
      return ls.getQuickInfoAtPosition(fileName, position);
    };

    proxy.getDefinitionAndBoundSpan = (fileName, position) => {
      const sf = sourceFile(fileName);
      const tok = sf ? recipeTokenAt(ts, sf, position) : null;
      if (sf && tok) {
        const { registry, recipesDir } = loadProjectRegistry(dirname(fileName));
        if (recipesDir && Object.hasOwn(registry.flattened, tok.name)) {
          const def = findRecipeDefinition(recipesDir, tok.name);
          if (def) {
            return {
              textSpan: { start: tok.start, length: tok.length },
              definitions: [
                {
                  fileName: def.fileName,
                  textSpan: { start: def.start, length: def.length },
                  kind: ts.ScriptElementKind.constElement,
                  name: `@${tok.name}`,
                  containerName: "shortwind",
                  containerKind: ts.ScriptElementKind.moduleElement,
                },
              ],
            };
          }
        }
      }
      return ls.getDefinitionAndBoundSpan(fileName, position);
    };

    proxy.getSemanticDiagnostics = (fileName) => {
      const prior = ls.getSemanticDiagnostics(fileName);
      const sf = sourceFile(fileName);
      if (!sf) return prior;
      const { registry } = loadProjectRegistry(dirname(fileName));
      const names = Object.keys(registry.flattened);
      // No project registry → stay silent (don't squiggle a non-Shortwind file).
      if (names.length === 0) return prior;
      const extra: tsmod.Diagnostic[] = [];
      forEachClassToken(ts, sf, ({ token, name, start, length }) => {
        if (looksLikeRecipeToken(token) && !Object.hasOwn(registry.flattened, name)) {
          const hint = suggest(name, names);
          extra.push({
            file: sf,
            start,
            length,
            category: ts.DiagnosticCategory.Warning,
            code: UNKNOWN_RECIPE_CODE,
            messageText: `Unknown Shortwind recipe '@${name}'.${hint ? ` Did you mean '@${hint}'?` : ""}`,
          });
        }
      });
      return [...prior, ...extra];
    };

    proxy.getCodeFixesAtPosition = (fileName, start, end, errorCodes, formatOptions, preferences) => {
      const prior = ls.getCodeFixesAtPosition(fileName, start, end, errorCodes, formatOptions, preferences);
      if (!errorCodes.includes(UNKNOWN_RECIPE_CODE)) return prior;
      const sf = sourceFile(fileName);
      const tok = sf ? recipeTokenAt(ts, sf, start) : null;
      if (!sf || !tok) return prior;
      const { registry } = loadProjectRegistry(dirname(fileName));
      const hint = suggest(tok.name, Object.keys(registry.flattened));
      if (!hint) return prior;
      const fix: tsmod.CodeFixAction = {
        fixName: "shortwind-did-you-mean",
        description: `Change '@${tok.name}' to '@${hint}'`,
        changes: [
          {
            fileName,
            textChanges: [{ span: { start: tok.start, length: tok.length }, newText: `@${hint}` }],
          },
        ],
      };
      return [fix, ...prior];
    };

    return proxy;
  }

  return { create };
}

export default init;
