import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  detectTailwindMajor,
  findTailwindEntryCssFiles,
  loadRegistryFromDir,
  syncSafelistFile,
  TailwindAdapterError,
} from "@shortwind/tailwind";
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
  // Fail the build when a known recipe token survives in transformed output
  // anywhere — including the silent variable-indirection case (#67). Off by
  // default; the detector is token-based, so prose that legitimately names a
  // recipe would fail a strict build.
  strict?: boolean;
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
  // Recipe expansions exist only in loader output, which Tailwind never sees:
  // in Next, Tailwind v4 reads the entry CSS FROM DISK (PostCSS/Turbopack) and
  // scans on-disk sources — there is no CSS pipeline hook equivalent to Vite's
  // load phase. So the registry-derived `@source inline(...)` safelist must
  // live on disk too (#73) — written to a sibling `*.shortwind.css` and pulled
  // in via a single injected `@import`, so the user's entry CSS stays clean.
  // next.config is evaluated at the start of every `next dev`/`next build`,
  // which makes this the reliable sync point for both bundlers; the loader
  // refreshes the same files when recipes change mid-session (see loader.ts).
  const entryCss = syncSafelist(cwd, recipesDir);

  return (nextConfig: NextConfig = {}) => {
    const loaderOptions = { recipesDir, strict: options.strict ?? false, entryCss };
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
    // keys are globs with no negation syntax, so a node_modules exclude can't
    // be expressed here — and Next 16's Turbopack DOES apply custom loader
    // rules to node_modules. The loader itself skips vendored paths (#75), so
    // dependency files pass through untransformed and unscanned.
    rules["*.{tsx,ts,jsx,js,mdx,md}"] = {
      loaders: [{ loader: LOADER_PATH, options: loaderOptions }],
    };
    wrapped.turbopack = { ...turbo, rules };

    return wrapped;
  };
}

// Upsert the safelist into every Tailwind v4 entry stylesheet. Failures are
// reported, never thrown — a broken recipe or a read-only filesystem must not
// take down config evaluation (the loader will surface recipe errors with
// proper module attribution).
function syncSafelist(cwd: string, recipesDir: string): string[] {
  try {
    const registry = loadRegistryFromDir(recipesDir);
    const files = findTailwindEntryCssFiles(cwd);
    if (Object.keys(registry.flattened).length > 0 && files.length === 0 && isTailwind4(cwd)) {
      console.warn(
        `[shortwind] no Tailwind entry CSS found under ${cwd} (a .css with @import "tailwindcss") — ` +
          `recipe-only utilities won't reach Tailwind's generator and will render unstyled`,
      );
    }
    for (const file of files) {
      try {
        syncSafelistFile(file, registry);
      } catch (err) {
        console.warn(`[shortwind] could not write safelist to ${file}: ${String(err)}`);
      }
    }
    return files;
  } catch (err) {
    if (err instanceof TailwindAdapterError) {
      console.error(`[shortwind] ${err.message}`);
      return [];
    }
    throw err;
  }
}

function isTailwind4(cwd: string): boolean {
  try {
    return detectTailwindMajor(cwd) === 4;
  } catch {
    return false;
  }
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
