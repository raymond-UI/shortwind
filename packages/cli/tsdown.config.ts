import { defineConfig } from "tsdown";

// Three entries across two builds:
//  - index + bin: the ESM library surface and the `shortwind` launcher.
//  - ts-plugin: the TypeScript language-service plugin, emitted as CJS because
//    tsserver loads plugins via `require`. Its source lives in the private
//    `@shortwind/ts-plugin` package, bundled in here (noExternal) so it ships
//    inside `@shortwind/cli` as the `./ts-plugin` subpath — no extra package.
//    `typescript` is provided by the editor host; `@shortwind/core` stays a
//    normal runtime dependency.
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
    noExternal: ["@shortwind/ts-plugin"],
    external: ["typescript"],
    dts: false,
    clean: false,
  },
]);
