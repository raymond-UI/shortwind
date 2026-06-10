---
title: Getting started
description: A two-minute tour of Shortwind.
order: 0
---

# Getting started

Shortwind is a build-time class layer for Tailwind. Write `@card` instead of the
fifteen Tailwind tokens that make up a card. At build time, every `@recipe`
shorthand expands into its full Tailwind class list. The CSS your users
download is identical to plain Tailwind — Shortwind only shrinks the source.

## Why bother?

- **LLM artifacts shrink.** A Claude-generated dashboard goes from ~3,200
  tokens of class soup to ~900 tokens of `@recipe` shorthand. Same render.
- **You read what you wrote.** A line that says `class="@card-elevated"` tells
  you what the element *is*, not what it *looks like*.
- **No new runtime.** Shortwind compiles down to Tailwind. If Tailwind ships
  it, Shortwind ships it.

## Install

```bash
npx @shortwind/cli@beta init
```

The CLI (the `@shortwind/cli` package — beta for now) detects your bundler, installs
the matching adapter, copies a `recipes/` directory you own, scaffolds a default
theme, generates a `SKILL.md` so your agents know the recipe palette, and wires the
plugin into your bundler config.

See [install](/docs/install) for the full walkthrough.
