import { describe, expect, it, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { PagesView } from "./PagesView";
import { renderWithData } from "../test/render";
import { mockPages } from "../test/fixtures";
import type { PageWithVersions } from "../lib/types";

/** A second live page, older than `launch`, for search/sort assertions. */
const alphaPage: PageWithVersions = {
  page: {
    id: "page_3",
    slug: "alpha",
    visibility: "unlisted",
    lifecycle: "active",
    tags: [],
    currentVersion: 1,
    updatedAt: 1_700_000_100_000,
    createdAt: 1_700_000_000_000,
  },
  versions: [],
};

function cardOrder() {
  return screen
    .getAllByTestId(/^page-card-/)
    .map((el) => el.getAttribute("data-testid"));
}

describe("PagesView (Overview cards)", () => {
  it("shows live pages by default and hides archived ones behind the ghost card", () => {
    renderWithData(<PagesView />);
    expect(screen.getByTestId("page-card-launch")).toBeInTheDocument();
    // Tombstoned pages are filtered out of the default view…
    expect(screen.queryByTestId("page-card-pulled")).not.toBeInTheDocument();
    // …and surfaced through the archive ghost card instead.
    expect(screen.getByTestId("pages-archive-ghost")).toHaveTextContent(
      /1 archived/,
    );
  });

  it("opens the archive from the ghost card and clears the filter back to all", () => {
    renderWithData(<PagesView />);
    fireEvent.click(screen.getByTestId("pages-archive-ghost"));
    expect(screen.getByTestId("page-card-pulled")).toBeInTheDocument();
    expect(screen.queryByTestId("page-card-launch")).not.toBeInTheDocument();
    // Dead pages show their lifecycle instead of "live".
    expect(screen.getByText("tombstoned")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Clear status filter"));
    expect(screen.getByTestId("page-card-launch")).toBeInTheDocument();
    expect(screen.getByTestId("page-card-pulled")).toBeInTheDocument();
    expect(screen.queryByTestId("pages-archive-ghost")).not.toBeInTheDocument();
  });

  it("switches status through the filter chip menu", () => {
    renderWithData(<PagesView />);
    fireEvent.click(screen.getByLabelText("Filter pages by status"));
    fireEvent.click(screen.getByTestId("status-all"));
    expect(screen.getByTestId("page-card-launch")).toBeInTheDocument();
    expect(screen.getByTestId("page-card-pulled")).toBeInTheDocument();
  });

  it("filters by search across slug and tags", () => {
    renderWithData(<PagesView />, { pages: [...mockPages, alphaPage] });
    const input = screen.getByLabelText("Search pages");

    fireEvent.change(input, { target: { value: "alpha" } });
    expect(screen.getByTestId("page-card-alpha")).toBeInTheDocument();
    expect(screen.queryByTestId("page-card-launch")).not.toBeInTheDocument();

    // Tag match: `launch` carries the "marketing" tag.
    fireEvent.change(input, { target: { value: "marketing" } });
    expect(screen.getByTestId("page-card-launch")).toBeInTheDocument();
    expect(screen.queryByTestId("page-card-alpha")).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: "no-such-page" } });
    expect(screen.getByTestId("pages-no-match")).toBeInTheDocument();
  });

  it("sorts by last published by default and by name on demand", () => {
    renderWithData(<PagesView />, { pages: [...mockPages, alphaPage] });
    expect(cardOrder()).toEqual(["page-card-launch", "page-card-alpha"]);

    fireEvent.click(screen.getByLabelText("Sort pages"));
    fireEvent.click(screen.getByTestId("sort-name"));
    expect(cardOrder()).toEqual(["page-card-alpha", "page-card-launch"]);
  });

  it("shows only exceptional states on cards — public/private badge yes, unlisted no", () => {
    renderWithData(<PagesView />, { pages: [...mockPages, alphaPage] });
    // `launch` is public → badge; `alpha` is unlisted (the default) → no badge.
    expect(screen.getByText("public")).toBeInTheDocument();
    expect(screen.queryByText("unlisted")).not.toBeInTheDocument();
  });

  it("caps visible tags and summarizes the rest", () => {
    const tagged: PageWithVersions = {
      ...alphaPage,
      page: { ...alphaPage.page, id: "page_4", slug: "tagged", tags: ["a", "b", "c", "d"] },
    };
    renderWithData(<PagesView />, { pages: [tagged] });
    expect(screen.getByText("a")).toBeInTheDocument();
    expect(screen.getByText("b")).toBeInTheDocument();
    expect(screen.queryByText("c")).not.toBeInTheDocument();
    expect(screen.getByText("+2")).toBeInTheDocument();
  });

  it("calls onOpen when the card's title button is activated", () => {
    const onOpen = vi.fn();
    renderWithData(<PagesView onOpen={onOpen} />);
    // The title is a real <button> (stretched over the card), not a div role.
    fireEvent.click(screen.getByRole("button", { name: "launch" }));
    expect(onOpen).toHaveBeenCalledWith("page_1");
  });

  it("opens the New Page dialog with the publish command", () => {
    renderWithData(<PagesView />);
    fireEvent.click(screen.getByRole("button", { name: /new page/i }));
    expect(screen.getByRole("dialog")).toHaveTextContent(
      /shortwind cloud publish/,
    );
  });

  it("keeps header and controls visible while pages load", () => {
    renderWithData(<PagesView />, { pages: undefined });
    expect(screen.getByText("Your hosted pages")).toBeInTheDocument();
    expect(screen.getByLabelText("Search pages")).toBeInTheDocument();
    expect(screen.getByTestId("pages-loading")).toBeInTheDocument();
  });

  it("renders the empty state", () => {
    renderWithData(<PagesView />, { pages: [] });
    expect(screen.getByTestId("pages-empty")).toBeInTheDocument();
  });
});
