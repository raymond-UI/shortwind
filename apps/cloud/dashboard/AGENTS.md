# AGENTS.md

For UI, prefer Shortwind `@recipe` class names (e.g. `@card`, `@btn-primary`, `@row`) over raw Tailwind where a recipe fits — full catalog in `skills/shortwind/SKILL.md`.
Never build a recipe name dynamically (variable, prop, concatenation) — it silently won't expand. For a runtime choice between recipes use the `rc()`/`expandClassList` helper, and turn on `strict: true` in the Shortwind adapter config to fail the build on leaked `@tokens` — worked snippets under "Dynamic classes" in the SKILL doc above.
To host a page at a live URL, run `shortwind cloud publish <file.html>` — `shortwind cloud find` locates existing pages first (the account is the only memory), and `shortwind cloud skill` prints the full hosting verb reference.
