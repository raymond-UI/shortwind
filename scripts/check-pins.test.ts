import { describe, expect, it } from "vitest";
import { findPinViolations, isExactPin } from "./check-pins.js";

describe("isExactPin", () => {
  it("accepts exact semver", () => {
    expect(isExactPin("1.0.0")).toBe(true);
    expect(isExactPin("1.169.2")).toBe(true);
    expect(isExactPin("1.2.3-beta.1")).toBe(true);
  });

  it("rejects caret, tilde, ranges, and tags", () => {
    expect(isExactPin("^1.0.0")).toBe(false);
    expect(isExactPin("~1.0.0")).toBe(false);
    expect(isExactPin(">=1.0.0")).toBe(false);
    expect(isExactPin("1.0.x")).toBe(false);
    expect(isExactPin("latest")).toBe(false);
    expect(isExactPin("workspace:*")).toBe(false);
  });
});

describe("findPinViolations", () => {
  it("flags a caret range on a pinned package", () => {
    const violations = findPinViolations([
      {
        path: "/x/package.json",
        pkg: {
          name: "x",
          dependencies: { "@tanstack/react-router": "^1.0.0" },
        },
      },
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.range).toBe("^1.0.0");
    expect(violations[0]!.packageName).toBe("@tanstack/react-router");
  });

  it("passes when pinned packages use exact versions", () => {
    const violations = findPinViolations([
      {
        path: "/x/package.json",
        pkg: {
          name: "x",
          dependencies: {
            "@tanstack/react-router": "1.169.2",
            "@tanstack/react-start": "1.167.65",
          },
        },
      },
    ]);
    expect(violations).toEqual([]);
  });

  it("ignores packages that are not in the pin list", () => {
    const violations = findPinViolations([
      {
        path: "/x/package.json",
        pkg: { name: "x", dependencies: { react: "^19.0.0" } },
      },
    ]);
    expect(violations).toEqual([]);
  });

  it("scans devDependencies and peerDependencies too", () => {
    const violations = findPinViolations([
      {
        path: "/x/package.json",
        pkg: {
          name: "x",
          devDependencies: { "@tanstack/react-start": "~1.167.0" },
        },
      },
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.field).toBe("devDependencies");
  });
});
