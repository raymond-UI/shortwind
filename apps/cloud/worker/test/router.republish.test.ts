import { describe, expect, it, vi } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import type { Env } from "../src/env";
import {
  putArtifact,
  artifactKey,
  currentArtifactKey,
  type ArtifactMeta,
} from "../src/r2";
import {
  putRoute,
  lookupRoute,
  deleteRoute,
  routeKey,
  type CachedRoute,
  type ColdRouteSource,
} from "../src/kv";
import { invalidateRoute } from "../src/cache";
import { handleRequest, type RouterDeps, type TokenValidator } from "../src/router";

/**
 * #232 — republish must go live IMMEDIATELY, at every visibility.
 *
 * Before this fix the KV route record carried the version-coupled
 * `artifacts/<acct>/<page>/<expandedHash>.html` key, so every republish minted a
 * NEW key while the cached record kept pointing at the OLD one — stale for up to
 * the 1h route TTL. The route record is now version-INDEPENDENT and the artifact
 * is served from the STABLE `artifacts/<acct>/<page>/current.html` object that
 * publish overwrites (R2 is strongly consistent for same-key overwrites), so a
 * republish touches nothing cached.
 *
 * These run inside workerd (@cloudflare/vitest-pool-workers) against the local
 * miniflare R2 (ARTIFACTS) + KV (ROUTES) bindings, exactly like router.test.ts.
 */
const E = env as unknown as Env;

const V1 = "<!doctype html><html><body>version one</body></html>";
const V2 = "<!doctype html><html><body>version two</body></html>";

function meta(over: Partial<ArtifactMeta>): ArtifactMeta {
  return {
    expandedHash: "hash1",
    version: 1,
    accountId: "acct_232",
    pageId: "page_232",
    ...over,
  };
}

/**
 * Simulate a Convex publish/update: write the IMMUTABLE hashed artifact (history
 * / rollback / dedup) AND overwrite the STABLE `current.html` object with the
 * same bytes. Mirrors `convex/lib/publish_core.ts` `buildAndStore`.
 */
async function publish(
  accountId: string,
  pageId: string,
  html: string,
  version: number,
): Promise<void> {
  const expandedHash = `hash${version}`;
  const m = meta({ expandedHash, version, accountId, pageId });
  await putArtifact(E, artifactKey(accountId, pageId, expandedHash), html, m);
  await putArtifact(E, currentArtifactKey(accountId, pageId), html, m);
}

