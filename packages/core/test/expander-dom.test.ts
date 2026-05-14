// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { expandDOM } from "../src/expander.js";
import type { Registry } from "../src/types.js";

const registry: Registry = {
  flattened: {
    card: ["rounded-lg", "border"],
    btn: ["px-4", "py-2"],
  },
  families: {},
};

describe("expandDOM", () => {
  it("walks the tree and expands @-tokens on every element", () => {
    const root = document.createElement("div");
    root.innerHTML = `<section class="@card"><button class="@btn text-sm"></button></section>`;
    expandDOM(root, registry);
    const section = root.querySelector("section")!;
    const btn = root.querySelector("button")!;
    expect(section.getAttribute("class")).toEqual("rounded-lg border");
    expect(btn.getAttribute("class")).toEqual("px-4 py-2 text-sm");
  });

  it("expands the root element itself", () => {
    const root = document.createElement("div");
    root.setAttribute("class", "@card");
    expandDOM(root, registry);
    expect(root.getAttribute("class")).toEqual("rounded-lg border");
  });

  it("is idempotent — a second pass changes nothing", () => {
    const root = document.createElement("div");
    root.innerHTML = `<section class="@card"><button class="@btn"></button></section>`;
    expandDOM(root, registry);
    const once = root.outerHTML;
    expandDOM(root, registry);
    expect(root.outerHTML).toEqual(once);
  });

  it("leaves elements without a class attribute alone", () => {
    const root = document.createElement("div");
    root.innerHTML = `<p>hello</p>`;
    expandDOM(root, registry);
    expect(root.querySelector("p")!.hasAttribute("class")).toBe(false);
  });

  it("leaves unknown @-tokens in place", () => {
    const root = document.createElement("div");
    root.setAttribute("class", "@unknown @card");
    expandDOM(root, registry);
    expect(root.getAttribute("class")).toEqual("@unknown rounded-lg border");
  });
});
