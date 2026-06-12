// Real `vite build` with @tailwindcss/vite (#74): utilities that exist ONLY
// inside a recipe body must reach Tailwind's CSS generation regardless of
// where shortwind() sits relative to tailwindcss() in the plugins array.
// Before the load-hook fix, listing tailwindcss() first (which is also the
// order Astro produces) silently shipped those utilities unstyled.
import { mkdtemp, rm, writeFile, mkdir, symlink, readdir, readFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { build } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { shortwind } from "../src/index.js";

const require = createRequire(import.meta.url);
const TAILWIND_PKG_DIR = path.dirname(require.resolve("tailwindcss/package.json"));

// A utility that appears nowhere except the recipe body — the exact shape
// that shipped unstyled in the beta.11 dogfooding round.
const BODY_ONLY_UTILITY = "bg-emerald-100";
const CUSTOM_RECIPE = `@recipe hero {\n  ${BODY_ONLY_UTILITY} rounded-xl\n}\n`;

async function makeProject(): Promise<string> {
  const dir = realpathSync(await mkdtemp(path.join(tmpdir(), "shortwind-vite-int-")));
  await mkdir(path.join(dir, "recipes"), { recursive: true });
  await mkdir(path.join(dir, "src"), { recursive: true });
  await mkdir(path.join(dir, "node_modules"), { recursive: true });
  // `@import "tailwindcss"` resolves from the project; link the real package.
  await symlink(TAILWIND_PKG_DIR, path.join(dir, "node_modules", "tailwindcss"));
  await writeFile(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "x", dependencies: { tailwindcss: "^4.0.0" } }),
  );
  await writeFile(path.join(dir, "recipes", "hero.css"), CUSTOM_RECIPE);
  await writeFile(path.join(dir, "src", "app.css"), `@import "tailwindcss";\n`);
  await writeFile(path.join(dir, "src", "main.js"), `import "./app.css";\n`);
  await writeFile(
    path.join(dir, "index.html"),
    `<!doctype html><html><head><script type="module" src="/src/main.js"></script></head>` +
      `<body><div class="@hero">hi</div></body></html>`,
  );
  return dir;
}

async function builtCss(dir: string): Promise<string> {
  const assets = await readdir(path.join(dir, "dist", "assets"));
  const cssFiles = assets.filter((f) => f.endsWith(".css"));
  expect(cssFiles.length).toBeGreaterThan(0);
  const parts = await Promise.all(
    cssFiles.map((f) => readFile(path.join(dir, "dist", "assets", f), "utf8")),
  );
  return parts.join("\n");
}

describe("vite build integration (#74)", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    while (dirs.length > 0) {
      await rm(dirs.pop()!, { recursive: true, force: true }).catch(() => {});
    }
  });

  async function buildWith(order: "shortwind-first" | "tailwind-first"): Promise<string> {
    const dir = await makeProject();
    dirs.push(dir);
    const sw = shortwind({ cwd: dir });
    const tw = tailwindcss();
    const plugins = order === "shortwind-first" ? [sw, tw] : [tw, sw];
    await build({ root: dir, logLevel: "error", plugins });
    return builtCss(dir);
  }

  it("generates recipe-body-only utilities when shortwind() is listed first", async () => {
    const css = await buildWith("shortwind-first");
    expect(css).toContain(BODY_ONLY_UTILITY);
  }, 120_000);

  it("generates recipe-body-only utilities when tailwindcss() is listed first (Astro's ordering)", async () => {
    const css = await buildWith("tailwind-first");
    expect(css).toContain(BODY_ONLY_UTILITY);
  }, 120_000);
});
