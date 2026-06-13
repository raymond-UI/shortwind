# RFC: Predictable recipe names + a data-driven tone system

Status: draft for review · Date: 2026-06-12 · Source: 4 rounds of Vite/Next/Astro dogfooding

## Problem

Two findings from dogfooding, which turn out to be the same problem:

1. **Data-driven styling falls out of the catalog.** Severity/status coloring is
   chosen from data at render time. Recipe names can't be dynamic
   (`@badge-${tone}` silently no-ops) and the catalog's fixed tones
   (`success/warning/danger/info`) don't map to domain semantics (SEV1–4, open/
   acked/mitigated/resolved). So the most distinctive part of every build dropped
   to raw Tailwind and Shortwind contributed nothing there.

2. **Names aren't predictable enough to guess.** The catalog already enumerates
   `@flagged` slips in its own `@guide` comments — "there is no `@flex-row`",
   "`@grid-3` not `@grid-cols-3`", "`@body` not `@body-text`". Every such note is
   a place an agent guesses wrong.

**Target:** an agent (or human) guessing a recipe name from intent should be
right **≥90%** of the time, measured (see Acceptance).

## Thesis

> The name carries only what is **static by nature** — element + structural part
> + size. Everything **data-driven by nature** — tone/semantic-status,
> active/selected, open/closed — leaves the name and becomes a `data-*`
> attribute.

This single rule serves both findings at once:

- It collapses the name space. `@badge`/`@badge-success`/`@badge-warning`/
  `@badge-danger`/`@badge-info` → one name `@badge`. Fewer names, each highly
  guessable.
- It makes data-driven styling work *without* dynamic class names: the class
  stays a static literal the expander sees; the variable part is a `data-*`
  attribute Tailwind v4 already supports as a variant.

```tsx
// today — wrong axis in the name, and it can't be dynamic:
<span className={`@badge-${severity}`} />     // silently ships raw

// proposed — name is static, tone is data:
<span className="@badge" data-tone={severity} />
```

## The naming grammar

```
name      := element ("-" part | "-" variant)? ("-" size)?
element   := the component's single most common noun, spelled in full
part      := base | header | body | footer | item | trigger
           | content | title | description | icon | container
variant   := per-family, drawn from shared pools:
             intent  = primary | secondary | ghost | danger | outline
             surface = elevated | flat | interactive
size      := xs | sm | md | lg | xl        (always last; default omitted)
```

Rules that make guessing work:

1. **One *canonical* name per concept, plus aliases for the common
   mis-guesses** (decided: additive-aliases). The canonical name is the
   grammar-correct one; aliases resolve identically so a guesser hits either
   spelling. A `recipe/prefer-canonical` info-level lint nudges toward canonical
   (same severity tier as `recipe/no-redundant-utility`), so "canonical" stays
   meaningful without breaking anything. See Migration for how aliases are
   implemented.
2. **Element is the full common word**, not an abbreviation. `@button`, not
   `@btn`. (See Migration — this is the biggest current leak.)
3. **Singular nouns.** `@badge`, never `@badges`.
4. **Fixed slot order**: element → part|variant → size. Size is always last.
   Never size-first, never two variants stacked.
5. **Shared part vocabulary across every container family.** If `@card` has
   `-header/-body/-footer`, then `@dialog`, `@sheet`, `@menu` use the same part
   words for the same roles. Learn the parts once, apply everywhere.
6. **Dynamic axes are never in the name.** Tone, semantic status, active,
   open/expanded → `data-*` (next section). The only state ever spelled in a
   name is none — `@tab` not `@tab-active`.

## The tone / state mechanism

Dynamic axes resolve through `data-*` attributes. Two flavours:

**(a) Tone — domain-open, via CSS-variable indirection (recommended).** The
recipe is tone-agnostic; it reads three vars. The *user* maps their domain tones
to values once, the same way the theme already defines `--primary` etc.

```css
/* recipe — never enumerates tones, so the name never explodes */
@recipe badge {
  inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium
  bg-[var(--tone-bg,theme(colors.muted.DEFAULT))]
  text-[var(--tone-fg,theme(colors.muted.foreground))]
}

/* user's CSS (or a scaffolded default block) — domain tones, defined once */
[data-tone="sev1"]    { --tone-bg: var(--color-red-100);   --tone-fg: var(--color-red-800); }
[data-tone="sev2"]    { --tone-bg: var(--color-amber-100); --tone-fg: var(--color-amber-800); }
[data-tone="success"] { --tone-bg: var(--color-green-100); --tone-fg: var(--color-green-800); }
```
```tsx
<span className="@badge" data-tone={incident.severity} />
```

