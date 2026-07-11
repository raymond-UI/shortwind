import { useEffect, useState } from "react";
import { ChevronDown, LogOut, Moon, Sun, User } from "lucide-react";
import { Menu, MenuItem } from "./Menu";
import { applyTheme, resolveTheme, type Theme } from "../lib/theme";

/**
 * Header account dropdown — collapses the theme switch + sign out into one menu
 * (built on the `@menu*` recipes; no component library, per /ui). Theme state
 * mirrors the pre-hydration script (see ThemeToggle); toggling it keeps the menu
 * open so the change is visible, while Sign out closes first, then signs out.
 */
export function AccountMenu({ onSignOut }: { onSignOut: () => void }) {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    setTheme(resolveTheme());
  }, []);

  const isDark = theme === "dark";
  function toggleTheme() {
    const next: Theme = isDark ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
  }

  return (
    <Menu
      align="end"
      label="Account menu"
      trigger={
        <span className="inline-flex items-center gap-1.5">
          <span className="grid h-6 w-6 place-items-center rounded-full bg-secondary text-muted-foreground">
            <User className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        </span>
      }
    >
      {(close) => (
        <>
          <MenuItem onSelect={toggleTheme} testId="menu-theme-toggle">
            <span className="inline-flex items-center gap-2">
              {isDark ? (
                <Sun className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Moon className="h-4 w-4" aria-hidden="true" />
              )}
              {isDark ? "Light mode" : "Dark mode"}
            </span>
          </MenuItem>
          <div role="separator" className="my-1 h-px bg-border" />
          <MenuItem
            onSelect={() => {
              close();
              onSignOut();
            }}
            testId="menu-sign-out"
          >
            <span className="inline-flex items-center gap-2">
              <LogOut className="h-4 w-4" aria-hidden="true" />
              Sign out
            </span>
          </MenuItem>
        </>
      )}
    </Menu>
  );
}
