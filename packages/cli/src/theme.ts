import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { glob } from "tinyglobby";

// The recipe catalog is authored against semantic color tokens (bg-card,
// text-foreground, border-border, …). Tailwind generates nothing for those
// unless the project defines the matching CSS variables + @theme map, so
// without this block a freshly-initialised project renders every recipe
// colorless. We scaffold a neutral default theme so recipes work on first run;
// it's plain CSS the user owns and edits.

export const THEME_MARKER = "/* shortwind:theme";

const THEME_BLOCK = `${THEME_MARKER} — default tokens for the recipe catalog. Edit freely. */
@custom-variant dark (&:is(.dark *));

:root {
  --radius: 0.625rem;
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.145 0 0);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.145 0 0);
  --primary: oklch(0.205 0 0);
  --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.97 0 0);
  --secondary-foreground: oklch(0.205 0 0);
  --muted: oklch(0.97 0 0);
  --muted-foreground: oklch(0.556 0 0);
  --accent: oklch(0.97 0 0);
  --accent-foreground: oklch(0.205 0 0);
  --destructive: oklch(0.577 0.245 27.325);
  --destructive-foreground: oklch(0.985 0 0);
  --success: oklch(0.51 0.12 165);
  --success-foreground: oklch(0.985 0 0);
  --warning: oklch(0.83 0.15 84);
  --warning-foreground: oklch(0.28 0.06 50);
  --danger: oklch(0.51 0.21 27);
  --danger-foreground: oklch(0.985 0 0);
  --border: oklch(0.922 0 0);
  --input: oklch(0.922 0 0);
  --ring: oklch(0.708 0 0);
}

.dark {
  --background: oklch(0.145 0 0);
  --foreground: oklch(0.985 0 0);
  --card: oklch(0.205 0 0);
  --card-foreground: oklch(0.985 0 0);
  --popover: oklch(0.205 0 0);
  --popover-foreground: oklch(0.985 0 0);
  --primary: oklch(0.922 0 0);
  --primary-foreground: oklch(0.205 0 0);
  --secondary: oklch(0.269 0 0);
  --secondary-foreground: oklch(0.985 0 0);
  --muted: oklch(0.269 0 0);
  --muted-foreground: oklch(0.708 0 0);
  --accent: oklch(0.269 0 0);
  --accent-foreground: oklch(0.985 0 0);
  --destructive: oklch(0.704 0.191 22.216);
  --destructive-foreground: oklch(0.985 0 0);
  --success: oklch(0.59 0.14 163);
  --success-foreground: oklch(0.985 0 0);
  --warning: oklch(0.77 0.16 70);
  --warning-foreground: oklch(0.28 0.06 50);
  --danger: oklch(0.64 0.24 25);
  --danger-foreground: oklch(0.985 0 0);
  --border: oklch(1 0 0 / 10%);
  --input: oklch(1 0 0 / 15%);
  --ring: oklch(0.556 0 0);
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-success: var(--success);
  --color-success-foreground: var(--success-foreground);
  --color-warning: var(--warning);
  --color-warning-foreground: var(--warning-foreground);
  --color-danger: var(--danger);
  --color-danger-foreground: var(--danger-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
}

@layer base {
  body {
    @apply bg-background text-foreground;
  }
}
/* end shortwind theme */
`;

const TAILWIND_IMPORT_RE = /@import\s+["']tailwindcss["'][^;\n]*;?/;

// "supplemented" is produced by init (not scaffoldTheme): an existing theme
// was left intact and a marked block defining only the missing tokens was
// appended (see buildThemeSupplement).
export type ThemeAction = "injected" | "created" | "skipped" | "supplemented";
export type ThemeResult = {
  themePath: string | null;
  action: ThemeAction;
  reason?: string;
};

// Scaffold the default theme into the project. Preference order:
//   1. inject into the existing Tailwind CSS entry (the file with
//      `@import "tailwindcss"`), right after the import
//   2. otherwise, on a Tailwind v4 project, write src/index.css with the import
//      plus the theme
//   3. otherwise skip (v3 themes live in tailwind.config, not CSS)
// Always idempotent and never clobbers a theme the user already defined.
export async function scaffoldTheme(cwd: string): Promise<ThemeResult> {
  const cssFiles = await glob(["**/*.css"], {
    cwd,
    absolute: true,
    onlyFiles: true,
    ignore: ["**/node_modules/**", "**/dist/**", "**/.next/**", "**/.output/**", "recipes/**"],
  });

  for (const file of cssFiles) {
    const source = await readFile(file, "utf8");
    if (!TAILWIND_IMPORT_RE.test(source)) continue;
    if (source.includes(THEME_MARKER)) {
      return { themePath: file, action: "skipped", reason: "already scaffolded" };
    }
    // Respect a theme the user already wrote rather than fighting it.
    if (/--background\s*:/.test(source) || /@theme\b/.test(source)) {
      return { themePath: file, action: "skipped", reason: "project already defines a theme" };
    }
    const m = source.match(TAILWIND_IMPORT_RE)!;
    const at = (m.index ?? 0) + m[0].length;
    const next = source.slice(0, at) + "\n\n" + THEME_BLOCK + source.slice(at);
    await writeFile(file, next);
    return { themePath: file, action: "injected" };
  }

  // No Tailwind CSS entry found — only scaffold one for v4 (v3 colors live in
  // tailwind.config.js, which is out of scope here).
  if (!isTailwindV4(cwd)) {
    return { themePath: null, action: "skipped", reason: "no Tailwind v4 CSS entry found" };
  }
  const target = path.join(cwd, "src", "index.css");
  if (existsSync(target)) {
    return { themePath: target, action: "skipped", reason: "src/index.css exists without a tailwindcss import" };
  }
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `@import "tailwindcss";\n\n${THEME_BLOCK}`);
  return { themePath: target, action: "created" };
}

