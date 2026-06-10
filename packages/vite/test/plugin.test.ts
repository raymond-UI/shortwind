import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { realpathSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { shortwind } from "../src/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const REGISTRY = path.resolve(here, "..", "..", "registry");
const CARD_CSS = readFileSync(path.join(REGISTRY, "recipes", "card.css"), "utf8");
const BUTTON_CSS = readFileSync(path.join(REGISTRY, "recipes", "button.css"), "utf8");

async function makeProject(recipes: Record<string, string>): Promise<string> {
  const raw = await mkdtemp(path.join(tmpdir(), "shortwind-vite-"));
  const dir = realpathSync(raw);
  await writeFile(path.join(dir, "package.json"), JSON.stringify({ name: "x" }, null, 2));
  const recipesDir = path.join(dir, "recipes");
  await import("node:fs/promises").then((m) => m.mkdir(recipesDir, { recursive: true }));
  for (const [name, body] of Object.entries(recipes)) {
    await writeFile(path.join(recipesDir, name), body);
  }
  return dir;
}

type TransformReturn = string | { code: string; map: null } | null;
function callTransform(plugin: ReturnType<typeof shortwind>[number], code: string, id: string): TransformReturn {
  const t = plugin.transform;
  if (!t) return null;
  return t.call({}, code, id) as TransformReturn;
}

describe("vite plugin", () => {
  let dirs: string[] = [];
  beforeEach(() => {
    dirs = [];
  });
  afterEach(async () => {
    for (const d of dirs) await rm(d, { recursive: true, force: true }).catch(() => {});
  });

  it("returns three plugins (transform + css-source + watcher)", async () => {
    const dir = await makeProject({});
    dirs.push(dir);
    const plugins = shortwind({ cwd: dir });
    expect(plugins).toHaveLength(3);
    expect(plugins[0]?.name).toBe("shortwind:transform");
    expect(plugins[1]?.name).toBe("shortwind:css-source");
    expect(plugins[2]?.name).toBe("shortwind:watcher");
    expect(plugins[0]?.enforce).toBe("pre");
    expect(plugins[1]?.enforce).toBe("pre");
  });

  it("transforms @recipe tokens inside class= attributes of HTML", async () => {
    const dir = await makeProject({ "card.css": CARD_CSS });
    dirs.push(dir);
    const [transformPlugin] = shortwind({ cwd: dir });
    const result = callTransform(
      transformPlugin!,
      `<div class="@card other-class"></div>`,
      path.join(dir, "index.html"),
    );
    expect(result).not.toBeNull();
    const code = typeof result === "string" ? result : result?.code;
    expect(code).toMatch(/rounded/);
    expect(code).toContain("other-class");
    expect(code).not.toMatch(/@card\b/);
  });

  it("transforms className= attributes in JSX/TSX", async () => {
    const dir = await makeProject({ "button.css": BUTTON_CSS });
    dirs.push(dir);
    const [transformPlugin] = shortwind({ cwd: dir });
    const result = callTransform(
      transformPlugin!,
      `<button className="@btn-primary">Go</button>`,
      path.join(dir, "src", "App.tsx"),
    );
    const code = typeof result === "string" ? result : result?.code;
    expect(code).not.toBeNull();
    expect(code).not.toMatch(/@btn-primary\b/);
  });

  // .astro/.vue/.svelte are HTML-shaped templates: they use `class=`, not
  // `className=`, and are NOT valid JSX. They must run through the html-mode
  // expander — routing them to the JSX AST transform silently no-ops and ships
  // literal `class="@recipe"` to the browser. Regression for that bug.
  it("expands class= attributes in .astro templates (html mode, not JSX)", async () => {
    const dir = await makeProject({ "card.css": CARD_CSS });
    dirs.push(dir);
    const [transformPlugin] = shortwind({ cwd: dir });
    const result = callTransform(
      transformPlugin!,
      `<header class="@card other-class"></header>`,
      path.join(dir, "src", "components", "Header.astro"),
    );
    expect(result).not.toBeNull();
    const code = typeof result === "string" ? result : result?.code;
    expect(code).toMatch(/rounded/);
    expect(code).toContain("other-class");
    expect(code).not.toMatch(/@card\b/);
  });

  it("expands class= attributes in .vue templates (html mode, not JSX)", async () => {
    const dir = await makeProject({ "card.css": CARD_CSS });
    dirs.push(dir);
    const [transformPlugin] = shortwind({ cwd: dir });
    const result = callTransform(
      transformPlugin!,
      `<template><div class="@card"></div></template>`,
      path.join(dir, "src", "App.vue"),
    );
    const code = typeof result === "string" ? result : result?.code;
    expect(code).not.toBeNull();
    expect(code).not.toMatch(/@card\b/);
    expect(code).toMatch(/rounded/);
  });

  it("returns null for unrelated extensions", async () => {
    const dir = await makeProject({ "card.css": CARD_CSS });
    dirs.push(dir);
    const [transformPlugin] = shortwind({ cwd: dir });
    const result = callTransform(transformPlugin!, "ignore me", path.join(dir, "data.json"));
    expect(result).toBeNull();
  });

  it("skips the recipe CSS files themselves", async () => {
    const dir = await makeProject({ "card.css": CARD_CSS });
    dirs.push(dir);
    const [transformPlugin] = shortwind({ cwd: dir });
    const result = callTransform(
      transformPlugin!,
      "/* this content has @card in it */",
      path.join(dir, "recipes", "card.css"),
    );
    expect(result).toBeNull();
  });

  it("strips query suffix from the id before deciding", async () => {
    const dir = await makeProject({ "card.css": CARD_CSS });
    dirs.push(dir);
    const [transformPlugin] = shortwind({ cwd: dir });
    const result = callTransform(
      transformPlugin!,
      `<div class="@card"></div>`,
      path.join(dir, "App.tsx") + "?vue&type=template",
    );
    const code = typeof result === "string" ? result : result?.code;
    expect(code).not.toBeNull();
    expect(code).not.toMatch(/@card\b/);
  });

  it("injects @source inline(...) into user CSS that imports tailwindcss", async () => {
    const dir = await makeProject({ "card.css": CARD_CSS });
    dirs.push(dir);
    const [, cssPlugin] = shortwind({ cwd: dir });
    const result = callTransform(
      cssPlugin!,
      `@import "tailwindcss";\n:root { --x: 1; }`,
      path.join(dir, "src", "styles.css"),
    );
    const code = typeof result === "string" ? result : result?.code;
    expect(code).not.toBeNull();
    expect(code).toContain("@source inline(");
    expect(code).toContain("/* shortwind:source-inject */");
  });

  it("leaves CSS without @import \"tailwindcss\" untouched", async () => {
    const dir = await makeProject({ "card.css": CARD_CSS });
    dirs.push(dir);
    const [, cssPlugin] = shortwind({ cwd: dir });
    const result = callTransform(
      cssPlugin!,
      `:root { --x: 1; }`,
      path.join(dir, "src", "styles.css"),
    );
    expect(result).toBeNull();
  });

  it("does not inject into recipe CSS files even if they import tailwindcss", async () => {
    const dir = await makeProject({ "card.css": CARD_CSS });
    dirs.push(dir);
    const [, cssPlugin] = shortwind({ cwd: dir });
    const result = callTransform(
      cssPlugin!,
      `@import "tailwindcss";\n@recipe @card { ... }`,
      path.join(dir, "recipes", "card.css"),
    );
    expect(result).toBeNull();
  });

  it("watcher plugin registers chokidar listeners and emits full-reload on recipe change", async () => {
    const dir = await makeProject({ "card.css": CARD_CSS });
    dirs.push(dir);
    const [, , watcher] = shortwind({ cwd: dir });
    const events: string[] = [];
    const handlers: Record<string, ((file: string) => void)[]> = {};
    const sent: { type: string }[] = [];
    const server = {
      watcher: {
        add(p: string | string[]) {
          events.push(`add:${Array.isArray(p) ? p.join(",") : p}`);
        },
        on(event: string, cb: (file: string) => void) {
          (handlers[event] ??= []).push(cb);
        },
      },
      moduleGraph: {
        getModulesByFile: () => undefined,
        invalidateModule: () => {},
      },
      ws: { send: (payload: { type: "full-reload" }) => sent.push(payload) },
    };
    await watcher!.configureServer?.(server);
    // The watcher must subscribe to the recipes directory specifically — a
    // generic `add:` prefix lets a regression that registers an unrelated
    // path slip through.
    expect(events).toContain(`add:${path.join(dir, "recipes")}`);
    expect(handlers["change"]?.length ?? 0).toBeGreaterThan(0);

    handlers["change"]?.forEach((cb) =>
      cb(path.join(dir, "recipes", "card.css")),
    );
    expect(sent).toContainEqual({ type: "full-reload" });
  });
});
