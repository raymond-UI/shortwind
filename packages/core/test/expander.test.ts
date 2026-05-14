import { describe, it, expect } from "vitest";
import { expand } from "../src/expander.js";
import type { Registry } from "../src/types.js";
import { loadExpanderFixtures } from "./run-fixtures.js";

describe("expand (fixtures)", () => {
  for (const fx of loadExpanderFixtures()) {
    it(fx.name, () => {
      const registry: Registry = { flattened: fx.flattened, families: {} };
      const actual = expand(fx.input, registry, {
        mode: fx.mode,
        mergeConflicts: fx.mergeConflicts,
      });
      expect(actual).toEqual(fx.expected);
    });
  }
});

describe("expand (defaults)", () => {
  it("defaults to html mode and mergeConflicts:true", () => {
    const registry: Registry = {
      flattened: { card: ["p-4", "rounded-lg"] },
      families: {},
    };
    const out = expand(`<div class="@card p-6"></div>`, registry);
    expect(out).toEqual(`<div class="rounded-lg p-6"></div>`);
  });

  it("does not touch className in html mode", () => {
    const registry: Registry = {
      flattened: { card: ["rounded-lg"] },
      families: {},
    };
    const out = expand(`<div className="@card"></div>`, registry);
    expect(out).toEqual(`<div className="@card"></div>`);
  });
});

describe("expand (callExpanders)", () => {
  const registry: Registry = {
    flattened: { "btn-base": ["inline-flex", "rounded-md"] },
    families: {},
  };

  it("expands custom call names via option", () => {
    const out = expand(`const x = styled("@btn-base");`, registry, {
      mode: "jsx",
      callExpanders: ["styled"],
    });
    expect(out).toEqual(`const x = styled("inline-flex rounded-md");`);
  });

  it("disables call expansion when callExpanders=[]", () => {
    const out = expand(`const x = cva("@btn-base");`, registry, {
      mode: "jsx",
      callExpanders: [],
    });
    expect(out).toEqual(`const x = cva("@btn-base");`);
  });

  it("does not expand calls in html mode by default", () => {
    const out = expand(`const x = cva("@btn-base");`, registry, { mode: "html" });
    expect(out).toEqual(`const x = cva("@btn-base");`);
  });

  it("is idempotent across two passes", () => {
    const src = `const v = cva("@btn-base", { variants: { variant: { default: "@btn-base" } } });`;
    const once = expand(src, registry, { mode: "jsx" });
    const twice = expand(once, registry, { mode: "jsx" });
    expect(twice).toEqual(once);
  });
});
