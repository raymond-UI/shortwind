import { describe, expect, it } from "vitest";
import { describeRecipeEdit, shortHash, formatTime } from "./format";

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
