---
title: Naming
description: The <family>-<intent>-<size> convention.
order: 4
---

# Naming

Recipe names follow `<family>-<intent>-<size>`:

- **Family.** The component class: `card`, `button`, `badge`, `dialog`.
- **Intent.** The visual or semantic variant: `primary`, `ghost`, `danger`.
- **Size.** When applicable: `sm`, `md`, `lg`.

Examples: `card-elevated`, `button-primary`, `button-ghost-sm`, `badge-success`.

The name uses the full, common word — `@button`, not `@btn`. The short forms
(`@btn-*`, `@nav-*`, `@dl`/`@dt`/`@dd`) still work as aliases that expand
identically, but the full-word names are canonical — prefer them, and a guess
like `@button-primary` or `@navigation-link` lands.

## Keep dynamic axes out of the name

What's **static by nature** goes in the name — the element, a structural part,
the size. What's **data-driven by nature** does not. A badge's color, a tab's
selected state, a switch's on/off — those are chosen from data at runtime, so
they ride on a `data-*` attribute, not a different recipe name:

```tsx
<span className="@badge" data-tone={severity} />   {/* color via data-tone, not @badge-${…} */}
<button className="@tab" data-active={isActive} />  {/* selected via data-active */}
```

This is why you won't find a recipe per severity or per state: one guessable
name plus an attribute beats an exploding name space. See
[Tones](/docs/tones) and [Dynamic classes](/docs/dynamic-classes).

## Why a convention?

- **Searchability.** `@button` finds every button recipe in your editor's
  fuzzy finder. So does `@badge`.
- **LLM legibility.** A model reading your `SKILL.md` can guess what
  `@button-danger-sm` does without ever seeing its expansion.
- **Diff readability.** Renaming a recipe touches one line per file. A
  search-and-replace is unambiguous.

The CLI's `shortwind lint` flags recipes whose names break the convention
(`recipe/bad-suffix-order` and friends). The convention is a guideline, not law.
