# @shortwind/vite

Vite plugin for [Shortwind](https://shortwind.dev) — expands `@recipe` tokens in your source before Tailwind's content scan, so the shipped CSS is plain Tailwind with no runtime.

> Most projects don't add this by hand — `npx @shortwind/cli@beta init` installs and wires it for you.

## Install

```bash
npm i -D @shortwind/vite@beta @shortwind/cli@beta
```

## Usage

Add `shortwind()` to your Vite plugins. It runs in the `pre` phase, ahead of Tailwind's scan, regardless of array position:

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { shortwind } from "@shortwind/vite";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [shortwind(), tailwindcss(), react()],
});
```

By default it reads recipes from `./recipes/` (override with `shortwind({ recipesDir })`). It also injects the registry's candidate set into your Tailwind CSS so the JIT generates the expanded utilities, and warns if a recipe token survives unexpanded (e.g. inside a dynamic `className`).

Docs: <https://shortwind.dev>
