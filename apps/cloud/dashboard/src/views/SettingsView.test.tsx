import { describe, expect, it, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { SettingsView } from "./SettingsView";
import { renderWithData } from "../test/render";

/** Click a Settings sub-page tab by its label. */
function openTab(label: string) {
  fireEvent.click(screen.getByRole("radio", { name: label }));
}

describe("SettingsView — sub-page tabs", () => {
  it("defaults to the Domains sub-page (with the custom-domain policy folded in)", () => {
    renderWithData(<SettingsView />);
    expect(screen.getByTestId("settings-tabs")).toBeInTheDocument();
    expect(screen.getByTestId("domains-view")).toBeInTheDocument();
    expect(screen.getByTestId("policy-view")).toBeInTheDocument();
    // Other sub-pages aren't mounted until selected.
    expect(screen.queryByTestId("theme-editor")).not.toBeInTheDocument();
    expect(screen.queryByTestId("recipes-view")).not.toBeInTheDocument();
  });

  it("toggles the custom-domain approval policy from the Domains sub-page", async () => {
    const setPolicy = vi.fn().mockResolvedValue(undefined);
    renderWithData(<SettingsView />, { setPolicy });
    fireEvent.click(screen.getByTestId("toggle-custom-domain"));
    await waitFor(() =>
      expect(setPolicy).toHaveBeenCalledWith({ customDomainNeedsApproval: false }),
    );
  });
});

describe("SettingsView — Access (API tokens)", () => {
  it("lists the operator's tokens with their scopes", () => {
    renderWithData(<SettingsView />);
    openTab("Access");
    const rows = screen.getAllByTestId("token-row");
    expect(rows).toHaveLength(2);
    expect(screen.getByText("laptop CLI")).toBeInTheDocument();
    expect(screen.getByText("revoked")).toBeInTheDocument();
  });

  it("revokes an active token", async () => {
    const revokeToken = vi.fn().mockResolvedValue(undefined);
    renderWithData(<SettingsView />, { revokeToken });
    openTab("Access");
    fireEvent.click(screen.getByTestId("revoke-tok_active"));
    await waitFor(() => expect(revokeToken).toHaveBeenCalledWith("tok_active"));
  });

  it("shows no revoke button for an already-revoked token", () => {
    renderWithData(<SettingsView />);
    openTab("Access");
    expect(screen.queryByTestId("revoke-tok_revoked")).not.toBeInTheDocument();
  });

  it("renders the empty state with no tokens", () => {
    renderWithData(<SettingsView />, { tokens: [] });
    openTab("Access");
    expect(screen.getByTestId("tokens-empty")).toBeInTheDocument();
  });
});

describe("SettingsView — web theme (P5)", () => {
  it("seeds the inputs from the loaded theme and notes the default", () => {
    renderWithData(<SettingsView />);
    openTab("Theme");
    expect(screen.getByTestId("accent-input")).toHaveValue("oklch(0.205 0 0)");
    // The slider seeds from the radius (0.625rem = 10px); the readout mirrors it.
    expect(screen.getByTestId("radius-range")).toHaveValue("10");
    expect(screen.getByTestId("radius-value")).toHaveTextContent("0.625rem");
    expect(screen.getByText(/Using the neutral default/)).toBeInTheDocument();
  });

  it("picks an accent via the color input and a radius via the slider, then saves", async () => {
    const setTheme = vi.fn(async (next: { accent: string; radius: string }) => ({
      ...next,
      isDefault: false,
    }));
    renderWithData(<SettingsView />, { setTheme });
    openTab("Theme");
    fireEvent.change(screen.getByTestId("accent-color"), {
      target: { value: "#2563eb" },
    });
    // 16px on the slider → 1rem emitted.
    fireEvent.change(screen.getByTestId("radius-range"), {
      target: { value: "16" },
    });
    fireEvent.click(screen.getByTestId("save-theme"));
    await waitFor(() =>
      expect(setTheme).toHaveBeenCalledWith({ accent: "#2563eb", radius: "1rem" }),
    );
    expect(await screen.findByTestId("theme-saved")).toBeInTheDocument();
  });

  it("sets the accent from a preset swatch", () => {
    renderWithData(<SettingsView />);
    openTab("Theme");
    fireEvent.click(screen.getByRole("button", { name: "Use #16a34a" }));
    expect(screen.getByTestId("accent-input")).toHaveValue("#16a34a");
  });

  it("surfaces a friendly error when the save is rejected", async () => {
    const setTheme = vi.fn(async () => {
      throw new Error("INVALID_THEME");
    });
    renderWithData(<SettingsView />, { setTheme });
    openTab("Theme");
    fireEvent.change(screen.getByTestId("accent-input"), {
      target: { value: "red; }" },
    });
    fireEvent.click(screen.getByTestId("save-theme"));
    expect(await screen.findByTestId("theme-error")).toBeInTheDocument();
  });

  it("keeps static chrome visible while the theme loads, masking only the value controls (/ui)", () => {
    renderWithData(<SettingsView />, { theme: undefined });
    openTab("Theme");
    // Static labels, presets, and Save render immediately…
    expect(screen.getByText("Accent color")).toBeInTheDocument();
    expect(screen.getByText("Corner radius")).toBeInTheDocument();
    expect(screen.getByTestId("accent-presets")).toBeInTheDocument();
    expect(screen.getByTestId("save-theme")).toBeDisabled();
    // …while only the dynamic value inputs are masked.
    expect(screen.queryByTestId("accent-input")).not.toBeInTheDocument();
    expect(screen.queryByTestId("radius-range")).not.toBeInTheDocument();
  });
});

describe("SettingsView — Recipes sub-page", () => {
  it("mounts the Recipes panel on the Recipes tab", () => {
    renderWithData(<SettingsView />);
    expect(screen.queryByTestId("recipes-view")).not.toBeInTheDocument();
    openTab("Recipes");
    expect(screen.getByTestId("recipes-view")).toBeInTheDocument();
  });
});

describe("SettingsView — Domains sub-page", () => {
  it("switches away from and back to the Domains sub-page", () => {
    renderWithData(<SettingsView />);
    // Domains is the default sub-page.
    expect(screen.getByTestId("domains-view")).toBeInTheDocument();
    openTab("Recipes");
    expect(screen.queryByTestId("domains-view")).not.toBeInTheDocument();
    openTab("Domains");
    expect(screen.getByTestId("domains-view")).toBeInTheDocument();
  });
});
