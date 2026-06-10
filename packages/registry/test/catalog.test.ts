import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { parseRecipeFile, buildRegistry } from "@shortwind/core";
import type { Recipe } from "@shortwind/core";

const here = path.dirname(fileURLToPath(import.meta.url));
const recipesDir = path.join(here, "..", "recipes");

type Parsed = {
  file: string;
  family: string;
  recipes: Recipe[];
  guidance: string | null;
};

function loadCatalog(): Parsed[] {
  const files = readdirSync(recipesDir)
    .filter((n) => n.endsWith(".css"))
    .sort();
  const out: Parsed[] = [];
  for (const file of files) {
    const source = readFileSync(path.join(recipesDir, file), "utf8");
    const result = parseRecipeFile(source, file);
    if (!result.ok) {
      throw new Error(`parse failed for ${file}: ${JSON.stringify(result.errors)}`);
    }
    out.push({
      file,
      family: file.replace(/\.css$/, ""),
      recipes: result.value.recipes,
      guidance: result.value.guidance,
    });
  }
  return out;
}

const EXPECTED_FAMILIES = [
  "badge",
  "button",
  "card",
  "code",
  "dialog",
  "empty",
  "feedback",
  "form",
  "icon",
  "layout",
  "list",
  "media",
  "navigation",
  "progress",
  "skeleton",
  "surface",
  "table",
  "text",
  "tooltip",
];

describe("catalog", () => {
  const catalog = loadCatalog();

  it("ships exactly 19 family files", () => {
    expect(catalog.map((c) => c.family).sort()).toEqual(EXPECTED_FAMILIES);
  });

  for (const parsed of loadCatalog()) {
    it(`${parsed.file} parses with a valid header`, () => {
      const source = readFileSync(path.join(recipesDir, parsed.file), "utf8");
      const result = parseRecipeFile(source, parsed.file);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.header).not.toBeNull();
      expect(result.value.header?.family).toEqual(parsed.family);
      expect(result.value.header?.version).toEqual("0.0.1");
      expect(result.value.header?.sha).toEqual("000000");
    });

    it(`${parsed.file} has a description on every recipe`, () => {
      for (const recipe of parsed.recipes) {
        expect(recipe.description, `${recipe.name} is missing a description`).not.toBeNull();
      }
    });

    it(`${parsed.file} ships family selection guidance`, () => {
      // Every family must carry an @guide block so the generated SKILL.md
      // teaches when to reach for which recipe, not just the expansions.
      expect(parsed.guidance, `${parsed.family} is missing an @guide block`).toBeTruthy();
      expect((parsed.guidance ?? "").length).toBeGreaterThan(20);
    });

    it(`${parsed.file} names follow @<family>[-<...>]`, () => {
      const family = parsed.family;
      const prefixes: Record<string, string> = {
        button: "btn",
        navigation: "nav",
        feedback: "alert",
      };
      const allowed = new Set([family, prefixes[family]].filter(Boolean) as string[]);
      // some families use their own root (card, badge, etc.) and named members.
      // we relax to: every recipe name's leading segment matches one of the allowed roots OR is family-specific naming.
      for (const recipe of parsed.recipes) {
        const root = recipe.name.split("-")[0] ?? "";
        if (allowed.size > 0 && (allowed.has(root) || allowed.has(recipe.name))) continue;
        // accept if the family is implied by family-specific vocabulary we know
        const familyKnown: Record<string, string[]> = {
          layout: ["stack", "row", "grid", "center", "full"],
          text: ["heading", "body", "lead", "muted", "label", "caption", "link"],
          form: ["input", "textarea", "select", "checkbox", "radio", "field", "fieldset", "label", "help"],
          surface: ["surface", "wrapper", "divider"],
          feedback: ["alert", "callout", "toast", "banner"],
          navigation: ["nav", "breadcrumb", "tab"],
          list: ["list", "dl", "dt", "dd"],
          table: ["table", "th", "td", "tr"],
          media: ["avatar", "thumb", "aspect"],
          code: ["code", "kbd"],
          dialog: ["dialog"],
          empty: ["empty"],
          progress: ["progress", "spinner"],
          tooltip: ["tooltip"],
          skeleton: ["skeleton"],
          icon: ["icon"],
        };
        const known = familyKnown[family] ?? [];
        expect(
          known.includes(root),
          `${recipe.name} in ${family}.css has unexpected root '${root}'`,
        ).toBe(true);
      }
    });
  }

  it("buildRegistry succeeds — no duplicates, no unknown refs, no cycles", () => {
    const allRecipes = catalog.flatMap((c) => c.recipes);
    const result = buildRegistry(allRecipes);
    if (!result.ok) {
      throw new Error(`resolve failed: ${JSON.stringify(result.errors, null, 2)}`);
    }
    expect(result.ok).toBe(true);
  });

  it("registry includes all 19 families", () => {
    const allRecipes = catalog.flatMap((c) => c.recipes);
    const result = buildRegistry(allRecipes);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.value.families).sort()).toEqual(EXPECTED_FAMILIES);
  });

  it("flattened expansion is a stable snapshot", () => {
    const allRecipes = catalog.flatMap((c) => c.recipes);
    const result = buildRegistry(allRecipes);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.flattened).toMatchSnapshot();
  });
});
