import { describe, expect, it } from "vitest";
import { buildRegistry, expand, parseRecipeFile } from "@shortwind/core";
import type { Recipe } from "@shortwind/core";
import { expandPage, type ExpandPageInput } from "./expand";

// CLOUD-20 — server-side expansion (the DEFAULT expansion host; the Worker serve
// path never expands, per worker/SPIKE.md). These tests exercise the PURE
// `expandPage` helper directly — no Convex deployment, no codegen — and hold it
// to the SAME parity bar the CLOUD-02 spike used: the frozen Tailwind HTML must
// be BYTE-IDENTICAL to calling @shortwind/core `expand` on the same input.

// --- Fixtures: byte-faithful copies of site/recipes/{button,card}.css --------
// Inlined as constants (no fs) so the test is self-contained and the parity
// reference is computed from the identical bytes the helper sees.

const BUTTON_CSS = `/* shortwind: button@0.0.2 sha:b0b08652cd757b90 */

/* @guide
   (guidance text omitted from the fixture — it does not affect expansion)
*/

/* Shared button base — sizing, focus ring, disabled state. */
@recipe btn-base {
  inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50
}

/* Primary call-to-action button. */
@recipe btn-primary {
  @btn-base bg-primary text-primary-foreground hover:bg-primary/90
}

/* Small primary button. */
@recipe btn-primary-sm {
  @btn-primary px-3 py-1.5 text-xs
}

/* Ghost button — text only, no background. */
@recipe btn-ghost {
  @btn-base text-foreground hover:bg-muted
}

/* Ghost button (alias of @btn-ghost). */
@recipe button-ghost { @btn-ghost }
`;

const CARD_CSS = `/* shortwind: card@0.0.1 sha:4813cef10cd21824 — DO NOT EDIT THIS LINE */

/* Default content card with border, padding, and surface color. */
@recipe card {
  rounded-lg border border-border bg-card text-card-foreground p-4
}

/* Card with raised shadow for emphasis. */
@recipe card-elevated {
  @card shadow-md
}

/* Card header region with bottom divider. */
@recipe card-header {
  mb-3 border-b border-border pb-3
}

/* Card body region. */
@recipe card-body {
  py-1
}
`;

const RECIPES: ExpandPageInput["recipes"] = [
  { filename: "button.css", source: BUTTON_CSS },
  { filename: "card.css", source: CARD_CSS },
];

const INPUT_HTML =
  '<div class="@card-elevated">\n' +
  '  <header class="@card-header">Title</header>\n' +
  '  <div class="@card-body">\n' +
  '    <button class="@btn-primary-sm">Save</button>\n' +
  '    <button class="@button-ghost">Cancel</button>\n' +
  "  </div>\n" +
  "</div>";

// Compute the core reference the same way CLOUD-02 did: parse → build → expand,
// directly against @shortwind/core, from the identical fixture bytes.
function coreExpand(html: string, recipes: ExpandPageInput["recipes"]): string {
  const all: Recipe[] = [];
  for (const { source, filename } of recipes) {
    const parsed = parseRecipeFile(source, filename);
    if (!parsed.ok) throw new Error(`parse ${filename}: ${parsed.errors.map((e) => e.message).join("; ")}`);
    all.push(...parsed.value.recipes);
  }
  const built = buildRegistry(all);
  if (!built.ok) throw new Error(built.errors.map((e) => e.message).join("; "));
  return expand(html, built.value);
}

describe("CLOUD-20: expandPage server-side expansion", () => {
  it("produces frozen Tailwind HTML byte-identical to @shortwind/core expand", async () => {
    const reference = coreExpand(INPUT_HTML, RECIPES);
    const out = await expandPage({ html: INPUT_HTML, recipes: RECIPES });

    // Byte-identical: exact equality + length guard so trailing-whitespace or
    // encoding drift can't slip past.
    expect(out.expandedHtml).toBe(reference);
    expect(out.expandedHtml.length).toBe(reference.length);
  });

  it("exercises tailwind-merge: @btn-primary-sm drops the conflicting base utilities", async () => {
    const out = await expandPage({
      html: '<button class="@btn-primary-sm">x</button>',
      recipes: RECIPES,
    });
    expect(out.expandedHtml).toContain("px-3");
    expect(out.expandedHtml).toContain("py-1.5");
    expect(out.expandedHtml).toContain("text-xs");
    expect(out.expandedHtml).not.toContain("px-4");
    expect(out.expandedHtml).not.toContain("py-2");
  });

  it("is deterministic: same input -> same expandedHtml, css, and expandedHash", async () => {
    const a = await expandPage({ html: INPUT_HTML, recipes: RECIPES });
    const b = await expandPage({ html: INPUT_HTML, recipes: RECIPES });
    expect(a.expandedHtml).toBe(b.expandedHtml);
    expect(a.css).toBe(b.css);
    expect(a.expandedHash).toBe(b.expandedHash);
  });

  it("computes a lowercase-hex expandedHash over the frozen artifact", async () => {
    const out = await expandPage({ html: INPUT_HTML, recipes: RECIPES });
    expect(out.expandedHash).toMatch(/^[0-9a-f]+$/);
    expect(out.expandedHash.length).toBeGreaterThan(0);
  });

  it("changes expandedHash when the frozen output changes", async () => {
    const a = await expandPage({ html: '<div class="@card">a</div>', recipes: RECIPES });
    const b = await expandPage({ html: '<div class="@card">b</div>', recipes: RECIPES });
    expect(a.expandedHtml).not.toBe(b.expandedHtml);
    expect(a.expandedHash).not.toBe(b.expandedHash);
  });

  it("folds the css preamble into expandedHash (same html, different css -> different hash)", async () => {
    const a = await expandPage({ html: INPUT_HTML, recipes: RECIPES });
    const b = await expandPage({
      html: INPUT_HTML,
      recipes: RECIPES,
      css: ':root { --primary: oklch(0.5 0.2 250); }',
    });
    expect(a.expandedHtml).toBe(b.expandedHtml);
    expect(a.css).not.toBe(b.css);
    expect(a.expandedHash).not.toBe(b.expandedHash);
  });

  it("honors ExpandMode (jsx): rewrites className= as well as class=", async () => {
    const html = '<div className="@card">x</div>';
    const out = await expandPage({ html, recipes: RECIPES, options: { mode: "jsx" } });
    const reference = expand(
      html,
      (() => {
        const all: Recipe[] = [];
        for (const { source, filename } of RECIPES) {
          const p = parseRecipeFile(source, filename);
          if (!p.ok) throw new Error("parse");
          all.push(...p.value.recipes);
        }
        const r = buildRegistry(all);
        if (!r.ok) throw new Error("build");
        return r.value;
      })(),
      { mode: "jsx" },
    );
    expect(out.expandedHtml).toBe(reference);
  });

  it("surfaces a recipe parse failure as a structured error (not a silent miss)", async () => {
    await expect(
      expandPage({
        html: '<div class="@x">y</div>',
        recipes: [{ filename: "broken.css", source: "@recipe {" }],
      }),
    ).rejects.toThrow();
  });
});
