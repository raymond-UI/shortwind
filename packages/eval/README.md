# @shortwind/eval

A selection-quality eval harness. It measures the one thing `shortwind bench`
can't: whether the `@guide` blocks actually make a model **pick the right
recipe more often** — not just how many tokens are saved once it does.

## The question

`bench` proves recipes are terse. This proves they're *selectable*. The bench
corpus itself was the motivating bug: it reached for `@flex-row` (doesn't
exist) instead of `@row`. That's a selection failure, and the `@guide` blocks
were written to fix exactly those. This harness checks whether they do.

## How it works

For each task, the model is given the catalog two ways and asked for the same
UI snippet:

- **control** — `SKILL.md` with recipe names + expansions only (the pre-`@guide` format)
- **guided** — the same `SKILL.md`, plus the `@guide` selection blocks

The two prompts are byte-identical except for the guidance, so guidance is the
only variable. Each generation is graded by running the **real `shortwind`
linter** over it (no duplicated logic):

| Metric | Source | Better |
| --- | --- | --- |
| Unknown-recipe rate | `recipe/unknown` ÷ recipe tokens | lower |
| Selection conflicts | `recipe/conflicting-intent` + `no-sibling-overlap` + `bad-suffix-order` + `dynamic-class` | lower |
| Redundant utilities | `recipe/no-redundant-utility` | lower |
| Recipe density | recipe tokens ÷ all class tokens | higher |

The headline is **unknown-recipe rate**: the `@flex-row`-instead-of-`@row`
failure, measured.

## Running it

```bash
# Offline simulator — free, no key, runs in CI. Smoke-tests the pipeline;
# results MODEL the hypothesis, they do not confirm it.
pnpm --filter @shortwind/eval eval --offline

# Real run via OpenRouter (paid). Needs OPENROUTER_API_KEY.
OPENROUTER_API_KEY=sk-... pnpm --filter @shortwind/eval eval \
  --models anthropic/claude-3.5-sonnet,openai/gpt-4o-mini

# Options
#   --models a,b      comma-separated OpenRouter model ids
#   --tasks  id,id    run a subset of tasks
#   --limit  N        first N tasks only
#   --json            machine-readable output
#   --out file.json   write raw per-generation results
```

With no `OPENROUTER_API_KEY` and no `--offline`, it falls back to the simulator
and says so on stderr.

## What's trustworthy vs not

- The **grader** is real: it scores output against the real registry with the
  real lint rules. Its tests are deterministic and run in CI.
- The **offline simulator** is a stand-in for pipeline testing only. It picks a
  confusable's wrong name under control and the right name under guided, so an
  offline run always shows the differential. That is a fixture, not evidence.
- Only a **real OpenRouter run** answers the actual question.
