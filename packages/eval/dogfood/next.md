# Building with Shortwind — a candid retro

Stack: Next.js 16.2.9 (App Router, Turbopack) · React 19 · TypeScript · Tailwind v4 · `@shortwind/cli@0.1.0-beta.10`.

## Where it saved real effort

The recipe vocabulary is genuinely pleasant once the theme is wired. Writing
`@card-elevated @stack-xs` instead of `rounded-lg border border-border bg-card
text-card-foreground p-4 shadow-md flex flex-col gap-1` is a real reduction, and
the layout primitives (`@stack-*`, `@row-between`, `@grid-4`) read like intent
rather than mechanics. The status badges (`@badge-success/-danger/-warning`),
`@btn-primary`, `@input`, `@tab`/`@tab-active`, `@empty`, and `@list-bordered`
all did exactly what they said and already bake in hover/focus/dark-mode
variants, so I never restated those. The generated `SKILL.md` is the standout:
every family opens with a "when to use" line that calls out the confusable
neighbours ("there is no `@flex-row`, use `@row`"; "`@grid-3`, not
`@grid-cols-3`"). That catalog did more to keep me consistent than the recipes
themselves — it's the best part of the product.

## Where I got stuck or confused

**The theme is bring-your-own, and nothing tells you.** Every recipe references
shadcn-style tokens — `bg-card`, `text-muted-foreground`, `border-border`,
`bg-primary`, `bg-destructive`, `text-popover-foreground`. A fresh
`create-next-app` defines none of those. `shortwind init` claims it can scaffold
a default theme, but it silently skipped that step because the generated
`globals.css` already had an `@theme` block — leaving 19 families of recipes
pointing at colors that don't exist. There was no warning at init time and no
warning at build time; I would have shipped a page where every `@card` and
`@badge` rendered colorless. I ended up reverse-engineering the expected token
set from Shortwind's *own benchmark corpus* inside `node_modules` and writing the
full shadcn neutral palette (light + dark, oklch) by hand. This is the biggest
gap: the recipes have a hard contract with a design-token layer that the tool
neither ships nor verifies is present.

**The auto-wiring under-delivered, and the docs are wrong.** init printed
"bundler config: needs a manual edit" with the snippet
`export default withShortwind(nextConfig)`. That's incorrect —
`withShortwind` is curried: `withShortwind(options?)(nextConfig)`. The README
shows a third, also-wrong variant (`withShortwind({ ...nextConfig })`). Following
either literally makes your default export a *function*, and Next fails to boot.
I had to open the compiled `dist/index.js` to find the right call. For a tool
whose whole pitch is "let the agent write less," sending the agent a config
snippet that doesn't work is a rough first five minutes.

**A TypeScript mismatch the happy path hides.** `@shortwind/next` declares its
own `NextConfig` type whose `webpack` is non-nullable, which is not assignable
from Next's official `NextConfig` (where `webpack` can be `null`). `next build`
compiled fine but the type check failed. I cast the argument with
`Parameters<ReturnType<typeof withShortwind>>[0]` to keep it honest rather than
reaching for `any`.

## The surprise: the dynamic-class pitfall is real, and the docs half-describe it

This was the most interesting finding. Recipes only expand inside class strings
the loader can statically see. I deliberately stored badge recipes in a lookup
object (`{ recipe: "@badge-success", ... }`) and applied them with
`className={cfg.recipe}` — and the build grep caught exactly four dead `@badge*`
tokens sitting in the client JS bundle. Unstyled badges, invisible at a glance.
The fix was to inline the recipe as a literal ternary directly in `className`.

What surprised me: `SKILL.md` explicitly lists a ternary as a *non-expanding*
case (`class={active ? "@nav-link-active" : "@nav-link"}`), yet my
`className={active ? "@tab-active" : "@tab"}` **did** expand cleanly. So the
loader is actually smarter than its own docs in one direction — it handles
literal ternaries *inside* a `className={...}` expression — while the real rule
that bit me (no expansion through a variable/prop indirection) is the one the
docs state less prominently. The accurate mental model is "the recipe text must
appear literally within a class attribute the loader can see," not "no ternaries."
The docs would be better leading with that.

Credit where due: the task's "grep the built output for `@recipe` tokens" check
is not busywork — it's the only thing besides a pixel-by-pixel review that would
have caught my leak. A build-time error (or even a louder warning) on a dead
recipe token in client output would close this gap.

## What was awkward or that I wanted and couldn't cleanly do

Anything computed is awkward. The instant a class isn't a literal — built from
state, themed by a prop, composed in a helper — you either inline it (verbose,
defeating the point) or reach for `expandClassList` from `@shortwind/core`, i.e.
a build/runtime helper for what is a one-line template string in plain Tailwind.
For a static dashboard this was fine; for a component library that passes
`variant` props around, the literal-only constraint would fight the natural
React grain constantly.

## Bottom line

Shortwind delivered on the core promise — terser, semantic, identical-output
class strings, and an unusually good catalog — but the beta seams show at exactly
the setup boundary it's supposed to automate: the theme contract is unstated and
unverified, the wiring instructions are wrong in two places, and the one failure
mode that silently ships broken UI (dead recipe tokens) is left to a manual grep.
Once past setup, writing the actual page was the easy part.
