import { describe, expect, it } from "vitest";
import {
  bodyAfterHeader,
  computeBodySha,
  extractHeader,
  isTouched,
  selectTouchedRecipes,
} from "./fingerprint.js";

// The canonical recipe body the CLI fingerprint test (packages/cli/test/
// fingerprint.test.ts) hashes (its `BODY` const, verbatim). Re-used so the
// shared port is provably hashing the same bytes — same input -> same sha
// across the two codebases.
const BODY = "\n/* a card */\n@recipe card {\n  rounded-lg border p-4\n}\n";

// Golden sha for `/* header */${BODY}` under the shared core normalization +
// SHA-256 truncated to RECIPE_SHA_HEX_LENGTH (16). Independently computed with
// node:crypto over @shortwind/core's `normalizeRecipeBody` (the exact algorithm
// packages/cli/src/fingerprint.ts uses) — the cloud port must reproduce it, or
// a family edited via the CLI and one detected cloud-side would disagree.
const GOLDEN_BODY_SHA = "f78c8c690cd730e3";

describe("fingerprint port (CLOUD-03)", () => {
  it("extractHeader parses the canonical sealed header line", () => {
    const sealed = `/* shortwind: card@0.5.0 sha:deadbeefdeadbeef — DO NOT EDIT THIS LINE */${BODY}`;
    expect(extractHeader(sealed)).toEqual({
      family: "card",
      version: "0.5.0",
      sha: "deadbeefdeadbeef",
    });
  });

  it("extractHeader accepts the short (no-trailer) header and rejects junk", () => {
    expect(extractHeader(`/* shortwind: card@0.5.0 sha:abc123 */${BODY}`)).toEqual({
      family: "card",
      version: "0.5.0",
      sha: "abc123",
    });
    expect(extractHeader("/* not a header */\n@recipe card { p-4 }\n")).toBeNull();
    expect(extractHeader("@recipe card { p-4 }\n")).toBeNull();
  });

  it("bodyAfterHeader drops only the first line", () => {
    expect(bodyAfterHeader("HEADER\nrest\nmore")).toBe("rest\nmore");
    expect(bodyAfterHeader("single-line")).toBe("");
  });

  it("computeBodySha yields a 16-hex sha matching the CLI hash on a shared body", async () => {
    const sealed = `/* shortwind: card@0.0.1 sha:000000 */${BODY}`;
    const sha = await computeBodySha(sealed);
    expect(sha).toMatch(/^[0-9a-f]{16}$/);
    // Parity with the CLI fingerprint implementation (golden cross-checked).
    expect(sha).toBe(GOLDEN_BODY_SHA);
  });

  it("computeBodySha is normalization-stable (CRLF / trailing ws / blank lines)", async () => {
    const a = `/* shortwind: card@0.0.1 sha:000000 */\n@recipe card {\n  p-4\n}\n`;
    const b = `/* shortwind: card@0.0.1 sha:000000 */\r\n@recipe card {  \r\n  p-4   \r\n}\r\n\r\n\r\n`;
    expect(await computeBodySha(a)).toBe(await computeBodySha(b));
  });

  it("isTouched: false when header sha matches the body, true when it diverges", async () => {
    const sealed = `/* shortwind: card@0.0.1 sha:000000 */${BODY}`;
    const realSha = await computeBodySha(sealed);
    const sealedReal = `/* shortwind: card@0.0.1 sha:${realSha} */${BODY}`;
    expect(await isTouched({ source: sealedReal })).toBe(false);

    // Body mutated after sealing -> header sha is now stale -> touched.
    const tampered = sealedReal.replace("border", "border-2");
    expect(await isTouched({ source: tampered })).toBe(true);
  });

  it("isTouched: unsealed content and the 000000 placeholder are NOT touched", async () => {
    // No header at all -> nothing to diverge from -> not a touched edit.
    expect(await isTouched({ source: "@recipe card { p-4 }\n" })).toBe(false);
    // Placeholder sha -> never sealed -> not a touched edit.
    expect(await isTouched({ source: `/* shortwind: card@0.0.1 sha:000000 */${BODY}` })).toBe(
      false,
    );
  });

  it("isTouched accepts pre-extracted { headerSha, body } plain data", async () => {
    // Oracle: hashing `\nBODY` as a sealed file (header = empty first line) strips
    // that first line, leaving exactly BODY — so its sha is the body-only sha.
    const bodyOnlySha = await computeBodySha(`\n${BODY}`);
    expect(await isTouched({ headerSha: bodyOnlySha, family: "card", body: BODY })).toBe(false);
    expect(await isTouched({ headerSha: "ffffffffffffffff", family: "card", body: BODY })).toBe(
      true,
    );
  });

  it("selectTouchedRecipes returns the touched subset, keyed by family, sorted", async () => {
    const sealed = `/* shortwind: card@0.0.1 sha:000000 */${BODY}`;
    const cardSha = await computeBodySha(sealed);
    const cleanCard = `/* shortwind: card@0.0.1 sha:${cardSha} */${BODY}`;
    const touchedButton = `/* shortwind: button@0.0.1 sha:0000ffff0000ffff */\n@recipe button {\n  px-3\n}\n`;
    const touchedAlert = `/* shortwind: alert@0.0.1 sha:1111111111111111 */\n@recipe alert {\n  bg-red-100\n}\n`;

    const touched = await selectTouchedRecipes([
      { family: "card", source: cleanCard },
      { family: "button", source: touchedButton },
      { family: "alert", source: touchedAlert },
    ]);

    expect(touched.map((r) => r.family)).toEqual(["alert", "button"]);
    // Each carries the recomputed body sha (so a publish can record the new seal).
    for (const r of touched) {
      expect(r.bodySha).toMatch(/^[0-9a-f]{16}$/);
      expect(r.bodySha).not.toBe(r.headerSha);
    }
  });
});
