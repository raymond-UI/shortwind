# @shortwind/astro

Astro integration for [Shortwind](https://shortwind.dev) — expands `@recipe` tokens before Tailwind's content scan.

> Most projects don't add this by hand — `npx @shortwind/cli@beta init` installs and wires it for you.

## Install

```bash
npm i -D @shortwind/astro@beta @shortwind/cli@beta
```

## Usage

```ts
// astro.config.mjs
import { defineConfig } from "astro/config";
import shortwind from "@shortwind/astro";

export default defineConfig({
  integrations: [shortwind()],
});
```

Reads recipes from `./recipes/`. Run `npx @shortwind/cli@beta init` first to scaffold the catalog, theme, and `SKILL.md`.

Docs: <https://shortwind.dev>
