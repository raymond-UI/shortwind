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

## Second run: latest coding + frontier models (2026-06-10)

Re-ran on current-generation models to check whether the null effect was just
the mid-tier models tested first. It was not — the effect is null because these
models are already at the ceiling.

Pooled unknown-recipe rate (invented names ÷ recipe tokens):

| Category | Model | Control | Guided |
| --- | --- | --: | --: |
| Coding | deepseek/deepseek-v4-pro | 0.0% | 0.0% |
| Coding | qwen/qwen3-coder-next | 0.8% | 0.0% |
| Coding | openai/gpt-5.3-codex | 0.0% | 0.0% |
| Frontier OpenAI | openai/gpt-5.5 | 0.0% | 0.0% |
| Frontier OpenAI | openai/gpt-5.5-pro † | 0.0% | 0.0% |

† gpt-5.5-pro: only 2/12 tasks completed before the test key ran out of credits;
both showed 0% unknown.

Selection conflicts were 0 in both conditions for every model **except**
qwen3-coder-next, where guidance cut conflicts 4 → 1 — the single positive
signal in the whole study, and from one model on n=12.

**Reinforced conclusion:** current coding and frontier models make essentially
zero recipe-selection errors with or without `@guide`. The `@flex-row`-instead-
of-`@row` failure that motivated the guidance does not occur with 2026-era
models. Guidance can only help where the model is weak enough to fail, and those
models (e.g. llama-3.1-8b) are too weak to be usable regardless.

## Recommendation

Do not add a "guidance improves selection" claim to the README — the data
doesn't support one. Keep the `@guide` blocks (near-zero cost, helps humans and
weak models), but treat their value as readability/teaching, not as a measured
accuracy lever. If we want to actually move this number, the lever is a harder
task set, not more guidance text.
