/**
 * CLOUD-33 — publish-time content scanning (PRD §8.2 / §8.4).
 *
 * Three PURE, injectable scan primitives the publish path runs after auth, BEFORE
 * the page is created. They move trust-&-safety from a purely reactive posture
 * (act only on a report / actual knowledge) to a proactive one (PRD §8.2):
 *
 *   hashMatch         — proactive known-CSAM hash-list matching. Hash the incoming
 *                       artifact and compare against an injectable list of known
 *                       hashes. A hit MUST block publish and drive the CLOUD-32
 *                       kill seam (`killPage({category:'csam'})`). The real
 *                       NCMEC/industry list is wired at deploy (CLOUD-30b); here
 *                       the list is a pluggable source + a test list.
 *   classifyContent   — a configurable publish-time classifier (phishing / malware
 *                       / abuse heuristics) scored over the HTML. This is the
 *                       reusable content-scoring seam (PRD §8.4 "prior
 *                       probabilistic prompt-injection / content-scoring work is
 *                       reusable"), gated by a configurable threshold — NOT a full
 *                       ML model. `block` rejects the publish; `review` allows but
 *                       flags for human review.
 *   domainReputation  — a pluggable domain-reputation check for custom-domain /
 *                       outbound-link checks (PRD §8.4 domain-reputation at
 *                       publish). Stub here; the real provider is wired at deploy.
 *
 * Everything in this module is a pure function over plain data (no Convex, no IO),
 * mirroring the codebase rule (moderation.ts / publish-core.ts): the DECISION
 * logic is pure + unit-tested; the thin Convex adapter (pages.ts publish hook) is
 * the only IO. The hash digest uses the Web Crypto `crypto.subtle` available in
 * both the Convex runtime and the convex-test edge runtime.
 */

// ---------------------------------------------------------------------------
// Known-CSAM hash matching (PRD §8.2 proactive hash-matching).
// ---------------------------------------------------------------------------

/**
 * The abuse category a hash-list match carries. A known-CSAM list match is, by
 * construction, `csam` — it drives the CLOUD-32 `killPage({category:'csam'})`
 * seam (the 60-day NCMEC preservation clock). Other industry hash lists could be
 * added later behind the same interface with a different category.
 */
export type HashMatchCategory = "csam";

/**
 * A pluggable known-hash source. The real integration (NCMEC / industry hash
 * lists) is wired at deploy (CLOUD-30b) behind THIS interface; offline + in tests
 * it is an in-memory set. Kept abstract so the publish path never imports a
 * concrete provider and the list can be swapped without touching the hook.
 *
 * `id` identifies the list for the audit trail (which list produced the hit).
 * `has(hash)` answers membership for a lowercased hex digest.
 */
export interface KnownHashList {
  /** Stable identifier for the list (recorded on the moderation case / audit). */
  id: string;
  /** Membership test for a lowercase hex digest. */
  has(hash: string): boolean | Promise<boolean>;
}

/** The result of a hash-list check. A `match` MUST block publish. */
export interface HashMatchResult {
  match: boolean;
  /** The list that produced the hit (for audit), present only on a match. */
  listId?: string;
  /** Always `csam` for a known-CSAM list hit (drives the CLOUD-32 kill seam). */
  category: HashMatchCategory;
  /** The computed digest of the artifact (lowercase hex), surfaced for audit. */
  hash: string;
}

/** Build an in-memory {@link KnownHashList} from a set of known hex digests. */
export function makeHashList(id: string, hashes: Iterable<string>): KnownHashList {
  const set = new Set<string>();
  for (const h of hashes) set.add(h.trim().toLowerCase());
  return { id, has: (hash) => set.has(hash) };
}

/**
 * Compute the SHA-256 hex digest of an artifact. Accepts either the raw bytes /
 * string OR a pre-computed digest (so a caller that already fingerprinted the
 * artifact can pass the hash straight through). A 64-char lowercase hex string is
 * treated as an already-computed digest and returned as-is.
 */
export async function digestArtifact(
  artifactBytesOrHash: string | Uint8Array | ArrayBuffer,
): Promise<string> {
  if (typeof artifactBytesOrHash === "string" && isHexDigest(artifactBytesOrHash)) {
    return artifactBytesOrHash.toLowerCase();
  }
  const bytes = toBytes(artifactBytesOrHash);
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  return toHex(new Uint8Array(buf));
}

/**
 * Proactive hash-list match. Hash the incoming artifact (or take a pre-computed
 * digest) and test it against the known-CSAM list. A `match:true` result MUST
 * block the publish AND open a moderation case via the CLOUD-32 kill seam
 * (`killPage({category:'csam'})`) — that wiring lives in the pages.ts publish
 * hook; this function only decides.
 */
