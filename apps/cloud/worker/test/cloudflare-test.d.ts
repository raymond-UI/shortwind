// Pulls in the ambient module declaration for `cloudflare:test` (the typed
// `env` / runner surface from @cloudflare/vitest-pool-workers) so the worker
// tests typecheck under the root `tsc --noEmit`. Confined to worker/ per
// CLOUD-21 scope; the pool itself is configured in worker/vitest.config.ts.
/// <reference types="@cloudflare/vitest-pool-workers/types" />
