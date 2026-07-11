/**
 * Web theme preamble (P5).
 *
 * A fragment-wrapped artifact (see `assembleArtifact`) pairs the frozen HTML
 * with a `<style type="text/tailwindcss">` block compiled by the CDN's browser
 * Tailwind build. For recipes that reference the semantic token palette
 * (`bg-card`, `text-muted-foreground`, `border-border`, …) to render with
 * color, that block must define the tokens. This module builds that preamble:
 * the neutral shadcn-calibrated default theme, with the account's chosen ACCENT
 * (→ `--primary` / `--ring`) and corner RADIUS (→ `--radius`) substituted in.
 *
 * Self-contained (no `@shortwind/cli` import — cloud does not depend on the CLI,
 * and the dependency arrows never reverse). Deterministic output so it stays
 * golden-fixture testable. Full-DOCUMENT uploads own their own `<head>` and are
 * served verbatim, so this preamble never applies to them.
 */

export interface AccountTheme {
  /** CSS color for the accent — maps to `--primary` / `--ring`. */
  accent: string;
  /** CSS length for `--radius` (e.g. "0.625rem"). */
  radius: string;
}

/** The neutral default accent (shadcn `--primary`, light). */
export const DEFAULT_ACCENT = "oklch(0.205 0 0)";
/** The default corner radius. */
export const DEFAULT_RADIUS = "0.625rem";
export const DEFAULT_ACCOUNT_THEME: AccountTheme = {
  accent: DEFAULT_ACCENT,
  radius: DEFAULT_RADIUS,
};

/**
 * A safe CSS color value — the character set of `oklch(...)`, `#rrggbb`,
 * `rgb()/hsl()`, and named colors, and nothing that could break out of a
 * declaration (no `{ } ; : < > @ " \` or newlines → no CSS/HTML injection into
 * the style block). Bounded length.
 */
export function isSafeColor(value: string): boolean {
  return value.length > 0 && value.length <= 64 && /^[a-zA-Z0-9.,%()#/+\s-]+$/.test(value);
}

/** A safe CSS length for the radius: a number with an optional rem/px/em/% unit. */
export function isSafeRadius(value: string): boolean {
  return value.length <= 16 && /^\d*\.?\d+(rem|px|em|%)?$/.test(value.trim());
}

/**
 * Build the fragment-wrap CSS preamble for the account's theme (or the default
 * neutral theme when none is set / passed). The block is the shadcn token scale
 * with `--primary`/`--ring` set to the accent (light AND dark — a brand accent
 * reads the same in both) and `--radius` set to the chosen radius.
 */
export function themePreamble(theme?: AccountTheme | null): string {
  const accent = theme && isSafeColor(theme.accent) ? theme.accent : DEFAULT_ACCENT;
  const radius = theme && isSafeRadius(theme.radius) ? theme.radius : DEFAULT_RADIUS;
  return `@import "tailwindcss";
@custom-variant dark (&:is(.dark *));

:root {
  --radius: ${radius};
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.145 0 0);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.145 0 0);
  --primary: ${accent};
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
  --ring: ${accent};
}

.dark {
  --background: oklch(0.145 0 0);
  --foreground: oklch(0.985 0 0);
  --card: oklch(0.205 0 0);
  --card-foreground: oklch(0.985 0 0);
  --popover: oklch(0.205 0 0);
  --popover-foreground: oklch(0.985 0 0);
  --primary: ${accent};
  --primary-foreground: oklch(0.985 0 0);
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
  --ring: ${accent};
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

[data-tone="neutral"] { --tone-bg: var(--muted); --tone-fg: var(--muted-foreground); }
[data-tone="success"] { --tone-bg: color-mix(in oklab, var(--success) 15%, transparent); --tone-fg: var(--success); }
[data-tone="warning"] { --tone-bg: color-mix(in oklab, var(--warning) 15%, transparent); --tone-fg: var(--warning); }
[data-tone="danger"] { --tone-bg: color-mix(in oklab, var(--destructive) 15%, transparent); --tone-fg: var(--destructive); }
[data-tone="info"] { --tone-bg: color-mix(in oklab, var(--primary) 15%, transparent); --tone-fg: var(--primary); }

@layer base {
  body {
    @apply bg-background text-foreground;
  }
}
`;
}
