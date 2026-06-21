import { describe, expect, it, vi } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import type { Env } from "../src/env";
import { putArtifact, artifactKey, type ArtifactMeta } from "../src/r2";
import {
  lookupRoute,
  type CachedRoute,
  type ColdRouteSource,
} from "../src/kv";
import {
  handleRequest,
  type RouterDeps,
  type TokenValidator,
  type ColdCustomHostnameSource,
} from "../src/router";

/**
 * CLOUD-40 — worker custom-hostname resolution (ADDITIVE branch).
 *
 * A request to a bound custom hostname (pages.customDomain) resolves to the page
 * via the injected `coldCustomHostname` cold source — but ONLY on a host/path
 * miss, so the existing hot-path host/path resolution + KV-hit discipline is
 * untouched. Runs inside workerd against local miniflare R2 + KV (no live creds).
 */
const E = env as unknown as Env;

const HASH = "deadbeefcafe4040";

function meta(over: Partial<ArtifactMeta> = {}): ArtifactMeta {
  return {
    expandedHash: HASH,
    version: 1,
    accountId: "acct_40",
    pageId: "page_40",
    ...over,
  };
}

function route(over: Partial<CachedRoute> = {}): CachedRoute {
  return {
    pageId: "page_40",
    accountId: "acct_40",
    version: 1,
    artifactKey: artifactKey("acct_40", "page_40", HASH),
    lifecycle: "active",
    visibility: "public",
    ...over,
  };
}

const HTML = "<!doctype html><html><body>bound custom domain</body></html>";

async function seedArtifact(r: CachedRoute, html = HTML): Promise<void> {
  await putArtifact(E, r.artifactKey, html, meta());
}

function deps(over: Partial<RouterDeps> = {}): RouterDeps {
  return {
    coldRoute: vi.fn<ColdRouteSource>(async () => null),
    validateToken: vi.fn<TokenValidator>(async () => false),
    ...over,
  };
}

function req(host: string, path: string, headers?: Record<string, string>): Request {
  return new Request(`https://${host}${path}`, { headers });
}

async function run(request: Request, d: RouterDeps) {
  const ctx = createExecutionContext();
  const res = await handleRequest(request, E, ctx, d);
  await waitOnExecutionContext(ctx);
  return res;
}

describe("CLOUD-40 router: custom-hostname resolution", () => {
  it("resolves a bound custom hostname → the page and serves the artifact", async () => {
    const r = route();
    await seedArtifact(r);

    const coldCustomHostname = vi.fn<ColdCustomHostnameSource>(async (host) =>
      host === "mybrand.com" ? r : null,
    );
    const coldRoute = vi.fn<ColdRouteSource>(async () => null);
    const d = deps({ coldRoute, coldCustomHostname });

    const res = await run(req("mybrand.com", "/"), d);

    expect(res.status).toBe(200);
    expect(await res.text()).toBe(HTML);
    // The custom-hostname resolver WAS consulted (the host/path lookup missed).
    expect(coldCustomHostname).toHaveBeenCalledWith("mybrand.com");
    // The resolved route was cached in KV → a repeat view is a KV hit.
    expect(await lookupRoute(E, "mybrand.com", "/")).not.toBeNull();
  });

  it("404s an unbound custom hostname (no page maps to it)", async () => {
    const coldCustomHostname = vi.fn<ColdCustomHostnameSource>(async () => null);
    const d = deps({ coldCustomHostname });

    const res = await run(req("unbound.example.org", "/"), d);
    expect(res.status).toBe(404);
    expect(coldCustomHostname).toHaveBeenCalledWith("unbound.example.org");
  });

  it("does NOT consult the custom-hostname resolver when host/path already resolves (hot-path untouched)", async () => {
    const r = route({ pageId: "page_hit" });
    await seedArtifact(r);

    const coldRoute = vi.fn<ColdRouteSource>(async () => r);
    const coldCustomHostname = vi.fn<ColdCustomHostnameSource>(async () => null);
    const d = deps({ coldRoute, coldCustomHostname });

    const res = await run(req("regular.example.com", "/p"), d);

    expect(res.status).toBe(200);
    // The standard cold route resolved → the custom-hostname branch is skipped.
    expect(coldRoute).toHaveBeenCalledTimes(1);
    expect(coldCustomHostname).not.toHaveBeenCalled();
  });

  it("behaves identically to before when no custom-hostname resolver is injected", async () => {
    const d = deps(); // no coldCustomHostname
    const res = await run(req("nope.example.com", "/"), d);
    expect(res.status).toBe(404);
  });
});
