// Real `astro build` (#74): Astro appends integration-injected Vite plugins
// AFTER the user's vite.plugins, so @tailwindcss/vite's generate transform ran
// before shortwind's css transform and the injected @source inline(...) never
// reached Tailwind — custom-recipe utilities shipped unstyled while catalog
// recipes survived only via the SKILL.md markdown-scan accident. This project
// has NO SKILL.md at all, so passing proves styling doesn't depend on it.
import { mkdtemp, rm, writeFile, mkdir, symlink, readdir, readFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { build } from "astro";
import tailwindcss from "@tailwindcss/vite";
import shortwind from "../src/index.js";

const require = createRequire(import.meta.url);
const TAILWIND_PKG_DIR = path.dirname(require.resolve("tailwindcss/package.json"));
const ASTRO_PKG_DIR = path.dirname(require.resolve("astro/package.json"));

const BODY_ONLY_UTILITY = "bg-emerald-100";
const CUSTOM_RECIPE = `@recipe hero {\n  ${BODY_ONLY_UTILITY} rounded-xl\n}\n`;

async function makeProject(): Promise<string> {
  const dir = realpathSync(await mkdtemp(path.join(tmpdir(), "shortwind-astro-int-")));
  await mkdir(path.join(dir, "recipes"), { recursive: true });
  await mkdir(path.join(dir, "src", "pages"), { recursive: true });
  await mkdir(path.join(dir, "src", "styles"), { recursive: true });
  await mkdir(path.join(dir, "node_modules"), { recursive: true });
  // Astro resolves its own entrypoints and `@import "tailwindcss"` from the
  // project root; link the real packages instead of installing.
  await symlink(TAILWIND_PKG_DIR, path.join(dir, "node_modules", "tailwindcss"));
  await symlink(ASTRO_PKG_DIR, path.join(dir, "node_modules", "astro"));
  await writeFile(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "x", type: "module", dependencies: { tailwindcss: "^4.0.0" } }),
  );
  await writeFile(path.join(dir, "recipes", "hero.css"), CUSTOM_RECIPE);
  await writeFile(path.join(dir, "src", "styles", "global.css"), `@import "tailwindcss";\n`);
  await writeFile(
    path.join(dir, "src", "pages", "index.astro"),
    `---\nimport "../styles/global.css";\n---\n<html><body><div class="@hero">hi</div></body></html>\n`,
  );
  return dir;
}

async function findFiles(dir: string, ext: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await findFiles(p, ext)));
    else if (entry.name.endsWith(ext)) out.push(p);
  }
  return out;
}

describe("astro build integration (#74)", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    while (dirs.length > 0) {
      await rm(dirs.pop()!, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("generates custom-recipe-only utilities with no SKILL.md in the project", async () => {
    const dir = await makeProject();
    dirs.push(dir);
    await build({
      root: dir,
      integrations: [shortwind({ cwd: dir })],
      // The user's plugins come first in Astro's merged Vite config — the
      // exact ordering that broke the in-memory injection.
      vite: { plugins: [tailwindcss()] },
      logLevel: "error",
    });

    const distDir = path.join(dir, "dist");
    const cssFiles = await findFiles(distDir, ".css");
    expect(cssFiles.length).toBeGreaterThan(0);
    const css = (await Promise.all(cssFiles.map((f) => readFile(f, "utf8")))).join("\n");
    expect(css).toContain(BODY_ONLY_UTILITY);

    // The recipe token itself expanded in the HTML (sanity check that the
    // transform side also ran).
    const [htmlFile] = await findFiles(distDir, ".html");
    expect(htmlFile).toBeDefined();
    const html = await readFile(htmlFile!, "utf8");
    expect(html).not.toContain("@hero");
    expect(html).toContain(BODY_ONLY_UTILITY);
  }, 180_000);
});
