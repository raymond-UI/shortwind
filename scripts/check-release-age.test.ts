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

// The CI workflow runs `pnpm check:release-age` directly against the repo
// root before any other security gate, so a regression that broke the script
// wrapper would fail the CI job — that's the end-to-end smoke test. We don't
// duplicate it as a vitest spawn here because the script intentionally reads
// the repo's own package.json (not a fixture), which makes process-spawn
// tests hard to isolate without rewriting the script.
