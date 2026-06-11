import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { wireBundler } from "../src/bundler-config.js";

async function project(files: Record<string, string>): Promise<string> {
  const dir = realpathSync(await mkdtemp(path.join(tmpdir(), "shortwind-bundler-")));
  for (const [rel, body] of Object.entries(files)) {
    await writeFile(path.join(dir, rel), body);
  }
  return dir;
}

const VITE = `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [tailwindcss(), react()],
});
`;

describe("wireBundler (vite)", () => {
  let dirs: string[] = [];
  beforeEach(() => {
    dirs = [];
  });
  afterEach(async () => {
    for (const d of dirs) await rm(d, { recursive: true, force: true }).catch(() => {});
  });

  it("adds the import and injects shortwind() at the head of the plugins array", async () => {
    const dir = await project({ "vite.config.ts": VITE });
    dirs.push(dir);
    const result = await wireBundler(dir, "vite");
    expect(result.action).toBe("patched");
    const cfg = await readFile(path.join(dir, "vite.config.ts"), "utf8");
    expect(cfg).toContain(`import { shortwind } from "@shortwind/vite";`);
    expect(cfg).toContain("plugins: [shortwind(), tailwindcss(), react()]");
    // import lands among the other imports, above the config body
    expect(cfg.indexOf("@shortwind/vite")).toBeLessThan(cfg.indexOf("export default"));
  });

  it("is idempotent — skips when the plugin is already wired", async () => {
    const dir = await project({ "vite.config.ts": VITE });
    dirs.push(dir);
    await wireBundler(dir, "vite");
    const second = await wireBundler(dir, "vite");
    expect(second.action).toBe("skipped");
    const cfg = await readFile(path.join(dir, "vite.config.ts"), "utf8");
    expect(cfg.match(/@shortwind\/vite/g)).toHaveLength(1);
  });

  it("returns a snippet when there is no vite config to patch", async () => {
    const dir = await project({});
    dirs.push(dir);
    const result = await wireBundler(dir, "vite");
    expect(result.action).toBe("manual");
    expect(result.snippet).toContain("@shortwind/vite");
  });

  it("returns a snippet (not a corrupt patch) when the plugins array is missing", async () => {
    const dir = await project({ "vite.config.ts": `export default { build: {} };\n` });
    dirs.push(dir);
    const result = await wireBundler(dir, "vite");
    expect(result.action).toBe("manual");
    const cfg = await readFile(path.join(dir, "vite.config.ts"), "utf8");
    expect(cfg).not.toContain("shortwind()"); // file left intact
  });

  it("hands back a snippet for next/astro rather than editing", async () => {
    const dir = await project({});
    dirs.push(dir);
    expect((await wireBundler(dir, "next")).action).toBe("manual");
    expect((await wireBundler(dir, "astro")).snippet).toContain("@shortwind/astro");
  });

  it("the next snippet shows the curried call shape (#61)", async () => {
    // withShortwind is curried: withShortwind(options?)(nextConfig?). The
    // non-curried form the snippet used to show passes the Next config as
    // Shortwind options and exports a function — Next then fails to boot.
    const dir = await project({});
    dirs.push(dir);
    const result = await wireBundler(dir, "next");
    expect(result.snippet).toContain("withShortwind()(");
    expect(result.snippet).not.toMatch(/withShortwind\((?!\)\()\w/);
  });
});