This is domain-open (the catalog can't ship every domain's tones, and shouldn't
try), aligns with the existing semantic-token system, and keeps the recipe a
flat static class list. `init` scaffolds a default tone block
(`neutral/success/warning/danger/info`) the user extends — exactly like the
theme-token supplement (#89).

**(b) Boolean/enum state — baked `data-[…]:` variants** for axes with a small
closed set the catalog *can* own (active, selected, open):

```css
@recipe tab {
  inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium
  border-transparent text-muted-foreground hover:text-foreground
  data-[active]:border-primary data-[active]:text-primary
}
```
```tsx
<button className="@tab" data-active={tab === current ? "" : undefined} />
```

Both already flow through the pipeline (verified: bracketed/`aria-`/arbitrary
variants ship in `@table-zebra`/`@input-shell` today; `FRAGILE_TOKEN_RE` splits
them into their own `@source inline(...)`).

## Migration cost (the catalog is published; family versions are machine-checked)

Applying the grammar to what's already shipped surfaces real decisions, not just
greenfield naming:

- **Abbreviation leaks** — `@btn-*` (vs full `@badge`/`@card`/`@input`),
  `@nav`/`@nav-link` (vs `@navigation`), `@dl`/`@dt`/`@dd` (HTML-ese). These are
  the highest-value guessability fixes *and* the most disruptive (every existing
  user's `@btn-primary` breaks).
- **Tone-in-name** — `@badge-success/warning/danger/info`,
  `@alert-success/...` → `@badge` + `data-tone`. Migrate, or keep the
  `@badge-<tone>` forms as documented sugar that expands identically (sugar
  costs the "one canonical name" rule — a decision).
- **State-in-name** — `@tab-active`, `@nav-link-active` → `@tab`/`@nav-link` +
  `data-[active]`.

**Decided: additive aliases.** Nothing breaks; the grammar-correct names become
canonical, the old names keep working. Two distinct mechanics, because a recipe
body is a class list and can't set an attribute:

- **Abbreviation / element aliases** (`@btn`→`@button`, `@nav`→`@navigation`,
  `@dl/dt/dd`→`@description-list/-term/-detail`): implement as **composition**,
  not duplication. The canonical recipe holds the classes; the alias is a
  one-line reference that flattens through the existing resolver:
  ```css
  @recipe button-primary { @button-base bg-primary text-primary-foreground hover:bg-primary/90 }
  @recipe btn-primary    { @button-primary }   /* alias — zero new machinery */
  ```
  No new AST field, no parser/resolver change; `recipe/unknown` and
  `recipe/unused` already understand references. The safelist dedups, so an alias
  adds no utilities — only a registry entry.

- **Tone "aliases" are not aliases — they're the static half of a two-pattern
  split.** `@badge-success` can't reference `@badge`+`data-tone` (a recipe can't
  emit an attribute), so it stays exactly as today: a self-contained recipe with
  baked colors, for when the tone is **known at author time**. The new `@badge` +
  `data-tone` path is for when the tone is **data-driven**. Both are first-class
  and supported; neither is an alias of the other. (So decision #2 dissolves:
  keep `@badge-<tone>` for static, add `@badge`+`data-tone` for dynamic.)
  Likewise `@tab-active` (static) stays; `@tab`+`data-[active]` is the
  data-driven form.

Cost to account for (machine-checked versioning): each touched family takes a
**minor bump** with new shas, and `catalog.lock.json` + `catalog.generated.ts` +
the CDN runtime bundle must be re-synced (`scripts/sync-runtime-to-site.ts`) or
the "CDN bundle in sync" CI guard fails. Aliases grow the embedded catalog (more
entries, deduped utilities) — acceptable, but real.

## New families (sequenced after the convention is ratified)

Named to the grammar, tone/state via data-attrs from day one. All five were
hand-built in *every* dogfood round:

| Family | Names | Dynamic axis → data-attr |
| --- | --- | --- |
| `menu` | `@menu`, `@menu-item`, `@menu-trigger`, `@menu-separator` | `data-[active]` (highlighted item) |
| `sheet` | `@sheet`, `@sheet-overlay`, `@sheet-content`, `@sheet-header`, `@sheet-footer` | side via `data-[side=left/right]` |
| `stat` | `@stat`, `@stat-label`, `@stat-value`, `@stat-trend` | `data-trend=up/down/flat` → `--tone-*` |
| `segmented` | `@segmented`, `@segmented-item` | `data-[active]` (selected segment) |
| `switch` | `@switch`, `@switch-thumb` | `data-[checked]` |

(`menu`/`sheet` are the "…" actions menu and the slide-over panel that every
build re-implemented. Canonical `@sheet` (highest LLM/agent recall via shadcn),
with `@drawer` as an alias per the additive-aliases decision — the alias policy
dissolves this tie too.)

## Acceptance — operationalizing "≥90% guessable"

Add a **guessability eval** to `packages/eval`: a fixture set of
(intent description → expected recipe name) pairs; a check that a name generated
from the grammar + a "did-you-mean" resolver hits the expected name ≥90% across
the set. This turns the naming principle into a machine-checked gate that runs in
CI alongside the existing fixtures — names can't regress predictability silently.
The same resolver powers a `recipe/unknown` "did you mean `@button`?" lint
suggestion (the safe alternative to silent aliasing).

## Decisions (resolved)

1. **Migration / abbreviation** — *additive aliases*: canonical grammar names +
   old names kept working (composition aliases; `recipe/prefer-canonical` lint).
2. **Tone-in-name** — *dissolved*: keep `@badge-<tone>`/`@tab-active` as the
   static-known pattern; add `@badge`+`data-tone` / `@tab`+`data-[active]` as the
   data-driven pattern. Both first-class.
3. **`sheet` vs `drawer`** — `@sheet` canonical, `@drawer` alias.

Remaining for review: the exact canonical spellings for the HTML-ese set
(`@dl/dt/dd` → `@description-list/-term/-detail`? or keep short and alias the
long form?) — a judgment call on which spelling an agent guesses first.

## Sequenced plan

1. **Pilot** — convert `badge` to the tone mechanism (`@badge` reads
   `--tone-bg/--tone-fg`; add the scaffolded default tone block to `init`,
   alongside the theme supplement), keeping `@badge-<tone>` intact. Stand up the
   **guessability eval** in `packages/eval` as the acceptance gate. This proves
   the convention end-to-end on one family before scaling.
2. **Abbreviation aliases** — add `@button*`/`@navigation*` (+ HTML-ese)
   canonical names with composition aliases; minor-bump + re-sync the touched
   families.
3. **New families** — `menu`, `sheet`(+`@drawer`), `stat`, `segmented`,
   `switch`, authored to the grammar with tone/state via data-attrs.
4. Each step is TDD golden fixtures + family version bump + CDN re-sync, per the
   existing catalog discipline.
