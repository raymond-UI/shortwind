import path from "node:path";
import { existsSync, readdirSync } from "node:fs";
import {
  findUnexpandedRecipes,
  hasTailwindImport,
  injectSourceDirective,
  loadRegistryFromDir,
  transformContent,
  TailwindAdapterError,
} from "@shortwind/tailwind";
import type { Registry } from "@shortwind/core";

export type ShortwindViteOptions = {
  recipesDir?: string;
  include?: RegExp;
  cwd?: string;
};

type MinimalViteHmrServer = {
  watcher: {
    add: (paths: string | string[]) => void;
    on: (event: string, listener: (file: string) => void) => void;
    off?: (event: string, listener: (file: string) => void) => void;
  };
  ws: { send: (payload: { type: "full-reload" }) => void };
  httpServer?: { on: (event: "close", cb: () => void) => void } | null;
};

type MinimalVitePlugin = {
  name: string;
  enforce?: "pre" | "post";
  configureServer?: (server: MinimalViteHmrServer) => void | Promise<void>;
  closeBundle?: () => void | Promise<void>;
  transform?: (
    code: string,
    id: string,
  ) => string | { code: string; map: null } | null;
};

const DEFAULT_INCLUDE = /\.(?:tsx?|jsx?|vue|svelte|astro|html?|md|mdx)$/;

// Real JSX/TSX (and MDX, which compiles to JSX) use `className` and parse with
// the JSX-aware transform. Template formats — .astro, .vue, .svelte — and
// .html/.htm are HTML-shaped: they use `class=` (not `className`) and are NOT
// valid JSX, so the JSX AST parser can't read them and would silently leave
// every `class="@recipe"` unexpanded. Those go through the html-mode expander,
// which rewrites `class=` attributes by regex. (.md is markdown, not JSX; it
// stays on the JSX path, where a parse failure is a safe no-op, to avoid
// expanding `class="@..."` inside documentation code fences.)
const JSX_LIKE = new Set(["ts", "tsx", "js", "jsx", "md", "mdx"]);

function modeForId(id: string): "html" | "jsx" {
  const ext = path.extname(id).slice(1).toLowerCase();
  return JSX_LIKE.has(ext) ? "jsx" : "html";
}

export function shortwind(options: ShortwindViteOptions = {}): MinimalVitePlugin[] {
  const cwd = options.cwd ?? process.cwd();
  const recipesDir = options.recipesDir ?? path.join(cwd, "recipes");
  const include = options.include ?? DEFAULT_INCLUDE;

  let registry: Registry = loadRegistry(recipesDir);
  let registryFiles = new Set<string>();
  refreshRegistryFiles();

  function refreshRegistryFiles(): void {
    registryFiles = new Set<string>();
    if (!existsSync(recipesDir)) return;
    for (const f of readdirSync(recipesDir)) {
      if (f.endsWith(".css")) registryFiles.add(path.join(recipesDir, f));
    }
  }

  function reloadRegistry(): void {
    registry = loadRegistry(recipesDir);
    refreshRegistryFiles();
  }

  const transformPlugin: MinimalVitePlugin = {
    name: "shortwind:transform",
    enforce: "pre",
    transform(code, id) {
      const cleanId = id.split("?")[0] ?? id;
      if (!include.test(cleanId)) return null;
      if (registryFiles.has(cleanId)) return null;
      // Skip vendored/built code: node_modules dependencies and any `dist/`
      // output (including this workspace's own built packages). Source files
      // for the app live outside `dist/`; the expander never needs to run on
      // already-compiled JS, and processing it can corrupt files that contain
      // string literals or comments mentioning `className=` or `cva(`.
      if (cleanId.includes("/node_modules/")) return null;
      if (/\/dist\//.test(cleanId)) return null;
      // No families means nothing to expand — every file would round-trip
      // identically; skip the per-file work entirely.
      if (Object.keys(registry.flattened).length === 0) return null;
      const out = transformContent(code, registry, { mode: modeForId(cleanId) });
      // Surface recipes the transform couldn't reach (usually a dynamic
      // className) — they ship as literal @tokens and won't render.
      const leftover = findUnexpandedRecipes(out, registry);
      if (leftover.length > 0) {
        console.warn(
          `[shortwind] ${cleanId}: unexpanded recipe ${leftover.join(", ")} — likely a dynamic className the build can't statically expand; it will render as raw text.`,
        );
      }
      if (out === code) return null;
      return { code: out, map: null };
    },
  };

  // Recipe expansions live only in Vite's transformed JSX/HTML, which Tailwind
  // v4's scanner never reads — it walks files on disk. We inject the
  // registry-derived candidate set into the user's main CSS via
  // `@source inline(...)` so Tailwind's JIT picks them up like any other
  // candidate. Runs before `@tailwindcss/vite` because of `enforce: "pre"`.
  const cssPlugin: MinimalVitePlugin = {
    name: "shortwind:css-source",
    enforce: "pre",
    transform(code, id) {
      const cleanId = id.split("?")[0] ?? id;
      if (!cleanId.endsWith(".css")) return null;
      if (registryFiles.has(cleanId)) return null;
      if (Object.keys(registry.flattened).length === 0) return null;
      if (!hasTailwindImport(code)) return null;
      const out = injectSourceDirective(code, registry);
      if (out === code) return null;
      return { code: out, map: null };
    },
  };

  let installedListener:
    | { server: MinimalViteHmrServer; fn: (file: string) => void }
    | null = null;

  const detachListener = (): void => {
    if (!installedListener) return;
    const { server, fn } = installedListener;
    if (server.watcher.off) {
      server.watcher.off("add", fn);
      server.watcher.off("change", fn);
      server.watcher.off("unlink", fn);
    }
    installedListener = null;
  };

  const watcherPlugin: MinimalVitePlugin = {
    name: "shortwind:watcher",
    configureServer(server) {
      if (!existsSync(recipesDir)) return;
      // configureServer may fire more than once across restarts; tear down
      // any prior listener before attaching a new one so handlers don't
      // accumulate (each one re-runs reloadRegistry on every file event).
      detachListener();
      server.watcher.add(recipesDir);
      const onRecipeEvent = (file: string): void => {
        const normalized = path.resolve(file);
        const rel = path.relative(path.resolve(recipesDir), normalized);
        if (rel.startsWith("..") || path.isAbsolute(rel)) return;
        if (!normalized.endsWith(".css")) return;
        reloadRegistry();
        server.ws.send({ type: "full-reload" });
      };
      server.watcher.on("add", onRecipeEvent);
      server.watcher.on("change", onRecipeEvent);
      server.watcher.on("unlink", onRecipeEvent);
      installedListener = { server, fn: onRecipeEvent };
      server.httpServer?.on("close", detachListener);
    },
    closeBundle() {
      detachListener();
    },
  };

  return [transformPlugin, cssPlugin, watcherPlugin];
}

function loadRegistry(recipesDir: string): Registry {
  try {
    return loadRegistryFromDir(recipesDir);
  } catch (err) {
    if (err instanceof TailwindAdapterError) {
      // surface parse/resolve errors as Vite-side messages and continue with empty registry.
      console.error(`[shortwind] ${err.message}`);
      return { families: {}, flattened: {} };
    }
    throw err;
  }
}

export default shortwind;
