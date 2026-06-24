import { describe, expect, it, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { PagesView } from "./PagesView";
import { renderWithData } from "../test/render";

describe("PagesView (Overview cards)", () => {
  it("renders a card per page with its state", () => {
    renderWithData(<PagesView />);
    expect(screen.getByTestId("page-card-launch")).toBeInTheDocument();
    expect(screen.getByTestId("page-card-pulled")).toBeInTheDocument();
    // Dead pages show their lifecycle instead of "live".
    expect(screen.getByText("tombstoned")).toBeInTheDocument();
  });

  it("calls onOpen when the card's title button is activated", () => {
    const onOpen = vi.fn();
    renderWithData(<PagesView onOpen={onOpen} />);
    // The title is a real <button> (stretched over the card), not a div role.
    fireEvent.click(screen.getByRole("button", { name: "launch" }));
    expect(onOpen).toHaveBeenCalledWith("page_1");
  });

  it("renders the empty state", () => {
    renderWithData(<PagesView />, { pages: [] });
    expect(screen.getByTestId("pages-empty")).toBeInTheDocument();
  });
});
