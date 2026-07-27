import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";

// CLOUD-02 Phase-0 spike. A SEPARATE config from apps/cloud/vitest.config.ts
// (the plain Node pool over shared/ + convex/ + cli/). This one runs ONLY the
// worker/ tests inside workerd via @cloudflare/vitest-pool-workers, so we can
// execute @shortwind/core's expand() in the real Cloudflare runtime and assert
// byte-identical parity with Node.
//
// Run with either of:
//   pnpm -C apps/cloud test:worker
//   pnpm -C apps/cloud exec vitest run --config worker/vitest.config.ts
//
// CWD-INDEPENDENT (audit): `include` and `wrangler.configPath` used to be
// relative strings, which vitest resolves against the CWD, not against this
// file. Running the same command from `apps/cloud/worker` therefore matched
// `worker/test/**` under `worker/` — zero files — and vitest reported a PASS. A
// false green on the whole Worker suite is worse than a hard failure, so both
// paths are now resolved from this module's own URL and hold from any CWD.
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
const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: here("./wrangler.toml") },
    }),
  ],
  test: {
    include: [here("./test/**/*.test.ts")],
    // Guard the false green for good: if the glob ever matches nothing again,
    // fail instead of reporting a green run over zero Worker tests.
    passWithNoTests: false,
  },
});