// The color tokens the default block provides — derived from the block itself
// so the missing-token check can never drift from what we scaffold.
const THEME_COLOR_TOKENS: ReadonlySet<string> = new Set(
  [...THEME_BLOCK.matchAll(/--color-([\w-]+)\s*:/g)].map((m) => m[1] ?? ""),
);

export const THEME_SUPPLEMENT_MARKER = "/* shortwind:theme-supplement";

// Light/dark values per token, parsed out of THEME_BLOCK itself (same
// no-drift trick as THEME_COLOR_TOKENS): the supplement hands out exactly the
// values full scaffolding would have written.
function blockSectionValues(selector: string): ReadonlyMap<string, string> {
  const m = THEME_BLOCK.match(new RegExp(`${selector.replace(".", "\\.")}\\s*\\{([^}]*)\\}`));
  const out = new Map<string, string>();
  for (const decl of (m?.[1] ?? "").matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
    out.set(decl[1]!, decl[2]!.trim());
  }
  return out;
}
const THEME_LIGHT_VALUES = blockSectionValues(":root");
const THEME_DARK_VALUES = blockSectionValues(".dark");

// The existing-theme skip is all-or-nothing, which leaves every missing token
// to a terminal warning nobody persists — on a stock create-next-app theme
// (background/foreground only) recipes then render colorless. Build an
// append-only supplement defining JUST the missing tokens: purely additive,
// so nothing the user wrote is ever overridden, and re-running init finds
// nothing missing, so it's naturally idempotent. Dark values follow the
// project's own strategy — `.dark` class (incl. @custom-variant) or the
// prefers-color-scheme media query — and are omitted when there isn't one
// (the :root values then apply everywhere).
// Dark overrides are class-only (#96): a `.dark { … }` block, the single
// strategy an in-app toggle (`.dark` on <html>) can drive. `init` ensures the
// matching `@custom-variant dark` and converts any create-next-app
// prefers-color-scheme block to `.dark` (see convertMediaDarkToClass), so the
// toggle is the one source of truth and `@media` never competes with it.
function darkSection(lines: string[]): string[] {
  return [".dark {", ...lines, "}"];
}

export function buildThemeSupplement(missing: string[]): string | null {
  const tokens = missing.filter((t) => THEME_LIGHT_VALUES.has(t));
  if (tokens.length === 0) return null;

  const light = tokens.map((t) => `  --${t}: ${THEME_LIGHT_VALUES.get(t)};`);
  const dark = tokens
    .filter((t) => THEME_DARK_VALUES.has(t))
    .map((t) => `  --${t}: ${THEME_DARK_VALUES.get(t)};`);
  const mapping = tokens.map((t) => `  --color-${t}: var(--${t});`);

  const lines: string[] = [
    `${THEME_SUPPLEMENT_MARKER} — placeholder values for tokens your theme didn't define. Tune them to your palette. */`,
    ":root {",
    ...light,
    "}",
  ];
  if (dark.length > 0) lines.push(...darkSection(dark));
  lines.push("@theme inline {", ...mapping, "}", "/* end shortwind theme-supplement */");
  return lines.join("\n");
}

export const DARK_CLASS_VARIANT = "@custom-variant dark (&:is(.dark *));";
const CUSTOM_VARIANT_RE = /@custom-variant\s+dark\b/;

