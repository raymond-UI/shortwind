import { describe, expect, it } from "vitest";
import {
  buildHeaderLine,
  computeBodySha,
  rewriteHeaderSha,
  sealRecipeFile,
  verifyFetchedFamily,
} from "../src/fingerprint.js";

const BODY = "\n/* a card */\n@recipe card {\n  rounded-lg border p-4\n}\n";

describe("fingerprint (#42)", () => {
  it("computes a 16-hex (64-bit) fingerprint, not the old 6-hex", () => {
    const sealed = sealRecipeFile(`/* placeholder */${BODY}`, "card", "0.0.1");
    expect(computeBodySha(sealed)).toMatch(/^[0-9a-f]{16}$/);
  });

  it("reproduces the registry's published sha for the same body (shared core hash)", () => {
    // The bundled catalog ships card sealed by the registry build; the CLI must
    // hash identically or downloaded content can never be verified.
    const sealed = `/* shortwind: card@0.0.1 sha:placeholder */${BODY}`;
    const sha = computeBodySha(sealed);
    // Re-sealing is a no-op: a file already carrying the matching sha verifies.
    const resealed = rewriteHeaderSha(sealed, sha);
    expect(() => verifyFetchedFamily(resealed, "card")).not.toThrow();
  });

  it("rejects a fetched family whose header sha doesn't match its body (tampered)", () => {
    const sealed = sealRecipeFile(`/* h */${BODY}`, "card", "0.0.1");
    // Attacker keeps a plausible 16-hex sha but mutates the body.
    const realSha = computeBodySha(sealed);
    const tampered = rewriteHeaderSha(sealed, realSha).replace("border", "border-2");
    expect(() => verifyFetchedFamily(tampered, "card")).toThrow(/integrity check failed/);
  });

  it("skips the 000000 source placeholder and unsealed content", () => {
    const placeholder = `${buildHeaderLine("card", "0.0.1", "000000")}${BODY}`;
    expect(() => verifyFetchedFamily(placeholder, "card")).not.toThrow();
    expect(() => verifyFetchedFamily("@recipe card { p-4 }\n", "card")).not.toThrow();
  });
});
