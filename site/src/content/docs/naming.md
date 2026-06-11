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

## Why a convention?

- **Searchability.** `@button` finds every button recipe in your editor's
  fuzzy finder. So does `@badge`.
- **LLM legibility.** A model reading your `SKILL.md` can guess what
  `@button-danger-sm` does without ever seeing its expansion.
- **Diff readability.** Renaming a recipe touches one line per file. A
  search-and-replace is unambiguous.

The CLI's `shortwind lint --naming` flags recipes that don't follow the
convention. The check is opt-in — the convention is a guideline, not law.
