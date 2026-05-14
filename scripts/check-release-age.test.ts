import { describe, expect, it } from "vitest";
import { checkReleaseAge, MIN_RELEASE_AGE_MINUTES } from "./check-release-age.js";

describe("checkReleaseAge", () => {
  it("passes when minimumReleaseAge meets the threshold", () => {
    expect(checkReleaseAge({ pnpm: { minimumReleaseAge: MIN_RELEASE_AGE_MINUTES } })).toEqual({
      ok: true,
    });
    expect(checkReleaseAge({ pnpm: { minimumReleaseAge: MIN_RELEASE_AGE_MINUTES + 1 } })).toEqual({
      ok: true,
    });
  });

  it("fails when minimumReleaseAge is below the threshold", () => {
    const result = checkReleaseAge({ pnpm: { minimumReleaseAge: 60 } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("60 minutes");
  });

  it("fails when minimumReleaseAge is missing", () => {
    const result = checkReleaseAge({});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("missing");
  });

  it("fails when minimumReleaseAge is not a number", () => {
    const result = checkReleaseAge({
      pnpm: { minimumReleaseAge: "72h" as unknown as number },
    });
    expect(result.ok).toBe(false);
  });
});
