import path from "node:path";
import { existsSync, readdirSync } from "node:fs";
import {
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
  moduleGraph: {
    getModulesByFile: (file: string) => Set<{ file: string | null }> | undefined;
    invalidateModule: (mod: unknown) => void;
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

const JSX_LIKE = new Set(["ts", "tsx", "js", "jsx", "vue", "svelte", "astro", "md", "mdx"]);

function modeForId(id: string): "html" | "jsx" {
  const ext = path.extname(id).slice(1).toLowerCase();
  if (ext === "html" || ext === "htm") return "html";
  if (JSX_LIKE.has(ext)) return "jsx";
  return "jsx";
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
      // No families means nothing to expand — every file would round-trip
      // identically; skip the per-file work entirely.
      if (Object.keys(registry.flattened).length === 0) return null;
      const out = transformContent(code, registry, { mode: modeForId(cleanId) });
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

  return [transformPlugin, watcherPlugin];
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
