# @shortwind/core — recipe parser

## Scope

Implement the parser for `.css` files containing `@recipe <name> { <class-list> }` directives. Output is a `Recipe[]` plus the optional fingerprint header, returned via the project-wide `Result` shape.

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

```ts
parseRecipeFile(source: string, filename: string)
  : Result<ParsedRecipeFile, Diagnostic[]>
```

```ts
type Result<T, E> = { ok: true; value: T } | { ok: false; errors: E };

type ParsedRecipeFile = {
  header: RecipeFileHeader | null;   // separate field — the resolver does not consume it
  recipes: Recipe[];
};

type RecipeFileHeader = {
  family: string;       // "card"
  version: string;      // "0.4.2"
  sha: string;          // "b0a1c3"
  sourceLine: number;   // always 1 if present
};

type Recipe = {
  name: string;             // no leading "@"
  description: string | null; // from the comment immediately above the recipe
  tokens: string[];         // every token in the body, in source order
  references: string[];     // names of other recipes referenced (with `@` stripped)
  sourceFile: string;
  sourceLine: number;
};

type Diagnostic = {
  code: string;             // e.g. "parse/missing-brace"
  message: string;
  file: string;
  line: number;
  column?: number;
};
```

Header is returned as a **separate field**, not attached to each recipe — the resolver only cares about `recipes`. The header is consumed by `shortwind verify`, `shortwind upgrade`, and the registry build.

Errors are returned via `Result`, never thrown. Throwing is reserved for actual bugs.

## Requirements

- Body is a class list, **not CSS declarations**. No semicolons inside the body. No `@apply`.
- Multiline bodies are supported; whitespace between tokens is collapsed.
- Comments inside the body are stripped, not preserved.
- The fingerprint header `/* shortwind: ... */` at the top of the file is parsed into a `RecipeFileHeader` and returned as `result.value.header`. If absent, `header` is `null`.
- Unknown syntax (anything that isn't `@recipe <name> { ... }` or a top-level comment) produces a typed `Diagnostic` with line number; the parser collects all syntax errors before returning a single `{ ok: false, errors }`.

## Public exports of `@shortwind/core` owned by this issue

`packages/core/src/index.ts` re-exports:

- `parseRecipeFile`
- `Result`, `Diagnostic`
- `ParsedRecipeFile`, `RecipeFileHeader`, `Recipe`

`buildRegistry` (issue 02) and `expand`, `expandDOM` (issue 03) are added to the same barrel by their respective issues. All shared types live in `packages/core/src/types.ts`; nothing is redefined in other packages.

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
- Fingerprint header present → returned in `header`, not duplicated on each recipe
- Fingerprint header absent → `header: null`
- Malformed: missing closing brace → `{ ok: false, errors: [...] }` with line
- Malformed: missing recipe name → diagnostic
- Malformed: semicolon in body → diagnostic with helpful message ("recipe bodies are class lists, not CSS")
- Multiple syntax errors in one file are all reported (parser does not bail on first error)
- Files with `\r\n` line endings
- BOM at file start

## Out of scope

No resolution. No expansion. No tailwind-merge. Pure source → AST.
