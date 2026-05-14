# apps/web — `/docs/*` route

## Scope

Documentation pages on `shortwind.dev`. Reuses the project's existing README and PRD as primary content sources.

## Pages (initial)

- `/docs` — index, getting-started summary.
- `/docs/install` — `shortwind init` walkthrough.
- `/docs/recipes` — recipe format spec.
- `/docs/composition` — how `@references` and `tailwind-merge` work.
- `/docs/naming` — the `<family>-<intent>-<size>` convention.
- `/docs/upgrade` — fingerprint + lockfile + the `shortwind upgrade` flow.
- `/docs/cli` — every command's flags and behavior.
- `/docs/cdn` — the runtime expander, for standalone artifact authors.
- `/docs/skills-md` — how the auto-generated SKILL.md works.
- `/docs/security` — security posture.

## Implementation

- Markdown source in `apps/web/src/content/docs/*.md`.
- Render with a lightweight markdown library (no MDX needed for v1 — content is plain text + code).
- Syntax highlighting via Shiki.
- Sidebar TOC generated from frontmatter.

## Tests

- Smoke: each markdown file renders without error.
- Link check: all internal links resolve to existing routes.

## Out of scope

- Versioned docs (v1 has one version).
- Interactive examples beyond the playground link.
