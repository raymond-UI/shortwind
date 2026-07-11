import { describe, expect, it } from "vitest";
import {
  DEFAULT_ACCENT,
  DEFAULT_RADIUS,
  isSafeColor,
  isSafeRadius,
  themePreamble,
} from "./theme_preamble.js";

describe("isSafeColor", () => {
  it("accepts oklch / hex / rgb / named colors", () => {
    expect(isSafeColor("oklch(0.6 0.2 250)")).toBe(true);
    expect(isSafeColor("#2563eb")).toBe(true);
    expect(isSafeColor("rgb(37, 99, 235)")).toBe(true);
    expect(isSafeColor("rebeccapurple")).toBe(true);
  });

  it("rejects anything that could break out of a CSS declaration", () => {
    expect(isSafeColor("red; } body { display:none")).toBe(false);
    expect(isSafeColor("red</style><script>")).toBe(false);
    expect(isSafeColor("var(--x)@import")).toBe(false);
    expect(isSafeColor("")).toBe(false);
    expect(isSafeColor("a".repeat(65))).toBe(false);
  });
});

describe("isSafeRadius", () => {
  it("accepts a number with an optional rem/px/em/% unit", () => {
    expect(isSafeRadius("0.625rem")).toBe(true);
    expect(isSafeRadius("8px")).toBe(true);
    expect(isSafeRadius("0")).toBe(true);
    expect(isSafeRadius("1.5em")).toBe(true);
    expect(isSafeRadius("50%")).toBe(true);
  });

  it("rejects non-lengths and injection attempts", () => {
    expect(isSafeRadius("1rem; color:red")).toBe(false);
    expect(isSafeRadius("calc(1rem + 2px)")).toBe(false);
    expect(isSafeRadius("huge")).toBe(false);
  });
});

describe("themePreamble", () => {
  it("substitutes a valid accent into --primary and --ring (light + dark)", () => {
    const css = themePreamble({ accent: "#2563eb", radius: "1rem" });
    // Two --primary (root + dark) and two --ring, all the accent.
    expect(css.match(/--primary: #2563eb;/g)).toHaveLength(2);
    expect(css.match(/--ring: #2563eb;/g)).toHaveLength(2);
    expect(css).toContain("--radius: 1rem;");
    // Still a Tailwind entry + theme map so recipes compile with color.
    expect(css).toContain('@import "tailwindcss";');
    expect(css).toContain("--color-primary: var(--primary);");
  });

  it("falls back to the default theme for missing / unsafe values", () => {
    expect(themePreamble(null)).toContain(`--primary: ${DEFAULT_ACCENT};`);
    expect(themePreamble(null)).toContain(`--radius: ${DEFAULT_RADIUS};`);
    const unsafe = themePreamble({ accent: "red; }", radius: "9; }" });
    expect(unsafe).toContain(`--primary: ${DEFAULT_ACCENT};`);
    expect(unsafe).toContain(`--radius: ${DEFAULT_RADIUS};`);
    // The malicious payload never reaches the output.
    expect(unsafe).not.toContain("red;");
  });

  it("is deterministic (stable bytes) for the same input", () => {
    const a = themePreamble({ accent: "#111", radius: "2px" });
    const b = themePreamble({ accent: "#111", radius: "2px" });
    expect(a).toBe(b);
  });
});
