import path from "node:path";
import { shortwind as shortwindVite } from "@shortwind/vite";

export type ShortwindAstroOptions = {
  recipesDir?: string;
  cwd?: string;
};

type SetupHookContext = {
  config: { root: { pathname?: string } | URL | string };
  updateConfig: (config: { vite: { plugins: unknown[] } }) => void;
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
  if (typeof root === "string") return root;
  if (root instanceof URL) return root.pathname;
  if (typeof root === "object" && typeof root.pathname === "string") return root.pathname;
  return null;
}
