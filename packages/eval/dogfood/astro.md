# Building with Shortwind — a candid retro

Stack: Astro 6 + React 19 + TypeScript, Tailwind v4 via `@tailwindcss/vite`,
Shortwind `0.1.0-beta.10` (`all` preset, 19 families / 122 recipes).

## Where Shortwind genuinely saved effort

The recipe vocabulary is the real win, and it shows up most in the parts of a
"real internal tool" that are usually death-by-a-thousand-utilities. A stat card
went from a dozen-token Tailwind chain to `class="@card-elevated @stack-xs"`. The
status pills are one class each (`@badge-success`, `@badge-danger`,
`@badge-warning`, `@badge`) and — crucially — they already bake in the
light/dark pairs (`bg-green-100 ... dark:bg-green-900 dark:text-green-200`), so I
got a coherent dark mode essentially for free by adding a single `.dark` class
toggle. The tab bar (`@tab` / `@tab-active`), the empty state (`@empty`,
`@empty-icon`, `@empty-title`, `@empty-description`), the mono branch chips
(`@code-inline`), avatars (`@avatar-sm`), and the focus-ring conventions on
buttons were all consistent without me hand-tuning spacing or states. The theme
the CLI dropped into `global.css` (semantic `--background`/`--card`/
`--primary` tokens in oklch) meant everything was visually consistent from the
first render rather than after an afternoon of fiddling.

The `SKILL.md` it generates is better documentation than most design systems
ship. Each family opens with a "when to reach for which" note that explicitly
calls out the confusable neighbours ("there is no `@flex-row`, use `@row`";
"`@grid-3`, not `@grid-cols-3`"). That removed almost all of the guessing.

## Where I got stuck — three real walls

**1. The "no recipes inside dynamic class strings" rule is the whole ballgame.**
The docs are upfront that a recipe only expands inside a *literal* `class="..."`
/ `className="..."`, never in a ternary, template literal, `class:list`, or a
prop. But an interactive panel is *made* of conditional classes. The trap is
that a leak is only a build **warning**, not an error — `npm run build` happily
succeeds while shipping a dead `@tab-active` token that renders unstyled. So I
architected around it: the tab bar renders two fully-literal branches
(`<button className="@tab-active">` vs `<button className="@tab">`) instead of
`className={active ? "@tab-active" : "@tab"}`; status badges are a `switch` that
returns a literal-class element per case; and the density toggle is driven by a
`data-density` attribute + plain CSS rather than a recipe in an expression. It
works and is arguably cleaner, but you have to internalize the constraint before
you write a single island or you'll get a clean build and a broken page.

**2. An inline `<script>` in `.astro` silently nuked every recipe after it.**
This one cost the most time. I put a tiny `<script is:inline>` in `<head>` to
add `.dark` from the OS preference. Build "succeeded," but `dist/index.html`
shipped raw `@wrapper`, `@card-elevated`, `@heading-xl`, etc. — and so did the
plain static `<main class="@wrapper">`, which has nothing dynamic about it.

What I tried: confirmed the core expander works on raw `.astro` (it does);
confirmed Astro's compiler is an `enforce:"pre"` Vite plugin that runs *before*
Shortwind, so Shortwind sees compiled JS; then instrumented the installed plugin
and found the smoking gun — in the compiled module, `<script` opened at index
1119 with **no `</script>` after it**, and `@wrapper` sat at 1401. Shortwind's
html-mode expander masks `<script>…</script>` regions (sensibly, so it won't
rewrite JS), and an *unclosed* `<script` masks to EOF. Astro emits inline
scripts in a shape where the closing tag isn't a literal `</script>` in the same
string, so the mask swallowed the entire body and nothing after the script
expanded. The fix was to keep `<script>` tags out of `.astro` entirely and move
the dark-mode logic into the island's `useEffect`. The docs warn about dynamic
classNames; they say nothing about an inline script poisoning all *static*
recipes downstream. That's a genuine footgun and the warning message
("likely a dynamic className") actively points you the wrong way.

**3. Tailwind v4 + Astro dev tried to compile the recipe files as CSS.**
`npm run build` was clean, but `npm run dev` threw a wall of Vite overlays:
``Invalid declaration: `inline-flex items-center gap-1 ...` `` with
`File: recipes/badge.css`. Tailwind's `@tailwindcss/vite` dev transform was
pulling each `recipes/*.css` into the module graph and trying to compile the
`@recipe name { … }` at-rule as a real stylesheet. `@source not "../../recipes"`
did **not** help (it's a module-load problem, not content-scanning). Since
Shortwind reads the recipe files from disk for its registry and never needs them
in the bundle, I added a 10-line `enforce:"pre"` Vite plugin that neutralizes
`recipes/*.css` modules to an empty comment before Tailwind sees them. Clean dev
and build after that — but this is exactly the kind of adapter-interop wrinkle
I'd have expected the official `@shortwind/astro` integration to handle, given
it advertises Tailwind v4 + Astro as a first-class target.

## Surprises

- The CLI experience is the most polished part: `init` detected pnpm, wrote the
  config, theme, husky pre-commit, VS Code settings, and `AGENTS.md`, and told
  me the one manual edit it couldn't make (adding the integration). Nice.
- The conflict resolver really is last-wins, so appending raw utilities to a
  recipe (`@input-shell w-72 pl-8`) just works — that escape hatch is what makes
  the literal-only constraint bearable.
- `@container` survives into the output and that's *correct* — it's Tailwind's
  container-query utility, and Shortwind deliberately reserves the name. Worth
  knowing before you panic-grep your `dist/` for stray `@`-tokens.

## What was awkward or impossible

The honest gap is **runtime choice between recipes**. There's no ergonomic story
for "this element is `@tab` or `@tab-active` depending on state" inside a
component. The blessed answer is `expandClassList` from `@shortwind/core`, but
that wants the registry, which is a build-time/Node artifact — not something you
casually reach for in a hydrated React island. So in practice every conditional
recipe becomes either a duplicated literal branch or a `data-*` + CSS dance. For
a static-leaning Astro page that's fine; for a stateful dashboard it's the
constant tax, and it's the one place the token-savings pitch quietly inverts —
you write *more* structure to keep the short classes legal.

Net: I'd reach for Shortwind again for content/marketing/dashboard-chrome where
markup is mostly static, and I'd be much more cautious wiring it into a
heavily-interactive island until the dynamic-class and adapter-dev-mode edges
are smoother. The savings are real; the guardrails are sharp and a couple of
them (the inline-script masking especially) draw blood silently.
