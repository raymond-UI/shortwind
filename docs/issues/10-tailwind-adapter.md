# @shortwind/tailwind — v3/v4 adapter

## Scope

Single integration package that registers Shortwind's source-file transform with the host project's Tailwind, regardless of whether they're on v3 or v4.

## Contract

```
shortwindPlugin(options?) → TailwindPlugin
```

Detection happens at install/import time:
- Read `tailwindcss` major version from the consuming project's `package.json`.
- If v3: register via the v3 plugin API (`module.exports = { plugins: [shortwindPlugin()] }`).
- If v4: register via the v4 plugin API (CSS-first, via the new plugin shape).

The actual file-transform work delegates to `@shortwind/core`. Only the registration glue differs between versions.

## Responsibilities

- Hook into Tailwind's content scan so that **expanded** classes (not the raw `@card` tokens) are visible to JIT.
- For v3: register a content transformer.
- For v4: integrate with `@source` / theme via the v4 plugin API.
- Ensure ordering: Shortwind's transform runs **before** Tailwind sees content.

## Tests (medium — smoke)

- v3 fixture: minimal project with `tailwindcss@^3`, recipes, a page using `@card`. After build, output CSS contains the underlying Tailwind utility rules (`.rounded-lg`, `.border-zinc-200`, etc.) — proving JIT saw the expanded classes.
- v4 fixture: same shape with `tailwindcss@^4`. Same assertion.
- Error case: project has no `tailwindcss` dependency → clear error message pointing the user to install it.

## Out of scope

- Bundler-specific wiring (Vite/Next/Astro plugins in separate issues).
- Tailwind utilities themselves (we don't ship CSS).
