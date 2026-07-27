import { describe, expect, it, vi } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import type { Env } from "../src/env";
import {
  putArtifact,
  artifactKey,
  type ArtifactMeta,
} from "../src/r2";
import { currentArtifactKey } from "../../shared/src/artifact_keys";
import {
  lookupRoute,
  type CachedRoute,
  type ColdRouteSource,
} from "../src/kv";
import {
  handleRequest,
  type RouterDeps,
  type TokenValidator,
  type ColdAccountDomainSource,
} from "../src/router";

/**
 * Worker ACCOUNT-LEVEL custom-domain resolution (ADDITIVE branch).
 *
 * A request to a bound account domain resolves `<hostname>/<slug>` to the page
 * via the injected `coldAccountDomain(host, path)` cold source — but ONLY on a
 * subdomain miss, so the existing hot-path host/path resolution + KV-hit
 * discipline is untouched. Runs inside workerd against local miniflare R2 + KV.
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

// #232: version-INDEPENDENT route record — the served object is derived from
// accountId + pageId (`.../current.html`), not carried on the record.
function route(over: Partial<CachedRoute> = {}): CachedRoute {
  return {
    pageId: "page_40",
    accountId: "acct_40",
    lifecycle: "active",
    visibility: "public",
    ...over,
  };
}

const HTML = "<!doctype html><html><body>bound custom domain</body></html>";

async function seedArtifact(r: CachedRoute, html = HTML): Promise<void> {
  const m = meta({ accountId: r.accountId, pageId: r.pageId });
  await putArtifact(E, artifactKey(r.accountId, r.pageId, HASH), html, m);
  await putArtifact(E, currentArtifactKey(r.accountId, r.pageId), html, m);
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

describe("router: account-level custom-domain resolution", () => {
  it("resolves <hostname>/<slug> → the page and serves the artifact", async () => {
    const r = route();
    await seedArtifact(r);

    const coldAccountDomain = vi.fn<ColdAccountDomainSource>(
      async (host, path) =>
        host === "pages.mybrand.com" && path === "/price-calculator" ? r : null,
    );
    const coldRoute = vi.fn<ColdRouteSource>(async () => null);
    const d = deps({ coldRoute, coldAccountDomain });

    const res = await run(req("pages.mybrand.com", "/price-calculator"), d);

    expect(res.status).toBe(200);
    expect(await res.text()).toBe(HTML);
    // Consulted with BOTH host and path (the subdomain lookup missed).
    expect(coldAccountDomain).toHaveBeenCalledWith(
      "pages.mybrand.com",
      "/price-calculator",
    );
    // Cached under (host, path) → a repeat view is a KV hit.
    expect(
      await lookupRoute(E, "pages.mybrand.com", "/price-calculator"),
    ).not.toBeNull();
  });

  it("404s an unbound host / unknown slug", async () => {
    const coldAccountDomain = vi.fn<ColdAccountDomainSource>(async () => null);
    const d = deps({ coldAccountDomain });

    const res = await run(req("unbound.example.org", "/whatever"), d);
    expect(res.status).toBe(404);
    expect(coldAccountDomain).toHaveBeenCalledWith(
      "unbound.example.org",
      "/whatever",
    );
  });

  it("does NOT consult the account-domain resolver when host/path already resolves", async () => {
    const r = route({ pageId: "page_hit" });
    await seedArtifact(r);

    const coldRoute = vi.fn<ColdRouteSource>(async () => r);
    const coldAccountDomain = vi.fn<ColdAccountDomainSource>(async () => null);
    const d = deps({ coldRoute, coldAccountDomain });

    const res = await run(req("label.shortwind.app", "/"), d);

    expect(res.status).toBe(200);
    expect(coldRoute).toHaveBeenCalledTimes(1);
    expect(coldAccountDomain).not.toHaveBeenCalled();
  });

  it("behaves identically to before when no account-domain resolver is injected", async () => {
    const d = deps(); // no coldAccountDomain
    const res = await run(req("nope.example.com", "/x"), d);
    expect(res.status).toBe(404);
  });
});
