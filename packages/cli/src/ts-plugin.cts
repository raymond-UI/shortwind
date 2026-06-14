// The Shortwind TypeScript language-service plugin, re-exported so it ships as
// `@shortwind/cli/ts-plugin` — no separate npm package. The source lives in
// `packages/ts-plugin` (private); tsdown bundles it into `ts-plugin/ts-plugin.cjs`
// — a real directory (with its own package.json `main`) rather than a `dist`
// file behind an exports subpath, because tsserver resolves plugins with classic
// node10 resolution that ignores the `exports` map. CJS, because tsserver loads
// plugins via `require`. `init` adds `{ "name": "@shortwind/cli/ts-plugin" }` to
// the project's tsconfig.
//
// TS's plugin loader calls `require(name)(...)`, so the module's export must BE
// the factory function — `export = ` produces exactly `module.exports = init`.
// CommonJS (`import = require` / `export =`) also keeps `verbatimModuleSyntax`
// happy in this `.cts` file.
import plugin = require("@shortwind/ts-plugin");

export = plugin.init;
