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
    expect(installer.calls[0]?.packages.sort()).toEqual(
      ["@shortwind/tailwind", "@shortwind/vite"].sort(),
    );
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
      expect(md).toContain(family);
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

    // bundler unknown → only base package is installed
    expect(installer.calls[0]?.packages).toEqual(["@shortwind/tailwind"]);
  });
});

