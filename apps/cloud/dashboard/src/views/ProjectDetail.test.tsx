import { describe, expect, it, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { ProjectDetail } from "./ProjectDetail";
import { renderWithData } from "../test/render";

describe("ProjectDetail", () => {
  it("shows the selected page and its deployment history", () => {
    renderWithData(<ProjectDetail pageId="page_1" onBack={() => {}} />);
    expect(screen.getByTestId("project-detail")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "launch" })).toBeInTheDocument();

    // Deployments tab carries the version history (moved from the old inline expand).
    fireEvent.click(screen.getByRole("button", { name: "deployments" }));
    const deploys = screen.getByTestId("deployments");
    expect(deploys.textContent).toContain("v3");
    expect(deploys.textContent).toContain("v2");
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
});
