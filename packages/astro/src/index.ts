import path from "node:path";
import { shortwind as shortwindVite } from "@shortwind/vite";

export type ShortwindAstroOptions = {
  recipesDir?: string;
  cwd?: string;
  // Fail the build when a known recipe token survives in transformed output
  // anywhere — including the silent variable-indirection case (#67).
  // Forwarded to @shortwind/vite. Off by default.
  strict?: boolean;
};

type SetupHookContext = {
  config: { root: { pathname?: string } | URL | string };
  // `updateConfig` is intentionally typed to accept any config shape. Astro's
  // real signature is `(DeepPartial<AstroConfig>) => AstroConfig`; if we narrow
  // the parameter (e.g. to `{ vite: { plugins: unknown[] } }`) the integration
  // stops being assignable to Astro's `AstroIntegration` under strict function
  // contravariance, which red-lines `astro check` / tsc in consuming sites even
  // though the runtime shape is fine. Keeping the integration Astro-version-
  // agnostic (no astro dependency) is the tradeoff this `any` parameter buys
  // (`unknown` would fail the same contravariance check it's meant to satisfy).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  updateConfig: (config: any) => unknown;
};

type AstroIntegration = {
  name: string;
  hooks: {
    "astro:config:setup": (ctx: SetupHookContext) => void;
  };
};

export default function shortwind(options: ShortwindAstroOptions = {}): AstroIntegration {
  return {
    name: "@shortwind/astro",
    hooks: {
      "astro:config:setup": ({ config, updateConfig }) => {
        const cwd = options.cwd ?? rootToPath(config.root) ?? process.cwd();
        const recipesDir = options.recipesDir ?? path.join(cwd, "recipes");
        const plugins = shortwindVite({ cwd, recipesDir, strict: options.strict ?? false });
        updateConfig({ vite: { plugins } });
      },
    },
  };
}

// Re-exported so the documented rc() helper resolves from the package init
// actually installs — `@shortwind/core` is only a transitive dependency (#63).
// The integration already composes @shortwind/vite, so the
// `virtual:shortwind/registry` module (and its ambient type) come along too.
export { expandClassList, REGISTRY_MODULE_ID } from "@shortwind/vite";
export type { Registry } from "@shortwind/vite";

function rootToPath(root: { pathname?: string } | URL | string): string | null {
  const raw =
    typeof root === "string"
      ? root
      : root instanceof URL
        ? root.pathname
        : typeof root === "object" && typeof root.pathname === "string"
          ? root.pathname
          : null;
  if (raw === null) return null;
  // Astro's URL form yields a trailing slash; the string form usually doesn't.
  // Normalize so `path.join(cwd, "recipes")` produces the same result for
  // both shapes and downstream comparisons line up.
  return raw.length > 1 ? raw.replace(/[\\/]+$/, "") : raw;
}
