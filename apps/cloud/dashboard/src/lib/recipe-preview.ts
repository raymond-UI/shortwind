import type { RecipeFamilyRow } from "./types";

/**
 * Client-side recipe → live-preview plumbing for the dashboard Recipes view,
 * mirroring the docs catalog/playground: parse the account's stored recipe
 * bodies into a `flattened` map (recipe name → Tailwind utilities), expand
 * `@recipe` shorthand in example markup, and render it in a sandboxed
 * `@tailwindcss/browser` iframe themed with the account's accent + radius.
 */

/** A `@recipe <name> { <utilities> }` block. Comments/guides are ignored. */
const RECIPE_RE = /@recipe\s+([a-z][a-z0-9-]*)\s*\{([^}]*)\}/gi;

/** Utility tokens that could break out of a class attribute / inject markup. */
const UNSAFE = /[<>"'`{};]/;

/** Split a recipe body into utility tokens, dropping anything unsafe. */
function tokens(inner: string): string[] {
  return inner
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && !UNSAFE.test(t));
}

export interface ParsedPalette {
  /** recipe name → its utility list (across every family). */
  flattened: Record<string, string[]>;
  /** family name → the recipe names it defines, in source order. */
  familyRecipes: Record<string, string[]>;
}

/** Parse every family body into a flattened registry + per-family recipe list. */
export function parsePalette(rows: readonly RecipeFamilyRow[]): ParsedPalette {
  const flattened: Record<string, string[]> = {};
  const familyRecipes: Record<string, string[]> = {};
  for (const row of rows) {
    const names: string[] = [];
    for (const m of row.body.matchAll(RECIPE_RE)) {
      const name = m[1]!;
      flattened[name] = tokens(m[2] ?? "");
      names.push(name);
    }
    familyRecipes[row.family] = names;
  }
  return { flattened, familyRecipes };
}

/**
 * The recipe to feature for a family: the one named exactly like the family
 * (e.g. `@card` for `card`), else the family's first defined recipe.
 */
export function primaryRecipe(
  family: string,
  familyRecipes: Record<string, string[]>,
): string {
  const names = familyRecipes[family] ?? [];
  return names.includes(family) ? family : (names[0] ?? family);
}

/** class-attribute-aware `@recipe` → Tailwind expansion (for the preview). */
export function expand(src: string, flattened: Record<string, string[]>): string {
  return src.replace(/class="([^"]*)"/g, (_all, cls: string) => {
    const out = cls
      .split(/\s+/)
      .map((t) =>
        t[0] === "@" && flattened[t.slice(1)] ? flattened[t.slice(1)]!.join(" ") : t,
      )
      .join(" ");
    return `class="${out}"`;
  });
}

const R = (n: string) => "@" + n;
const box = (n: string) =>
  `<div style="display:grid;place-items:center;height:2.5rem;width:2.5rem;border:1px solid var(--border);border-radius:6px;font-size:11px;color:var(--muted-foreground)">${n}</div>`;

/**
 * Family-aware example markup (uses `@recipe` shorthand; expanded by the
 * caller). Ported from the docs catalog so the dashboard preview reads the same.
 */
