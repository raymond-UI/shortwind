// Shortwind TypeScript language-service plugin.
//
// Recipe-token IntelliSense inside `class`/`className` strings — completion,
// hover-to-expand, and go-to-definition — driven by the project's real recipe
// registry, in any TS-powered editor, with no extension. Ships inside
// @shortwind/cli as the `./ts-plugin` subpath (see packages/cli/src/ts-plugin.cts).

import { dirname } from "node:path";
import type * as tsmod from "typescript";
import { findRecipeDefinition, loadProjectRegistry } from "./registry.js";

const CLASS_ATTRS = new Set(["class", "className", "class:list"]);

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

    return proxy;
  }

  return { create };
}

export default init;
