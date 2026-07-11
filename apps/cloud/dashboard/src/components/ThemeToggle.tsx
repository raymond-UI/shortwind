import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { applyTheme, resolveTheme, type Theme } from "../lib/theme";

/**
 * Light/dark toggle (epic #184). The pre-hydration script in `__root` already
 * set the class; this syncs React state to it on mount, then flips both the
 * `<html>` class and the persisted choice on click. Icon-only, sits in the
 * sidebar footer.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("light");

  // Sync to whatever the pre-hydration script resolved (avoids SSR mismatch:
  // we don't render theme-dependent markup until mounted).
  useEffect(() => {
    setTheme(resolveTheme());
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
  }

  const isDark = theme === "dark";
  return (
    <button
      type="button"
      onClick={toggle}
      className="inline-flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
    >
      {isDark ? (
        <Sun className="h-4 w-4" aria-hidden="true" />
      ) : (
        <Moon className="h-4 w-4" aria-hidden="true" />
      )}
      <span>{isDark ? "Light" : "Dark"}</span>
    </button>
  );
}