// Ensure the class-based dark variant exists so a `.dark` on <html> activates
// `dark:` utilities and the `.dark { … }` token blocks (#93). Inserted right
// after the `@import "tailwindcss"`; a no-op when already present or when there
// is no import to anchor to.
export function ensureDarkClassVariant(css: string): string {
  if (CUSTOM_VARIANT_RE.test(css)) return css;
  const m = css.match(TAILWIND_IMPORT_RE);
  if (!m) return css;
  const at = (m.index ?? 0) + m[0].length;
  return `${css.slice(0, at)}\n${DARK_CLASS_VARIANT}${css.slice(at)}`;
}

export const DARK_PROMOTE_MARKER = "/* shortwind:dark-promote";

// A stock create-next-app theme puts its dark values in
// `@media (prefers-color-scheme: dark) { :root { … } }`, which a class toggle
// can't reach — and worse, it overrides a force-light choice when the OS is in
// dark mode. CONVERT it to `.dark { … }`: move the declarations and drop the
// `@media` wrapper, so the `.dark` toggle is the single source of truth (#96).
// Only the simple single-`:root` shape is touched; a media block with any other
// content is left alone. Returns the rewritten css and whether it changed;
// idempotent via the marker. (System-preference seeding moves to a tiny inline
// script — see the setup docs.)
const MEDIA_DARK_ROOT_RE =
  /@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)\s*\{\s*:root\s*\{([^}]*)\}\s*\}/;

export function convertMediaDarkToClass(css: string): { css: string; converted: boolean } {
  if (css.includes(DARK_PROMOTE_MARKER)) return { css, converted: false };
  const m = css.match(MEDIA_DARK_ROOT_RE);
  const decls = [...(m?.[1] ?? "").matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)].map(
    (d) => `  --${d[1]}: ${d[2]!.trim()};`,
  );
  if (decls.length === 0) return { css, converted: false };
  const without = css.replace(MEDIA_DARK_ROOT_RE, "").replace(/\n{3,}/g, "\n\n");
  const block = [
    `${DARK_PROMOTE_MARKER} — dark tokens moved out of the system-preference media query so a .dark toggle is the single source of truth. */`,
    ".dark {",
    ...decls,
    "}",
    "/* end shortwind dark-promote */",
  ].join("\n");
  return { css: `${without.replace(/\s*$/, "")}\n\n${block}\n`, converted: true };
}

export const TONE_MARKER = "/* shortwind:tones";

// Default semantic tones consumed by tone-aware recipes — @badge reads
// `--tone-bg`/`--tone-fg` and the element's `data-tone` selects which values
// apply (`<span class="@badge" data-tone="success">`). Values mirror the
// static @badge-<tone> recipes so the data-driven and static forms match.
// Plain CSS the user owns; extend with project tones
// (`[data-tone="sev1"] { --tone-bg: …; --tone-fg: … }`). neutral/danger/info
// resolve through theme tokens (they already flip in dark); success/warning
// carry explicit dark values.
type Tone = { name: string; bg: string; fg: string; darkBg?: string; darkFg?: string };
const TONES: readonly Tone[] = [
  { name: "neutral", bg: "var(--muted)", fg: "var(--muted-foreground)" },
  {
    name: "success",
    bg: "oklch(0.962 0.044 156.743)",
    fg: "oklch(0.448 0.119 151.328)",
    darkBg: "oklch(0.393 0.095 152.535)",
    darkFg: "oklch(0.925 0.084 155.995)",
  },
  {
    name: "warning",
    bg: "oklch(0.962 0.059 95.617)",
    fg: "oklch(0.473 0.137 46.201)",
    darkBg: "oklch(0.414 0.112 45.904)",
    darkFg: "oklch(0.924 0.12 95.746)",
  },
  { name: "danger", bg: "color-mix(in oklab, var(--destructive) 15%, transparent)", fg: "var(--destructive)" },
  { name: "info", bg: "color-mix(in oklab, var(--primary) 15%, transparent)", fg: "var(--primary)" },
];

// Build the append-only tone block. Dark overrides (success/warning only) go
// under `.dark` so an in-app toggle drives them (class-only; #96).
export function buildToneBlock(): string {
  const rule = (name: string, bg: string, fg: string) =>
    `[data-tone="${name}"] { --tone-bg: ${bg}; --tone-fg: ${fg}; }`;
  const lines: string[] = [
    `${TONE_MARKER} — semantic tones for tone-aware recipes (@badge, …). Set on an element:`,
    `   <span class="@badge" data-tone="success">. Add your own: [data-tone="sev1"] { --tone-bg: …; --tone-fg: … } */`,
    ...TONES.map((t) => rule(t.name, t.bg, t.fg)),
  ];
  const darkTones = TONES.filter((t) => t.darkBg && t.darkFg);
  if (darkTones.length > 0) {
    const darkRules = darkTones.map((t) => "  " + rule(t.name, t.darkBg!, t.darkFg!));
    lines.push(...darkSection(darkRules));
  }
  lines.push("/* end shortwind tones */");
  return lines.join("\n");
}

