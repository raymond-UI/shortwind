---
title: Recipe format
description: How recipe files are structured and parsed.
order: 2
---

# Recipe format

A recipe file is a `.css` file with a Shortwind header and one or more
`@recipe` blocks. Example:

```css
/* shortwind: card@0.0.1 sha:abc123 */

/* Default content card with border, padding, and surface color. */
@recipe card {
  rounded-lg border border-zinc-200 bg-white p-4
}

/* Elevated variant. */
@recipe card-elevated {
  @card shadow-md
}
```

## Anatomy

- **Header.** First line, machine-managed: `/* shortwind: <family>@<version> sha:<6-hex> */`. The CLI rewrites the SHA whenever you edit. Don't hand-edit it.
- **Family name.** The header determines the family (e.g. `card`). All
  `@recipe` blocks in the file must belong to it.
- **Description.** The block-comment immediately above an `@recipe` becomes
  its description. Used in `SKILL.md` and the catalog.
- **Tokens.** Whitespace-separated Tailwind tokens. Any token starting with `@`
  is a reference to another recipe.

## References

`@recipe card-elevated { @card shadow-md }` says: "expand `@card`, then append
`shadow-md`." References resolve at build time, never at runtime — there is no
cascade, no inheritance, no surprises.

See [composition](/docs/composition) for how conflicts are resolved.