export function example(name: string, fam: string): string {
  const c = R(name);
  switch (fam) {
    case "button":
      return `<button class="${c}">Button</button>`;
    case "badge":
      return `<span class="${c}">Badge</span>`;
    case "text":
      if (name === "link") return `<a class="${c}" href="#">a link</a>`;
      if (["eyebrow", "label", "caption"].includes(name))
        return `<p class="${c}">${name}</p>`;
      return `<p class="${c}">The quick brown fox</p>`;
    case "code":
      if (name === "code-block") return `<pre class="${c}">expand(input, registry)</pre>`;
      if (name === "kbd") return `<kbd class="${c}">⌘K</kbd>`;
      return `<code class="${c}">npm i shortwind</code>`;
    case "form":
      if (name === "textarea") return `<textarea class="${c}" rows="2">Text…</textarea>`;
      if (name === "checkbox" || name === "radio")
        return `<input type="${name === "radio" ? "radio" : "checkbox"}" class="${c}" checked />`;
      if (name === "label") return `<label class="${c}">Email address</label>`;
      if (name === "select") return `<select class="${c}"><option>Choose…</option></select>`;
      if (["field", "fieldset"].includes(name))
        return `<div class="${c}"><label class="${R("label")}">Email</label><input class="${R("input")}" placeholder="you@example.com"/></div>`;
      if (["help", "field-error"].includes(name))
        return `<p class="${c}">Helper text for the field.</p>`;
      return `<input class="${c}" placeholder="you@example.com" />`;
    case "layout":
      return `<div class="${c}">${box("1")}${box("2")}${box("3")}</div>`;
    case "card":
      if (["card", "card-elevated", "card-flat", "card-interactive"].includes(name))
        return `<div class="${c}" style="max-width:16rem"><p class="${R("eyebrow")}">Eyebrow</p><h3 class="${R("heading-md")}">Card title</h3><p class="${R("muted")}">A short description inside the card.</p></div>`;
      return `<div class="${R("card")}" style="max-width:16rem"><div class="${c}">${name.replace("card-", "")}</div></div>`;
    case "navigation":
      if (name === "nav")
        return `<nav class="${c}"><a class="${R("nav-link-active")}">Home</a><a class="${R("nav-link")}">Docs</a><a class="${R("nav-link")}">Pricing</a></nav>`;
      if (name === "breadcrumb") return `<nav class="${c}">Home / Docs / Catalog</nav>`;
      if (name.includes("tab"))
        return `<div class="${R("nav")}"><span class="${R("tab-active")}">Active</span><span class="${R("tab")}">Tab</span></div>`;
      return `<a class="${c}">Nav link</a>`;
    case "list":
      if (["list", "list-bordered"].includes(name))
        return `<ul class="${c}"><li class="${R("list-item")}">First item</li><li class="${R("list-item")}">Second item</li></ul>`;
      return `<div class="${R("list")}"><div class="${c}">List item</div></div>`;
    case "feedback":
      return `<div class="${c}">A short ${name} message for the user.</div>`;
    case "empty":
      if (name === "empty")
        return `<div class="${c}"><div class="${R("empty-icon")}">📭</div><h3 class="${R("empty-title")}">Nothing here yet</h3><p class="${R("empty-description")}">Create something to get started.</p></div>`;
      return `<div class="${R("empty")}"><div class="${c}">${name.replace("empty-", "")}</div></div>`;
    case "progress":
      if (name === "spinner") return `<div class="${c}"></div>`;
      return `<div class="${R("progress-track")}" style="width:12rem"><div class="${R("progress-bar")}" style="width:60%"></div></div>`;
    case "media":
      if (name.startsWith("avatar")) return `<div class="${c}"></div>`;
      return `<div class="${c}" style="width:8rem"></div>`;
    case "icon":
      return `<span class="${c}">★</span>`;
    case "segmented":
      if (name === "segmented")
        return `<div class="${c}"><button class="${R("segmented-item")}">Day</button><button class="${R("segmented-item")}">Week</button></div>`;
      return `<button class="${c}">Item</button>`;
    case "switch":
      return `<div class="${R("switch")}"><div class="${R("switch-thumb")}"></div></div>`;
    case "skeleton":
      return `<div class="${c}" style="width:10rem"></div>`;
    case "menu":
      if (name === "menu")
        return `<div class="${c}"><div class="${R("menu-item")}">Edit</div><div class="${R("menu-item")}">Duplicate</div></div>`;
      return `<div class="${R("menu")}"><div class="${c}">${name.replace("menu-", "")}</div></div>`;
    case "dialog":
    case "sheet":
      return `<div class="${c}" style="max-width:18rem"><h3 class="${R("heading-md")}">Title</h3><p class="${R("muted")}">Dialog body content.</p></div>`;
    default:
      return `<div class="${c}">Aa Bb Cc</div>`;
  }
}

// Pinned @tailwindcss/browser (exact version + SRI), matching the docs playground.
const TW_BROWSER_SRC = "https://unpkg.com/@tailwindcss/browser@4.3.0/dist/index.global.js";
const TW_BROWSER_SRI = "sha384-nWTzRTCY/9V4Bo352ehygr1c4cnst4XN6lMR3fipakEQrhVpc0hEM5Dii3Amz0sT";

