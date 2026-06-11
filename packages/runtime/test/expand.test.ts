import { describe, expect, it, beforeEach } from "vitest";
import { expand } from "@shortwind/core";
import {
  DEFAULT_REGISTRY,
  createGlobal,
  expandClassList,
  expandDOM,
  install,
} from "../src/index.js";

describe("@shortwind/runtime", () => {
  beforeEach(() => {
    document.documentElement.innerHTML = "<head></head><body></body>";
    delete (window as Window & { shortwind?: unknown }).shortwind;
  });

  it("ships a non-empty default registry", () => {
    expect(Object.keys(DEFAULT_REGISTRY.flattened).length).toBeGreaterThan(0);
    expect(Object.keys(DEFAULT_REGISTRY.families).length).toBeGreaterThan(0);
  });

  it("expands a @recipe in a DOM tree", () => {
    document.body.innerHTML = `<div class="@card"></div>`;
    expandDOM(document.body, DEFAULT_REGISTRY);
    const cls = document.body.firstElementChild!.getAttribute("class")!;
    expect(cls).not.toMatch(/@card\b/);
    expect(cls.length).toBeGreaterThan(0);
  });

  it("is idempotent across multiple invocations", () => {
    document.body.innerHTML = `<div class="@card text-base"></div>`;
    expandDOM(document.body, DEFAULT_REGISTRY);
    const once = document.body.firstElementChild!.getAttribute("class");
    expandDOM(document.body, DEFAULT_REGISTRY);
    const twice = document.body.firstElementChild!.getAttribute("class");
    expect(twice).toBe(once);
  });

  it("preserves unknown @recipe tokens verbatim", () => {
    document.body.innerHTML = `<div class="@notarecipe-zzz"></div>`;
    expandDOM(document.body, DEFAULT_REGISTRY);
    const cls = document.body.firstElementChild!.getAttribute("class")!;
    expect(cls).toContain("@notarecipe-zzz");
  });

  it("does not crash on a prototype-key class and keeps expanding the rest of the page (#40)", () => {
    // A page-content class like `@constructor` would resolve an inherited
    // Object.prototype member with a bare lookup and throw mid-walk.
    document.body.innerHTML = `<div class="@constructor @__proto__ @toString"></div><div class="@card"></div>`;
    expect(() => expandDOM(document.body, DEFAULT_REGISTRY)).not.toThrow();
    const first = document.body.children[0]!.getAttribute("class")!;
    expect(first).toBe("@constructor @__proto__ @toString");
    // the walk must not abort early — the sibling still expands
    expect(document.body.children[1]!.getAttribute("class")).not.toMatch(/@card\b/);
  });

  it("leaves attributes with no @ tokens untouched", () => {
    document.body.innerHTML = `<div class="text-base font-bold"></div>`;
    const before = document.body.firstElementChild!.getAttribute("class");
    expandDOM(document.body, DEFAULT_REGISTRY);
    const after = document.body.firstElementChild!.getAttribute("class");
    expect(after).toBe(before);
  });

  it("install() attaches a window.shortwind global with a run method", () => {
    const api = install(window);
    expect(window.shortwind).toBe(api);
    expect(api.registry).toBe(DEFAULT_REGISTRY);
    document.body.innerHTML = `<div class="@card"></div>`;
    api.run(document.body);
    expect(document.body.firstElementChild!.getAttribute("class")).not.toMatch(/@card\b/);
  });

  it("createGlobal() with a custom registry uses it", () => {
    const custom = {
      flattened: { mybtn: ["px-4", "py-2", "bg-blue-500"] },
      families: {},
    };
    const api = createGlobal(custom);
    document.body.innerHTML = `<div class="@mybtn"></div>`;
    api.run(document.body);
    const cls = document.body.firstElementChild!.getAttribute("class")!;
    expect(cls).toContain("bg-blue-500");
    expect(cls).not.toMatch(/@mybtn\b/);
  });

  it("expandClassList passes through fastpath when no @ tokens are present", () => {
    const input = "text-base font-bold hover:bg-gray-100";
    expect(expandClassList(input, DEFAULT_REGISTRY)).toBe(input);
  });

  // Pins the contract that `expandClassList` agrees with the full `expand()`
  // from @shortwind/core for a single recipe in isolation. We don't compare
  // multi-recipe / merge-conflict cases because the runtime intentionally
  // skips tailwind-merge to keep the bundle under 8 KB gzipped — that
  // divergence is documented, not accidental.
  it("expandClassList matches @shortwind/core expand for single-recipe inputs", () => {
    const samples = ["@card", "@badge"];
    for (const sample of samples) {
      const lite = expandClassList(sample, DEFAULT_REGISTRY);
      const wrapped = expand(`<div class="${sample}"></div>`, DEFAULT_REGISTRY, {
        mode: "html",
        mergeConflicts: false,
      });
      const fullCls = wrapped.match(/class="([^"]*)"/)?.[1] ?? "";
      expect(lite.split(/\s+/).filter(Boolean).sort()).toEqual(
        fullCls.split(/\s+/).filter(Boolean).sort(),
      );
    }
  });
});
