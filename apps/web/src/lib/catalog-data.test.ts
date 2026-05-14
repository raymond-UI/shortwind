import { describe, expect, it } from "vitest";
import { buildCatalogFromSources } from "./catalog-data";

const CARD_CSS = `/* shortwind: card@0.0.1 sha:000000 */

/* Default card. */
@recipe card {
  rounded-lg border p-4
}

/* Elevated card. */
@recipe card-elevated {
  @card shadow-md
}
`;

const BUTTON_CSS = `/* shortwind: button@0.0.1 sha:000000 */

/* Primary action. */
@recipe button {
  inline-flex items-center rounded bg-blue-600 px-4 py-2 text-white
}
`;

describe("buildCatalogFromSources", () => {
  it("parses sources into families with expanded class lists", () => {
    const data = buildCatalogFromSources({
      "card.css": CARD_CSS,
      "button.css": BUTTON_CSS,
    });

    const familyNames = data.families.map((f) => f.name);
    expect(familyNames).toEqual(["button", "card"]);

    const card = data.families.find((f) => f.name === "card");
    expect(card!.recipes.map((r) => r.name)).toEqual(["card", "card-elevated"]);

    const cardElevated = card!.recipes.find((r) => r.name === "card-elevated")!;
    expect(cardElevated.expansion).toContain("shadow-md");
    expect(cardElevated.expansion).toContain("rounded-lg");
    expect(cardElevated.expansion.every((t) => !t.startsWith("@"))).toBe(true);
  });

  it("returns an empty catalog when every source fails to parse", () => {
    const data = buildCatalogFromSources({ "broken.css": "not a recipe file" });
    expect(data.families).toEqual([]);
  });
});
