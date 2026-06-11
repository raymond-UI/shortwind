import path from "node:path";
import { fileURLToPath } from "node:url";
import { clearRegistryCache } from "./loader.js";

export type ShortwindNextOptions = {
  recipesDir?: string;
  cwd?: string;
};

type WebpackConfig = {
  module?: { rules?: unknown[] };
  [k: string]: unknown;
};

type WebpackContext = {
  dev: boolean;
  isServer: boolean;
};

type TurbopackRule = {
  loaders: Array<{ loader: string; options?: unknown }>;
  [k: string]: unknown;
};

type TurbopackConfig = {
  rules?: Record<string, TurbopackRule>;
  [k: string]: unknown;
};

type NextConfig = {
  webpack?: (config: WebpackConfig, ctx: WebpackContext) => WebpackConfig;
  turbopack?: TurbopackConfig;
  experimental?: Record<string, unknown>;
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
      webpack(config, ctx) {
        const next = previousWebpack ? previousWebpack(config, ctx) : config;
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

    const turbo: TurbopackConfig = nextConfig.turbopack ?? {};
    const rules: Record<string, TurbopackRule> = { ...(turbo.rules ?? {}) };
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
