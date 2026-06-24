import { describe, expect, it } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { App } from "./App";
import { renderWithData } from "./test/render";

/**
 * Integration-shape smoke (epic #184): the owner-first shell renders against
 * mocked data and every section is reachable from the sidebar. Asserts the §5.4
 * recipe-edit distinction survives end-to-end (under the Activity section now).
 */
describe("App (integration smoke)", () => {
  it("mounts the sidebar shell with all sections", () => {
    renderWithData(<App />);
    expect(screen.getByText("shortwind")).toBeInTheDocument();
    for (const label of [
      "Overview",
      "Analytics",
      "Domains",
      "Usage",
      "Activity",
      "Moderation",
      "Settings",
    ]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    // Default section is Overview (the pages list).
    expect(screen.getByTestId("pages-view")).toBeInTheDocument();
  });

  it("Activity shows the distinct recipe-edit feed (§5.4)", () => {
    renderWithData(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Activity" }));
    expect(screen.getByTestId("audit-view")).toBeInTheDocument();
    expect(screen.getByTestId("recipe-edits-view")).toBeInTheDocument();
    const rows = screen.getAllByTestId("recipe-edit-row");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toHaveAttribute("data-recipe-edit", "true");
  });

  it("navigates to Moderation and Settings (policy folded in)", () => {
    renderWithData(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Moderation" }));
    expect(screen.getByTestId("moderation-view")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByTestId("settings-view")).toBeInTheDocument();
    // Policy lives inside Settings now.
    expect(screen.getByTestId("policy-view")).toBeInTheDocument();
  });

  it("navigates to the metered Usage view", () => {
    renderWithData(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Usage" }));
    expect(screen.getByTestId("usage-view")).toBeInTheDocument();
    expect(screen.getByTestId("usage-meter-publishes")).toBeInTheDocument();
    expect(screen.getByTestId("usage-meter-customDomains")).toBeInTheDocument();
    expect(screen.getByTestId("usage-meter-storage")).toBeInTheDocument();
  });

  it("Domains and Analytics sections render", () => {
    renderWithData(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Domains" }));
    // Fixture pages include a custom domain, so the list renders.
    expect(screen.getByTestId("domains-view")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Analytics" }));
    expect(screen.getByTestId("analytics-view")).toBeInTheDocument();
  });
});
