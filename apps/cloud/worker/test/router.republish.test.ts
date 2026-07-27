import { describe, expect, it, vi } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import type { Env } from "../src/env";
import {
  putArtifact,
  artifactKey,
  type ArtifactMeta,
} from "../src/r2";
import {
  bundleCurrentKey,
  currentArtifactKey,
} from "../../shared/src/artifact_keys";
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

describe("#232 bundle siblings resolve to their OWN stable key", () => {
  /** Simulate a bundle sibling publish: hashed object + stable current.html. */
  async function publishSibling(
    accountId: string,
    pageId: string,
    path: string,
    html: string,
    version: number,
  ): Promise<string> {
    const expandedHash = `sib${version}`;
    const m = meta({ expandedHash, version, accountId, pageId });
    const hashed = `bundles/${accountId}/${pageId}/${path}/${expandedHash}.html`;
    await putArtifact(E, hashed, html, m);
    await putArtifact(E, bundleCurrentKey(accountId, pageId, path), html, m);
    return hashed;
  }

  it("serves the sibling's own document, not the entry page's current.html", async () => {
    const accountId = "acct_232";
    const pageId = "page_232_bundle";
    const host = "bundle-232.shortwind.app";
    await publish(accountId, pageId, V1, 1); // the ENTRY page document
    const sibling = "<!doctype html><html><body>about page</body></html>";
    await publishSibling(accountId, pageId, "about.html", sibling, 1);

    const r = route({ pageId, accountId, bundlePath: "about.html" });
    await putRoute(E, host, "/about.html", r);

    const res = await run(req(host, "/about.html"), deps());
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(sibling);
  });

  it("a sibling REPUBLISH is immediate — the cached record is version-independent", async () => {
    const accountId = "acct_232";
    const pageId = "page_232_bundle_republish";
    const host = "bundlerp-232.shortwind.app";
    await publish(accountId, pageId, V1, 1);
    const v1Key = await publishSibling(accountId, pageId, "about.html", V1, 1);

    const r = route({ pageId, accountId, bundlePath: "about.html", fileKey: v1Key });
    const cold = vi.fn<ColdRouteSource>(async () => r);
    const d = deps({ coldRoute: cold });

    const first = await run(req(host, "/about.html"), d);
    expect(first.status).toBe(200);
    expect(await first.text()).toBe(V1);

    // v2 overwrites the sibling's stable key. NOTHING evicts the KV route — and
    // the record still names the v1 HASHED key, which must never be consulted.
    await publishSibling(accountId, pageId, "about.html", V2, 2);
    await invalidateRoute(E, `https://${host}/about.html`);

    const second = await run(req(host, "/about.html"), d);
    expect(second.status).toBe(200);
    expect(await second.text()).toBe(V2);
    expect(cold).toHaveBeenCalledTimes(1);
  });

  it("MIGRATION: a sibling with no stable object falls back to its hashed key", async () => {
    const accountId = "acct_232";
    const pageId = "page_232_bundle_legacy";
    const host = "bundlelegacy-232.shortwind.app";
    // Pre-#232 bucket state: only the immutable hashed sibling object exists.
    const hashed = `bundles/${accountId}/${pageId}/about.html/hashold.html`;
    await putArtifact(E, hashed, V1, meta({ accountId, pageId }));

    const r = route({ pageId, accountId, bundlePath: "about.html", fileKey: hashed });
    await putRoute(E, host, "/about.html", r);

    const res = await run(req(host, "/about.html"), deps());
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(V1);
  });

  it("MIGRATION: a pre-#232 record (fileKey, no bundlePath) still serves", async () => {
    const accountId = "acct_232";
    const pageId = "page_232_bundle_oldrecord";
    const host = "bundleold-232.shortwind.app";
    const hashed = `bundles/${accountId}/${pageId}/about.html/hashold.html`;
    await putArtifact(E, hashed, V1, meta({ accountId, pageId }));

    await putRoute(E, host, "/about.html", route({ pageId, accountId, fileKey: hashed }));
    const res = await run(req(host, "/about.html"), deps());
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(V1);
  });
});

describe("#232 setVisibility on a BUNDLE pulls the siblings too", () => {
  it("public → private 401s on a SIBLING path once its own route key is evicted", async () => {
    // The hole this closes: siblings serve through the entry page but cache under
    // their OWN route keys (`route:<host>/about.html`). The lifecycle evictions
    // used to drop only `route:<host>/`, so a flip left every sibling cached as
    // `public` and the Worker kept serving them with no bearer check.
    const accountId = "acct_232";
    const pageId = "page_232_bundle_flip";
    const host = "bundleflip-232.shortwind.app";
    const sibling = "<!doctype html><html><body>about page</body></html>";
    const hashed = `bundles/${accountId}/${pageId}/about.html/sibflip.html`;
    await putArtifact(E, hashed, sibling, meta({ accountId, pageId }));
    await putArtifact(
      E,
      bundleCurrentKey(accountId, pageId, "about.html"),
      sibling,
      meta({ accountId, pageId }),
    );

    // Warm BOTH the entry and the sibling route records as `public`.
    const pub = route({ pageId, accountId, visibility: "public" });
    await putRoute(E, host, "/", pub);
    await putRoute(E, host, "/about.html", { ...pub, bundlePath: "about.html" });
    expect((await run(req(host, "/about.html"), deps())).status).toBe(200);

    // What `setVisibility` now schedules: the entry key AND every sibling key
    // (convex/lib/edge_kv.ts `evictRouteForPage` with `paths`).
    await deleteRoute(E, host, "/");
    await invalidateRoute(E, `https://${host}/`);
    await deleteRoute(E, host, "/about.html");
    await invalidateRoute(E, `https://${host}/about.html`);

    const priv = {
      ...route({ pageId, accountId, visibility: "private" }),
      bundlePath: "about.html",
    };
    const res = await run(
      req(host, "/about.html"),
      deps({ coldRoute: vi.fn<ColdRouteSource>(async () => priv) }),
    );
    expect(res.status).toBe(401);
  });
});
