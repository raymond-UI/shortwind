import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";

// CLOUD-02 Phase-0 spike. A SEPARATE config from apps/cloud/vitest.config.ts
// (the plain Node pool over shared/ + convex/ + cli/). This one runs ONLY the
// worker/ tests inside workerd via @cloudflare/vitest-pool-workers, so we can
// execute @shortwind/core's expand() in the real Cloudflare runtime and assert
// byte-identical parity with Node.
//
// Run with:
//   pnpm -C apps/cloud exec vitest run --config worker/vitest.config.ts
//
// Note on wiring: @cloudflare/vitest-pool-workers@0.16.18 (the version pinned in
// apps/cloud/package.json, built for vitest 4) does NOT ship the older
// `defineWorkersConfig` helper / `./config` export. In this version the pool is
// installed as a Vite plugin via `cloudflareTest(...)`, which sets up the
// workerd pool and accepts the same { miniflare, wrangler } options that used to
// live under poolOptions.workers.
//
// No `nodejs_compat` flag here (mirrors worker/wrangler.toml) — the hypothesis
// is that core needs no Node built-ins. If a test fails to boot without it, add
// `compatibilityFlags: ["nodejs_compat"]` to the miniflare block below and the
// matching flag in wrangler.toml, then record it in SPIKE.md.
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./worker/wrangler.toml" },
    }),
  ],
  test: {
    include: ["worker/test/**/*.test.ts"],
  },
});
