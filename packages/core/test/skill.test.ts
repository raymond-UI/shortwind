import { describe, expect, it } from "vitest";
import { renderSkillMarkdown } from "../src/skill.js";
import type { Recipe, Registry } from "../src/types.js";

function recipe(
  name: string,
  tokens: string[],
  description: string | null = null,
  sourceFile = `${name.split("-")[0]}.css`,
): Recipe {
  return {
    name,
    description,
    tokens,
    references: [],
    sourceFile,
    sourceLine: 1,
  };
}

function buildSampleRegistry(): Registry {
  const card = recipe("card", ["rounded", "border", "p-4"], "Default card.", "card.css");
  const cardElevated = recipe(
    "card-elevated",
    ["rounded", "border", "p-4", "shadow-lg"],
    "Elevated card.",
    "card.css",
  );
  const btn = recipe("btn", ["px-3", "py-1", "rounded"], "Button.", "button.css");
  const btnPrimary = recipe(
    "btn-primary",
    ["px-3", "py-1", "rounded", "bg-blue-600", "text-white"],
    "Primary button.",
    "button.css",
  );
  return {
    families: {
      card: [card, cardElevated],
      button: [btn, btnPrimary],
    },
    flattened: {
      card: card.tokens,
      "card-elevated": cardElevated.tokens,
      btn: btn.tokens,
      "btn-primary": btnPrimary.tokens,
    },
  };
}

describe("renderSkillMarkdown", () => {
  it("renders a stable snapshot for the sample catalog", () => {
    const md = renderSkillMarkdown(buildSampleRegistry());
    expect(md).toMatchSnapshot();
  });

  it("emits frontmatter with name and description", () => {
    const md = renderSkillMarkdown(buildSampleRegistry());
    const match = md.match(/^---\n([\s\S]*?)\n---/);
    expect(match).not.toBeNull();
    const frontmatter = match?.[1] ?? "";
    const fields: Record<string, string> = {};
    for (const line of frontmatter.split("\n")) {
      const idx = line.indexOf(":");
      if (idx === -1) continue;
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();
      fields[key] = value;
    }
    expect(fields["name"]).toBe("shortwind");
    expect(fields["description"]).toBeTruthy();
    expect((fields["description"] ?? "").length).toBeGreaterThan(20);
  });

  it("respects the order override and appends remaining families", () => {
    const md = renderSkillMarkdown(buildSampleRegistry(), { order: ["button", "card"] });
    const buttonIdx = md.indexOf("### Button recipes");
    const cardIdx = md.indexOf("### Card recipes");
    expect(buttonIdx).toBeGreaterThan(-1);
    expect(cardIdx).toBeGreaterThan(buttonIdx);

    // unknown family in override is ignored; missing families still render
    const md2 = renderSkillMarkdown(buildSampleRegistry(), { order: ["bogus", "button"] });
    expect(md2.indexOf("### Button recipes")).toBeLessThan(md2.indexOf("### Card recipes"));
    expect(md2).not.toContain("Bogus recipes");
  });

  it("wraps long expansions with a hanging indent", () => {
    const longTokens = [
      "rounded-lg",
      "border",
      "border-gray-200",
      "bg-white",
      "p-6",
      "shadow-md",
      "hover:shadow-lg",
      "focus:ring-2",
      "focus:ring-blue-500",
      "dark:bg-gray-900",
      "dark:border-gray-700",
      "transition-shadow",
    ];
    const r = recipe("card-fancy", longTokens, "Long card.", "card.css");
    const registry: Registry = {
      families: { card: [r] },
      flattened: { "card-fancy": longTokens },
    };
    const md = renderSkillMarkdown(registry, { wrapAt: 60 });
    const lines = md.split("\n");
    const headerIdx = lines.findIndex((l) => l.includes("@card-fancy"));
    expect(headerIdx).toBeGreaterThan(-1);
    // collect the recipe block: header + subsequent indented continuation lines
    const block: string[] = [lines[headerIdx] ?? ""];
    for (let i = headerIdx + 1; i < lines.length; i++) {
      const line = lines[i] ?? "";
      if (line.length === 0 || !line.startsWith("  ")) break;
      if (line.startsWith("  #")) continue; // skip verbose description lines
      if (line.includes("@")) break; // next recipe
      block.push(line);
    }
    // wrapped output produces continuation lines
    expect(block.length).toBeGreaterThan(1);
    // continuation lines share a common hanging indent
    const cont = block[1] ?? "";
    const indent = cont.match(/^ +/)?.[0] ?? "";
    expect(indent.length).toBeGreaterThan(2);
    // every line fits in a generous bound
    for (const line of block) {
      expect(line.length).toBeLessThanOrEqual(80);
    }
  });

  it("renders family guidance as a blockquote and a selection hint", () => {
    const base = buildSampleRegistry();
    const registry: Registry = {
      ...base,
      guidance: { card: "Use @card-elevated for emphasis; @card otherwise." },
    };
    const md = renderSkillMarkdown(registry, { order: ["card", "button"] });
    // top-level selection hint appears because at least one family has guidance
    expect(md).toContain("Read it before picking");
    // the guidance renders as a blockquote directly under the family heading
    const cardIdx = md.indexOf("### Card recipes");
    const quoteIdx = md.indexOf("> Use @card-elevated for emphasis");
    const recipeIdx = md.indexOf("@card ");
    expect(cardIdx).toBeGreaterThan(-1);
    expect(quoteIdx).toBeGreaterThan(cardIdx);
    expect(recipeIdx).toBeGreaterThan(quoteIdx);
  });

  it("omits the selection hint when no family has guidance", () => {
    const md = renderSkillMarkdown(buildSampleRegistry());
    expect(md).not.toContain("Read it before picking");
    expect(md).not.toContain("\n> ");
  });

  it("renders a minimal but valid SKILL.md for an empty registry", () => {
    const md = renderSkillMarkdown({ families: {}, flattened: {} });
    expect(md.startsWith("---\n")).toBe(true);
    expect(md).toContain("name: shortwind");
    expect(md).toContain("description:");
    expect(md).toContain("# Shortwind");
    expect(md).toContain("## Available recipes");
    expect(md).toContain("No families installed yet");
    expect(md).not.toContain("###");
  });
});