export async function hashMatch(
  artifactBytesOrHash: string | Uint8Array | ArrayBuffer,
  knownList: KnownHashList,
): Promise<HashMatchResult> {
  const hash = await digestArtifact(artifactBytesOrHash);
  const matched = await knownList.has(hash);
  return matched
    ? { match: true, listId: knownList.id, category: "csam", hash }
    : { match: false, category: "csam", hash };
}

// ---------------------------------------------------------------------------
// Content classifier (PRD §8.4 phishing / malware / abuse scoring).
// ---------------------------------------------------------------------------

/** The classifier verdict, gated off the score by the configured thresholds. */
export type ClassifyVerdict = "allow" | "review" | "block";

/** A single heuristic signal that fired, with the weight it contributed. */
export interface ClassifySignal {
  /** Stable signal name (e.g. `credential-harvest`, `obfuscated-script`). */
  name: string;
  /** The weight this signal added to the total score (>= 0). */
  weight: number;
}

/** The classifier result. `score` is the summed signal weight (clamped to 1). */
export interface ClassifyResult {
  score: number;
  verdict: ClassifyVerdict;
  signals: ClassifySignal[];
}

/**
 * The configurable scoring gate. `block` ≥ `review` ≥ 0; a score at/over the
 * `block` threshold rejects the publish, at/over `review` flags it for human
 * review, below `review` is allowed. Tuned at deploy (CLOUD-30b); the defaults
 * are sensible launch values.
 */
export interface ClassifyConfig {
  /** Score at/over which the publish is BLOCKED. Default 0.8. */
  block: number;
  /** Score at/over which the publish is FLAGGED for review. Default 0.4. */
  review: number;
}

export const DEFAULT_CLASSIFY_CONFIG: ClassifyConfig = { block: 0.8, review: 0.4 };

/**
 * A heuristic: a name, a matcher over the (lowercased) HTML, and the weight it
 * contributes when it fires. Kept as plain data so the rule set is configurable
 * and the scoring stays a clean, testable sum — the reusable content-scoring seam
 * (a real classifier swaps the rule set / weights, not the gate).
 */
export interface ClassifyHeuristic {
  name: string;
  weight: number;
  test: (html: string, lower: string) => boolean;
}

/**
 * The launch heuristic set (phishing / malware / abuse). Deliberately small and
 * explainable; CLOUD-30b can replace it with a probabilistic model behind the
 * same {@link classifyContent} signature. Weights sum so that a single strong
 * signal can block and two moderate signals reach review.
 */
