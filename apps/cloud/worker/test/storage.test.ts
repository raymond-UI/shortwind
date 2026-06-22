import { describe, expect, it, vi } from "vitest";
import { env } from "cloudflare:test";
import type { Env } from "../src/env";
import {
  artifactKey,
  getArtifact,
  putArtifact,
  type ArtifactMeta,
} from "../src/r2";
import {
  lookupRoute,
  putRoute,
  resolveRouteWithFallback,
  routeKey,
  type CachedRoute,
  type ColdRouteSource,
} from "../src/kv";
import { cacheArtifactResponse, invalidateRoute } from "../src/cache";

// CLOUD-21 storage tests. These run INSIDE workerd via
// @cloudflare/vitest-pool-workers against LOCAL miniflare R2 + KV bindings
// declared in worker/wrangler.toml ([[r2_buckets]] ARTIFACTS, [[kv_namespaces]]
// ROUTES). No live Cloudflare creds. `env` is the typed binding object miniflare
// injects; we cast it to our `Env` shape.
const E = env as unknown as Env;

const META: ArtifactMeta = {
  expandedHash: "deadbeefcafe0001",
  version: 3,
  accountId: "acct_123",
  pageId: "page_abc",
};

function sampleRoute(over: Partial<CachedRoute> = {}): CachedRoute {
  return {
    pageId: "page_abc",
    accountId: "acct_123",
    version: 3,
    artifactKey: artifactKey("acct_123", "page_abc", META.expandedHash),
    lifecycle: "active",
    visibility: "public",
    ...over,
  };
}

describe("CLOUD-21 r2: artifact store", () => {
  it("artifactKey matches the PageVersion.artifactKey convention", () => {
    expect(artifactKey("acct_123", "page_abc", "abc123")).toBe(
      "artifacts/acct_123/page_abc/abc123.html",
    );
  });

  it("put -> get round-trips an artifact (bytes + metadata)", async () => {
    const key = artifactKey("acct_123", "page_abc", META.expandedHash);
    const html = "<html><body>frozen</body></html>";
    await putArtifact(E, key, html, META);

    const got = await getArtifact(E, key);
    expect(got).not.toBeNull();
    expect(await got!.object.text()).toBe(html);
    expect(got!.meta).toEqual(META);
    // content-type was set so the router can stream without transform
    expect(got!.object.httpMetadata?.contentType).toBe(
      "text/html; charset=utf-8",
    );
  });

  it("getArtifact returns null for a missing key", async () => {
    const got = await getArtifact(E, "artifacts/acct_123/page_abc/missing.html");
    expect(got).toBeNull();
  });
});

describe("CLOUD-21 kv: route hot cache", () => {
  it("routeKey normalizes host case and leading slash", () => {
    expect(routeKey("Example.COM", "about")).toBe("route:example.com/about");
    expect(routeKey("example.com", "/about")).toBe("route:example.com/about");
  });

  it("putRoute -> lookupRoute hits", async () => {
    const rec = sampleRoute();
    await putRoute(E, "hit.example.com", "/p", rec);
    const got = await lookupRoute(E, "hit.example.com", "/p");
    expect(got).toEqual(rec);
  });

  it("lookupRoute misses with null", async () => {
    const got = await lookupRoute(E, "nope.example.com", "/never");
    expect(got).toBeNull();
  });

  it("resolveRouteWithFallback: KV hit does NOT call cold source", async () => {
    const rec = sampleRoute({ pageId: "page_hit" });
    await putRoute(E, "fast.example.com", "/x", rec);
    const cold = vi.fn<ColdRouteSource>(async () => sampleRoute());
    const got = await resolveRouteWithFallback(E, "fast.example.com", "/x", cold);
    expect(got).toEqual(rec);
    expect(cold).not.toHaveBeenCalled();
  });

  it("resolveRouteWithFallback: KV miss calls cold source once and populates KV", async () => {
    const cold = vi.fn<ColdRouteSource>(async () => sampleRoute({ pageId: "page_cold" }));
    const host = "cold.example.com";
    const path = "/y";

    // precondition: not cached
    expect(await lookupRoute(E, host, path)).toBeNull();

    const got = await resolveRouteWithFallback(E, host, path, cold);
    expect(got?.pageId).toBe("page_cold");
    expect(cold).toHaveBeenCalledTimes(1);

    // KV is now populated; a second resolve does not call cold again
    const again = await resolveRouteWithFallback(E, host, path, cold);
    expect(again?.pageId).toBe("page_cold");
    expect(cold).toHaveBeenCalledTimes(1);
    expect(await lookupRoute(E, host, path)).toEqual(sampleRoute({ pageId: "page_cold" }));
  });

  it("resolveRouteWithFallback: cold null -> null, nothing cached", async () => {
    const cold = vi.fn<ColdRouteSource>(async () => null);
    const got = await resolveRouteWithFallback(E, "gone.example.com", "/z", cold);
    expect(got).toBeNull();
    expect(cold).toHaveBeenCalledTimes(1);
    expect(await lookupRoute(E, "gone.example.com", "/z")).toBeNull();
  });
});

describe("CLOUD-21 cache: edge cache helpers", () => {
  it("cacheArtifactResponse shapes a streamable text/html response with etag", async () => {
    const key = artifactKey("acct_123", "page_abc", "resp01");
    const html = "<html>cacheable</html>";
    await putArtifact(E, key, html, { ...META, expandedHash: "resp01" });
    const artifact = await getArtifact(E, key);
    const res = cacheArtifactResponse(artifact!);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("etag")).toBe('"resp01"');
    expect(res.headers.get("cache-control")).toContain("max-age=");
    expect(await res.text()).toBe(html);
  });

  it("invalidateRoute purges the edge cache key for a URL", async () => {
    const url = "https://purge.example.com/page";
    const cache = (caches as unknown as { default: Cache }).default;
    // seed the edge cache for this URL
    await cache.put(
      url,
      new Response("cached", {
        headers: { "cache-control": "public, max-age=3600" },
      }),
    );
    expect(await cache.match(url)).not.toBeUndefined();

    const purged = await invalidateRoute(E, url);
    expect(purged).toBe(true);
    expect(await cache.match(url)).toBeUndefined();
  });

  it("invalidateRoute returns false when nothing was cached", async () => {
    const purged = await invalidateRoute(E, "https://empty.example.com/none");
    expect(purged).toBe(false);
  });
});
