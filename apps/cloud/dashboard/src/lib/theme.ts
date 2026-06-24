/**
 * Theme (light/dark) plumbing for the hosting dashboard (epic #184).
 *
 * The dashboard shares the docs-site token system (`index.css`), toggled by the
 * `.dark` class on `<html>`. Resolution: an explicit saved choice wins; else the
 * OS preference. The choice is persisted so it survives reloads.
 *
 * `THEME_INIT_SCRIPT` is injected into `<head>` (before hydration) so the class
 * is applied before first paint — no flash of the wrong theme. It is a string
 * literal (runs in the browser, not the React runtime), kept in sync with
 * {@link applyTheme} below.
 */

export type Theme = "light" | "dark";
export const THEME_KEY = "sw-dashboard-theme";

/** Resolve the active theme: saved choice → OS preference → light. */
export function resolveTheme(): Theme {
  if (typeof window === "undefined") return "light";
  try {
    const saved = window.localStorage.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // localStorage may be unavailable (private mode); fall through to OS.
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/** Apply a theme to `<html>` and persist the choice. */
export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", theme === "dark");
  try {
    window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Non-fatal: the theme still applies for this session.
  }
}

/**
 * Pre-hydration inline script: set the `.dark` class from the saved choice / OS
 * preference before the page paints. Mirrors {@link resolveTheme}; kept tiny and
 * dependency-free because it runs as a raw <script> in <head>.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var k=${JSON.stringify(
  THEME_KEY,
)};var s=localStorage.getItem(k);var d=s?s==="dark":matchMedia("(prefers-color-scheme: dark)").matches;document.documentElement.classList.toggle("dark",d);}catch(e){}})();`;
