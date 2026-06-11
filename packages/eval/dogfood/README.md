# Dogfood builds — Vite / Next / Astro

On 2026-06-11 the same "Deployments dashboard" brief ([`prompt.md`](./prompt.md))
was built three times from scratch — once per adapter — by fresh agent sessions,
against the published `0.1.0-beta.10` packages. The goal was to test the real
adoption experience and surface DX/correctness gaps the unit fixtures don't.

Each agent's candid retro is preserved verbatim:

- [`vite.md`](./vite.md) — Vite + React + TS
- [`next.md`](./next.md) — Next.js (App Router) + React + TS
- [`astro.md`](./astro.md) — Astro + React island + TS

## Outcome

All three builds **passed the leak gate** (zero `@recipe` tokens in output) — but
only because each agent manually architected around the dynamic-class
constraint. Each framework surfaced a distinct, previously-untested bug.

| | Vite | Next | Astro |
| --- | --- | --- | --- |
| Build passed | ✅ | ✅ (after a cast) | ✅ |
| Leaks in final output | 0 | 0 (caught 4 mid-build) | 0 (caught 6 mid-build) |
| Headline new bug | escape hatch uninstallable + self-defeating | wiring docs wrong → won't boot; theme silently skipped | inline `<script>` silently kills all downstream recipes |

**Universal finding (all three, independently):** recipes are a real win for
static design-system furniture, the generated `SKILL.md` is the best part of the
product, dark-mode-for-free is real — but every *stateful* class is a place you
can silently ship a dead token, and the only safety net is a manual grep. The
token-savings pitch inverts on interactive components.

## Issues filed from this round

| Issue | Sev | Source retro |
| --- | --- | --- |
| [#60](https://github.com/raymond-UI/shortwind/issues/60) — unclosed `<script>` masks downstream recipes to EOF | critical | astro |
| [#61](https://github.com/raymond-UI/shortwind/issues/61) — `withShortwind` wiring mis-documented (curried) | critical | next |
| [#62](https://github.com/raymond-UI/shortwind/issues/62) — theme silently skipped when `@theme` exists | critical | next |
| [#63](https://github.com/raymond-UI/shortwind/issues/63) — `rc()` escape hatch uninstallable + re-inlines `@recipe` tokens | medium | vite |
| [#64](https://github.com/raymond-UI/shortwind/issues/64) — `NextConfig.webpack` non-nullable → typecheck fails | medium | next |
| [#65](https://github.com/raymond-UI/shortwind/issues/65) — Tailwind v4 dev compiles `recipes/*.css` | medium | astro |
| [#66](https://github.com/raymond-UI/shortwind/issues/66) — SKILL/docs wrong about JSX ternary expansion | docs | next |
| [#67](https://github.com/raymond-UI/shortwind/issues/67) — dead `@recipe` token should fail the build | enhancement | all |
| [#68](https://github.com/raymond-UI/shortwind/issues/68) — `init --yes` rejected / interactive-only | enhancement | all |
| [#69](https://github.com/raymond-UI/shortwind/issues/69) — homepage uses `@eyebrow`, not in default catalog | bug | vite |

The throwaway project dirs (`~/Codebase/OSS/shortwind-{vite,next,astro}/`) were
not preserved; these retros + the issues above are the record.
