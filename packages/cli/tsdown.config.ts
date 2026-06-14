import { defineConfig } from "tsdown";

// Three entries across two builds:
//  - index + bin: the ESM library surface and the `shortwind` launcher.
//  - ts-plugin: the TypeScript language-service plugin, emitted as CJS because
//    tsserver loads plugins via `require`. Its source lives in the private
//    `@shortwind/ts-plugin` package. The @shortwind workspace packages it uses
//    (ts-plugin, core, tailwind) are ALL bundled in — they're ESM, and the
//    editor's tsserver runs on a Node that can't `require()` ESM (ERR_REQUIRE_ESM
//    on < 22), so the plugin must be fully self-contained CJS. `typescript` is
//    the only external — provided by the editor host, never required at runtime.
export default defineConfig([
  {
    entry: ["src/index.ts", "src/bin.ts"],
    format: "esm",
    outExtensions: () => ({ js: ".js" }),
    dts: { entry: "src/index.ts" },
    clean: true,
  },
  {
    entry: ["src/ts-plugin.cts"],
    format: "cjs",
    outExtensions: () => ({ js: ".cjs" }),
    deps: {
      alwaysBundle: ["@shortwind/ts-plugin", "@shortwind/core", "@shortwind/tailwind"],
      neverBundle: ["typescript"],
    },
    dts: false,
    clean: false,
  },
]);
