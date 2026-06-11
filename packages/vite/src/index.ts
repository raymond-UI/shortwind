import path from "node:path";
import {
  findResidualRecipeTokens,
  findUnexpandedRecipes,
  hasTailwindImport,
  injectSourceDirective,
  listRecipeFiles,
  loadRegistryFromDir,
  modeForFile,
  residualRecipeMessage,
  transformContent,
  TailwindAdapterError,
} from "@shortwind/tailwind";
import type { Registry } from "@shortwind/core";

export type ShortwindViteOptions = {
  recipesDir?: string;
  include?: RegExp;
  cwd?: string;
  // Fail the transform (build error / dev overlay) when a known recipe token
  // survives in transformed output ANYWHERE — including the silent
  // variable-indirection case the class-value warning can't see (#67).
  // Opt-in: the detector is token-based, so prose that legitimately names a
  // recipe (docs pages, comments) would fail a strict build.
  strict?: boolean;
};

type MinimalViteHmrServer = {
  watcher: {
    add: (paths: string | string[]) => void;
    on: (event: string, listener: (file: string) => void) => void;
    off?: (event: string, listener: (file: string) => void) => void;
  };
  // Vite caches `transform` results per module; recipe `.css` files are not
  // modules of the transformed sources, so without dropping the cached modules
  // a recipe edit reloads the browser with stale (old-registry) output. We
  // invalidate everything on a recipe change — every transformed module may
  // depend on the registry.
  moduleGraph?: { invalidateAll?: () => void };
  ws: {
    send: (
      payload:
        | { type: "full-reload" }
        | { type: "error"; err: { message: string; stack: string } },
    ) => void;
  };
  httpServer?: { on: (event: "close", cb: () => void) => void } | null;
};

// Minimal slice of Rollup's transform-hook `this` we use. Optional because the
// hook also runs in non-Rollup test harnesses where `this` is a bare object.
type MinimalTransformContext = {
  warn?: (msg: string) => void;
  addWatchFile?: (id: string) => void;
};

type MinimalVitePlugin = {
  name: string;
  enforce?: "pre" | "post";
  configResolved?: (config: { command: "build" | "serve" }) => void;
  buildStart?: () => void;
  configureServer?: (server: MinimalViteHmrServer) => void | Promise<void>;
  closeBundle?: () => void | Promise<void>;
  resolveId?: (id: string) => string | null;
  load?: (id: string) => string | null;
  transform?: (
    this: MinimalTransformContext,
    code: string,
    id: string,
  ) => string | { code: string; map: null } | null;
};

const DEFAULT_INCLUDE = /\.(?:tsx?|jsx?|vue|svelte|astro|html?|md|mdx)$/;

// The html-vs-jsx decision lives in @shortwind/tailwind (modeForFile) so every
// adapter shares one implementation instead of re-deriving it.

// Normalize to posix separators so on-disk paths (path.join → backslashes on
// Windows) compare equal to Vite's always-posix module ids.
function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

