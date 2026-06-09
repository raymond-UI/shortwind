# Eval findings

First real run via OpenRouter, 2026-06-10. 12 tasks × control/guided × 3 models,
temperature 0, one sample per cell. Raw data was written with `--out`.

## Headline: no measurable selection-correctness effect from `@guide`

Pooled unknown-recipe rate = invented recipe names ÷ total recipe tokens
(controls for output volume, unlike the per-task mean):

| Model | Control | Guided | Effect |
| --- | --: | --: | --- |
| openai/gpt-4o-mini | 1.1% | 1.0% | none |
| mistralai/mistral-small-2603 | 1.9% | 1.9% | none |
| meta-llama/llama-3.1-8b-instruct | 57.5% | 54.4% | ~3 pts, still unusable |

**Why:** capable models already pick valid recipe names ~98–99% of the time
**without** guidance — there is almost no selection error for guidance to remove.
The only model that fails badly (llama-3.1-8b invents over half its recipe
names) is too weak to follow the catalog structure at all; guidance barely
moves it.

The density/redundant metrics are not usable here: llama-3.1-8b pasted each
recipe's full expansion next to the recipe name (`@input block w-full
rounded-md …`), which the linter correctly flags as redundant. That's a
weak-model instruction-following failure, not a guidance effect.

## What this does and doesn't say

It says: on this task set, for frontier-class models, the specific failure mode
`@guide` targets (inventing recipe names / reaching for a near-neighbour) barely
occurs, so guidance can't improve it.

It does **not** say guidance is worthless:
- It costs nothing at runtime (`@guide` is comment-only) and is not in the
  shipped CSS output.
- It still helps the weakest model directionally and almost certainly helps a
  human reading `SKILL.md` or the catalog page.
- This eval measures selection *correctness* only. It cannot see whether
  guidance helps a model choose well *between valid* options (e.g. `@card`
  vs `@card-elevated`), which is a different and harder thing to score.

## Limitations (why this is directional, not a verdict)

- n = 12 tasks, 3 models, single sample per cell — no variance estimate.
- The tasks are deliberately unambiguous; capable models nail them. A harder
  set (obscure recipes, denser near-neighbours, partial specs) might surface an
  effect that easy tasks hide.
- Only three models, none of them the current frontier tier.

## Recommendation

Do not add a "guidance improves selection" claim to the README — the data
doesn't support one. Keep the `@guide` blocks (near-zero cost, helps humans and
weak models), but treat their value as readability/teaching, not as a measured
accuracy lever. If we want to actually move this number, the lever is a harder
task set, not more guidance text.
