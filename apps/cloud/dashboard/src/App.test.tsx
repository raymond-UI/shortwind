import { describe, expect, it } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { App } from "./App";
import { renderWithData } from "./test/render";

/**
 * Integration-shape smoke (CLOUD-35): the whole dashboard shell renders against
 * mocked Convex data and each oversight view is reachable. Asserts the §5.4
 * distinction survives end-to-end (the Recipe-edits tab shows recipe-edit rows).
 */
describe("App (integration smoke)", () => {
  it("mounts the shell with all five oversight tabs", () => {
    renderWithData(<App />);
    expect(screen.getByText("Shortwind Cloud")).toBeInTheDocument();
    for (const label of [
      "Pages",
      "Audit log",
      "Recipe edits",
      "Moderation",
      "Policy",
    ]) {
      expect(
        screen.getByRole("button", { name: label }),
      ).toBeInTheDocument();
    }
    // Default tab is Pages.
    expect(screen.getByTestId("pages-view")).toBeInTheDocument();
  });

  it("navigates to the distinct recipe-edit feed and shows recipe-edit rows", () => {
    renderWithData(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Recipe edits" }));
    expect(screen.getByTestId("recipe-edits-view")).toBeInTheDocument();
    const rows = screen.getAllByTestId("recipe-edit-row");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toHaveAttribute("data-recipe-edit", "true");
  });

  it("navigates across audit, moderation, and policy views", () => {
    renderWithData(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Audit log" }));
    expect(screen.getByTestId("audit-view")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Moderation" }));
    expect(screen.getByTestId("moderation-view")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Policy" }));
    expect(screen.getByTestId("policy-view")).toBeInTheDocument();
  });

  it("navigates to the CLOUD-43 Usage (metered-billing) view", () => {
    renderWithData(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Usage" }));
    expect(screen.getByTestId("usage-view")).toBeInTheDocument();
    // The three cost-aligned meters are present.
    expect(screen.getByTestId("usage-meter-publishes")).toBeInTheDocument();
    expect(screen.getByTestId("usage-meter-customDomains")).toBeInTheDocument();
    expect(screen.getByTestId("usage-meter-storage")).toBeInTheDocument();
  });
});
