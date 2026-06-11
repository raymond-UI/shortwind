import { createHash } from "node:crypto";
import {
  normalizeRecipeBody,
  PLACEHOLDER_SHA,
  RECIPE_SHA_HEX_LENGTH,
} from "@shortwind/core";

// Accept either the canonical short form or the legacy em-dash trailer
// `— DO NOT EDIT THIS LINE`. The two-hyphen ASCII variant (`-- DO NOT…`) is
// rejected on purpose: writeFamily has never emitted it, so accepting it would
// let hand-edited files silently round-trip into the canonical form.
const HEADER_PATTERN = /^\/\*\s*shortwind:\s+(\S+)@(\S+)\s+sha:([^\s*]+)(?:\s+—\s+DO NOT EDIT THIS LINE)?\s*\*\/\s*$/;

export type RecipeHeader = {
  family: string;
  version: string;
  sha: string;
};

export function extractHeader(source: string): RecipeHeader | null {
  const eol = source.indexOf("\n");
  const firstLine = (eol === -1 ? source : source.slice(0, eol)).replace(/\r$/, "");
  const m = firstLine.match(HEADER_PATTERN);
  if (!m) return null;
  // All three capture groups are guaranteed non-empty when the regex matches
  // (the pattern uses `\S+`/`[^\s*]+`); the `!` asserts what the regex shape
  // already requires so we don't paper over an impossible-null with "".
  return { family: m[1]!, version: m[2]!, sha: m[3]! };
}

export function bodyAfterHeader(source: string): string {
  const eol = source.indexOf("\n");
  return eol === -1 ? "" : source.slice(eol + 1);
}

export function computeBodySha(source: string): string {
  // Normalization and width come from core (RECIPE_SHA_HEX_LENGTH), shared with
  // the registry sealer so a downloaded family's header sha can be verified
  // against its body. Previously this truncated to 6 hex (24 bits) — forgeable
  // by brute force in seconds — and normalized differently from the registry,
  // so the two could never agree.
  const normalized = normalizeRecipeBody(bodyAfterHeader(source));
  return createHash("sha256").update(normalized).digest("hex").slice(0, RECIPE_SHA_HEX_LENGTH);
}

// A fingerprint written by an older CLI (the 6-hex / 24-bit form), as opposed to
// the current 16-hex form or the `000000` placeholder. Used to give projects
// sealed before the width change a "run `shortwind reseal`" message instead of a
// false "tampered" — the body is fine, only the seal format is stale.
export function isLegacyFingerprint(sha: string): boolean {
  return (
    sha !== PLACEHOLDER_SHA &&
    sha.length < RECIPE_SHA_HEX_LENGTH &&
    /^[0-9a-f]+$/.test(sha)
  );
}

// Verify a family fetched from a registry before trusting/resealing its bytes.
// A built registry seals each family with a real content sha; if the header sha
// doesn't match the body we recompute, the response was tampered with or
// corrupted in transit (integrity is otherwise TLS-only). Unsealed content and
// the `000000` source placeholder have no real fingerprint, so they pass.
export function verifyFetchedFamily(source: string, family: string): void {
  const header = extractHeader(source);
  if (!header || header.sha === PLACEHOLDER_SHA) return;
  // The header's family name is also part of the seal: a registry serving
  // `button.css` in response to a request for `card` is a mismatch even if its
  // own sha is internally consistent.
  if (header.family !== family) {
    throw new Error(
      `integrity check failed for "${family}": registry returned a recipe sealed as "${header.family}" — wrong family or a tampered/corrupted response`,
    );
  }
  const actual = computeBodySha(source);
  if (header.sha !== actual) {
    throw new Error(
      `integrity check failed for "${family}": header sha ${header.sha} does not match content sha ${actual} — the registry response was tampered with or corrupted in transit`,
    );
  }
}

export function buildHeaderLine(family: string, version: string, sha: string): string {
  return `/* shortwind: ${family}@${version} sha:${sha} — DO NOT EDIT THIS LINE */`;
}

export function rewriteHeaderSha(source: string, sha: string): string {
  const header = extractHeader(source);
  if (!header) return source;
  const newHeader = buildHeaderLine(header.family, header.version, sha);
  const eol = source.indexOf("\n");
  if (eol === -1) return newHeader;
  return newHeader + source.slice(eol);
}

export function sealRecipeFile(source: string, family: string, version: string): string {
  const sha = computeBodySha(source);
  const header = buildHeaderLine(family, version, sha);
  const eol = source.indexOf("\n");
  const rest = eol === -1 ? "" : source.slice(eol);
  return header + rest;
}
