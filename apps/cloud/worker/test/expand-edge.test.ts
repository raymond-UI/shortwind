import { describe, expect, it } from "vitest";
import { expandWithRecipes } from "../src/expand-edge";
import type { RecipeSource } from "../src/expand-edge";

// CLOUD-02 Phase-0 spike test. THIS RUNS INSIDE workerd (via
// @cloudflare/vitest-pool-workers, see worker/vitest.config.ts), NOT Node.
//
// It calls @shortwind/core's expand() in the real Cloudflare runtime and
// asserts the output is BYTE-IDENTICAL to the reference computed in Node. The
// reference (NODE_GOLDEN below) was produced by running the exact same
// parseRecipeFile → buildRegistry → expand pipeline under Node v24 against the
// exact same recipe fixtures and input HTML, then JSON.stringify'd verbatim:
//
//   node --input-type=module -e "<same pipeline>"  →  JSON.stringify(out)
//
// If this test passes, expand() runs cleanly under workerd → SPIKE outcome is
// Worker-OK. If it cannot even boot/import, that is the fall-back-to-Convex
// signal. Either way, see worker/SPIKE.md.

// --- Fixtures: committed copies of site/recipes/{button,card}.css ------------
// Inlined as string constants (not fs reads) so the test is fully self-contained
// inside workerd — no Node `fs`, no bundler loader assumptions. These are
// byte-faithful to worker/test/fixtures/{button,card}.css (also committed).

const BUTTON_CSS = `/* shortwind: button@0.0.2 sha:b0b08652cd757b90 */

/* @guide
   (guidance text omitted from the spike fixture — it does not affect expansion)
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

const RECIPES: RecipeSource[] = [
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

// Reference output computed in Node (v24) from the identical pipeline + inputs.
// Pasted verbatim from `JSON.stringify(expand(...))`.
const NODE_GOLDEN =
  '<div class="rounded-lg border border-border bg-card text-card-foreground p-4 shadow-md">\n' +
  '  <header class="mb-3 border-b border-border pb-3">Title</header>\n' +
  '  <div class="py-1">\n' +
  '    <button class="inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 px-3 py-1.5 text-xs">Save</button>\n' +
  '    <button class="inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50 text-foreground hover:bg-muted">Cancel</button>\n' +
  "  </div>\n" +
  "</div>";

describe("CLOUD-02 spike: @shortwind/core expand() under workerd", () => {
  it("imports and runs the full parse → resolve → expand pipeline in workerd", () => {
    const result = expandWithRecipes(INPUT_HTML, RECIPES);
    expect(result.ok).toBe(true);
  });

  it("produces output byte-identical to the Node reference (expand parity)", () => {
    const result = expandWithRecipes(INPUT_HTML, RECIPES);
    if (!result.ok) {
      throw new Error(`expand failed under workerd: ${result.errors.join("; ")}`);
    }
    // Byte-identical: exact string equality, and a length check so a trailing
    // whitespace/encoding drift cannot slip past a normalized comparison.
    expect(result.html).toBe(NODE_GOLDEN);
    expect(result.html.length).toBe(NODE_GOLDEN.length);
  });

  it("exercises tailwind-merge: @btn-primary-sm drops the base px-4/py-2/text-sm", () => {
    const result = expandWithRecipes('<button class="@btn-primary-sm">x</button>', RECIPES);
    if (!result.ok) throw new Error(result.errors.join("; "));
    // Proves tailwind-merge (core's only runtime dep) executes under workerd:
    // the smaller padding/size win over the base utilities they conflict with.
    expect(result.html).toContain("px-3");
    expect(result.html).toContain("py-1.5");
    expect(result.html).toContain("text-xs");
    expect(result.html).not.toContain("px-4");
    expect(result.html).not.toContain("py-2");
  });
});
