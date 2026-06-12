import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findMissingThemeTokens, scaffoldTheme, THEME_MARKER } from "../src/theme.js";

async function project(opts: {
  tailwind?: string;
  files?: Record<string, string>;
}): Promise<string> {
  const dir = realpathSync(await mkdtemp(path.join(tmpdir(), "shortwind-theme-")));
  const pkg: { name: string; devDependencies?: Record<string, string> } = { name: "x" };
  if (opts.tailwind) pkg.devDependencies = { tailwindcss: opts.tailwind };
  await writeFile(path.join(dir, "package.json"), JSON.stringify(pkg, null, 2));
  for (const [rel, body] of Object.entries(opts.files ?? {})) {
    const full = path.join(dir, rel);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, body);
  }
  return dir;
}

describe("scaffoldTheme", () => {
  let dirs: string[] = [];
  beforeEach(() => {
    dirs = [];
  });
  afterEach(async () => {
    for (const d of dirs) await rm(d, { recursive: true, force: true }).catch(() => {});
  });

  it("injects the token block after the tailwindcss import", async () => {
    const dir = await project({
      tailwind: "^4.0.0",
      files: { "src/index.css": `@import "tailwindcss";\n\nbody { margin: 0; }\n` },
    });
    dirs.push(dir);
    const result = await scaffoldTheme(dir);
    expect(result.action).toBe("injected");
    const css = await readFile(path.join(dir, "src/index.css"), "utf8");
    expect(css).toContain(THEME_MARKER);
    expect(css).toContain("--color-card: var(--card)");
    // block sits between the import and the pre-existing body rule
    expect(css.indexOf('@import "tailwindcss"')).toBeLessThan(css.indexOf(THEME_MARKER));
    expect(css.indexOf(THEME_MARKER)).toBeLessThan(css.indexOf("body { margin: 0; }"));
  });

  it("is idempotent — re-running does not duplicate the block", async () => {
    const dir = await project({
      tailwind: "^4.0.0",
      files: { "src/index.css": `@import "tailwindcss";\n` },
    });
    dirs.push(dir);
    await scaffoldTheme(dir);
    const second = await scaffoldTheme(dir);
    expect(second.action).toBe("skipped");
    const css = await readFile(path.join(dir, "src/index.css"), "utf8");
    expect(css.match(new RegExp(THEME_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"))).toHaveLength(1);
  });

  it("does not clobber a theme the project already defines", async () => {
    const dir = await project({
      tailwind: "^4.0.0",
      files: { "src/app.css": `@import "tailwindcss";\n:root { --background: #fff; }\n` },
    });
    dirs.push(dir);
    const result = await scaffoldTheme(dir);
    expect(result.action).toBe("skipped");
    expect(result.reason).toContain("already defines a theme");
    const css = await readFile(path.join(dir, "src/app.css"), "utf8");
    expect(css).not.toContain(THEME_MARKER);
  });

  it("creates src/index.css when a v4 project has no Tailwind CSS entry", async () => {
    const dir = await project({ tailwind: "^4.0.0" });
    dirs.push(dir);
    const result = await scaffoldTheme(dir);
    expect(result.action).toBe("created");
    expect(existsSync(path.join(dir, "src/index.css"))).toBe(true);
    const css = await readFile(path.join(dir, "src/index.css"), "utf8");
    expect(css).toContain('@import "tailwindcss"');
    expect(css).toContain(THEME_MARKER);
  });

  it("skips when there is no Tailwind v4 entry to attach to", async () => {
    const dir = await project({ tailwind: "^3.4.0" });
    dirs.push(dir);
    const result = await scaffoldTheme(dir);
    expect(result.action).toBe("skipped");
    expect(result.themePath).toBeNull();
  });
});

describe("findMissingThemeTokens (#62)", () => {
  // create-next-app ships an @theme that defines only background/foreground —
  // the skip-existing-theme path must still tell the user which recipe-
  // referenced tokens that theme does NOT define.
  const nextAppCss = `@import "tailwindcss";
:root { --background: #ffffff; --foreground: #171717; }
@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
}
`;

  const flattened = {
    card: ["bg-card", "text-card-foreground", "rounded-lg", "border-border"],
    badge: ["hover:bg-primary/90", "text-muted-foreground"],
  };

  it("reports recipe-referenced tokens the project theme does not define", () => {
    const missing = findMissingThemeTokens(nextAppCss, flattened);
    expect(missing).toEqual(["border", "card", "card-foreground", "muted-foreground", "primary"]);
  });

  it("reports nothing when the theme defines every referenced token", () => {
    const css = `@theme inline {
  --color-card: var(--card);
  --color-card-foreground: oklch(0.1 0 0);
  --color-border: #eee;
  --color-muted-foreground: #888;
  --color-primary: #000;
}`;
    expect(findMissingThemeTokens(css, flattened)).toEqual([]);
  });

  it("accepts bare --<name> custom properties as defining a token", () => {
    const css = `:root { --card: #fff; --card-foreground: #000; --border: #eee; --muted-foreground: #888; --primary: #000; }`;
    expect(findMissingThemeTokens(css, flattened)).toEqual([]);
  });

  it("ignores utilities that are not theme color tokens", () => {
    const css = `@theme inline { --color-background: #fff; }`;
    expect(findMissingThemeTokens(css, { text: ["text-4xl", "font-bold", "tracking-tight"] })).toEqual([]);
  });
});