function route(over: Partial<CachedRoute> = {}): CachedRoute {
  return {
    pageId: "page_232",
    accountId: "acct_232",
    lifecycle: "active",
    visibility: "public",
    ...over,
  };
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

describe("#232 republish is immediate at every visibility", () => {
  const cases = [
    { visibility: "public" as const, host: "pub-232.shortwind.app" },
    { visibility: "unlisted" as const, host: "unl-232.shortwind.app" },
    { visibility: "private" as const, host: "priv-232.shortwind.app" },
  ];

  for (const { visibility, host } of cases) {
    it(`${visibility}: publish → fetch (warms KV) → update → fetch serves v2`, async () => {
      const accountId = "acct_232";
      const pageId = `page_232_${visibility}`;
      const auth =
        visibility === "private" ? { authorization: "Bearer good" } : undefined;

      // 1. Publish v1 and fetch it once — this WARMS the KV route (the exact
      //    precondition that made the old behavior stale).
      await publish(accountId, pageId, V1, 1);
      const r = route({ pageId, accountId, visibility });
      const cold = vi.fn<ColdRouteSource>(async () => r);
      const d = deps({
        coldRoute: cold,
        validateToken: vi.fn<TokenValidator>(async () => true),
      });

      const first = await run(req(host, "/", auth), d);
      expect(first.status).toBe(200);
      expect(await first.text()).toBe(V1);
      expect(await lookupRoute(E, host, "/")).toEqual(r); // KV is warm

      // 2. Update: v2 overwrites `current.html`. NOTHING evicts the KV route.
      await publish(accountId, pageId, V2, 2);
      if (visibility === "public") {
        // Only PUBLIC pages are written to the shared edge cache, so only they
        // need the publish-side zone purge (#207). unlisted/private are
        // `private, no-store` and have no edge layer to invalidate.
        await invalidateRoute(E, `https://${host}/`);
      }

      // 3. The very next fetch serves v2 — no TTL wait, no eviction needed.
      const second = await run(req(host, "/", auth), d);
      expect(second.status).toBe(200);
      expect(await second.text()).toBe(V2);
      expect(second.headers.get("etag")).toBe('"hash2"');

      // The KV record is untouched by the republish (version-independent), and
      // the cold source was consulted exactly once (the initial miss).
      expect(await lookupRoute(E, host, "/")).toEqual(r);
      expect(cold).toHaveBeenCalledTimes(1);
    });
  }
});

describe("#232 setVisibility: public → private stops serving without a bearer", () => {
  it("after the KV eviction + edge purge, a bearer-less fetch is 401", async () => {
    const accountId = "acct_232";
    const pageId = "page_232_flip";
    const host = "flip-232.shortwind.app";
    await publish(accountId, pageId, V1, 1);

    const publicRoute = route({ pageId, accountId, visibility: "public" });
    await putRoute(E, host, "/", publicRoute);
    const served = await run(req(host, "/"), deps());
    expect(served.status).toBe(200);

    // `setVisibility` (convex/pages.ts) purges the edge AND evicts the KV route,
    // so the next request re-resolves against Convex and sees `private`.
    await deleteRoute(E, host, "/");
    await invalidateRoute(E, `https://${host}/`);

    const privateRoute = route({ pageId, accountId, visibility: "private" });
    const res = await run(
      req(host, "/"),
      deps({ coldRoute: vi.fn<ColdRouteSource>(async () => privateRoute) }),
    );
    expect(res.status).toBe(401);
  });
});

describe("#232 migration: pre-fix KV records and pre-fix R2 buckets", () => {
  it("a legacy (version-coupled) KV record is rejected → cold re-resolve, serves v2", async () => {
    const accountId = "acct_232";
    const pageId = "page_232_legacy";
    const host = "legacy-232.shortwind.app";
    await publish(accountId, pageId, V1, 1);
    await publish(accountId, pageId, V2, 2);

    // A record written by the PRE-#232 worker: carries `version` + `artifactKey`
    // pinned to v1. Accepting it would serve v1 for up to an hour.
    await E.ROUTES.put(
      routeKey(host, "/"),
      JSON.stringify({
        pageId,
        accountId,
        version: 1,
        artifactKey: artifactKey(accountId, pageId, "hash1"),
        lifecycle: "active",
        visibility: "public",
      }),
    );

    const fresh = route({ pageId, accountId });
    const cold = vi.fn<ColdRouteSource>(async () => fresh);
    const res = await run(req(host, "/"), deps({ coldRoute: cold }));

    expect(res.status).toBe(200);
    expect(await res.text()).toBe(V2);
    expect(cold).toHaveBeenCalledTimes(1);
    // The legacy record has been replaced by the version-independent one.
    expect(await lookupRoute(E, host, "/")).toEqual(fresh);
  });

  it("a page published BEFORE current.html existed serves from the fallback key", async () => {
    const accountId = "acct_232";
    const pageId = "page_232_nocurrent";
    const host = "nocurrent-232.shortwind.app";
    // Only the immutable hashed object exists (the pre-#232 bucket state).
    const legacyKey = artifactKey(accountId, pageId, "hash1");
    await putArtifact(E, legacyKey, V1, meta({ accountId, pageId }));

    const r = route({
      pageId,
      accountId,
      fallbackArtifactKey: legacyKey,
    });
    await putRoute(E, host, "/", r);

    const res = await run(req(host, "/"), deps());
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(V1);
  });

  it("no current.html and no fallback → 404 (never a wrong page)", async () => {
    const host = "absent-232.shortwind.app";
    const r = route({ pageId: "page_232_absent", accountId: "acct_232" });
    await putRoute(E, host, "/", r);

    const res = await run(req(host, "/"), deps());
    expect(res.status).toBe(404);
  });
});

describe("#232 bundle siblings keep an explicit artifact key", () => {
  it("serves the sibling's own object, not the entry page's current.html", async () => {
    const accountId = "acct_232";
    const pageId = "page_232_bundle";
    const host = "bundle-232.shortwind.app";
    await publish(accountId, pageId, V1, 1); // the ENTRY page document

    const siblingKey = `bundles/${accountId}/${pageId}/about.html/hash9.html`;
    const sibling = "<!doctype html><html><body>about page</body></html>";
    await putArtifact(E, siblingKey, sibling, meta({ accountId, pageId }));

    const r = route({ pageId, accountId, fileKey: siblingKey });
    await putRoute(E, host, "/about.html", r);

    const res = await run(req(host, "/about.html"), deps());
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(sibling);
  });
});
