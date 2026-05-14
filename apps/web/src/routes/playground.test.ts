import { describe, expect, it } from "vitest";
import { decodeShareHash, encodeShareHash } from "./playground";

describe("playground share hash", () => {
  it("round-trips a multi-line UTF-8 input", () => {
    const input = `<div class="@card">
  <p>héllo · 你好 · 🌱</p>
</div>`;
    const hash = encodeShareHash(input);
    expect(hash.startsWith("share=")).toBe(true);
    expect(decodeShareHash(hash)).toBe(input);
  });

  it("returns null for a malformed share hash", () => {
    expect(decodeShareHash("")).toBeNull();
    expect(decodeShareHash("foo=bar")).toBeNull();
  });
});
