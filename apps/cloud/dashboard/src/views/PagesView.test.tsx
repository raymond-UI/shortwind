import { describe, expect, it } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { PagesView } from "./PagesView";
import { renderWithData } from "../test/render";

describe("PagesView", () => {
  it("lists every page with its current state", () => {
    renderWithData(<PagesView />);
    expect(screen.getByText("/launch")).toBeInTheDocument();
    expect(screen.getByText("/pulled")).toBeInTheDocument();
    // Dead pages are flagged by lifecycle.
    expect(screen.getByText("tombstoned")).toBeInTheDocument();
  });

  it("reveals per-page version history on expand", () => {
    renderWithData(<PagesView />);
    expect(screen.queryByTestId("versions-launch")).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByLabelText("Toggle version history for launch"),
    );
    const history = screen.getByTestId("versions-launch");
    expect(history).toBeInTheDocument();
    expect(history.textContent).toContain("v3");
    expect(history.textContent).toContain("v2");
  });

  it("renders the empty state", () => {
    renderWithData(<PagesView />, { pages: [] });
    expect(screen.getByText(/No pages published yet/)).toBeInTheDocument();
  });
});
