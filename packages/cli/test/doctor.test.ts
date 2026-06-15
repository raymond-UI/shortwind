import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { doctor } from "../src/commands/doctor.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const RECIPES_SRC = path.resolve(here, "..", "..", "registry", "recipes");

async function setupProject(families: string[] = ["card"]): Promise<string> {
  const raw = await mkdtemp(path.join(tmpdir(), "shortwind-doctor-"));
  const dir = realpathSync(raw);
  const recipesDir = path.join(dir, "recipes");
  await mkdir(recipesDir, { recursive: true });
  for (const fam of families) {
    await copyFile(path.join(RECIPES_SRC, `${fam}.css`), path.join(recipesDir, `${fam}.css`));
  }
  await writeFile(
    path.join(dir, "shortwind.config.json"),
    JSON.stringify({ recipesDir: "recipes", outputPath: "SKILL.md" }, null, 2),
  );
  return dir;
}

async function write(dir: string, rel: string, body: string): Promise<string> {
  const full = path.join(dir, rel);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, body);
  return full;
}

describe("doctor", () => {
  let dirs: string[] = [];
  beforeEach(() => {
    dirs = [];
  });
  afterEach(async () => {
    for (const d of dirs) await rm(d, { recursive: true, force: true }).catch(() => {});
  });

  it("reports no-output when no build directory exists", async () => {
    const dir = await setupProject();
    dirs.push(dir);
    const result = await doctor({ cwd: dir });
    expect(result.verdict).toBe("no-output");
    expect(result.ok).toBe(false);
    expect(result.scannedFiles).toBe(0);
  });

  it("is clean when build output contains only expanded utilities", async () => {
    const dir = await setupProject();
    dirs.push(dir);
    await write(dir, "src/page.tsx", `export default () => <div className="@card" />;\n`);
    await write(dir, "dist/index.html", `<div class="rounded-lg border p-4 shadow"></div>\n`);
    await write(dir, "dist/assets/app.js", `const a="rounded-lg border p-4";\n`);

    const result = await doctor({ cwd: dir });
    expect(result.verdict).toBe("clean");
    expect(result.ok).toBe(true);
    expect(result.scannedFiles).toBe(2);
    expect(result.findings).toEqual([]);
  });

  it("diagnoses not-wired when every source-used recipe survives raw in output (#84)", async () => {
    const dir = await setupProject();
    dirs.push(dir);
    await write(
      dir,
      "app/page.tsx",
      `export default () => <div className="@card"><span className="@card-flat" /></div>;\n`,
    );
    // Green build, raw tokens in prerendered HTML — the adapter was never wired.
    await write(dir, ".next/server/app/index.html", `<div class="@card"><span class="@card-flat"></span></div>\n`);

    const result = await doctor({ cwd: dir });
    expect(result.verdict).toBe("not-wired");
    expect(result.ok).toBe(false);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.tokens).toEqual(["@card", "@card-flat"]);
    expect(result.usedInSource).toEqual(["@card", "@card-flat"]);
  });

  it("diagnoses leak when the transform ran but some tokens escaped", async () => {
    const dir = await setupProject();
    dirs.push(dir);
    await write(
      dir,
      "src/page.tsx",
      `export default () => <div className="@card"><span className="@card-flat" /></div>;\n`,
    );
    // @card was expanded (transform clearly ran); @card-flat leaked through a
    // dynamic className and shipped raw inside a client chunk.
    await write(dir, "dist/index.html", `<div class="rounded-lg border p-4 shadow"></div>\n`);
    await write(dir, "dist/assets/chunk.js", `const cls=cond?"@card-flat":base;\n`);

    const result = await doctor({ cwd: dir });
    expect(result.verdict).toBe("leak");
    expect(result.ok).toBe(false);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.tokens).toEqual(["@card-flat"]);
  });

  it("ignores sourcemaps and bundler caches", async () => {
    const dir = await setupProject();
    dirs.push(dir);
    await write(dir, "src/page.tsx", `export default () => <div className="@card" />;\n`);
    await write(dir, "dist/index.html", `<div class="rounded-lg border p-4 shadow"></div>\n`);
    // Sourcemaps and webpack caches embed original source — raw tokens there
    // are expected and must not be reported.
    await write(dir, "dist/assets/app.js.map", `{"sourcesContent":["className=\\"@card\\""]}\n`);
    await write(dir, ".next/cache/webpack/0.pack", `className="@card"\n`);

    const result = await doctor({ cwd: dir });
    expect(result.verdict).toBe("clean");
  });

  it("ignores the dev-server output dir (.next/dev) (#91)", async () => {
    const dir = await setupProject();
    dirs.push(dir);
    await write(dir, "src/page.tsx", `export default () => <div className="@card" />;\n`);
    await write(dir, ".next/server/app/index.html", `<div class="rounded-lg border p-4"></div>\n`);
    // Dev-server chunks inline framework internals with raw @-tokens; they are
    // not a production artifact and must not be scanned.
    await write(dir, ".next/dev/static/chunks/main.js", `const x="@card";\n`);

    const result = await doctor({ cwd: dir });
    expect(result.verdict).toBe("clean");
  });

  it("exempts the documented rc() runtime escape hatch", async () => {
    const dir = await setupProject();
    dirs.push(dir);
    await write(dir, "src/page.tsx", `export default () => <div className="@card" />;\n`);
    await write(dir, "dist/assets/app.js", `const cls=rc("@card");\n`);

    const result = await doctor({ cwd: dir });
    expect(result.verdict).toBe("clean");
  });

  it("scans only explicit --dir targets when given", async () => {
    const dir = await setupProject();
    dirs.push(dir);
    await write(dir, "src/page.tsx", `export default () => <div className="@card" />;\n`);
    await write(dir, "dist/index.html", `<div class="@card"></div>\n`);
    await write(dir, "custom-out/index.html", `<div class="rounded-lg border p-4 shadow"></div>\n`);

    const result = await doctor({ cwd: dir, dirs: ["custom-out"] });
    expect(result.verdict).toBe("clean");
    expect(result.outputDirs).toEqual(["custom-out"]);
  });

  it("does not false-positive on unknown @-words in output", async () => {
    const dir = await setupProject();
    dirs.push(dir);
    await write(dir, "src/page.tsx", `export default () => <div className="@card" />;\n`);
    // @container is reserved/not a recipe; @md: is a container-query variant.
    await write(dir, "dist/index.html", `<div class="@container @md:flex rounded-lg border p-4 shadow"></div>\n`);

    const result = await doctor({ cwd: dir });
    expect(result.verdict).toBe("clean");
  });

  it("flags theme tokens recipes reference but the theme never defines (zero-CSS trap)", async () => {
    // @card references card/card-foreground/border/muted/ring. Define a theme
    // entry with NONE of them — only background/foreground.
    const dir = await setupProject(["card"]);
    dirs.push(dir);
    await write(
      dir,
      "src/index.css",
      `@import "tailwindcss";\n@theme inline { --color-background: #fff; --color-foreground: #111; }\n`,
    );
    await write(dir, "dist/index.html", `<div class="rounded-lg border p-4"></div>\n`);

    const result = await doctor({ cwd: dir });
    // token EXPANSION is clean, but the tokens resolve to nothing → not ok.
    expect(result.verdict).toBe("clean");
    expect(result.undefinedTokens).toEqual(expect.arrayContaining(["card", "card-foreground", "border"]));
    expect(result.ok).toBe(false);
  });

  it("passes token validation when the theme defines every referenced token", async () => {
    const dir = await setupProject(["card"]);
    dirs.push(dir);
    await write(
      dir,
      "src/index.css",
      `@import "tailwindcss";\n@theme inline {\n` +
        `  --color-background: #fff; --color-foreground: #111;\n` +
        `  --color-card: #fff; --color-card-foreground: #111; --color-border: #eee;\n` +
        `  --color-muted: #f4f4f5; --color-muted-foreground: #888; --color-ring: #ccc;\n` +
        `}\n`,
    );
    await write(dir, "dist/index.html", `<div class="rounded-lg border p-4"></div>\n`);

    const result = await doctor({ cwd: dir });
    expect(result.undefinedTokens).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("flags a hand-edited safelist @import that points at the wrong file", async () => {
    const dir = await setupProject(["card"]);
    dirs.push(dir);
    // Entry imports a renamed safelist — not the sibling doctor expects.
    await write(
      dir,
      "src/index.css",
      `@import "tailwindcss";\n@import "./renamed-safelist.shortwind.css";\n`,
    );

    const result = await doctor({ cwd: dir });
    expect(result.staleSafelistImports).toHaveLength(1);
    expect(result.staleSafelistImports[0]!.found).toBe("./renamed-safelist.shortwind.css");
    expect(result.staleSafelistImports[0]!.expected).toBe("./index.shortwind.css");
    expect(result.ok).toBe(false);
  });

  it("accepts the correctly-named safelist import (and ./ vs bare path)", async () => {
    const dir = await setupProject(["card"]);
    dirs.push(dir);
    // No `./` prefix, but resolves to the same sibling → not flagged.
    await write(
      dir,
      "src/index.css",
      `@import "tailwindcss";\n@import "index.shortwind.css";\n`,
    );

    const result = await doctor({ cwd: dir });
    expect(result.staleSafelistImports).toEqual([]);
  });
});
