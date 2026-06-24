import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
  {
    ignores: [
      "**/dist/**",
      "**/.turbo/**",
      "**/node_modules/**",
      "**/.wrangler/**",
      "apps/web/public/registry/**",
      "apps/web/public/expand*.js",
    ],
  },
  tseslint.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // `.cts` modules are CommonJS by design (e.g. the TS-plugin entry that TS's
    // loader `require()`s and re-exports via `export =`). `import = require()` is
    // the correct, verbatimModuleSyntax-safe form there, not a lint violation.
    files: ["**/*.cts"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
);
