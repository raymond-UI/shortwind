// Canonical recipe-body fingerprint inputs, shared by the registry sealer
// (@shortwind/catalog) and the CLI so a downloaded family's header sha can be
// verified against its body — they must hash identically or verification is
// impossible. The hashing itself stays in those adapters (core takes no Node
// built-ins, including node:crypto); only the security-relevant, pure inputs —
// the body normalization and the truncation width — live here so the two
// implementations can't drift.

// 16 hex chars = 64 bits. A 6-hex (24-bit) fingerprint is brute-forceable in
// seconds: an attacker can craft a tampered body that collides with the locked
// sha and pass `verify`. 64 bits puts a forged collision out of reach.
export const RECIPE_SHA_HEX_LENGTH = 16;

// The placeholder sha source recipes ship with before they're sealed. Content
// carrying it has no real fingerprint to verify against.
export const PLACEHOLDER_SHA = "000000";

// Normalize a recipe body before hashing so cosmetic differences (CRLF vs LF,
// trailing whitespace, trailing blank lines) don't change the fingerprint —
// the writer re-emits with a trailing newline, so two bodies that differ only
// there must hash identically.
export function normalizeRecipeBody(body: string): string {
  return body
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n+$/g, "");
}
