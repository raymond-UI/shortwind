import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { RecipeEditsView } from "./RecipeEditsView";
import { AuditView } from "./AuditView";
import { renderWithData } from "../test/render";

/**
 * The §5.4 requirement: recipe-edit events render DISTINCTLY from page edits so
 * the human notices and can roll back. These tests pin that distinction.
 */
describe("RecipeEditsView (PRD §5.4 — distinct recipe-edit feed)", () => {
  it("renders the canonical 'affects N pages on next publish' phrasing", () => {
    renderWithData(<RecipeEditsView />);
    expect(
      screen.getByText(/@card 0\.4\.0 → 0\.5\.0, affects 12 pages on next publish/),
    ).toBeInTheDocument();
  });

  it("describes a first-version family as 'created' and singularizes one page", () => {
    renderWithData(<RecipeEditsView />);
    expect(
      screen.getByText(/@button created 0\.1\.0, affects 1 page on next publish/),
    ).toBeInTheDocument();
  });

  it("marks every recipe-edit row with the distinct recipe-edit styling", () => {
    renderWithData(<RecipeEditsView />);
    const rows = screen.getAllByTestId("recipe-edit-row");
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      // The distinct marker + class an ordinary page edit never carries.
      expect(row).toHaveAttribute("data-recipe-edit", "true");
      expect(row.className).toContain("recipe-edit");
    }
    // Every row is tagged "recipe edit" — the human-facing distinction.
    expect(screen.getAllByText("recipe edit")).toHaveLength(2);
  });

  it("recipe-edit rows are visually distinct from audit (page-edit) rows", () => {
    // Render the recipe feed and the audit feed; the page-edit rows in the audit
    // log must NOT carry the recipe-edit marker/class.
    const { unmount } = renderWithData(<RecipeEditsView />);
    const recipeRow = screen.getAllByTestId("recipe-edit-row")[0];
    expect(recipeRow.className).toContain("recipe-edit");
    unmount();

    renderWithData(<AuditView />);
    const auditRows = screen.getAllByTestId("audit-row");
    expect(auditRows.length).toBeGreaterThan(0);
    for (const row of auditRows) {
      expect(row).not.toHaveAttribute("data-recipe-edit");
      expect(row.className).not.toContain("recipe-edit");
    }
  });

  it("shows a loading branch while the feed is undefined", () => {
    renderWithData(<RecipeEditsView />, { recipeEdits: undefined });
    expect(screen.getByText(/Loading recipe edits/)).toBeInTheDocument();
  });
});
