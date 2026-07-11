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

describe("SettingsView — web theme (P5)", () => {
  it("seeds the inputs from the loaded theme and notes the default", () => {
    renderWithData(<SettingsView />);
    expect(screen.getByTestId("accent-input")).toHaveValue("oklch(0.205 0 0)");
    expect(screen.getByTestId("radius-input")).toHaveValue("0.625rem");
    expect(screen.getByText(/Using the neutral default/)).toBeInTheDocument();
  });

  it("saves the edited accent + radius through the seam", async () => {
    const setTheme = vi.fn(async (next: { accent: string; radius: string }) => ({
      ...next,
      isDefault: false,
    }));
    renderWithData(<SettingsView />, { setTheme });
    fireEvent.change(screen.getByTestId("accent-input"), {
      target: { value: "#2563eb" },
    });
    fireEvent.change(screen.getByTestId("radius-input"), {
      target: { value: "1rem" },
    });
    fireEvent.click(screen.getByTestId("save-theme"));
    await waitFor(() =>
      expect(setTheme).toHaveBeenCalledWith({ accent: "#2563eb", radius: "1rem" }),
    );
    expect(await screen.findByTestId("theme-saved")).toBeInTheDocument();
  });

  it("surfaces a friendly error when the save is rejected", async () => {
    const setTheme = vi.fn(async () => {
      throw new Error("INVALID_THEME");
    });
    renderWithData(<SettingsView />, { setTheme });
    fireEvent.change(screen.getByTestId("accent-input"), {
      target: { value: "red; }" },
    });
    fireEvent.click(screen.getByTestId("save-theme"));
    expect(await screen.findByTestId("theme-error")).toBeInTheDocument();
  });

  it("shows a loading branch while the theme is undefined", () => {
    renderWithData(<SettingsView />, { theme: undefined });
    expect(
      screen.getByRole("status", { name: /loading theme/i }),
    ).toBeInTheDocument();
  });
});
