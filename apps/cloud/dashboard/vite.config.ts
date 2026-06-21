import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

/**
 * Dashboard build (CLOUD-35). A plain Vite + React SPA — deliberately NOT a
 * TanStack-Start SSR app like the nyxe-mail/Togethr references, because the
 * dashboard must `build` + component-test OFFLINE with no live Convex URL and no
 * SSR server (the live wiring lands in CLOUD-30b). A static SPA bundle is the
 * smallest thing that satisfies that and is trivially hostable.
 *
 * `ssr.noExternal` is dropped (no SSR). `@convex/*` resolves to the sibling
 * Convex module dir so `api.dashboard.*` imports the hand-declared `_generated`
 * api types (offline-codegen note in convex/dashboard.ts).
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@convex": path.resolve(__dirname, "../convex"),
    },
  },
  server: { port: 5179, strictPort: true },
});
