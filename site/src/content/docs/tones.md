---
title: Tones
description: Data-driven color — set a recipe's tone from your data without dynamic class names.
order: 3.4
---

# Tones

Some recipes are **tone-aware**: their color comes from CSS variables
(`--tone-bg` / `--tone-fg`) instead of being baked into the recipe. You pick the
tone with a `data-tone` attribute — so the color can be **driven by your data**
while the class name stays a static literal the build can see.

```tsx
<span className="@badge" data-tone={incident.severity}>{incident.severity}</span>
```

That one line is the thing recipes couldn't do before. You can't build a class
name dynamically (`` `@badge-${severity}` `` silently ships dead — see
[Dynamic classes](/docs/dynamic-classes)). Moving the variable part to a
`data-*` attribute sidesteps that entirely: `@badge` is always the same literal,
and `data-tone` carries the value.

With no `data-tone`, a tone-aware recipe falls back to a neutral look — existing
markup renders exactly as before.

## How it works

A tone-aware recipe reads two variables with a neutral fallback:

```css
@recipe badge {
  inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium
  bg-[var(--tone-bg,var(--muted))] text-[var(--tone-fg,var(--muted-foreground))]
}
```

You define what each tone *means* once, in CSS. `init` scaffolds a default set
into your entry stylesheet (the `shortwind:tones` block):

```css
[data-tone="neutral"] { --tone-bg: var(--muted);  --tone-fg: var(--muted-foreground); }
[data-tone="success"] { --tone-bg: oklch(0.962 0.044 156.743); --tone-fg: oklch(0.448 0.119 151.328); }
[data-tone="warning"] { --tone-bg: oklch(0.962 0.059 95.617);  --tone-fg: oklch(0.473 0.137 46.201); }
[data-tone="danger"]  { --tone-bg: color-mix(in oklab, var(--destructive) 15%, transparent); --tone-fg: var(--destructive); }
[data-tone="info"]    { --tone-bg: color-mix(in oklab, var(--primary) 15%, transparent);     --tone-fg: var(--primary); }
```

It's plain CSS you own — tune the values, or follow your project's dark strategy
(`init` writes the dark overrides for you).

## Your own tones

The recipe never enumerates tones, so adding a domain tone is just CSS — no
recipe or catalog change:

```css
[data-tone="sev1"] { --tone-bg: var(--color-red-100);   --tone-fg: var(--color-red-700); }
[data-tone="sev2"] { --tone-bg: var(--color-amber-100); --tone-fg: var(--color-amber-700); }
```
```tsx
<span className="@badge" data-tone="sev1">SEV1</span>
```

## Which recipes are tone-aware

- **`@badge`** — the default badge; color from `data-tone`.
- **`@stat-trend`** — a metric delta; set `data-tone="success"` for up,
  `"danger"` for down.

Any recipe you author can join in: read `bg-[var(--tone-bg,…)]` /
`text-[var(--tone-fg,…)]` and the `data-tone` table applies automatically.

## Static vs. data-driven

Both patterns are first-class — pick by where the value comes from:

```tsx
<span className="@badge-success">Done</span>          {/* known at author time */}
<span className="@badge" data-tone={status}>{status}</span>  {/* chosen from data */}
```

The static `@badge-success`/`-warning`/`-danger`/`-info` variants stay for the
cases where you know the tone when you write the markup; reach for `data-tone`
when it comes from data.