export const DEFAULT_HEURISTICS: ClassifyHeuristic[] = [
  {
    name: "credential-harvest",
    weight: 0.5,
    test: (_h, l) =>
      /<input[^>]+type=["']?password/.test(l) &&
      /(verify|confirm|login|signin|sign-in|account|bank|wallet|seed phrase)/.test(l),
  },
  {
    name: "obfuscated-script",
    weight: 0.5,
    test: (_h, l) =>
      /eval\s*\(|atob\s*\(|fromcharcode|document\.write\s*\(\s*unescape/.test(l),
  },
  {
    name: "remote-payload",
    weight: 0.3,
    test: (_h, l) => /\.(exe|scr|jar|apk|dll|bat|msi)\b/.test(l),
  },
  {
    name: "brand-impersonation",
    weight: 0.3,
    test: (_h, l) =>
      /(paypal|apple\s*id|microsoft|coinbase|metamask|netflix)/.test(l) &&
      /(suspend|locked|verify your|unusual activity|reactivate)/.test(l),
  },
  {
    name: "meta-refresh-redirect",
    weight: 0.2,
    test: (_h, l) => /<meta[^>]+http-equiv=["']?refresh/.test(l),
  },
];

/**
 * Score the HTML against the heuristic set and gate the verdict off the
 * thresholds. Pure + deterministic: the same HTML + config always yields the same
 * verdict. The score is the summed weight of every fired signal, clamped to 1.
 */
export function classifyContent(
  html: string,
  config: ClassifyConfig = DEFAULT_CLASSIFY_CONFIG,
  heuristics: readonly ClassifyHeuristic[] = DEFAULT_HEURISTICS,
): ClassifyResult {
  const lower = html.toLowerCase();
  const signals: ClassifySignal[] = [];
  let raw = 0;
  for (const h of heuristics) {
    if (h.test(html, lower)) {
      signals.push({ name: h.name, weight: h.weight });
      raw += h.weight;
    }
  }
  const score = Math.min(1, raw);
  return { score, verdict: gateVerdict(score, config), signals };
}

/** Map a score to a verdict using the configured thresholds. */
export function gateVerdict(score: number, config: ClassifyConfig): ClassifyVerdict {
  if (score >= config.block) return "block";
  if (score >= config.review) return "review";
  return "allow";
}

// ---------------------------------------------------------------------------
// Domain reputation (PRD §8.4 domain-reputation checks at publish).
// ---------------------------------------------------------------------------

/** A domain-reputation verdict. `ok:false` carries a machine-readable reason. */
export interface DomainReputationResult {
  ok: boolean;
  reason?: string;
}

/**
 * A pluggable domain-reputation source. The real provider (a reputation feed /
 * blocklist API) is wired at deploy (CLOUD-30b) behind this interface; offline it
 * is an in-memory blocklist. `isBlocked` answers for a normalized hostname.
 */
export interface DomainReputationSource {
  isBlocked(domain: string): boolean | Promise<boolean>;
}

/** Build an in-memory {@link DomainReputationSource} from a blocklist. */
export function makeDomainBlocklist(blocked: Iterable<string>): DomainReputationSource {
  const set = new Set<string>();
  for (const d of blocked) set.add(normalizeDomain(d));
  return { isBlocked: (domain) => set.has(normalizeDomain(domain)) };
}

/**
 * Extract the distinct outbound link/resource hosts referenced by an HTML
 * artifact (the `href`/`src`/`action` targets with an absolute `http(s)` URL).
 * These are the domains a published page sends visitors or loads resources from,
 * so they are what a domain-reputation check must screen (#198 item 5 — the
 * publish scan never looked at outbound domains, so a page linking to a
 * known-bad phishing/malware host published clean). Pure + deterministic:
 * normalized, de-duped, order-stable. Relative/anchor/`mailto:`/`data:` URLs
 * carry no host and are skipped.
 */
export function extractOutboundHosts(html: string): string[] {
  const hosts: string[] = [];
  const seen = new Set<string>();
  // Match the URL inside href/src/action attributes (single, double, or unquoted).
  const attrRe = /(?:href|src|action)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  for (const m of html.matchAll(attrRe)) {
    const raw = (m[1] ?? m[2] ?? m[3] ?? "").trim();
    if (!/^https?:\/\//i.test(raw)) continue; // only absolute http(s) URLs have a host
    const host = normalizeDomain(raw);
    if (host.length === 0 || seen.has(host)) continue;
    seen.add(host);
    hosts.push(host);
  }
  return hosts;
}

/**
 * Screen every outbound host in an artifact against the reputation source. The
 * FIRST blocklisted host wins (the publish is blocked on it). `ok:true` when no
 * outbound host is blocklisted (the common case, incl. an empty source). Pure
 * over the injected source — the publish hook decides what to do with a hit.
 */
export async function screenOutboundHosts(
  html: string,
  source: DomainReputationSource = { isBlocked: () => false },
): Promise<{ ok: boolean; blockedHost?: string }> {
  for (const host of extractOutboundHosts(html)) {
    const verdict = await domainReputation(host, source);
    if (!verdict.ok) return { ok: false, blockedHost: host };
  }
  return { ok: true };
}

/**
 * Check a domain against the reputation source. Used for custom-domain binds and
 * outbound-link checks. A blocked domain → `{ ok:false, reason }`. The default
 * source (no blocklist) passes everything — the real feed is injected at deploy.
 */
export async function domainReputation(
  domain: string,
  source: DomainReputationSource = { isBlocked: () => false },
): Promise<DomainReputationResult> {
  const normalized = normalizeDomain(domain);
  if (normalized.length === 0) return { ok: false, reason: "empty_domain" };
  const blocked = await source.isBlocked(normalized);
  return blocked ? { ok: false, reason: "blocklisted" } : { ok: true };
}

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

/** Lowercase + strip a leading protocol / `www.` / trailing dots from a host. */
export function normalizeDomain(domain: string): string {
  return domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/^www\./, "")
    .replace(/\.+$/, "");
}

/** True when `s` is a 64-char lowercase/uppercase hex string (a SHA-256 digest). */
function isHexDigest(s: string): boolean {
  return /^[0-9a-fA-F]{64}$/.test(s);
}

function toBytes(input: string | Uint8Array | ArrayBuffer): Uint8Array {
  if (typeof input === "string") return new TextEncoder().encode(input);
  if (input instanceof Uint8Array) return input;
  return new Uint8Array(input);
}

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}
