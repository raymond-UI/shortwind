import { describe, expect, it, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { SettingsView } from "./SettingsView";
import { renderWithData } from "../test/render";

describe("SettingsView — API tokens", () => {
  it("lists the operator's tokens with their scopes", () => {
    renderWithData(<SettingsView />);
    const rows = screen.getAllByTestId("token-row");
    expect(rows).toHaveLength(2);
    expect(screen.getByText("laptop CLI")).toBeInTheDocument();
    // Revoked tokens are marked.
    expect(screen.getByText("revoked")).toBeInTheDocument();
  });

  it("revokes an active token", async () => {
    const revokeToken = vi.fn().mockResolvedValue(undefined);
    renderWithData(<SettingsView />, { revokeToken });
    fireEvent.click(screen.getByTestId("revoke-tok_active"));
    await waitFor(() => expect(revokeToken).toHaveBeenCalledWith("tok_active"));
  });

  it("shows no revoke button for an already-revoked token", () => {
    renderWithData(<SettingsView />);
    expect(screen.queryByTestId("revoke-tok_revoked")).not.toBeInTheDocument();
  });

  it("renders the empty state with no tokens", () => {
    renderWithData(<SettingsView />, { tokens: [] });
    expect(screen.getByTestId("tokens-empty")).toBeInTheDocument();
  });

  // Policy lives inside Settings now (folded in from the old Policy view).
  it("includes the policy toggle", () => {
    renderWithData(<SettingsView />);
    expect(screen.getByTestId("policy-view")).toBeInTheDocument();
  });
});