export function shortwind(options: ShortwindViteOptions = {}): MinimalVitePlugin[] {
  const cwd = options.cwd ?? process.cwd();
  const recipesDir = options.recipesDir ?? path.join(cwd, "recipes");
  const rawInclude = options.include ?? DEFAULT_INCLUDE;
  // A user-supplied `/g` RegExp keeps `lastIndex` across `.test()` calls, so
  // matching becomes order-dependent and skips alternate files. Strip it.
  const include = rawInclude.global
    ? new RegExp(rawInclude.source, rawInclude.flags.replace(/g/g, ""))
    : rawInclude;
  const strict = options.strict ?? false;

  let isBuild = false;
  // Remember an initial parse/resolve failure so a `vite build` can fail loudly
  // instead of silently shipping every `@recipe` as literal text.
  let initialLoadError: TailwindAdapterError | null = null;
  let registry: Registry;
  try {
    registry = loadRegistryFromDir(recipesDir);
  } catch (err) {
    if (err instanceof TailwindAdapterError) {
      initialLoadError = err;
      console.error(`[shortwind] ${err.message}`);
      registry = { families: {}, flattened: {} };
    } else {
      throw err;
    }
  }
  let registryFiles = new Set<string>();
  refreshRegistryFiles();

  function refreshRegistryFiles(): void {
    registryFiles = new Set<string>();
    for (const f of listRecipeFiles(recipesDir)) registryFiles.add(toPosix(f));
  }

  // Returns the load error (kept registry preserved) so the caller can surface
  // it in the dev overlay, or null on success.
  function reloadRegistry(): TailwindAdapterError | null {
    try {
      registry = loadRegistryFromDir(recipesDir);
      refreshRegistryFiles();
      return null;
    } catch (err) {
      if (err instanceof TailwindAdapterError) {
        // Keep the last good registry rather than blanking it — a transient
        // broken edit shouldn't make every recipe ship as raw text mid-session.
        console.error(`[shortwind] ${err.message} — keeping the previous recipes`);
        return err;
      }
      throw err;
    }
  }

  const transformPlugin: MinimalVitePlugin = {
    name: "shortwind:transform",
    enforce: "pre",
    configResolved(config) {
      isBuild = config.command === "build";
    },
    buildStart() {
      // Fail the build (not dev) when recipes couldn't be loaded at all —
      // otherwise `vite build` succeeds while every `@recipe` ships as literal
      // text. In dev we keep serving and let the watcher recover.
      if (isBuild && initialLoadError) throw initialLoadError;
    },
    transform(code, id) {
      const cleanId = toPosix(id.split("?")[0] ?? id);
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
      // Declare the recipe files as build dependencies so `vite build --watch`
      // re-runs this transform when a recipe changes.
      for (const file of registryFiles) this.addWatchFile?.(file);
      // Pass callExpanders in BOTH modes so a cva()/tv() call in a .vue/.svelte/
      // .astro <script> block is expanded too — the JSX path already does this,
      // and without it the identical pattern ships literal @recipe text.
      const out = transformContent(code, registry, {
        mode: modeForFile(cleanId),
        callExpanders: ["cva", "tv"],
      });
      // Surface recipes the transform couldn't reach (usually a dynamic
      // className) — they ship as literal @tokens and won't render.
      //
      // strict mode (#67): scan the WHOLE output (the class-value scan misses
      // the variable-indirection leak) and throw — Rollup fails the build,
      // dev shows the error overlay — instead of shipping unstyled UI behind
      // a green build.
      if (strict) {
        const residual = findResidualRecipeTokens(out, registry);
        if (residual.length > 0) {
          throw new TailwindAdapterError(
            `${residualRecipeMessage(cleanId, residual)} (strict mode: failing the build — pass strict: false to demote this to a warning)`,
          );
        }
      } else {
        // Default: a warning, not a build error, so it does NOT open the dev
        // overlay — that's reserved for registry load failures (onRecipeEvent).
        // Route through Rollup's `this.warn` (deduped, attributed to this
        // module in the build log); fall back to console.warn outside a Rollup
        // context (tests).
        const leftover = findUnexpandedRecipes(out, registry);
        if (leftover.length > 0) {
          const msg = residualRecipeMessage(cleanId, leftover);
          if (this.warn) this.warn(msg);
          else console.warn(msg);
        }
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
      const cleanId = toPosix(id.split("?")[0] ?? id);
      if (!cleanId.endsWith(".css")) return null;
      if (registryFiles.has(cleanId)) return null;
      if (Object.keys(registry.flattened).length === 0) return null;
      if (!hasTailwindImport(code)) return null;
      const out = injectSourceDirective(code, registry);
      if (out === code) return null;
      return { code: out, map: null };
    },
  };

  // Recipe files are not real stylesheets — `@recipe name { … }` at-rules are
  // Shortwind's registry format, read from disk (loadRegistryFromDir), and
  // never needed in the bundle. But @tailwindcss/vite's dev transform pulls
  // any recipes/*.css that lands in the module graph and fails compiling the
  // at-rules ("Invalid declaration"), throwing fatal overlays in `vite dev` /
  // `astro dev` (#65). Neutralize the modules at the LOAD phase, which runs
  // before every plugin's transform regardless of ordering, so Tailwind never
  // sees the recipe source. Explicit `?raw` imports (the file's literal text)
  // are left alone — they're strings, not stylesheets, and harmless to CSS
  // processing.
  const recipeNeutralizePlugin: MinimalVitePlugin = {
    name: "shortwind:recipe-neutralize",
    enforce: "pre",
    load(id) {
      const [file, query = ""] = id.split("?");
      if (/(?:^|&)raw(?:&|=|$)/.test(query)) return null;
      if (!registryFiles.has(toPosix(file ?? id))) return null;
      return "/* shortwind: recipe module neutralized — recipes are read from disk, not the bundle */\n";
    },
  };

  // The documented rc() escape hatch needs the registry in client code. A
  // `?raw` glob over recipes/*.css would plant the very `@recipe` definition
  // tokens the build is supposed to eliminate (#63); this virtual module
  // serves the FLATTENED registry instead — plain Tailwind utilities, zero
  // recipe tokens — so `import registry from "virtual:shortwind/registry"`
  // is bundle-clean by construction. `families` is intentionally empty: its
  // Recipe entries carry raw `@`-cross-refs, and expandClassList only reads
  // `flattened`. Recipe edits are covered by the watcher's invalidateAll.
  const registryModulePlugin: MinimalVitePlugin = {
    name: "shortwind:registry-module",
    resolveId(id) {
      return id === REGISTRY_MODULE_ID ? RESOLVED_REGISTRY_MODULE_ID : null;
    },
    load(id) {
      if (id !== RESOLVED_REGISTRY_MODULE_ID) return null;
      return `export default ${JSON.stringify({ families: {}, flattened: registry.flattened })};`;
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
      // Don't gate on the dir existing yet — chokidar watches not-yet-created
      // paths, so a recipes/ dir added after server start is still picked up
      // without a manual restart.
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
        const loadError = reloadRegistry();
        if (loadError) {
          // A broken recipe edit: show it in the browser's error overlay (we
          // kept the previous registry, so the page itself still works).
          server.ws.send({
            type: "error",
            err: { message: `[shortwind] ${loadError.message}`, stack: loadError.stack ?? "" },
          });
          return;
        }
        // Drop cached module transforms BEFORE the reload signal, or the
        // browser re-fetches output still expanded with the old registry.
        server.moduleGraph?.invalidateAll?.();
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

  return [transformPlugin, cssPlugin, recipeNeutralizePlugin, registryModulePlugin, watcherPlugin];
}

export const REGISTRY_MODULE_ID = "virtual:shortwind/registry";
// Rollup convention: prefix the resolved id with \0 so other plugins (and
// Vite's own resolver) leave the virtual module alone.
const RESOLVED_REGISTRY_MODULE_ID = "\0" + REGISTRY_MODULE_ID;

// Re-exported so the documented rc() helper resolves from the package init
// actually installs — `@shortwind/core` is only a transitive dependency and
// cannot be imported from a fresh project (#63). Types for the virtual module
// ship in client.d.ts (`/// <reference types="@shortwind/vite/client" />`).
export { expandClassList } from "@shortwind/core";
export type { Registry } from "@shortwind/core";

export default shortwind;
