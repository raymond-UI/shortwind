# @shortwind/cli

The Shortwind command-line tool. Provides the `shortwind` command: `init`, `add`, `remove`, `upgrade`, `dev`, `build`, `lint`, `ls`, `preset`, `bench`.

[Shortwind](https://shortwind.dev) is a token-efficient class layer for Tailwind: you write short `@recipe` names in `class=`/`className=` and they expand to full Tailwind class clusters at build time.

## Install

```bash
npx @shortwind/cli@beta init      # beta: published on the `beta` tag
```

`init` is the one command you need — it detects your bundler, installs the right adapter, copies the recipe catalog into `./recipes/`, scaffolds a default theme, wires the plugin into your config, and generates `skills/shortwind/SKILL.md`.

Install it to get the `shortwind` command in scripts:

```bash
npm i -D @shortwind/cli@beta
```

## Common commands

```bash
shortwind init --preset app     # starter | app | content | all | none
shortwind add table dialog      # add families on demand
shortwind dev                   # watch recipes/, regenerate SKILL.md
shortwind build                 # one-shot regenerate SKILL.md
shortwind lint                  # validate recipe usage, naming, conflicts
shortwind bench                 # measure token savings
```

Docs: <https://shortwind.dev>
