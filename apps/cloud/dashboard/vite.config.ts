import { defineConfig } from "vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import path from "node:path";

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
  ssr: {
    noExternal: ["@convex-dev/better-auth"],
  },
  resolve: {
    alias: {
      "@convex": path.resolve(__dirname, "../convex"),
    },
  },
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tsconfigPaths(),
    tanstackStart(),
    viteReact(),
    tailwindcss(),
  ],
  server: { port: 5179, strictPort: true },
});
