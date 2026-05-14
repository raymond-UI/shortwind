import { build } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { readFileSync, statSync } from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = path.resolve(here, "..", "src", "index.ts");
const outDir = path.resolve(here, "..", "dist");
const outFile = path.join(outDir, "expand.js");

const BUDGET_BYTES = 8 * 1024;

await build({
  entryPoints: [entry],
  bundle: true,
  format: "iife",
  globalName: "__shortwindRuntime",
  target: ["es2020"],
  platform: "browser",
  minify: true,
  outfile: outFile,
  legalComments: "none",
  sourcemap: false,
});

const raw = readFileSync(outFile);
const gz = gzipSync(raw);
const sizeRaw = statSync(outFile).size;
const sizeGz = gz.length;

console.log(
  `[runtime] expand.js — ${sizeRaw} bytes raw, ${sizeGz} bytes gzipped (budget ${BUDGET_BYTES}).`,
);

if (sizeGz > BUDGET_BYTES) {
  console.error(`[runtime] bundle exceeds gzipped budget of ${BUDGET_BYTES} bytes.`);
  process.exit(1);
}
