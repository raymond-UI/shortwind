import { describe, expect, it, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { PolicyView } from "./PolicyView";
import { renderWithData } from "../test/render";

describe("PolicyView (operator policy toggle — the one mutation)", () => {
  it("reflects the current customDomainNeedsApproval state", () => {
    renderWithData(<PolicyView />);
    expect(screen.getByTestId("custom-domain-state")).toHaveTextContent("ON");
    expect(
      screen.getByText(/Custom domain needs approval/),
    ).toBeInTheDocument();
  });

  it("calls setPolicy with the flipped value when toggled", async () => {
    const setPolicy = vi.fn().mockResolvedValue(undefined);
    renderWithData(<PolicyView />, { setPolicy });

    fireEvent.click(screen.getByTestId("toggle-custom-domain"));

    await waitFor(() => expect(setPolicy).toHaveBeenCalledTimes(1));
    // Current fixture is ON (true) → toggle persists OFF (false).
    expect(setPolicy).toHaveBeenCalledWith({
      customDomainNeedsApproval: false,
    });
  });

  it("keeps static text visible while policy loads (/ui: mask only dynamics)", () => {
    renderWithData(<PolicyView />, { policy: undefined });
    expect(
      screen.getByRole("status", { name: /loading policy/i }),
    ).toBeInTheDocument();
    // The toggle's label/description are known — they render immediately.
    expect(
      screen.getByText("Custom domain needs approval"),
    ).toBeInTheDocument();
  });
});
