// @vitest-environment edge-runtime
import { describe, expect, it } from "vitest";
import {
  classifyContent,
  DEFAULT_CLASSIFY_CONFIG,
  digestArtifact,
  domainReputation,
  gateVerdict,
  hashMatch,
  makeDomainBlocklist,
  makeHashList,
  normalizeDomain,
  type ClassifyHeuristic,
} from "./content-scan.js";

/**
 * CLOUD-33 — pure publish-time content-scan primitives (PRD §8.2/§8.4).
 *
 * `crypto.subtle` is needed for the SHA-256 digest, so this file runs under the
 * `edge-runtime` environment (same as the convex-test integration files).
 */

describe("hashMatch — proactive known-CSAM hash-list matching (PRD §8.2)", () => {
  it("matches a known artifact → blocks + reports the list + csam category", async () => {
    const artifact = "<html>known-bad-bytes</html>";
    const knownHash = await digestArtifact(artifact);
    const list = makeHashList("ncmec-test", [knownHash]);

    const res = await hashMatch(artifact, list);
    expect(res.match).toBe(true);
    expect(res.listId).toBe("ncmec-test");
    expect(res.category).toBe("csam");
    expect(res.hash).toBe(knownHash);
  });

  it("passes an unknown artifact (no match → publish proceeds)", async () => {
    const list = makeHashList("ncmec-test", [
      // some unrelated known hash
      "0".repeat(64),
    ]);
    const res = await hashMatch("<html>totally fine</html>", list);
    expect(res.match).toBe(false);
    expect(res.listId).toBeUndefined();
    expect(res.category).toBe("csam");
  });

  it("accepts a pre-computed digest straight through (no re-hash)", async () => {
    const artifact = "abc";
    const digest = await digestArtifact(artifact);
    // Passing the 64-char hex digest returns it as-is, and matches the same list.
    const list = makeHashList("ncmec-test", [digest]);
    const res = await hashMatch(digest, list);
    expect(res.match).toBe(true);
    expect(res.hash).toBe(digest);
  });

  it("hashes deterministically (same bytes → same digest)", async () => {
    const a = await digestArtifact("repeatable");
    const b = await digestArtifact("repeatable");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("classifyContent — configurable phishing/malware classifier (PRD §8.4)", () => {
  it("allows benign content (score under the review threshold)", () => {
    const res = classifyContent("<h1>Hello world</h1><p>my blog</p>");
    expect(res.verdict).toBe("allow");
    expect(res.score).toBeLessThan(DEFAULT_CLASSIFY_CONFIG.review);
    expect(res.signals).toHaveLength(0);
  });

  it("blocks a credential-harvest + obfuscated-script page (score ≥ block)", () => {
    const html =
      '<form><input type="password" name="p"/>verify your bank account</form>' +
      "<script>eval(atob('...'))</script>";
    const res = classifyContent(html);
    expect(res.verdict).toBe("block");
    expect(res.score).toBeGreaterThanOrEqual(DEFAULT_CLASSIFY_CONFIG.block);
    expect(res.signals.map((s) => s.name)).toContain("credential-harvest");
    expect(res.signals.map((s) => s.name)).toContain("obfuscated-script");
  });

  it("flags a single moderate signal for review (review ≤ score < block)", () => {
    // One credential-harvest signal alone = 0.5 → review (≥0.4, <0.8).
    const html =
      '<form><input type="password"/>confirm your login</form>';
    const res = classifyContent(html);
    expect(res.verdict).toBe("review");
    expect(res.score).toBeGreaterThanOrEqual(DEFAULT_CLASSIFY_CONFIG.review);
    expect(res.score).toBeLessThan(DEFAULT_CLASSIFY_CONFIG.block);
  });

  it("threshold gate is configurable (a strict config blocks the same score)", () => {
    const html = '<form><input type="password"/>confirm your login</form>';
    const strict = classifyContent(html, { block: 0.5, review: 0.2 });
    expect(strict.verdict).toBe("block");
    const lax = classifyContent(html, { block: 0.9, review: 0.6 });
    expect(lax.verdict).toBe("allow");
  });

  it("gateVerdict maps scores to verdicts at the boundaries", () => {
    const cfg = { block: 0.8, review: 0.4 };
    expect(gateVerdict(0.0, cfg)).toBe("allow");
    expect(gateVerdict(0.39, cfg)).toBe("allow");
    expect(gateVerdict(0.4, cfg)).toBe("review");
    expect(gateVerdict(0.79, cfg)).toBe("review");
    expect(gateVerdict(0.8, cfg)).toBe("block");
    expect(gateVerdict(1.0, cfg)).toBe("block");
  });

  it("accepts a custom heuristic set (the reusable scoring seam)", () => {
    const heuristics: ClassifyHeuristic[] = [
      { name: "has-foo", weight: 1, test: (_h, l) => l.includes("foo") },
    ];
    const res = classifyContent("<p>FOO</p>", { block: 0.8, review: 0.4 }, heuristics);
    expect(res.verdict).toBe("block");
    expect(res.signals).toEqual([{ name: "has-foo", weight: 1 }]);
  });

  it("clamps the score to 1 even when many signals fire", () => {
    const html =
      '<form><input type="password"/>verify your bank account</form>' +
      "<script>eval(atob('x'))</script>" +
      "payload.exe" +
      '<meta http-equiv="refresh" content="0">';
    const res = classifyContent(html);
    expect(res.score).toBeLessThanOrEqual(1);
  });
});

describe("domainReputation — pluggable domain-reputation check (PRD §8.4)", () => {
  it("passes a domain with the default (empty) source", async () => {
    const res = await domainReputation("example.com");
    expect(res.ok).toBe(true);
    expect(res.reason).toBeUndefined();
  });

  it("blocks a blocklisted domain with a reason", async () => {
    const source = makeDomainBlocklist(["evil.test", "phish.example"]);
    const res = await domainReputation("https://www.evil.test/path", source);
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("blocklisted");
  });

  it("rejects an empty domain", async () => {
    const res = await domainReputation("   ");
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("empty_domain");
  });

  it("normalizes hosts (protocol / www / trailing dot stripped, lowercased)", () => {
    expect(normalizeDomain("HTTPS://WWW.Example.COM/x")).toBe("example.com");
    expect(normalizeDomain("foo.bar.")).toBe("foo.bar");
  });
});
