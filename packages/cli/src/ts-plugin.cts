// The Shortwind TypeScript language-service plugin, re-exported so it ships as
// `@shortwind/cli/ts-plugin` — no separate npm package. The source lives in
// `packages/ts-plugin` (private); tsdown bundles it into `dist/ts-plugin.cjs`
// (CJS, because tsserver loads plugins via `require`). `init` adds
// `{ "name": "@shortwind/cli/ts-plugin" }` to the project's tsconfig.
//
// TS's plugin loader calls `require(name)(...)`, so the module's export must BE
// the factory function — `export = ` produces exactly `module.exports = init`.
// CommonJS (`import = require` / `export =`) also keeps `verbatimModuleSyntax`
// happy in this `.cts` file.
import plugin = require("@shortwind/ts-plugin");

export = plugin.init;
