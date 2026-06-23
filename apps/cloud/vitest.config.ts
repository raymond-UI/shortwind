import { defineConfig } from "vitest/config";

// Plain Node test pool for shared/ + convex/ unit tests. The Worker surfaces
// (CLOUD-02/21/22) bring their own workerd-pool config under worker/ when they
// need the @cloudflare/vitest-pool-workers runtime.
export default defineConfig({
  test: {
    include: [
      "shared/**/*.test.ts",
      "convex/**/*.test.ts",
      "cli/**/*.test.ts",
      // api-proxy's routing core is pure (no fetch) → runs in the Node pool.
      "api-proxy/**/*.test.ts",
    ],
    // Default environment for the pure unit tests. The convex-test integration
    // file (CLOUD-30a) opts INTO `edge-runtime` per-file via a
    // `// @vitest-environment edge-runtime` docblock, since convex-test runs the
    // functions in an edge-like in-process runtime.
    environment: "node",
    // convex-test must be transformed (it ships ESM that imports convex internals)
    // — inline it so the in-process function runner works under both pools.
    server: { deps: { inline: ["convex-test"] } },
  },
});
