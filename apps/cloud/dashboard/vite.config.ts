import { defineConfig, type Plugin } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import path from "node:path";
import fs from "node:fs";
import { shortwind } from "@shortwind/vite";

/**
 * The app is served under `/cloud` (Vite `base` below), so the SSR HTML
 * references its built assets at `/cloud/assets/...`. But Vite's `base` is a
 * LOGICAL prefix: it rewrites the references without nesting the output dir —
 * files still land in `dist/client/assets/`. The Cloudflare Workers static
 * asset binding serves `dist/client` from the ROOT, so those files would only
 * be reachable at `/assets/...`, and `/cloud/assets/...` would 404.
 *
 * This plugin closes that gap: after the CLIENT bundle is written, it moves
 * `dist/client/assets` → `dist/client/cloud/assets` so the physical path
 * matches the `/cloud/` base the HTML asks for. Scoped to the client build
 * (`apply: "build"` + a guard on the output dir) so it never touches the SSR
 * Worker bundle. `.assetsignore` and other root files are left in place.
 */
function nestClientAssetsUnderBase(base: string): Plugin {
  const prefix = base.replace(/^\/|\/$/g, ""); // "/cloud/" -> "cloud"
  return {
    name: "nest-client-assets-under-base",
    apply: "build",
    writeBundle(options) {
      // CLIENT environment ONLY. The SSR Worker bundle (`dist/server`) imports
      // its own `assets/*.js` chunks by relative path from `index.js`; moving
      // those would break the Worker ("No such module"). The static asset base
      // mismatch we are fixing only affects the browser-served client bundle.
      if (this.environment?.name !== "client") return;
      const outDir = options.dir;
      if (!outDir) return;
      const assetsDir = path.join(outDir, "assets");
      if (!fs.existsSync(assetsDir)) return;
      const targetParent = path.join(outDir, prefix);
      const target = path.join(targetParent, "assets");
      if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
      fs.mkdirSync(targetParent, { recursive: true });
      fs.renameSync(assetsDir, target);
    },
  };
}

/**
 * Dashboard build (CLOUD-30b rebuild). A TanStack Start (SSR) app — replacing
 * the prior plain Vite SPA — so the operator gets a real server-rendered login
 * page and an `/api/auth/*` proxy to the Convex Better Auth origin, mirroring
 * the nyxe-mail/apps/web reference.
 *
 * Cloudflare Workers target: the `cloudflare()` plugin MUST come first; it pairs
 * with `tanstackStart()` (which auto-detects the Cloudflare environment) to emit
 * a Worker bundle that `wrangler deploy` ships. `viteEnvironment.name: "ssr"`
 * routes Start's SSR environment through the Workers runtime.
 *
 * `ssr.noExternal: ["@convex-dev/better-auth"]` mirrors nyxe — the integration
 * ships ESM that must be bundled for the SSR build. `@convex/*` resolves to the
 * sibling Convex module dir so `api.dashboard.*` / `api.billing.*` references
 * type-check and bundle against the live `_generated` api.
 */
export default defineConfig({
  // Serve the whole app under `/cloud` so it can be routed at
  // `https://shortwind.dev/cloud`. The TanStack Start Vite plugin reads this
  // `base` as its `publicBase`: it emits built assets under `/cloud/assets/...`
  // AND derives the router basepath from it (injected as the
  // `TSS_ROUTER_BASEPATH` define that both the SSR handler and client
  // hydration feed into `router.update({ basepath })`). One knob drives router
  // + assets + the `_serverFn` base. The app also works when hit directly on
  // the workers.dev origin (every path lives under /cloud there too).
  base: "/cloud/",
  ssr: {
    noExternal: ["@convex-dev/better-auth"],
  },
  resolve: {
    alias: {
      "@convex": path.resolve(__dirname, "../convex"),
    },
  },
  plugins: [shortwind(), 
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tsconfigPaths(),
    tanstackStart(),
    viteReact(),
    tailwindcss(),
    // Must run AFTER the client bundle is written so the emitted `assets/` dir
    // exists; relocates it under `/cloud/` to match the `base` the HTML uses.
    nestClientAssetsUnderBase("/cloud/"),
  ],
  server: { port: 5179, strictPort: true },
});
