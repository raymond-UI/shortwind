import path from "node:path";
import { shortwind as shortwindVite } from "@shortwind/vite";

export type ShortwindAstroOptions = {
  recipesDir?: string;
  cwd?: string;
};

type SetupHookContext = {
  config: { root: { pathname?: string } | URL | string };
  // Newer Astro versions return the merged config from updateConfig. We don't
  // currently need it (we only register a Vite plugin), but the unknown return
  // documents the shape so a future caller doesn't add a void-returning hack.
  updateConfig: (config: { vite: { plugins: unknown[] } }) => unknown;
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
        const plugins = shortwindVite({ cwd, recipesDir });
        updateConfig({ vite: { plugins } });
      },
    },
  };
}

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
