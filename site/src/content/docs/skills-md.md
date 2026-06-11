---
title: SKILL.md
description: The auto-generated recipe palette your agents read.
order: 8
---

# SKILL.md

`SKILL.md` is a machine-friendly catalog of every recipe installed in the
current project. The CLI regenerates it on every install/remove/upgrade.
Drop it into your agent's context (Claude Code's `CLAUDE.md`, Cursor's
`.cursorrules`, etc.) and the model will use the recipe palette
correctly.

## Shape

```markdown
---
name: shortwind-recipes
description: Class shorthands available in this project.
---

### Card recipes

- `@card` — default card with border, padding, surface color.
- `@card-elevated` — card with raised shadow.
- `@card-flat` — borderless card on a muted surface.

### Button recipes

- `@button` — default primary button.
- `@button-ghost` — transparent button with hover state.
```

## Customizing

`shortwind build` accepts `--skill-order family1,family2,...` to control the
ordering. `--skill-verbose` includes the flattened expansion of each recipe —
useful when you want the model to reason about exact Tailwind output.

## When SKILL.md regenerates

- `shortwind add` and `shortwind remove`.
- `shortwind upgrade` (after applying changes).
- `shortwind build` (always, via the same `renderSkillMarkdown` core export).

If you edit `SKILL.md` by hand, the next CLI run overwrites it. Treat it as
a generated artifact.