/** A safe CSS color/length for injection into the iframe theme (else a default). */
const SAFE_TOKEN = /^[a-zA-Z0-9.,%()#/+\s-]+$/;
const safe = (v: string, fallback: string) =>
  v && v.length <= 64 && SAFE_TOKEN.test(v) ? v : fallback;

/**
 * The load-once iframe shell: Tailwind (browser) + the account theme (accent →
 * --primary/--ring, radius → --radius) + tone vars + a #root and a postMessage
 * listener. Sandboxed (`allow-scripts` only, no same-origin), so the account's
 * own preview markup can never reach the dashboard's DOM/storage.
 *
 * `dark` is baked into the shell (the `<html>` class + a plain-CSS background
 * that applies BEFORE Tailwind compiles), so there's no white flash on first
 * paint. The parent swaps only the markup via postMessage — switching recipes
 * never reloads the iframe, so it never flashes.
 */
export function buildPreviewShell(
  accent: string,
  radius: string,
  dark: boolean,
): string {
  const a = safe(accent, "oklch(0.205 0 0)");
  const r = safe(radius, "0.625rem");
  // Pre-compile background matching --background, so the frame is never white.
  const bg = dark ? "oklch(0.145 0 0)" : "oklch(1 0 0)";
  const theme = `
:root {
  --radius: ${r};
  --background: oklch(1 0 0); --foreground: oklch(0.145 0 0);
  --card: oklch(1 0 0); --card-foreground: oklch(0.145 0 0);
  --popover: oklch(1 0 0); --popover-foreground: oklch(0.145 0 0);
  --primary: ${a}; --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.97 0 0); --secondary-foreground: oklch(0.205 0 0);
  --muted: oklch(0.97 0 0); --muted-foreground: oklch(0.556 0 0);
  --accent: oklch(0.97 0 0); --accent-foreground: oklch(0.205 0 0);
  --destructive: oklch(0.577 0.245 27.325); --destructive-foreground: oklch(0.985 0 0);
  --success: oklch(0.51 0.12 165); --warning: oklch(0.83 0.15 84); --danger: oklch(0.51 0.21 27);
  --border: oklch(0.922 0 0); --input: oklch(0.922 0 0); --ring: ${a};
  --term: oklch(0.62 0.17 150);
}
.dark {
  --background: oklch(0.145 0 0); --foreground: oklch(0.985 0 0);
  --card: oklch(0.205 0 0); --card-foreground: oklch(0.985 0 0);
  --popover: oklch(0.205 0 0); --popover-foreground: oklch(0.985 0 0);
  --primary: ${a}; --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.269 0 0); --secondary-foreground: oklch(0.985 0 0);
  --muted: oklch(0.269 0 0); --muted-foreground: oklch(0.708 0 0);
  --accent: oklch(0.269 0 0); --accent-foreground: oklch(0.985 0 0);
  --destructive: oklch(0.704 0.191 22.216); --destructive-foreground: oklch(0.985 0 0);
  --success: oklch(0.59 0.14 163); --warning: oklch(0.77 0.16 70); --danger: oklch(0.64 0.24 25);
  --border: oklch(1 0 0 / 10%); --input: oklch(1 0 0 / 15%); --ring: ${a};
  --term: oklch(0.78 0.18 150);
}
@theme inline {
  --color-background: var(--background); --color-foreground: var(--foreground);
  --color-card: var(--card); --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover); --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary); --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary); --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted); --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent); --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive); --color-destructive-foreground: var(--destructive-foreground);
  --color-success: var(--success); --color-warning: var(--warning); --color-danger: var(--danger);
  --color-border: var(--border); --color-input: var(--input); --color-ring: var(--ring);
  --color-term: var(--term);
  --radius-sm: calc(var(--radius) - 4px); --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius); --radius-xl: calc(var(--radius) + 4px);
}
[data-tone="neutral"]{--tone-bg:var(--muted);--tone-fg:var(--muted-foreground)}
[data-tone="success"]{--tone-bg:color-mix(in oklab,var(--success) 15%,transparent);--tone-fg:var(--success)}
[data-tone="warning"]{--tone-bg:color-mix(in oklab,var(--warning) 15%,transparent);--tone-fg:var(--warning)}
[data-tone="danger"]{--tone-bg:color-mix(in oklab,var(--destructive) 15%,transparent);--tone-fg:var(--destructive)}
[data-tone="info"]{--tone-bg:color-mix(in oklab,var(--primary) 15%,transparent);--tone-fg:var(--primary)}
`;
  return `<!doctype html><html class="${dark ? "dark" : ""}"><head><meta charset="utf-8"><style>html,body{background:${bg}}</style><script src="${TW_BROWSER_SRC}" integrity="${TW_BROWSER_SRI}" crossorigin="anonymous"></script><style type="text/tailwindcss">${theme}</style><style>body{margin:0;min-height:100vh;display:grid;place-items:center;padding:1.5rem;font-family:ui-sans-serif,system-ui,sans-serif;background:var(--background);color:var(--foreground)}</style></head><body><div id="root"></div><script>(function(){var r=document.getElementById("root");addEventListener("message",function(e){if(!e.data||e.data.t!=="sw-preview")return;r.innerHTML=e.data.html})})();</script></body></html>`;
}
