import { describe, expect, it, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { ProjectDetail } from "./ProjectDetail";
import { renderWithData } from "../test/render";

describe("ProjectDetail", () => {
  it("shows the selected page and its deployment history", () => {
    renderWithData(<ProjectDetail pageId="page_1" onBack={() => {}} />);
    expect(screen.getByTestId("project-detail")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "launch" })).toBeInTheDocument();

    // Deployments tab carries the version history (moved from the old inline expand).
    fireEvent.click(screen.getByRole("tab", { name: "deployments" }));
    const deploys = screen.getByTestId("deployments");
    expect(deploys.textContent).toContain("v3");
    expect(deploys.textContent).toContain("v2");
  });

  it("overview leads with the current deployment and cross-links to history", () => {
    renderWithData(<ProjectDetail pageId="page_1" onBack={() => {}} />);
    const hero = screen.getByTestId("current-deployment");
    expect(hero.textContent).toContain("v3");
    // Properties card carries visibility (moved out of the header).
    expect(screen.getByText("public")).toBeInTheDocument();
    // The hero's history link switches to the deployments tab.
    fireEvent.click(screen.getByTestId("view-deployments"));
    expect(screen.getByTestId("deployments")).toBeInTheDocument();
  });

  it("lists the custom-domain address alongside shortwind.app when active", () => {
    // Fixtures: pages.acme.com is active, www.acme.com is pending approval.
    renderWithData(<ProjectDetail pageId="page_1" onBack={() => {}} />);
    expect(screen.getByText(/pages\.acme\.com\/launch/)).toBeInTheDocument();
    expect(screen.queryByText(/www\.acme\.com/)).not.toBeInTheDocument();
  });

  it("shows only the vanity address when no domain is active", () => {
    renderWithData(<ProjectDetail pageId="page_1" onBack={() => {}} />, {
      accountDomains: [],
    });
    expect(screen.getByTestId("address-vanity")).toBeInTheDocument();
    expect(screen.queryByTestId("address-domain")).not.toBeInTheDocument();
  });

  it("calls onBack from the back button", () => {
    const onBack = vi.fn();
    renderWithData(<ProjectDetail pageId="page_1" onBack={onBack} />);
    fireEvent.click(screen.getByRole("button", { name: /All pages/ }));
    expect(onBack).toHaveBeenCalled();
  });

  it("handles an unknown page id", () => {
    renderWithData(<ProjectDetail pageId="nope" onBack={() => {}} />);
    expect(screen.getByText("Page not found")).toBeInTheDocument();
  });

  it("changes visibility via the dropdown menu", async () => {
    const setVisibility = vi.fn().mockResolvedValue(undefined);
    renderWithData(<ProjectDetail pageId="page_1" onBack={() => {}} />, {
      setVisibility,
    });
    fireEvent.click(screen.getByRole("tab", { name: "settings" }));
    // Open the visibility menu, then pick private (fixture page_1 is public).
    fireEvent.click(screen.getByRole("button", { name: "Change visibility" }));
    fireEvent.click(screen.getByTestId("visibility-private"));
    expect(setVisibility).toHaveBeenCalledWith("page_1", "private");
  });

  it("deletes a page via the confirm dialog and navigates back", async () => {
    const deletePage = vi.fn().mockResolvedValue(undefined);
    const onBack = vi.fn();
    renderWithData(<ProjectDetail pageId="page_1" onBack={onBack} />, {
      deletePage,
    });
    fireEvent.click(screen.getByRole("tab", { name: "settings" }));
    // delete-page opens the dialog; confirm-delete lives inside it.
    fireEvent.click(screen.getByTestId("delete-page"));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("confirm-delete"));
    await waitFor(() => expect(deletePage).toHaveBeenCalledWith("page_1"));
    await waitFor(() => expect(onBack).toHaveBeenCalled());
  });
});
