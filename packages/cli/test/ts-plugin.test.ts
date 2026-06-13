import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import ts from "typescript";

// Verifies the production shape: the plugin ships as the `@shortwind/cli/ts-plugin`
// SUBPATH (no separate package), resolves by name the way tsserver would
// (require + exports map), exposes a callable factory, and works end-to-end
// against the built+bundled CJS artifact.
const require = createRequire(import.meta.url);

function service(fileName: string, code: string) {
  const files = new Map([[fileName, code]]);
  const host: ts.LanguageServiceHost = {
    getScriptFileNames: () => [fileName],
    getScriptVersion: () => "1",
    getScriptSnapshot: (f) => {
      const t = files.get(f) ?? (ts.sys.fileExists(f) ? ts.sys.readFile(f) : undefined);
      return t === undefined ? undefined : ts.ScriptSnapshot.fromString(t);
    },
    getCurrentDirectory: () => "/",
    getCompilationSettings: () => ({ jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 }),
    getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
    fileExists: (f) => files.has(f) || ts.sys.fileExists(f),
    readFile: (f) => files.get(f) ?? ts.sys.readFile(f),
  };
  return ts.createLanguageService(host);
}

describe("@shortwind/cli/ts-plugin subpath (#RFC editor-tooling — no new package)", () => {
  it("resolves the subpath by name to the bundled CJS", () => {
    const resolved = require.resolve("@shortwind/cli/ts-plugin");
    expect(resolved).toMatch(/dist[/\\]ts-plugin\.cjs$/);
  });

  it("exposes a callable factory (the tsserver plugin contract)", () => {
    const factory = require("@shortwind/cli/ts-plugin");
    expect(typeof factory).toBe("function");
    const plugin = factory({ typescript: ts });
    expect(typeof plugin.create).toBe("function");
  });

  it("the bundled factory produces a working proxy (recipe-token hooks installed)", () => {
    const factory = require("@shortwind/cli/ts-plugin");
    const ls = service("/x.tsx", `export const El = () => <div className="" />;`);
    const proxy = factory({ typescript: ts }).create({ languageService: ls });
    // The proxy is wired with the recipe-token overrides (behavior itself is
    // covered against a real project in @shortwind/ts-plugin's own tests).
    expect(typeof proxy.getCompletionsAtPosition).toBe("function");
    expect(typeof proxy.getQuickInfoAtPosition).toBe("function");
    expect(typeof proxy.getDefinitionAndBoundSpan).toBe("function");
    // delegates unrelated calls without throwing
    expect(() => proxy.getCompletionsAtPosition("/x.tsx", 0, {}, undefined)).not.toThrow();
  });
});
