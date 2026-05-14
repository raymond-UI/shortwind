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

type NextConfig = {
  webpack?: (config: WebpackConfig, ctx: WebpackContext) => WebpackConfig;
  turbopack?: {
    rules?: Record<string, unknown>;
    [k: string]: unknown;
  };
  experimental?: Record<string, unknown>;
  [k: string]: unknown;
};

const here = path.dirname(fileURLToPath(import.meta.url));
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

    const turbo = nextConfig.turbopack ?? {};
    const rules = { ...(turbo.rules ?? {}) } as Record<string, unknown>;
    rules["*.{tsx,ts,jsx,js,mdx,md}"] = {
      loaders: [{ loader: LOADER_PATH, options: loaderOptions }],
    };
    wrapped.turbopack = { ...turbo, rules };

    return wrapped;
  };
}

export { default as shortwindLoader } from "./loader.js";
export type { ShortwindLoaderOptions } from "./loader.js";
