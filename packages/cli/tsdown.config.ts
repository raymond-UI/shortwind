import { defineConfig } from "tsdown";

// Two entries: the library surface (index) and the CLI launcher (bin). The
// `bin` field in package.json points at dist/bin.js, so the published `npx
// shortwind` invocation resolves to the built launcher rather than a file
// that was never emitted.
export default defineConfig({
  entry: ["src/index.ts", "src/bin.ts"],
  format: "esm",
  outExtensions: () => ({ js: ".js" }),
  dts: { entry: "src/index.ts" },
  clean: true,
});
