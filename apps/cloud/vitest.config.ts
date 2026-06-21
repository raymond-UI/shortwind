import { defineConfig } from "vitest/config";

// Plain Node test pool for shared/ + convex/ unit tests. The Worker surfaces
// (CLOUD-02/21/22) bring their own workerd-pool config under worker/ when they
// need the @cloudflare/vitest-pool-workers runtime.
export default defineConfig({
  test: {
    include: ["shared/**/*.test.ts", "convex/**/*.test.ts", "cli/**/*.test.ts"],
    environment: "node",
  },
});
