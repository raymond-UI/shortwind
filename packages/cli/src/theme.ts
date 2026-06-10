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

export type ThemeAction = "injected" | "created" | "skipped";
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
