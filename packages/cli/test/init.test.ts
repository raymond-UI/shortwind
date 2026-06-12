import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse as parseJsonc } from "jsonc-parser";
import { init } from "../src/init.js";
import type { InstallPackages } from "../src/init.js";
import type { PackageManager } from "../src/detect.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const REGISTRY_PATH = path.resolve(here, "..", "..", "registry");

type InstallCall = { pm: PackageManager; packages: string[]; cwd: string };

function makeInstaller(): { fn: InstallPackages; calls: InstallCall[] } {
  const calls: InstallCall[] = [];
  const fn: InstallPackages = async (pm, packages, cwd) => {
    calls.push({ pm, packages, cwd });
  };
  return { fn, calls };
}

async function setupProject(
  pkgJson: Record<string, unknown> = { name: "x", version: "0.0.0" },
): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "shortwind-init-"));
  await writeFile(path.join(dir, "package.json"), JSON.stringify(pkgJson, null, 2));
  return dir;
}

describe("init", () => {
  let cleanup: string[] = [];

  beforeEach(() => {
    cleanup = [];
  });

  afterEach(async () => {
    for (const dir of cleanup) {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("copies the starter preset families into ./recipes", async () => {
    const dir = await setupProject({
      name: "demo",
      dependencies: { vite: "^5.0.0", react: "^18.0.0" },
    });
    cleanup.push(dir);

    const installer = makeInstaller();
    const result = await init({
      cwd: dir,
      preset: "starter",
      registry: REGISTRY_PATH,
      installPackages: installer.fn,
    });

    expect(result.preset).toBe("starter");
    expect(result.families.sort()).toEqual(
      ["button", "card", "form", "layout", "text"].sort(),
    );
    for (const family of result.families) {
      expect(existsSync(path.join(dir, "recipes", `${family}.css`))).toBe(true);
    }
  });

  it("invokes the package installer with the bundler-matched packages", async () => {
    const dir = await setupProject({
      name: "demo",
      dependencies: { vite: "^5.0.0" },
    });
    cleanup.push(dir);

    const installer = makeInstaller();
    await init({
      cwd: dir,
      preset: "starter",
      registry: REGISTRY_PATH,
      installPackages: installer.fn,
    });

    expect(installer.calls).toHaveLength(1);
    const installed = installer.calls[0]?.packages ?? [];
    // adapters are pinned to the CLI's own version (scoped name + @version)
    expect(installed.every((p) => /^@shortwind\/\S+@\d+\.\d+\.\d+/.test(p))).toBe(true);
    const bare = installed.map((p) => p.slice(0, p.lastIndexOf("@"))).sort();
    expect(bare).toEqual(["@shortwind/tailwind", "@shortwind/vite"].sort());
  });

  it("still scaffolds recipes/config/SKILL when the adapter install fails", async () => {
    const dir = await setupProject({ name: "x", version: "0.0.0", devDependencies: { vite: "^7" } });
    cleanup.push(dir);

    // mimic pnpm exiting non-zero (e.g. ERR_PNPM_IGNORED_BUILDS) — must not abort
    const failing: InstallPackages = async () => {
      throw new Error("pnpm add -D … exited 1");
    };
    const result = await init({
      cwd: dir,
      preset: "starter",
      registry: REGISTRY_PATH,
      installPackages: failing,
    });

    expect(result.installOk).toBe(false);
    expect(result.installError).toMatch(/exited 1/);
    // the core scaffold still happened
    expect(result.installedFamilies.length).toBeGreaterThan(0);
    expect(existsSync(result.configPath)).toBe(true);
    expect(existsSync(result.skillPath)).toBe(true);
    expect(existsSync(path.join(dir, "recipes", ".shortwind-lock.json"))).toBe(true);
  });

  it("writes the @source inline(...) safelist into a Next project's entry CSS (#73)", async () => {
    const dir = await setupProject({
      name: "demo",
      dependencies: { next: "^16.0.0", react: "^19.0.0" },
      devDependencies: { tailwindcss: "^4.0.0" },
    });
    cleanup.push(dir);
    const globals = path.join(dir, "app", "globals.css");
    await mkdir(path.dirname(globals), { recursive: true });
    await writeFile(globals, `@import "tailwindcss";\n`);

    const installer = makeInstaller();
    const result = await init({
      cwd: dir,
      preset: "starter",
      registry: REGISTRY_PATH,
      installPackages: installer.fn,
    });

    expect(result.safelistCssPaths).toContain(globals);
    const css = readFileSync(globals, "utf8");
    expect(css).toContain("@source inline(");
    // A recipe-body-only utility Tailwind can't discover from on-disk sources.
    expect(css).toContain("bg-card");
  });

  it("does not write the on-disk safelist for Vite projects (in-memory injection)", async () => {
    const dir = await setupProject({
      name: "demo",
      dependencies: { vite: "^5.0.0", react: "^18.0.0" },
      devDependencies: { tailwindcss: "^4.0.0" },
    });
    cleanup.push(dir);
    const entry = path.join(dir, "src", "index.css");
    await mkdir(path.dirname(entry), { recursive: true });
    await writeFile(entry, `@import "tailwindcss";\n`);

    const installer = makeInstaller();
    const result = await init({
      cwd: dir,
      preset: "starter",
      registry: REGISTRY_PATH,
      installPackages: installer.fn,
    });

    expect(result.safelistCssPaths).toEqual([]);
    expect(readFileSync(entry, "utf8")).not.toContain("@source inline(");
  });

  it("writes shortwind.config.json with registry and recipesDir", async () => {
    const dir = await setupProject();
    cleanup.push(dir);

    const installer = makeInstaller();
    const result = await init({
      cwd: dir,
      preset: "none",
      registry: REGISTRY_PATH,
      installPackages: installer.fn,
    });

    const config = JSON.parse(readFileSync(result.configPath, "utf8")) as Record<string, unknown>;
    expect(config["registry"]).toBe(REGISTRY_PATH);
    expect(config["recipesDir"]).toBe("recipes");
    expect(config["outputPath"]).toBe("skills/shortwind/SKILL.md");
  });

  it("writes vscode classRegex setting via comment-preserving jsonc edit", async () => {
    const dir = await setupProject();
    cleanup.push(dir);
    await mkdir(path.join(dir, ".vscode"), { recursive: true });
    await writeFile(
      path.join(dir, ".vscode", "settings.json"),
      `// my comment\n{\n  "editor.formatOnSave": true\n}\n`,
    );

    const installer = makeInstaller();
    await init({
      cwd: dir,
      preset: "none",
      registry: REGISTRY_PATH,
      installPackages: installer.fn,
    });

    const body = readFileSync(path.join(dir, ".vscode", "settings.json"), "utf8");
    expect(body).toContain("my comment");
    expect(body).toContain("tailwindCSS.experimental.classRegex");
    expect(body).toContain('"editor.formatOnSave": true');
    expect(() => parseJsonc(body)).not.toThrow();
  });

  it("installs the pre-commit hook with shortwind build", async () => {
    const dir = await setupProject();
    cleanup.push(dir);

    const installer = makeInstaller();
    const result = await init({
      cwd: dir,
      preset: "none",
      registry: REGISTRY_PATH,
      installPackages: installer.fn,
    });

    const hook = readFileSync(result.huskyPath, "utf8");
    expect(hook).toContain("npx shortwind build");
    // Husky v9: no shebang, no sourcing of _/husky.sh
    expect(hook).not.toContain("#!/usr/bin/env sh");
    expect(hook).not.toContain("husky.sh");
  });

  it("re-init with a new --registry overwrites the prior value in shortwind.config.json", async () => {
    const dir = await setupProject();
    cleanup.push(dir);

    const installer = makeInstaller();
    await init({
      cwd: dir,
      preset: "none",
      registry: REGISTRY_PATH,
      installPackages: installer.fn,
    });

    const SECOND_REGISTRY = "https://example.test/registry";
    await init({
      cwd: dir,
      preset: "none",
      registry: SECOND_REGISTRY,
      installPackages: installer.fn,
    });

    const config = JSON.parse(
      readFileSync(path.join(dir, "shortwind.config.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(config["registry"]).toBe(SECOND_REGISTRY);
  });

  it("writes SKILL.md including each family name", async () => {
    const dir = await setupProject();
    cleanup.push(dir);

    const installer = makeInstaller();
    const result = await init({
      cwd: dir,
      preset: "starter",
      registry: REGISTRY_PATH,
      installPackages: installer.fn,
    });

    const md = readFileSync(result.skillPath, "utf8");
    expect(md).toContain("name: shortwind");
    for (const family of result.families) {
      const cap = family[0]!.toUpperCase() + family.slice(1);
      expect(md).toContain(`### ${cap} recipes`);
    }
  });

  it("--preset=none produces a valid install with empty ./recipes/", async () => {
    const dir = await setupProject();
    cleanup.push(dir);

    const installer = makeInstaller();
    const result = await init({
      cwd: dir,
      preset: "none",
      registry: REGISTRY_PATH,
      installPackages: installer.fn,
    });

    expect(result.families).toEqual([]);
    expect(existsSync(path.join(dir, "recipes"))).toBe(true);
    expect(existsSync(result.configPath)).toBe(true);
    expect(existsSync(result.skillPath)).toBe(true);
  });

  it("is idempotent — second run does not clobber recipes and re-syncs the rest", async () => {
    const dir = await setupProject({
      name: "demo",
      dependencies: { vite: "^5.0.0" },
    });
    cleanup.push(dir);

    const installer1 = makeInstaller();
    const first = await init({
      cwd: dir,
      preset: "starter",
      registry: REGISTRY_PATH,
      installPackages: installer1.fn,
    });
    expect(first.installedFamilies.length).toBeGreaterThan(0);

    // mutate one recipe file — second run must not overwrite it
    const cardPath = path.join(dir, "recipes", "card.css");
    await writeFile(cardPath, "/* user modified */\n");

    const installer2 = makeInstaller();
    const second = await init({
      cwd: dir,
      preset: "starter",
      registry: REGISTRY_PATH,
      installPackages: installer2.fn,
    });

    expect(second.installedFamilies).toEqual([]);
    expect(second.skippedFamilies.length).toBe(first.installedFamilies.length);
    expect(readFileSync(cardPath, "utf8")).toBe("/* user modified */\n");
  });

  it("reports recipe-referenced tokens missing from a pre-existing @theme (#62)", async () => {
    // create-next-app ships a globals.css whose @theme defines only
    // background/foreground; the theme scaffold skips it, so init must surface
    // which tokens the installed recipes reference that the theme lacks.
    const dir = await setupProject({
      name: "demo",
      dependencies: { next: "^15.0.0" },
      devDependencies: { tailwindcss: "^4.0.0" },
    });
    cleanup.push(dir);
    await mkdir(path.join(dir, "app"), { recursive: true });
    await writeFile(
      path.join(dir, "app", "globals.css"),
      `@import "tailwindcss";\n:root { --background: #fff; --foreground: #171717; }\n@theme inline {\n  --color-background: var(--background);\n  --color-foreground: var(--foreground);\n}\n`,
    );

    const installer = makeInstaller();
    const result = await init({
      cwd: dir,
      preset: "starter",
      registry: REGISTRY_PATH,
      installPackages: installer.fn,
    });

    expect(result.themeAction).toBe("skipped");
    // the starter families lean on the semantic token set — card/border/etc.
    // must be flagged as missing from the untouched theme
    expect(result.missingThemeTokens).toContain("card");
    expect(result.missingThemeTokens).toContain("border");
    expect(result.missingThemeTokens).not.toContain("background");
  });

  it("reports no missing tokens when init scaffolds the theme itself", async () => {
    const dir = await setupProject({
      name: "demo",
      devDependencies: { tailwindcss: "^4.0.0" },
    });
    cleanup.push(dir);

    const installer = makeInstaller();
    const result = await init({
      cwd: dir,
      preset: "starter",
      registry: REGISTRY_PATH,
      installPackages: installer.fn,
    });

    expect(result.themeAction).toBe("created");
    expect(result.missingThemeTokens).toEqual([]);
  });

  it("detects pnpm via lockfile", async () => {
    const dir = await setupProject();
    cleanup.push(dir);
    await writeFile(path.join(dir, "pnpm-lock.yaml"), "lockfileVersion: 6.0\n");

    const installer = makeInstaller();
    const result = await init({
      cwd: dir,
      preset: "none",
      registry: REGISTRY_PATH,
      installPackages: installer.fn,
    });

    expect(result.packageManager).toBe("pnpm");
  });

  it("throws on unknown preset name", async () => {
    const dir = await setupProject();
    cleanup.push(dir);

    const installer = makeInstaller();
    await expect(
      init({
        cwd: dir,
        preset: "not-a-real-preset",
        registry: REGISTRY_PATH,
        installPackages: installer.fn,
      }),
    ).rejects.toThrow(/Unknown preset/);
  });

  it("does not call installer when --preset=none and bundler is unknown — still installs @shortwind/tailwind", async () => {
    const dir = await setupProject({ name: "demo" });
    cleanup.push(dir);

    const installer = makeInstaller();
    await init({
      cwd: dir,
      preset: "none",
      registry: REGISTRY_PATH,
      installPackages: installer.fn,
    });

    // bundler unknown → only base package is installed (version-pinned to the CLI)
    const installed = installer.calls[0]?.packages ?? [];
    expect(installed).toHaveLength(1);
    expect(installed[0]).toMatch(/^@shortwind\/tailwind@\d+\.\d+\.\d+/);
  });
});

