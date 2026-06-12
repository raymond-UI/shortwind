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
    // The summary prints the per-framework setup guide URL from this (#85).
    expect(result.bundler).toBe("next");
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

  it("appends the missing theme tokens to an existing create-next-app theme instead of warn-only", async () => {
    const dir = await setupProject({
      name: "demo",
      dependencies: { next: "^16.0.0", react: "^19.0.0" },
      devDependencies: { tailwindcss: "^4.0.0" },
    });
    cleanup.push(dir);
    const globals = path.join(dir, "app", "globals.css");
    await mkdir(path.dirname(globals), { recursive: true });
    // Stock create-next-app globals.css: background/foreground only,
    // media-query dark mode.
    await writeFile(
      globals,
      `@import "tailwindcss";

:root {
  --background: #ffffff;
  --foreground: #171717;
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
}

@media (prefers-color-scheme: dark) {
  :root {
    --background: #0a0a0a;
    --foreground: #ededed;
  }
}
`,
    );

    const installer = makeInstaller();
    const result = await init({
      cwd: dir,
      preset: "starter",
      registry: REGISTRY_PATH,
      installPackages: installer.fn,
    });

    expect(result.themeAction).toBe("supplemented");
    expect(result.supplementedThemeTokens).toContain("card");
    expect(result.supplementedThemeTokens).toContain("border");
    expect(result.missingThemeTokens).toEqual([]);

    const css = readFileSync(globals, "utf8");
    expect(css).toContain("shortwind:theme-supplement");
    expect(css).toContain("--color-card: var(--card);");
    // The project's own tokens are untouched and not redefined.
    expect(css.match(/--background\s*:/g)).toHaveLength(2); // :root + media, as before
    expect(css.match(/--color-background\s*:/g)).toHaveLength(1);

    // Re-running finds nothing missing — no second supplement block.
    const again = await init({
      cwd: dir,
      preset: "starter",
      registry: REGISTRY_PATH,
      installPackages: installer.fn,
    });
    expect(again.themeAction).toBe("skipped");
    expect(readFileSync(globals, "utf8").match(/shortwind:theme-supplement/g)).toHaveLength(1);
  });

  it("a mid-copy abort fails with a resumable message, and re-running completes (#78)", async () => {
    const { vi } = await import("vitest");
    const dir = await setupProject();
    cleanup.push(dir);
    const origin = "https://registry.example.com";
    const timeoutErr = new DOMException(
      "The operation was aborted due to timeout",
      "TimeoutError",
    );
    const family = (name: string): string =>
      `/* shortwind: ${name}@0.0.1 sha:000000 */\n@recipe ${name} { p-4 }\n`;
    let alphaBroken = true;
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith("/presets.json")) {
        return new Response(JSON.stringify({ starter: ["zed", "alpha"] }), { status: 200 });
      }
      if (url.endsWith("/index.json")) {
        return new Response(JSON.stringify({ families: ["zed", "alpha"] }), { status: 200 });
      }
      const m = url.match(/\/recipes\/([a-z]+)\.css$/);
      if (m) {
        if (m[1] === "alpha" && alphaBroken) throw timeoutErr;
        return new Response(family(m[1]!), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const installer = makeInstaller();
      await expect(
        init({ cwd: dir, preset: "starter", registry: origin, installPackages: installer.fn }),
      ).rejects.toThrow(/1\/2 copied: zed[\s\S]*Re-run the same init command to resume/);
      // Half-done on purpose: the copied family is on disk, the config isn't.
      expect(existsSync(path.join(dir, "recipes", "zed.css"))).toBe(true);
      expect(existsSync(path.join(dir, "shortwind.config.json"))).toBe(false);

      // The registry recovered — the same command resumes and completes.
      alphaBroken = false;
      const result = await init({
        cwd: dir,
        preset: "starter",
        registry: origin,
        installPackages: installer.fn,
      });
      expect(result.skippedFamilies).toContain("zed");
      expect(result.installedFamilies).toContain("alpha");
      expect(existsSync(path.join(dir, "shortwind.config.json"))).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
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

  it("installs a pre-commit hook that invokes the real @shortwind/cli package (#76)", async () => {
    const dir = await setupProject();
    cleanup.push(dir);
    await mkdir(path.join(dir, ".git"), { recursive: true });

    const installer = makeInstaller();
    const result = await init({
      cwd: dir,
      preset: "none",
      registry: REGISTRY_PATH,
      installPackages: installer.fn,
    });

    expect(result.huskyPath).not.toBeNull();
    const hook = readFileSync(result.huskyPath!, "utf8");
    // `npx shortwind build` resolves a nonexistent npm package (the CLI has
    // no `shortwind` bin and isn't a devDependency) — first commit 404s.
    expect(hook).toContain("npx @shortwind/cli build");
    expect(hook).not.toMatch(/npx shortwind build/);
    // Husky v9: no shebang, no sourcing of _/husky.sh
    expect(hook).not.toContain("#!/usr/bin/env sh");
    expect(hook).not.toContain("husky.sh");
  });

  it("skips the pre-commit hook when the target isn't a git repository (#76)", async () => {
    const dir = await setupProject();
    cleanup.push(dir);

    const installer = makeInstaller();
    const result = await init({
      cwd: dir,
      preset: "none",
      registry: REGISTRY_PATH,
      installPackages: installer.fn,
    });

    expect(result.huskyPath).toBeNull();
    expect(existsSync(path.join(dir, ".husky", "pre-commit"))).toBe(false);
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

  it("SKILL.md examples only reference recipes the preset installed (#80)", async () => {
    const dir = await setupProject();
    cleanup.push(dir);

    const installer = makeInstaller();
    const result = await init({
      cwd: dir,
      preset: "starter", // no badge or navigation family
      registry: REGISTRY_PATH,
      installPackages: installer.fn,
    });

    const md = readFileSync(result.skillPath, "utf8");
    // Recipes the install actually provides, straight from the listing.
    const installed = new Set(
      [...md.matchAll(/^  @([A-Za-z0-9][\w-]*)/gm)].map((m) => m[1]),
    );
    expect(installed.size).toBeGreaterThan(0);
    // Every @recipe mentioned inside example code fences must be installed.
    for (const fence of md.matchAll(/```tsx([\s\S]*?)```/g)) {
      for (const m of (fence[1] ?? "").matchAll(/@([A-Za-z0-9][\w-]*)/g)) {
        expect(installed.has(m[1]!), `@${m[1]} is not in the starter preset`).toBe(true);
      }
    }
  });

  it("SKILL.md surfaces strict mode and the escape hatch for the detected adapter (#81)", async () => {
    const dir = await setupProject({
      name: "demo",
      dependencies: { next: "^16.0.0", react: "^19.0.0" },
    });
    cleanup.push(dir);

    const installer = makeInstaller();
    const result = await init({
      cwd: dir,
      preset: "starter",
      registry: REGISTRY_PATH,
      installPackages: installer.fn,
    });

    const md = readFileSync(result.skillPath, "utf8");
    expect(md).toContain("withShortwind({ strict: true })");
    expect(md).toContain(`import { expandClassList, loadRegistryFromDir } from "@shortwind/next"`);
    // Vite-only idioms must not leak into a Next SKILL.
    expect(md).not.toContain("virtual:shortwind/registry");

    const agents = readFileSync(path.join(dir, "AGENTS.md"), "utf8");
    expect(agents).toContain("expandClassList");
    expect(agents).toContain("strict: true");
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

  it("supplements recipe-referenced tokens missing from a pre-existing @theme (#62)", async () => {
    // create-next-app ships a globals.css whose @theme defines only
    // background/foreground; the theme scaffold leaves it intact, and init
    // appends the tokens the installed recipes reference that the theme
    // lacks (warn-only proved insufficient — see the supplement test above).
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

    expect(result.themeAction).toBe("supplemented");
    // the starter families lean on the semantic token set — card/border/etc.
    // must be provided by the appended supplement; the project's own tokens
    // are not duplicated into it
    expect(result.supplementedThemeTokens).toContain("card");
    expect(result.supplementedThemeTokens).toContain("border");
    expect(result.supplementedThemeTokens).not.toContain("background");
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

