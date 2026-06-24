import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Menu, MenuItem } from "./Menu";

describe("Menu", () => {
  it("is closed until the trigger is clicked, then selects an item", () => {
    const onSelect = vi.fn();
    render(
      <Menu trigger="Open" label="actions">
        {(close) => (
          <MenuItem
            testId="item-one"
            onSelect={() => {
              onSelect();
              close();
            }}
          >
            One
          </MenuItem>
        )}
      </Menu>,
    );
    expect(screen.queryByTestId("item-one")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "actions" }));
    fireEvent.click(screen.getByTestId("item-one"));
    expect(onSelect).toHaveBeenCalled();
    // Selecting closed the menu.
    expect(screen.queryByTestId("item-one")).not.toBeInTheDocument();
  });

  it("closes on Escape", () => {
    render(
      <Menu trigger="Open" label="actions">
        {() => (
          <MenuItem testId="item-one" onSelect={() => {}}>
            One
          </MenuItem>
        )}
      </Menu>,
    );
    fireEvent.click(screen.getByRole("button", { name: "actions" }));
    expect(screen.getByTestId("item-one")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("item-one")).not.toBeInTheDocument();
  });
});
