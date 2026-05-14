import { defineConfig } from "eslint/config";
import base from "../../eslint.config.mjs";

export default defineConfig(
  base,
  {
    files: ["src/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "fs", message: "core must stay pure — no Node IO. Do IO in the adapter package." },
            { name: "node:fs", message: "core must stay pure — no Node IO. Do IO in the adapter package." },
            { name: "node:fs/promises", message: "core must stay pure — no Node IO." },
            { name: "path", message: "core must stay pure — no Node IO." },
            { name: "node:path", message: "core must stay pure — no Node IO." },
            { name: "process", message: "core must stay pure — no Node globals." },
            { name: "node:process", message: "core must stay pure — no Node globals." },
            { name: "child_process", message: "core must stay pure — no Node IO." },
            { name: "node:child_process", message: "core must stay pure — no Node IO." },
            { name: "os", message: "core must stay pure — no Node globals." },
            { name: "node:os", message: "core must stay pure — no Node globals." },
          ],
          patterns: [
            { group: ["node:*"], message: "core must stay pure — no Node built-ins. Push IO to the adapter." },
          ],
        },
      ],
    },
  },
);
