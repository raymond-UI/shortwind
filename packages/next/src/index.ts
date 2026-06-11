import path from "node:path";
import { fileURLToPath } from "node:url";
import { clearRegistryCache } from "./loader.js";
// Type-only import (next is a peer dependency): the accepted/returned config
// is Next's OWN NextConfig, resolved against the consumer's installed next, so
// `withShortwind()(nextConfig)` can never drift from what `next build`'s
// typecheck expects (#64 — the old local NextConfig type rejected
// `webpack: null`, which Next's type allows).
import type { NextConfig } from "next";

export type ShortwindNextOptions = {
  recipesDir?: string;
  cwd?: string;
};

type WebpackConfig = {
  module?: { rules?: unknown[] };
  [k: string]: unknown;
};

const here = path.dirname(fileURLToPath(import.meta.url));
// Resolves to the compiled ESM sibling. If we ever ship a dual CJS/ESM build,
// the loader file name must remain stable for webpack/turbopack to resolve it.
const LOADER_PATH = path.join(here, "loader.js");

const SOURCE_TEST = /\.(?:tsx?|jsx?|mdx?)$/;

export function withShortwind(
  options: ShortwindNextOptions = {},
): (nextConfig?: NextConfig) => NextConfig {
  const cwd = options.cwd ?? process.cwd();
  const recipesDir = options.recipesDir ?? path.join(cwd, "recipes");

  return (nextConfig: NextConfig = {}) => {
    const loaderOptions = { recipesDir };
    const previousWebpack = nextConfig.webpack;

    const wrapped: NextConfig = {
      ...nextConfig,
      // Next types the hook's config as `any`; narrow it locally to the slice
      // we touch and let `ctx` take its contextual WebpackConfigContext type.
      // The truthy guard also covers `webpack: null`, which Next's config type
      // explicitly allows.
      webpack(config: WebpackConfig, ctx) {
        const next = previousWebpack
          ? (previousWebpack(config, ctx) as WebpackConfig)
          : config;
        next.module ??= {};
        next.module.rules ??= [];
        const rule = {
          test: SOURCE_TEST,
          exclude: /node_modules/,
          use: [{ loader: LOADER_PATH, options: loaderOptions }],
          enforce: "pre" as const,
        };
        next.module.rules.unshift(rule);
        if (ctx.dev) clearRegistryCache();
        return next;
      },
    };

    const turbo = nextConfig.turbopack ?? {};
    const rules: NonNullable<NextConfig["turbopack"]>["rules"] = { ...(turbo.rules ?? {}) };
    // Asymmetry vs the webpack rule's `exclude: /node_modules/`: Turbopack rule
    // keys are globs with no negation syntax, so a node_modules exclude can't be
    // expressed here. Turbopack does not apply custom loader rules to
    // node_modules by default, so dependency files aren't transformed; the
    // loader is also a no-op on any file without `@recipe` tokens.
    rules["*.{tsx,ts,jsx,js,mdx,md}"] = {
      loaders: [{ loader: LOADER_PATH, options: loaderOptions }],
    };
    wrapped.turbopack = { ...turbo, rules };

    return wrapped;
  };
}

export { default as shortwindLoader } from "./loader.js";
export type { ShortwindLoaderOptions } from "./loader.js";

// Re-exported so the documented rc() escape hatch resolves from the package
// init actually installs — `@shortwind/core` is only a transitive dependency
// (#63). In Next the registry load is server-side (loadRegistryFromDir reads
// recipes/ from disk); expand in a server component or route and pass the
// resulting plain-Tailwind string to the client as a prop.
export { expandClassList } from "@shortwind/core";
export { loadRegistryFromDir } from "@shortwind/tailwind";
export type { Registry } from "@shortwind/core";
