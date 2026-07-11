import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { RecipesView } from "./RecipesView";
import { renderWithData } from "../test/render";

/**
 * Recipes panel — catalog-style master/detail. Fixtures: button + card
 * (standard), hero-banner (custom); families are sorted, so `button` is the
 * default selection.
 */
describe("RecipesView", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists families in the rail and flags custom ones", () => {
    renderWithData(<RecipesView />);
    expect(screen.getByTestId("recipe-item-button")).toBeInTheDocument();
    expect(screen.getByTestId("recipe-item-card")).toBeInTheDocument();
    const custom = screen.getByTestId("recipe-item-hero-banner");
    expect(within(custom).getByLabelText("custom")).toBeInTheDocument();
  });

  it("selects the first family by default and shows its detail + preview", () => {
    renderWithData(<RecipesView />);
    const detail = screen.getByTestId("recipe-detail");
    expect(within(detail).getByText("button")).toBeInTheDocument();
    expect(screen.getByTestId("recipe-preview")).toBeInTheDocument();
  });

  it("switches the detail when a family is selected", () => {
    renderWithData(<RecipesView />);
    fireEvent.click(screen.getByTestId("recipe-item-card"));
    const detail = screen.getByTestId("recipe-detail");
    expect(within(detail).getByText("card")).toBeInTheDocument();
    // The card body's utilities are surfaced as chips.
    expect(
      within(screen.getByTestId("recipe-utilities")).getByText("rounded-lg"),
    ).toBeInTheDocument();
  });

  it("filters the rail by the search box", () => {
    renderWithData(<RecipesView />);
    fireEvent.change(screen.getByTestId("recipes-search"), {
      target: { value: "hero" },
    });
    expect(screen.getByTestId("recipe-item-hero-banner")).toBeInTheDocument();
    expect(screen.queryByTestId("recipe-item-button")).not.toBeInTheDocument();
  });

  it("offers Reset in the detail for a standard family, resetting through the seam", async () => {
    const resetRecipes = vi.fn(async () => ({ reset: 1 }));
    renderWithData(<RecipesView />, { resetRecipes });
    // Default selection is the standard `button` family.
    fireEvent.click(screen.getByTestId("reset-button"));
    await waitFor(() => expect(resetRecipes).toHaveBeenCalledWith("button"));
  });

  it("hides the detail Reset for a custom family", () => {
    renderWithData(<RecipesView />);
    fireEvent.click(screen.getByTestId("recipe-item-hero-banner"));
    expect(screen.queryByTestId("reset-hero-banner")).not.toBeInTheDocument();
  });

  it("reveals the recipe source on toggle", () => {
    renderWithData(<RecipesView />);
    expect(screen.queryByTestId("recipe-source")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("recipe-source-toggle"));
    expect(screen.getByTestId("recipe-source")).toHaveTextContent("@recipe button");
  });

  it("reset-all confirms and calls the seam with no family", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const resetRecipes = vi.fn(async () => ({ reset: 2 }));
    renderWithData(<RecipesView />, { resetRecipes });
    fireEvent.click(screen.getByTestId("reset-all-recipes"));
    expect(confirm).toHaveBeenCalled();
    await waitFor(() => expect(resetRecipes).toHaveBeenCalledWith());
  });

  it("keeps the search chrome visible while the palette loads, masking the list (/ui)", () => {
    renderWithData(<RecipesView />, { recipeVersions: undefined });
    // Static chrome renders immediately…
    expect(screen.getByTestId("recipes-search")).toBeInTheDocument();
    // …the list is masked with a skeleton…
    expect(
      screen.getByRole("status", { name: /loading recipes/i }),
    ).toBeInTheDocument();
    // …and no family rows are shown yet.
    expect(screen.queryByTestId("recipe-item-button")).not.toBeInTheDocument();
  });

  it("shows an empty message when the palette is empty", () => {
    renderWithData(<RecipesView />, { recipeVersions: [] });
    expect(screen.getByText(/No recipes in this palette/)).toBeInTheDocument();
  });
});
