import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { RecipesView } from "./RecipesView";
import { renderWithData } from "../test/render";

/**
 * Recipes view (P4) — the account palette. Pins the standard/custom split, the
 * reset seams (per-family + reset-all), and the pre-backfill empty state.
 */
describe("RecipesView", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("splits standard families from custom ones", () => {
    renderWithData(<RecipesView />);
    // fixtures: button + card standard, hero-banner custom.
    expect(screen.getByTestId("recipes-standard")).toBeInTheDocument();
    expect(screen.getByTestId("recipes-custom")).toBeInTheDocument();
    expect(screen.getByText("button")).toBeInTheDocument();
    expect(screen.getByText("hero-banner")).toBeInTheDocument();
    // The custom family is tagged; standard ones are not.
    expect(screen.getByText("custom")).toBeInTheDocument();
  });

  it("offers Reset only on standard families", () => {
    renderWithData(<RecipesView />);
    expect(screen.getByTestId("reset-button")).toBeInTheDocument();
    expect(screen.getByTestId("reset-card")).toBeInTheDocument();
    expect(screen.queryByTestId("reset-hero-banner")).not.toBeInTheDocument();
  });

  it("resets a single family through the seam", async () => {
    const resetRecipes = vi.fn(async () => ({ reset: 1 }));
    renderWithData(<RecipesView />, { resetRecipes });
    fireEvent.click(screen.getByTestId("reset-card"));
    await waitFor(() => expect(resetRecipes).toHaveBeenCalledWith("card"));
  });

  it("reset-all confirms, calls the seam with no family, and reports the count", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const resetRecipes = vi.fn(async () => ({ reset: 2 }));
    renderWithData(<RecipesView />, { resetRecipes });
    fireEvent.click(screen.getByTestId("reset-all-recipes"));
    expect(confirm).toHaveBeenCalled();
    await waitFor(() => expect(resetRecipes).toHaveBeenCalledWith());
    expect(screen.getByTestId("recipes-note")).toHaveTextContent(
      /Reset 2 families/,
    );
  });

  it("reset-all is a no-op when the user cancels the confirm", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const resetRecipes = vi.fn(async () => ({ reset: 0 }));
    renderWithData(<RecipesView />, { resetRecipes });
    fireEvent.click(screen.getByTestId("reset-all-recipes"));
    expect(resetRecipes).not.toHaveBeenCalled();
  });

  it("shows the loading branch while the palette is undefined", () => {
    renderWithData(<RecipesView />, { recipeVersions: undefined });
    expect(
      screen.getByRole("status", { name: /loading recipes/i }),
    ).toBeInTheDocument();
  });

  it("shows the backfill hint when the palette is empty", () => {
    renderWithData(<RecipesView />, { recipeVersions: [] });
    expect(screen.getByTestId("recipes-empty")).toBeInTheDocument();
    expect(
      screen.getByText(/seedStandardKitBackfill/),
    ).toBeInTheDocument();
  });
});
