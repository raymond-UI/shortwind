# What I Would Do Differently

This is a practical follow-up plan from the repo review on 2026-06-08. The goal is not to change Shortwind's core premise. The premise is strong: Shortwind is a token-efficient macro layer for agent-authored Tailwind, not another component library.

## Keep

- Keep the flat `@recipe` vocabulary. It is the right tradeoff for LLM output: small surface, no new parameter grammar, readable source.
- Keep recipes as repo-owned `.css` files. The shadcn-style distribution model is a good fit for teams that want to customize visual language.
- Keep `SKILL.md` generation as a first-class output. The generated teaching surface is one of the most interesting parts of the product.
- Keep build-time and runtime expansion sharing `@shortwind/core`; that is the right place for semantic consistency.

## Change

### 1. Prove The Token Claim

Shortwind's README says LLMs spend 35-50% of HTML output tokens on Tailwind class strings and that recipes save roughly half of that. Make this continuously measurable.

- Add a small corpus of representative HTML/JSX artifacts.
- Add `shortwind bench` or a script-level equivalent that reports raw class tokens, recipe tokens, bytes, and percentage saved.
- Run the benchmark in CI so README claims stay honest.

Started:

- Built-in corpus under `packages/cli/src/bench-corpus/`, regenerated from the canonical registry via `pnpm gen:bench`.
- `shortwind bench` command reporting class words, class bytes, file bytes, and LLM tokens for the corpus or a local project.
- Real BPE token counting via `js-tiktoken` (cl100k_base), so the LLM-token column is comparable across runs rather than a regex heuristic.

### 2. Harden Source Transforms

The current JSX transform is intentionally pragmatic, but it manually scans JavaScript-like syntax. That is fine for v0, but a wider user base will hit edge cases in MDX, nested templates, `clsx`, `cva`, comments, and unusual string literals.

- Keep the current fast path for HTML.
- Move JSX/TSX/MDX expansion behind a parser-backed transform when feasible.
- Preserve source maps once transforms leave the prototype phase.
- Keep regex/manual scanning only where the syntax is genuinely regular.

Started:

- Parser-backed JSX/TSX string collection in `@shortwind/tailwind`, backed by `@babel/parser` (1.9 MB) rather than the full TypeScript compiler (24 MB).
- Source-preserving replacement of `class` / `className` JSX strings and configured helper calls such as `cva()` and `tv()`.
- HTML transform remains on the small `@shortwind/core` path.

### 3. Close The Lint Promise

The PRD and README describe more guardrails than the CLI currently enforces. Lint should either match the documented promise or the docs should become narrower.

High-priority rules:

- `recipe/bad-suffix-order`: warn on names like `@btn-lg-primary`; prefer `@btn-primary-lg`.
- `recipe/conflicting-intent`: warn on combinations like `@btn-primary @btn-danger`.
- `recipe/dynamic-class`: warn on likely computed recipe names such as `` `@${variant}` ``.
- `recipe/no-sibling-overlap`: warn when multiple recipes from the same family appear on one element.

Started:

- `recipe/bad-suffix-order`
- `recipe/conflicting-intent`
- `recipe/dynamic-class`
- `recipe/no-sibling-overlap`

### 4. Make Watch Mode Boringly Reliable

`shortwind dev` is part of the product's trust loop: edit a recipe, get a fresh skill file. A missed file event should not leave the generated teaching surface stale.

- Add a low-frequency reconciliation loop in watch mode.
- Keep event-driven rebuilds for fast feedback.
- Avoid noisy status events when periodic reconciliation finds no changes.

Started:

- Periodic silent reconciliation in `shortwind dev`.

### 5. Tune The Default Catalog For Agent Choice

The broad catalog is useful, but agents can suffer from too many near-neighbor choices. Presets should optimize for reliable selection, not just coverage.

- Keep `all` broad.
- Make `starter` and `app` strongly opinionated.
- Add selection guidance to `SKILL.md`, not only flattened expansions.
- Use the catalog page to expose the long tail.

### 6. Improve Generated Skill Guidance

The generated skill file should teach behavior as well as vocabulary.

- Add short family-level guidance.
- Add usage notes for easy-to-confuse recipes.
- Keep expansions visible, but consider compact examples for common combinations.

## Suggested Order

1. Improve `SKILL.md` guidance format.
2. Revisit MDX support on top of the existing `@babel/parser` JSX/TSX path.
3. Use benchmark and catalog data to tune presets.
4. Cross-platform watch behavior coverage (Linux/macOS/Windows).
5. Publish measured corpus numbers in the README from the bench command output.
