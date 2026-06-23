import { describe, expect, it } from "vitest";
import { resolveProxyTarget, ALLOWED_PREFIXES } from "./proxy.js";

/**
 * Unit tests for the API-proxy routing decision (the pure core). The fetch
 * plumbing itself (one `new Request` + `fetch`) is thin adapter IO and is
 * exercised live, not here — CLAUDE.md keeps Worker adapters light on coverage.
 * What MUST be locked down is the allow-list: the public surface forwards, and
 * the Worker-only `/internal/*` cold-source endpoints are never reachable from
 * the branded public origin.
 */

const BASE = "https://prestigious-shrimp-154.convex.site";

describe("resolveProxyTarget", () => {
  it("forwards each public prefix, preserving path + query", () => {
    expect(resolveProxyTarget("https://api.shortwind.dev/v1/pages", BASE)).toEqual({
      ok: true,
      url: `${BASE}/v1/pages`,
    });
    expect(
      resolveProxyTarget("https://api.shortwind.dev/v1/pages?q=hi&tag=a&tag=b", BASE),
    ).toEqual({ ok: true, url: `${BASE}/v1/pages?q=hi&tag=a&tag=b` });
    expect(
      resolveProxyTarget("https://api.shortwind.dev/oauth/device/code", BASE),
    ).toEqual({ ok: true, url: `${BASE}/oauth/device/code` });
    expect(
      resolveProxyTarget(
        "https://api.shortwind.dev/.well-known/oauth-authorization-server",
        BASE,
      ),
    ).toEqual({
      ok: true,
      url: `${BASE}/.well-known/oauth-authorization-server`,
    });
  });

  it("BLOCKS the Worker-only /internal/* cold-source endpoints", () => {
    for (const path of [
      "/internal/resolve",
      "/internal/validate-token",
      "/internal/resolve-custom?host=x",
    ]) {
      expect(resolveProxyTarget(`https://api.shortwind.dev${path}`, BASE)).toEqual({
        ok: false,
        reason: "not_allowed",
      });
    }
  });

  it("blocks anything outside the public surface (root, docs paths, near-misses)", () => {
    for (const path of ["/", "/admin", "/v1", "/oauthx", "/.well-knownx"]) {
      expect(resolveProxyTarget(`https://api.shortwind.dev${path}`, BASE)).toEqual({
        ok: false,
        reason: "not_allowed",
      });
    }
  });

  it("is closed-by-default when CONVEX_HTTP_URL is unset", () => {
    expect(resolveProxyTarget("https://api.shortwind.dev/v1/pages", "")).toEqual({
      ok: false,
      reason: "not_configured",
    });
  });

  it("trims trailing slashes on the configured base", () => {
    expect(
      resolveProxyTarget("https://api.shortwind.dev/v1/pages", `${BASE}//`),
    ).toEqual({ ok: true, url: `${BASE}/v1/pages` });
  });

  it("the allow-list never includes /internal", () => {
    expect([...ALLOWED_PREFIXES]).not.toContain("/internal/");
  });
});
