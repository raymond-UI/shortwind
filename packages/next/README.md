# @shortwind/next

Next.js plugin for [Shortwind](https://shortwind.dev) — expands `@recipe` tokens before Tailwind's content scan, on both Webpack and Turbopack.

> Most projects don't add this by hand — `npx @shortwind/cli@beta init` installs and wires it for you.

## Install

```bash
npm i -D @shortwind/next@beta @shortwind/cli@beta
```

## Usage

Wrap your Next config. `withShortwind` is curried — the first call takes
Shortwind options (usually none), the second your Next config:

```ts
// next.config.ts
import type { NextConfig } from "next";
import { withShortwind } from "@shortwind/next";

const nextConfig: NextConfig = {
  // your Next config
};

export default withShortwind()(nextConfig);
```

Reads recipes from `./recipes/`. Run `npx @shortwind/cli@beta init` first to scaffold the catalog, theme, and `SKILL.md`.

Docs: <https://shortwind.dev>
