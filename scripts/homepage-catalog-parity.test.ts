import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// #69: copy-pasting markup from the marketing homepage must resolve in a
// fresh `shortwind init` project. Every recipe token used in a class
// attribute on the landing page therefore has to exist in the published
// catalog — except a pinned list of site-chrome decorations that depend on
// site-only theme tokens and aren't component markup anyone copies. Adding a
// NEW site-only recipe to the homepage means consciously extending that list.

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

// Decorative site chrome, intentionally not in the catalog: @term needs the
// site-only --color-term token; @rule is the landing page's section divider.
const SITE_CHROME_EXCEPTIONS = new Set(["rule", "term"]);

function catalogRecipeNames(): Set<string> {
  const dir = path.join(root, "packages", "registry", "recipes");
  const names = new Set<string>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".css"))) {
    const body = readFileSync(path.join(dir, file), "utf8");
    for (const m of body.matchAll(/@recipe\s+([\w-]+)/g)) names.add(m[1] ?? "");
  }
  return names;
}

function homepageRecipeTokens(): string[] {
  const src = readFileSync(path.join(root, "site", "src", "pages", "index.astro"), "utf8");
  const tokens = new Set<string>();
  // Only class/className attribute values — prose and shell snippets mention
  // things like `@beta` (an npm tag) and `@recipe` (the keyword) legitimately.
  for (const m of src.matchAll(/\bclass(?:Name)?\s*=\s*(["'])([\s\S]*?)\1/g)) {
    for (const t of (m[2] ?? "").match(/@[a-z][\w-]*/g) ?? []) tokens.add(t.slice(1));
  }
  return [...tokens].sort();
}

describe("homepage / catalog parity (#69)", () => {
  it("every recipe token on the landing page ships in the default catalog", () => {
    const catalog = catalogRecipeNames();
    const missing = homepageRecipeTokens().filter(
      (t) => !catalog.has(t) && !SITE_CHROME_EXCEPTIONS.has(t),
    );
    expect(missing, `landing-page recipes missing from the published catalog: ${missing.join(", ")}`).toEqual([]);
  });

  it("@eyebrow — the hero kicker — is a catalog recipe", () => {
    // The regression that prompted this test: the homepage hero used
    // @eyebrow while the text family shipped only @caption/@label/@muted.
    expect(catalogRecipeNames().has("eyebrow")).toBe(true);
  });
});
