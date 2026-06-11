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
  // Vite caches `transform` results per module; recipe `.css` files are not
  // modules of the transformed sources, so without dropping the cached modules
  // a recipe edit reloads the browser with stale (old-registry) output. We
  // invalidate everything on a recipe change — every transformed module may
  // depend on the registry.
  moduleGraph?: { invalidateAll?: () => void };
  ws: { send: (payload: { type: "full-reload" }) => void };
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
  transform?: (
    this: MinimalTransformContext,
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
    if (!existsSync(recipesDir)) return;
    for (const f of readdirSync(recipesDir)) {
      if (f.endsWith(".css")) registryFiles.add(toPosix(path.join(recipesDir, f)));
    }
  }

  function reloadRegistry(): void {
    try {
      registry = loadRegistryFromDir(recipesDir);
      refreshRegistryFiles();
    } catch (err) {
      if (err instanceof TailwindAdapterError) {
        // Keep the last good registry rather than blanking it — a transient
        // broken edit shouldn't make every recipe ship as raw text mid-session.
        console.error(`[shortwind] ${err.message} — keeping the previous recipes`);
        return;
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
        mode: modeForId(cleanId),
        callExpanders: ["cva", "tv"],
      });
      // Surface recipes the transform couldn't reach (usually a dynamic
      // className) — they ship as literal @tokens and won't render. Route
      // through `this.warn` so it dedups and renders in Vite's overlay; fall
      // back to console.warn outside a Rollup context (tests).
      const leftover = findUnexpandedRecipes(out, registry);
      if (leftover.length > 0) {
        const msg = `[shortwind] ${cleanId}: unexpanded recipe ${leftover.join(", ")} — likely a dynamic className the build can't statically expand; it will render as raw text.`;
        if (this.warn) this.warn(msg);
        else console.warn(msg);
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
        reloadRegistry();
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

  return [transformPlugin, cssPlugin, watcherPlugin];
}

export default shortwind;
