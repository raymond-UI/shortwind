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
    // The dynamic-classes examples may also mention @card-fancy (they're
    // derived from the installed registry, #80) — anchor on the recipe
    // listing's two-space indent instead.
    const headerIdx = lines.findIndex((l) => l.startsWith("  @card-fancy"));
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

  it("teaches the dynamic-class rule and the build-time escape hatch", () => {
    const md = renderSkillMarkdown(buildSampleRegistry());
    expect(md).toContain("## Dynamic classes");
    // states the literal-only rule and names the silent failure shapes
    expect(md).toContain("literal");
    expect(md).toContain("class:list");
    // points at the supported build-time expansion path, not a guess
    expect(md).toContain("expandClassList");
    expect(md).toContain("https://shortwind.dev/docs/dynamic-classes");
  });

  it("dynamic-classes examples only reference recipes the registry ships (#80)", () => {
    // The sample registry has no badge or tab family — the old hardcoded
    // @badge-success/@tab examples pointed readers at recipes the install
    // didn't provide.
    const registry = buildSampleRegistry();
    const md = renderSkillMarkdown(registry);
    const fenceStart = md.indexOf("```tsx");
    const fence = md.slice(fenceStart, md.indexOf("```", fenceStart + 6));
    const referenced = [...fence.matchAll(/@([A-Za-z0-9][\w-]*)/g)].map((m) => m[1]);
    expect(referenced.length).toBeGreaterThan(0);
    for (const name of referenced) {
      expect(Object.keys(registry.flattened), `@${name} is not installed`).toContain(name);
    }
  });

  it("prefers the familiar tab/badge example names when those recipes are installed", () => {
    const tab = recipe("tab", ["px-2"], "Tab.", "navigation.css");
    const tabActive = recipe("tab-active", ["px-2", "font-bold"], "Active tab.", "navigation.css");
    const badgeSuccess = recipe("badge-success", ["bg-green-100"], "Success badge.", "badge.css");
    const registry = buildSampleRegistry();
    registry.families["navigation"] = [tab, tabActive];
    registry.families["badge"] = [badgeSuccess];
    registry.flattened["tab"] = tab.tokens;
    registry.flattened["tab-active"] = tabActive.tokens;
    registry.flattened["badge-success"] = badgeSuccess.tokens;
    const md = renderSkillMarkdown(registry);
    expect(md).toContain(`active ? "@tab-active" : "@tab"`);
    expect(md).toContain(`{ recipe: "@badge-success" }`);
  });

  it("offers the rc()/expandClassList escape hatch with adapter-correct wiring (#81)", () => {
    const registry = buildSampleRegistry();
    const vite = renderSkillMarkdown(registry, { adapter: "vite" });
    expect(vite).toContain("### Runtime escape hatch");
    expect(vite).toContain(`import { expandClassList } from "@shortwind/vite"`);
    expect(vite).toContain(`import registry from "virtual:shortwind/registry"`);

    const astro = renderSkillMarkdown(registry, { adapter: "astro" });
    expect(astro).toContain(`import { expandClassList } from "@shortwind/astro"`);
    expect(astro).toContain("virtual:shortwind/registry");

    const next = renderSkillMarkdown(registry, { adapter: "next" });
    expect(next).toContain(`import { expandClassList, loadRegistryFromDir } from "@shortwind/next"`);
    expect(next).not.toContain("virtual:shortwind/registry");
  });

  it("ships a copy-pasteable strict-mode snippet for the detected adapter (#81)", () => {
    const registry = buildSampleRegistry();
    const vite = renderSkillMarkdown(registry, { adapter: "vite" });
    expect(vite).toContain("### Catch silent leaks");
    expect(vite).toContain("shortwind({ strict: true })");
    expect(vite).not.toContain("withShortwind");

    const next = renderSkillMarkdown(registry, { adapter: "next" });
    expect(next).toContain("withShortwind({ strict: true })(nextConfig)");

    // No adapter detected: name all three wirings rather than guessing.
    const generic = renderSkillMarkdown(registry);
    expect(generic).toContain("shortwind({ strict: true })");
    expect(generic).toContain("withShortwind({ strict: true })");
    expect(generic).toContain("integrations: [shortwind({ strict: true })]");
  });

  it("escape-hatch examples also only use installed recipes (#80/#81)", () => {
    const registry = buildSampleRegistry(); // no badge/tab/nav families
    const md = renderSkillMarkdown(registry, { adapter: "vite" });
    const section = md.slice(md.indexOf("### Runtime escape hatch"), md.indexOf("### Catch silent leaks"));
    for (const m of section.matchAll(/@([A-Za-z0-9][\w-]*)/g)) {
      const name = m[1]!;
      if (name === "shortwind") continue; // the package scope, not a recipe
      expect(Object.keys(registry.flattened), `@${name} is not installed`).toContain(name);
    }
  });

  it("includes the dynamic-class guidance even for an empty registry", () => {
    const md = renderSkillMarkdown({ families: {}, flattened: {} });
    expect(md).toContain("## Dynamic classes");
  });

  it("renders a minimal but valid SKILL.md for an empty registry", () => {
    const md = renderSkillMarkdown({ families: {}, flattened: {} });
    expect(md.startsWith("---\n")).toBe(true);
    expect(md).toContain("name: shortwind");
    expect(md).toContain("description:");
    expect(md).toContain("# Shortwind");
    expect(md).toContain("## Available recipes");
    expect(md).toContain("No families installed yet");
    // No per-family sections (the escape-hatch/strict subsections are
    // intentionally present even before any family is installed).
    expect(md).not.toMatch(/### \w+ recipes/);
  });
});
