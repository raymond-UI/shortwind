import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { BillingView } from "./BillingView";
import { renderWithData } from "../test/render";

/**
 * Stub `window.location` so the redirect (`window.location.href = url`) after a
 * successful checkout/portal call is an inert property set, not a jsdom
 * "navigation not implemented" error.
 */
function stubLocationHref(): void {
  vi.stubGlobal("location", { href: "" });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("BillingView (Stripe billing surface)", () => {
  it("renders the active Pro plan with its renewal date", () => {
    renderWithData(<BillingView />);
    expect(screen.getByTestId("billing-plan")).toHaveTextContent("Pro");
    expect(screen.getByTestId("billing-active")).toHaveTextContent("Active");
    expect(screen.getByTestId("billing-renewal")).toHaveTextContent(/Renews on/);
  });

  it("shows the Manage button for an active subscription", () => {
    renderWithData(<BillingView />);
    expect(screen.getByTestId("billing-manage")).toBeInTheDocument();
    expect(screen.queryByTestId("billing-upgrade")).not.toBeInTheDocument();
  });

  it("shows the Upgrade button for a free account", () => {
    renderWithData(<BillingView />, {
      billing: {
        plan: "free",
        hasActive: false,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
      },
    });
    expect(screen.getByTestId("billing-plan")).toHaveTextContent("Free");
    expect(screen.getByTestId("billing-upgrade")).toBeInTheDocument();
    // Free has no renewal line (exceptions-only copy: nothing to renew).
    expect(screen.queryByTestId("billing-renewal")).not.toBeInTheDocument();
  });

  it("says 'Cancels on' when the subscription is set to cancel", () => {
    renderWithData(<BillingView />, {
      billing: {
        plan: "pro",
        hasActive: true,
        currentPeriodEnd: 1_735_689_600,
        cancelAtPeriodEnd: true,
      },
    });
    expect(screen.getByTestId("billing-renewal")).toHaveTextContent(/Cancels on/);
  });

  it("calls startCheckout('pro') when Upgrade is clicked", async () => {
    stubLocationHref();
    const startCheckout = vi
      .fn()
      .mockResolvedValue({ url: "https://checkout.stripe.test/s" });
    renderWithData(<BillingView />, {
      billing: {
        plan: "free",
        hasActive: false,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
      },
      startCheckout,
    });
    fireEvent.click(screen.getByTestId("billing-upgrade"));
    await waitFor(() => expect(startCheckout).toHaveBeenCalledWith("pro"));
  });

  it("calls openPortal when Manage is clicked", async () => {
    stubLocationHref();
    const openPortal = vi
      .fn()
      .mockResolvedValue({ url: "https://portal.stripe.test/s" });
    renderWithData(<BillingView />, { openPortal });
    fireEvent.click(screen.getByTestId("billing-manage"));
    await waitFor(() => expect(openPortal).toHaveBeenCalledTimes(1));
  });

  it("surfaces an error when checkout fails", async () => {
    const startCheckout = vi.fn().mockRejectedValue(new Error("boom"));
    renderWithData(<BillingView />, {
      billing: {
        plan: "free",
        hasActive: false,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
      },
      startCheckout,
    });
    fireEvent.click(screen.getByTestId("billing-upgrade"));
    await waitFor(() =>
      expect(screen.getByTestId("billing-error")).toBeInTheDocument(),
    );
  });

  it("shows the loading branch while billing is undefined", () => {
    renderWithData(<BillingView />, { billing: undefined });
    expect(screen.getByRole("status", { name: /loading billing/i })).toBeInTheDocument();
  });
});
