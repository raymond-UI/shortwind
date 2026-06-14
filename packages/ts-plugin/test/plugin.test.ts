import ts from "typescript";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { init } from "../src/plugin.js";

// A real on-disk project: shortwind.config.json + recipes/, with the source
// file living inside it — so the plugin loads the project's actual registry
// (loadRegistryFromDir), the way it does in an editor.
let root: string;
let tsx: string;
let badgeCss: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "sw-tsplugin-"));
  writeFileSync(join(root, "shortwind.config.json"), JSON.stringify({ recipesDir: "recipes" }));
  mkdirSync(join(root, "recipes"));
  badgeCss = join(root, "recipes", "badge.css");
  writeFileSync(
    badgeCss,
    `/* shortwind: badge@0.0.1 sha:000000 */\n/* A pill badge. */\n@recipe badge {\n  inline-flex items-center rounded-full bg-[var(--tone-bg)] px-2 py-0.5 text-xs\n}\n`,
  );
  writeFileSync(
    join(root, "recipes", "button.css"),
    `/* shortwind: button@0.0.1 sha:000000 */\n/* Primary button. */\n@recipe btn-primary {\n  inline-flex rounded-md bg-primary px-4 py-2 text-sm\n}\n`,
  );
  mkdirSync(join(root, "src"));
  tsx = join(root, "src", "x.tsx");
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

function withPlugin(fileName: string, code: string) {
  const files = new Map([[fileName, code]]);
  const host: ts.LanguageServiceHost = {
    getScriptFileNames: () => [fileName],
    getScriptVersion: () => "1",
    getScriptSnapshot: (f) => {
      const t = files.get(f) ?? (ts.sys.fileExists(f) ? ts.sys.readFile(f) : undefined);
      return t === undefined ? undefined : ts.ScriptSnapshot.fromString(t);
    },
    getCurrentDirectory: () => root,
    getCompilationSettings: () => ({ jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 }),
    getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
    fileExists: (f) => files.has(f) || ts.sys.fileExists(f),
    readFile: (f) => files.get(f) ?? ts.sys.readFile(f),
  };
  const ls = ts.createLanguageService(host);
  return init({ typescript: ts }).create({ languageService: ls });
}

const at = (code: string, marker: string, off = marker.length) => code.indexOf(marker) + off;

describe("ts-plugin — real project registry", () => {
  it("completes the project's recipe names inside a className string", () => {
    const code = `export const El = () => <div className="" />;`;
    const res = withPlugin(tsx, code).getCompletionsAtPosition(tsx, at(code, 'className="'), {}, undefined);
    const names = (res?.entries ?? []).map((e) => e.name);
    expect(names).toContain("@badge");
    expect(names).toContain("@btn-primary");
  });

  it("sets a replacementSpan over the @-token so the editor filters + replaces (no @@)", () => {
    // Cursor right after `@b` — the editor must know the whole `@b` is being
    // replaced, else it filters by `b` (dropping the list) and inserts after
    // the existing `@` (`@@btn-primary`).
    const code = `export const El = () => <div className="@b" />;`;
    const pos = code.indexOf("@b") + 2;
    const res = withPlugin(tsx, code).getCompletionsAtPosition(tsx, pos, {}, undefined);
    const btn = res?.entries.find((e) => e.name === "@btn-primary");
    const span = { start: code.indexOf("@b"), length: 2 };
    expect(btn?.replacementSpan).toEqual(span);
    expect(res?.optionalReplacementSpan).toEqual(span);
  });

  it("hovers a recipe token with the expansion from the project's recipe file", () => {
    const code = `export const El = () => <div className="@badge" />;`;
    const qi = withPlugin(tsx, code).getQuickInfoAtPosition(tsx, at(code, "@badge", 3));
    const doc = (qi?.documentation ?? []).map((d) => d.text).join("");
    expect(doc).toContain("inline-flex");
    expect(doc).toContain("rounded-full");
  });

  it("go-to-definition jumps to the @recipe block in recipes/*.css", () => {
    const code = `export const El = () => <div className="@badge" />;`;
    const def = withPlugin(tsx, code).getDefinitionAndBoundSpan(tsx, at(code, "@badge", 3));
    expect(def?.definitions?.[0]?.fileName).toBe(badgeCss);
    // the target span covers the `badge` name in the recipe file
    const src = ts.sys.readFile(badgeCss)!;
    const d = def!.definitions![0]!;
    expect(src.slice(d.textSpan.start, d.textSpan.start + d.textSpan.length)).toBe("badge");
  });

  it("does NOT complete in a plain (non-class) string", () => {
    const code = `const s = "";`;
    const f = join(root, "src", "y.ts");
    const res = withPlugin(f, code).getCompletionsAtPosition(f, at(code, '"'), {}, undefined);
    expect((res?.entries ?? []).map((e) => e.name)).not.toContain("@badge");
  });

  it("does NOT complete in a non-class JSX attribute", () => {
    const code = `export const El = () => <div id="" />;`;
    const res = withPlugin(tsx, code).getCompletionsAtPosition(tsx, at(code, 'id="'), {}, undefined);
    expect((res?.entries ?? []).map((e) => e.name)).not.toContain("@badge");
  });

  it("returns empty (no crash) when the project has no shortwind.config.json", () => {
    const code = `export const El = () => <div className="" />;`;
    const f = "/nowhere/x.tsx";
    const res = withPlugin(f, code).getCompletionsAtPosition(f, at(code, 'className="'), {}, undefined);
    expect((res?.entries ?? []).map((e) => e.name)).not.toContain("@badge");
  });

  it("warns on an unknown recipe with a did-you-mean", () => {
    const code = `export const El = () => <div className="@badeg p-2" />;`;
    const diags = withPlugin(tsx, code).getSemanticDiagnostics(tsx).filter((d) => d.code === 990001);
    expect(diags).toHaveLength(1);
    expect(String(diags[0]!.messageText)).toContain("Unknown Shortwind recipe '@badeg'");
    expect(String(diags[0]!.messageText)).toContain("Did you mean '@badge'");
  });

  it("does NOT flag Tailwind @-utilities or known recipes", () => {
    const code = `export const El = () => <div className="@badge @container @md:flex @min-[400px]:grid" />;`;
    const diags = withPlugin(tsx, code).getSemanticDiagnostics(tsx).filter((d) => d.code === 990001);
    expect(diags).toHaveLength(0);
  });

  it("offers a quick-fix to the suggested recipe", () => {
    const code = `export const El = () => <div className="@badeg" />;`;
    const start = code.indexOf("@badeg");
    const fixes = withPlugin(tsx, code).getCodeFixesAtPosition(
      tsx,
      start,
      start + "@badeg".length,
      [990001],
      {},
      {},
    );
    const fix = fixes.find((f) => f.fixName === "shortwind-did-you-mean");
    expect(fix?.changes[0]?.textChanges[0]?.newText).toBe("@badge");
  });
});
