# @shortwind/core — recipe parser

## Scope

Implement the parser for `.css` files containing `@recipe <name> { <class-list> }` directives. Output is a `Recipe[]` data structure consumed by the resolver.

## Recipe file format

```css
/* shortwind: card@0.4.2 sha:b0a1c3 — DO NOT EDIT THIS LINE */

/* Default content card. */
@recipe card {
  rounded-lg border border-zinc-200 bg-white p-4 shadow-sm
}

/* Raised card for primary content. Built on @card. */
@recipe card-elevated {
  @card rounded-xl p-6 hover:shadow-md transition-shadow
}
```

## Parser contract

Function signature:

```
parseRecipeFile(source: string, filename: string) → Recipe[]
```

Where each `Recipe` has:
- `name` (string, no leading `@`)
- `description` (string | null, from the comment immediately above the recipe)
- `tokens` (string[]) — every token in the body, including `@references` and raw Tailwind classes, in source order
- `references` (string[]) — names of other recipes referenced (the `@<name>` tokens, with `@` stripped)
- `sourceFile` (string)
- `sourceLine` (number)

## Requirements

- Body is a class list, **not CSS declarations**. No semicolons inside the body. No `@apply`.
- Multiline bodies are supported; whitespace between tokens is collapsed.
- Comments inside the body are stripped, not preserved.
- The fingerprint header `/* shortwind: ... */` at the top of the file is parsed into a `RecipeFileHeader` and returned separately (or attached to each recipe in the file).
- Unknown syntax (anything that isn't `@recipe <name> { ... }` or a top-level comment) produces a typed parse error with line number, never silent skipping.

## Tests (heavy)

Per the PRD testing decisions, this module is heavy-test priority. Cover:

- Single-recipe file
- Multi-recipe file
- Multiline body
- Leading comment becomes description
- Missing description (null)
- Reference to another recipe (`@card` inside `card-elevated`)
- Body with mixed `@references` and raw utilities
- Tailwind variants in body (`hover:shadow-md`, `dark:bg-zinc-900`, `md:grid-cols-2`)
- Arbitrary values in body (`p-[13px]`, `bg-[#abc]`)
- Empty body (zero-token recipe)
- Malformed: missing closing brace → error with line
- Malformed: missing recipe name → error
- Malformed: semicolon in body → error with helpful message ("recipe bodies are class lists, not CSS")
- Files with `\r\n` line endings
- BOM at file start

## Out of scope

No resolution. No expansion. No tailwind-merge. Pure source → AST.
