import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { UsageView } from "./UsageView";
import { renderWithData } from "../test/render";

describe("UsageView (CLOUD-43 metered billing surface)", () => {
  it("renders the three cost-aligned meters from usage", () => {
    renderWithData(<UsageView />);
    // publishes + custom domains as raw counts; storage as a human size.
    expect(screen.getByTestId("usage-value-publishes")).toHaveTextContent("42");
    expect(screen.getByTestId("usage-value-customDomains")).toHaveTextContent(
      "3",
    );
    // 5_242_880 bytes === 5 MiB (formatBytes, binary units).
    expect(screen.getByTestId("usage-value-storage")).toHaveTextContent("5 MiB");
  });

  it("labels the three meters distinctly", () => {
    renderWithData(<UsageView />);
    expect(screen.getByText("Publishes")).toBeInTheDocument();
    expect(screen.getByText("Custom domains")).toBeInTheDocument();
    expect(screen.getByText("Storage")).toBeInTheDocument();
  });

  it("states the §6.4 cost shape: page views are not billed", () => {
    renderWithData(<UsageView />);
    expect(screen.getByTestId("usage-cost-note")).toHaveTextContent(
      /viral page costs nothing/i,
    );
  });

  it("shows the loading branch while usage is undefined", () => {
    renderWithData(<UsageView />, { usage: undefined });
    expect(screen.getByText(/Loading usage/)).toBeInTheDocument();
  });

  it("renders zeros for a never-published account", () => {
    renderWithData(<UsageView />, {
      usage: {
        publishes: 0,
        customDomains: 0,
        storageBytes: 0,
        periodStart: null,
        periodEnd: 1_700_000_000_000,
      },
    });
    expect(screen.getByTestId("usage-value-publishes")).toHaveTextContent("0");
    expect(screen.getByTestId("usage-value-storage")).toHaveTextContent("0 B");
  });
});
