/**
 * #198 items 1 & 5 — config-driven activation of the publish-scan data sources.
 *
 * The scan SEAMS (known-CSAM hash matching, outbound-domain reputation) have
 * always been wired into the publish path (convex/pages.ts `runPublishScan`);
 * what was missing was a real DATA source behind them — offline they default to
 * "match nothing", so they could never fire in prod. This module loads those
 * sources from the Convex deployment env, exactly like the R2/Cloudflare creds
 * (`npx convex env set`), so an operator activates them without a code change:
 *
 *   - `CSAM_HASHLIST`      — whitespace/comma/newline-separated known-CSAM SHA-256
 *                            hex digests (the industry/NCMEC list, loaded once).
 *   - `CSAM_HASHLIST_ID`   — optional label for the list (audit trail); default
 *                            `"configured"`.
 *   - `DOMAIN_BLOCKLIST`   — whitespace/comma/newline-separated known-bad hosts
 *                            (phishing/malware) an outbound link must not target.
 *
 * Absent env ⇒ the safe offline posture (empty sources that match nothing), so
 * dev/test behaves exactly as before. Loaded ONCE at module init (see
 * convex/pages.ts) — not per publish — so it never races concurrent actions.
 *
 * Scale note: an inline env list is the launch mechanism (fine for a curated
 * blocklist + an operator-loaded hash set). A large, frequently-refreshed feed
 * (e.g. a hosted PhotoDNA/NCMEC list pulled over HTTP with a TTL) is a follow-up
 * behind these SAME `KnownHashList` / `DomainReputationSource` interfaces — the
 * publish path does not change, only the source construction here.
 */

import {
  makeDomainBlocklist,
  makeHashList,
  type DomainReputationSource,
  type KnownHashList,
} from "./content_scan.js";

/**
 * Minimal `process.env` accessor (this workspace types against
 * `@cloudflare/workers-types`, no Node `process`). Declared as the slice read.
 */
declare const process: { env: Record<string, string | undefined> };

/** The scan sources shape this module produces (mirrors pages.ts `ScanSources`). */
export interface LoadedScanSources {
  hashList: KnownHashList;
  domainSource: DomainReputationSource;
}

/** Split a whitespace/comma/newline-separated env list into trimmed entries. */
export function splitList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Build the production scan sources from the deployment env. Returns match-
 * nothing sources when the corresponding env var is absent/empty (the safe
 * offline default), so this is a no-op in dev/test.
 */
export function loadScanSources(
  env: Record<string, string | undefined> = process.env,
): LoadedScanSources {
  const hashes = splitList(env.CSAM_HASHLIST);
  const blocked = splitList(env.DOMAIN_BLOCKLIST);
  return {
    hashList:
      hashes.length > 0
        ? makeHashList(env.CSAM_HASHLIST_ID ?? "configured", hashes)
        : { id: "ncmec", has: () => false },
    domainSource:
      blocked.length > 0
        ? makeDomainBlocklist(blocked)
        : { isBlocked: () => false },
  };
}
