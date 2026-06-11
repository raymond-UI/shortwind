// Copies the built CDN runtime artifacts (`expand.js` and the versioned
// `expand@<version>.js`) from the catalog build output into `site/public/`, so
// the documented endpoint `https://shortwind.dev/expand.js` actually resolves.
//
// The site is a decoupled pnpm root: its deploy CI only builds `site/` and
// serves whatever is committed under `site/public/`. It never builds the
// runtime, so the artifact has to be staged into the site and committed. Run
// this whenever the runtime changes:
//
//   pnpm --filter @shortwind/runtime build && pnpm --filter @shortwind/catalog build
//   pnpm tsx scripts/sync-runtime-to-site.ts
//
// CI guards the result: `deploy-site.yml` fails if `site/public/expand.js` is
// missing.
import { copyFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const distDir = path.join(root, "packages", "registry", "dist");
const publicDir = path.join(root, "site", "public");

const base = path.join(distDir, "expand.js");
if (!existsSync(base)) {
  console.error(
    `[sync] ${base} not found — build the runtime and catalog first:\n` +
      `  pnpm --filter @shortwind/runtime build && pnpm --filter @shortwind/catalog build`,
  );
  process.exit(1);
}

const artifacts = ["expand.js", ...readdirSync(distDir).filter((f) => /^expand@.+\.js$/.test(f))];
for (const name of artifacts) {
  copyFileSync(path.join(distDir, name), path.join(publicDir, name));
  console.log(`[sync] ${name} → site/public/${name}`);
}
