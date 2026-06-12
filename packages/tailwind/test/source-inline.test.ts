// Real-Tailwind regression test for #79: every safelist token — including
// bracket/arbitrary-value tokens and the empty-arbitrary `before:content-['']`
// that corrupted the beta.11 Astro dogfooding build — must survive the
// `@source inline(...)` round-trip into generated CSS, with no silent drop of
// the tokens after it.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compile } from "@tailwindcss/node";
import type { Registry } from "@shortwind/core";
import { buildSourceDirective, injectSourceDirective } from "../src/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
// Resolve `@import "tailwindcss"` against this package, where the real
// tailwindcss devDependency is installed.
const BASE = path.resolve(here, "..");

// Theme-independent utilities only, so generation failures can only mean the
// directive itself didn't parse.
const PLAIN_TOKENS = ["flex", "underline", "items-center"];
const FRAGILE_TOKENS = [
  "tracking-[0.2em]",
  "transition-[color,box-shadow]",
  "focus-visible:ring-[3px]",
  "before:content-['']",
];

const REGISTRY: Registry = {
  families: {},
  flattened: { hero: [...PLAIN_TOKENS, ...FRAGILE_TOKENS] },
};

async function generate(css: string): Promise<string> {
  const compiler = await compile(css, { base: BASE, onDependency: () => {} });
  return compiler.build([]);
}

// The class name as it appears (escaped) in the generated stylesheet.
function escapedSelector(token: string): string {
  return "." + token.replace(/[^A-Za-z0-9_-]/g, (c) => `\\${c}`);
}

describe("@source inline round-trip through real Tailwind (#79)", () => {
  it("generates every token, fragile ones included, from the injected directive", async () => {
    const entry = injectSourceDirective(`@import "tailwindcss";\n`, REGISTRY);
    const out = await generate(entry);
    for (const token of [...PLAIN_TOKENS, ...FRAGILE_TOKENS]) {
      expect(out, `token ${token} should generate`).toContain(escapedSelector(token));
    }
  }, 60_000);

  it("a fragile token never drops the tokens after it in directive order", async () => {
    // Force the worst shape: the empty-arbitrary token ahead of plain tokens
    // in a single registry — buildSourceDirective must emit a structure where
    // the trailing tokens still generate.
    const directive = buildSourceDirective(REGISTRY);
    const out = await generate(`@import "tailwindcss";\n${directive}\n`);
    expect(out).toContain(escapedSelector("flex"));
    expect(out).toContain(escapedSelector("underline"));
    expect(out).toContain(escapedSelector("items-center"));
  }, 60_000);
});
