/**
 * RFC 8628 device-authorization grant — PURE decision logic (no Convex, no IO).
 *
 * Why this exists at all: `@convex-dev/better-auth`'s registry component ships a
 * FIXED adapter schema with no `deviceCode` model, so Better Auth's own
 * device-authorization plugin 500s on every request (it cannot persist a device
 * code). Rather than switch the whole auth layer to local-install mode AND
 * rewrite the CLI/discovery off the `/oauth/*` paths they already use, we
 * implement the grant natively: the CLI + discovery contract
 * (`/oauth/device/code`, `/oauth/token`, RFC field names) stays byte-identical,
 * and approval mints a scoped `swc_` token via `tokens.issueToken` — the bearer
 * the rest of the system already understands.
 *
 * Per CLAUDE.md the decision logic is pure and unit-tested here; `convex/device.ts`
 * is the thin Convex shell (table IO) and `convex/http.ts` the RFC wire layer.
 */

/** Lifecycle of a device code (mirrors the `deviceCodes.status` schema union). */
export type DeviceStatus = "pending" | "approved" | "denied" | "consumed";

/**
 * Unambiguous user-code alphabet: A–Z + 2–9, minus look-alikes (0/O, 1/I/L).
 * Short codes are human-typed, so legibility beats raw entropy (the real gate is
 * the authenticated human approval; codes are single-use + short-lived).
 */
export const USER_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** User-code length (8 chars ≈ 40 bits over the 31-char alphabet). */
export const USER_CODE_LENGTH = 8;

/** Device-code secret length in bytes (256 bits, like an `swc_` token body). */
export const DEVICE_CODE_BYTES = 32;

/**
 * Generate the opaque `device_code` secret the CLI holds and polls with.
 * 43-char base64url (no prefix). Pure relative to the injected randomness.
 */
export function generateDeviceCode(
  randomBytes: (n: number) => Uint8Array = (n) =>
    crypto.getRandomValues(new Uint8Array(n)),
): string {
  const bytes = randomBytes(DEVICE_CODE_BYTES);
  let bin = "";
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Generate the short human `user_code` (normalized, no separator). Pure relative
 * to the injected randomness. Display formatting (the `ABCD-EFGH` hyphen) is a
 * presentation concern handled at the edge, not stored.
 */
export function generateUserCode(
  randomBytes: (n: number) => Uint8Array = (n) =>
    crypto.getRandomValues(new Uint8Array(n)),
): string {
  const bytes = randomBytes(USER_CODE_LENGTH);
  let out = "";
  for (let i = 0; i < USER_CODE_LENGTH; i++) {
    out += USER_CODE_ALPHABET[bytes[i] % USER_CODE_ALPHABET.length];
  }
  return out;
}

/**
 * Normalize a user-entered code for lookup: uppercase, drop everything outside
 * the alphabet (hyphens, spaces, lowercase). So `abcd-efgh` and `ABCD EFGH` both
 * match the stored `ABCDEFGH`.
 */
export function normalizeUserCode(input: string): string {
  if (typeof input !== "string") return "";
  const upper = input.toUpperCase();
  let out = "";
  for (const ch of upper) {
    if (USER_CODE_ALPHABET.includes(ch)) out += ch;
  }
  return out;
}

/** Insert the display hyphen at the midpoint (`ABCDEFGH` → `ABCD-EFGH`). */
export function formatUserCode(code: string): string {
  const mid = Math.floor(code.length / 2);
  return `${code.slice(0, mid)}-${code.slice(mid)}`;
}

/** The minimal device-code shape the poll verdict needs (a subset of the row). */
export interface DeviceCodeRecord {
  status: DeviceStatus;
  expiresAt: number;
  lastPolledAt: number | null;
  pollingInterval: number;
  accountId: string | null;
}

/**
 * The verdict for one token-endpoint poll. `approved` carries the account whose
 * scoped token should be minted; `slow_down` means the client polled faster than
 * `pollingInterval`; the rest map to RFC 8628 §3.5 error codes at the wire.
 */
export type PollVerdict =
  | { state: "approved"; accountId: string }
  | { state: "pending" }
  | { state: "slow_down" }
  | { state: "denied" }
  | { state: "expired" }
  | { state: "consumed" };

/**
 * Decide what a poll of `record` at `now` yields. Pure. Precedence:
 *   consumed (already redeemed) → expired (past TTL) → denied → too-fast poll
 *   (slow_down) → approved (with account) → pending.
 * A `pending`/`approved` record that has expired is `expired`; a consumed one is
 * always `consumed` (single-use) so a replayed device_code can't re-mint.
 */
export function pollVerdict(
  record: DeviceCodeRecord,
  now: number,
): PollVerdict {
  if (record.status === "consumed") return { state: "consumed" };
  if (now >= record.expiresAt) return { state: "expired" };
  if (record.status === "denied") return { state: "denied" };
  if (
    record.lastPolledAt !== null &&
    now - record.lastPolledAt < record.pollingInterval
  ) {
    return { state: "slow_down" };
  }
  if (record.status === "approved") {
    // An approved code with no account is a bug; treat defensively as pending.
    if (record.accountId === null) return { state: "pending" };
    return { state: "approved", accountId: record.accountId };
  }
  return { state: "pending" };
}
