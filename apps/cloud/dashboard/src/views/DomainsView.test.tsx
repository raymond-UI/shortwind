import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { DomainsView } from "./DomainsView";
import { renderWithData } from "../test/render";

describe("DomainsView (UI custom-domain management)", () => {
  it("shows the bind form when the account has no domain", () => {
    renderWithData(<DomainsView />, { accountDomains: [] });
    expect(screen.getByTestId("domain-bind-form")).toBeInTheDocument();
    expect(screen.getByTestId("domain-input")).toBeInTheDocument();
  });

  it("binds the entered hostname via the session on Connect", async () => {
    const bindDomain = vi.fn().mockResolvedValue({
      state: "pending-cert",
      hostname: "pages.acme.com",
      cloudflareHostnameId: "cf_1",
    });
    renderWithData(<DomainsView />, { accountDomains: [], bindDomain });
    fireEvent.change(screen.getByTestId("domain-input"), {
      target: { value: "pages.acme.com" },
    });
    fireEvent.click(screen.getByTestId("domain-connect"));
    await waitFor(() =>
      expect(bindDomain).toHaveBeenCalledWith("pages.acme.com"),
    );
  });

  it("shows the CNAME instructions + Check status for a pending domain", () => {
    renderWithData(<DomainsView />, {
      accountDomains: [
        {
          id: "d1",
          hostname: "pages.acme.com",
          status: "pending-cert",
          verifiedAt: null,
          createdAt: 1,
        },
      ],
      cnameTarget: "cname.shortwind.app",
    });
    // The DNS record the user must add.
    expect(screen.getByText("CNAME")).toBeInTheDocument();
    expect(screen.getByText("cname.shortwind.app")).toBeInTheDocument();
    // A pending domain offers a status re-check; no bind form (quota is 1).
    expect(
      screen.getByTestId("domain-recheck-pages.acme.com"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("domain-bind-form")).not.toBeInTheDocument();
  });

  it("re-checks a pending domain's cert on Check status", async () => {
    const recheckDomain = vi.fn().mockResolvedValue({
      state: "active",
      hostname: "pages.acme.com",
      cloudflareHostnameId: "cf_1",
    });
    renderWithData(<DomainsView />, {
      accountDomains: [
        {
          id: "d1",
          hostname: "pages.acme.com",
          status: "pending-cert",
          verifiedAt: null,
          createdAt: 1,
        },
      ],
      recheckDomain,
    });
    fireEvent.click(screen.getByTestId("domain-recheck-pages.acme.com"));
    await waitFor(() =>
      expect(recheckDomain).toHaveBeenCalledWith("pages.acme.com"),
    );
  });

  it("surfaces the friendly ConvexError message (not the raw wrapper) + upgrade nudge", async () => {
    // A Convex function throwing ConvexError surfaces its payload on `.data`.
    const bindDomain = vi.fn().mockRejectedValue(
      Object.assign(new Error("[Request ID: abc] Server Error"), {
        data: {
          code: "NOT_ENTITLED",
          message: "Custom domains require a paid plan.",
        },
      }),
    );
    renderWithData(<DomainsView />, { accountDomains: [], bindDomain });
    fireEvent.change(screen.getByTestId("domain-input"), {
      target: { value: "pages.acme.com" },
    });
    fireEvent.click(screen.getByTestId("domain-connect"));
    await waitFor(() =>
      expect(screen.getByTestId("domain-error")).toHaveTextContent(
        "Custom domains require a paid plan.",
      ),
    );
    // No raw "Server Error" leak, and the entitlement case nudges to Billing.
    expect(screen.getByTestId("domain-error")).not.toHaveTextContent(
      "Server Error",
    );
    expect(screen.getByTestId("domain-error")).toHaveTextContent(/Billing/);
  });

  it("marks an active domain and hides its DNS instructions", () => {
    renderWithData(<DomainsView />, {
      accountDomains: [
        {
          id: "d1",
          hostname: "pages.acme.com",
          status: "active",
          verifiedAt: 2,
          createdAt: 1,
        },
      ],
    });
    expect(
      screen.getByTestId("domain-active-pages.acme.com"),
    ).toBeInTheDocument();
    expect(screen.queryByText("CNAME")).not.toBeInTheDocument();
  });
});
