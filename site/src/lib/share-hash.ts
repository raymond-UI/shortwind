// URL-hash sharing for the playground. Ported verbatim from the old site so
// existing /playground#share=… links keep working.

function toBase64(utf8: string): string {
  // Round-trip via TextEncoder so unicode survives base64.
  if (typeof btoa !== "undefined" && typeof TextEncoder !== "undefined") {
    const bytes = new TextEncoder().encode(utf8);
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
    return btoa(bin);
  }
  return Buffer.from(utf8, "utf8").toString("base64");
}

function fromBase64(b64: string): string {
  if (typeof atob !== "undefined" && typeof TextDecoder !== "undefined") {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  return Buffer.from(b64, "base64").toString("utf8");
}

export function encodeShareHash(input: string): string {
  return "share=" + toBase64(input);
}

// 50 KB encoded ceiling — above any hand-typed snippet, below the multi-MB
// inputs that would freeze expand() in the tab.
export const MAX_SHARE_HASH_BYTES = 50 * 1024;

export function decodeShareHash(hash: string): string | null {
  const m = hash.match(/share=([^&]+)/);
  if (!m) return null;
  const payload = m[1]!;
  if (payload.length > MAX_SHARE_HASH_BYTES) return null;
  try {
    return fromBase64(payload);
  } catch {
    return null;
  }
}

export function readShareHash(): string | null {
  if (typeof window === "undefined") return null;
  const hash = window.location.hash.replace(/^#/, "");
  return decodeShareHash(hash);
}