// Utility prefixes that consume a theme color token (`bg-card`,
// `text-muted-foreground`, `border-border`, …).
const COLOR_UTILITY_RE =
  /^(?:bg|text|border|ring|outline|fill|stroke|divide|accent|caret|decoration|shadow|from|via|to|placeholder)-(.+)$/;

// Which default-theme color tokens do the registry's expanded utilities
// reference? Variants (`hover:`, `dark:`) and opacity suffixes (`/90`) are
// stripped; only names the default theme block actually defines are reported,
// so genuine Tailwind palette utilities (`bg-white`) never false-positive.
function referencedThemeTokens(flattened: Record<string, string[]>): string[] {
  const out = new Set<string>();
  for (const utilities of Object.values(flattened)) {
    for (const raw of utilities) {
      const base = raw.split(":").pop() ?? raw;
      const m = base.match(COLOR_UTILITY_RE);
      if (!m) continue;
      const name = (m[1] ?? "").replace(/\/.*$/, "");
      if (THEME_COLOR_TOKENS.has(name)) out.add(name);
    }
  }
  return [...out].sort();
}

// The skip-existing-theme path is all-or-nothing: "an @theme exists → assume
// the theme is handled". That silently shipped colorless UIs when the existing
// theme (e.g. create-next-app's globals.css) defines none of the tokens the
// installed recipes reference (#62). This diff lets init warn loudly instead.
// A token counts as defined if the CSS declares `--color-<name>` (Tailwind v4
// theme key) or `--<name>` (the bare custom-property indirection many themes use).
export function findMissingThemeTokens(
  css: string,
  flattened: Record<string, string[]>,
): string[] {
  return referencedThemeTokens(flattened).filter(
    (name) => !new RegExp(`--(?:color-)?${name}\\s*:`).test(css),
  );
}

// Locate the project's theme entry CSS — the Tailwind v4 entry
// (`@import "tailwindcss"`) that carries the theme. Used by `add`/`preset` to
// supplement tokens and by `doctor` to validate them. Prefers an entry that
// already defines a theme (marker / @theme / --background); else the first
// tailwindcss entry. null when the project has none.
export async function findThemeEntryCss(cwd: string): Promise<string | null> {
  const cssFiles = await glob(["**/*.css"], {
    cwd,
    absolute: true,
    onlyFiles: true,
    ignore: ["**/node_modules/**", "**/dist/**", "**/.next/**", "**/.output/**", "recipes/**"],
  });
  let fallback: string | null = null;
  for (const file of cssFiles.sort()) {
    const css = await readFile(file, "utf8");
    if (!TAILWIND_IMPORT_RE.test(css)) continue;
    if (
      css.includes(THEME_MARKER) ||
      css.includes(THEME_SUPPLEMENT_MARKER) ||
      /@theme\b/.test(css) ||
      /--background\s*:/.test(css)
    ) {
      return file;
    }
    fallback ??= file;
  }
  return fallback;
}

// Append placeholder definitions for any theme color tokens the installed
// recipes reference but the project's theme doesn't define — the missing half
// of init's supplement, so `add`/`preset` don't leave newly-installed families
// pointing at undefined `--color-*` vars (the "bg-popover emits zero CSS,
// transparent panel" trap). Idempotent: once a token is defined it's no longer
// missing. No-op when there's no theme entry or nothing is missing.
export async function appendMissingThemeTokens(
  cwd: string,
  flattened: Record<string, string[]>,
): Promise<{ themePath: string | null; added: string[] }> {
  const themePath = await findThemeEntryCss(cwd);
  if (!themePath) return { themePath: null, added: [] };
  const css = await readFile(themePath, "utf8");
  const missing = findMissingThemeTokens(css, flattened);
  const supplement = buildThemeSupplement(missing);
  if (!supplement) return { themePath, added: [] };
  await writeFile(themePath, `${css.replace(/\s*$/, "")}\n\n${supplement}\n`);
  return { themePath, added: missing };
}

function isTailwindV4(cwd: string): boolean {
  try {
    const pkg = JSON.parse(readFileSync(path.join(cwd, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const range = pkg.devDependencies?.["tailwindcss"] ?? pkg.dependencies?.["tailwindcss"] ?? "";
    const m = range.match(/(\d+)/);
    return m ? Number(m[1]) >= 4 : false;
  } catch {
    return false;
  }
}
