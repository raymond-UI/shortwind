import { describe, expect, it } from "vitest";
import {
  describeRecipeEdit,
  shortHash,
  formatTime,
  formatBytes,
} from "./format";

describe("describeRecipeEdit (PRD §5.4 phrasing)", () => {
  it("renders a version transition + plural pages", () => {
    expect(
      describeRecipeEdit({
        family: "card",
        fromVersion: "0.4.0",
        toVersion: "0.5.0",
        affectedPages: 12,
      }),
    ).toBe("@card 0.4.0 → 0.5.0, affects 12 pages on next publish");
  });

  it("renders 'created' for a first version and singular page", () => {
    expect(
      describeRecipeEdit({
        family: "button",
        fromVersion: null,
        toVersion: "0.1.0",
        affectedPages: 1,
      }),
    ).toBe("@button created 0.1.0, affects 1 page on next publish");
  });
});

describe("shortHash / formatTime", () => {
  it("truncates a long hash to 8 chars", () => {
    expect(shortHash("deadbeefcafef00d")).toBe("deadbeef");
  });
  it("formats epoch ms to a stable UTC string", () => {
    expect(formatTime(0)).toBe("1970-01-01 00:00:00Z");
  });
});

describe("formatBytes (CLOUD-43 storage meter)", () => {
  it("returns 0 B for empty/zero/negative", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(-5)).toBe("0 B");
  });
  it("formats whole bytes without a decimal", () => {
    expect(formatBytes(512)).toBe("512 B");
  });
  it("steps to binary units with one decimal", () => {
    expect(formatBytes(1024)).toBe("1 KiB");
    expect(formatBytes(1536)).toBe("1.5 KiB");
    expect(formatBytes(5_242_880)).toBe("5 MiB");
  });
});
