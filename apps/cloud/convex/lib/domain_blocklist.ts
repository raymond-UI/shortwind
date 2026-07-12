/**
 * #198 item 5 — the curated BASELINE outbound-domain blocklist (checked in).
 *
 * Known-bad phishing/malware hosts a published page must not link to / load from.
 * This lives in the repo (not env) BECAUSE it is curated reference data, not a
 * secret: keeping it here makes every add/remove reviewable in a PR (with a
 * reason), version-controlled, and testable against the exact list. The
 * `DOMAIN_BLOCKLIST` env var is kept as an ADDITIVE override
 * (`lib/scan_config.loadScanSources` unions the two) — a break-glass way to block
 * a host mid-incident without a PR; it never REPLACES this baseline.
 *
 * Curation policy:
 *   - one host per entry, bare (no scheme / path); `makeDomainBlocklist`
 *     normalizes case + strips `www.`/protocol, so `evil.com` covers
 *     `https://www.evil.com/x`.
 *   - every real addition should cite a source/reason in the PR that adds it.
 *
 * The entries below are illustrative PLACEHOLDERS on RFC 2606 reserved domains
 * (`.example`) so the mechanism is exercised end-to-end without asserting that
 * any real-world host is malicious. Replace them with curated threat-intel hosts.
 */
export const BASELINE_DOMAIN_BLOCKLIST: readonly string[] = [
  // --- placeholders (RFC 2606 reserved) — replace with real curated entries ---
  "phishing.example",
  "malware.example.com",
];
