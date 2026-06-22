import { describe, expect, it, vi, beforeEach } from "vitest";
import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import type { Env } from "../src/env";
import { putArtifact, artifactKey, type ArtifactMeta } from "../src/r2";
import {
  putRoute,
  lookupRoute,
  deleteRoute,
  type CachedRoute,
  type ColdRouteSource,
} from "../src/kv";
import {
  handleRequest,
  type RouterDeps,
  type TokenValidator,
} from "../src/router";

// CLOUD-22 serve-router integration tests. These run INSIDE workerd via
// @cloudflare/vitest-pool-workers against LOCAL miniflare R2 (ARTIFACTS) + KV
// (ROUTES) bindings declared in worker/wrangler.toml. No live Cloudflare creds,
// no live Convex — the cold source + token validator are injected stubs.
const E = env as unknown as Env;

const HASH = "deadbeefcafe2222";

function meta(over: Partial<ArtifactMeta> = {}): ArtifactMeta {
  return {
    expandedHash: HASH,
    version: 1,
    accountId: "acct_22",
    pageId: "page_22",
    ...over,
  };
}

function route(over: Partial<CachedRoute> = {}): CachedRoute {
  return {
    pageId: "page_22",
    accountId: "acct_22",
    version: 1,
    artifactKey: artifactKey("acct_22", "page_22", HASH),
    lifecycle: "active",
    visibility: "public",
    ...over,
  };
}

const HTML = "<!doctype html><html><body>frozen artifact</body></html>";

/** Seed the R2 artifact a route points at. */
async function seedArtifact(r: CachedRoute, html = HTML): Promise<void> {
  await putArtifact(E, r.artifactKey, html, meta());
}

/** Build router deps with default stubs; override per test. */
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

/** Drive the router with a real execution context and drain waitUntil. */
async function run(request: Request, d: RouterDeps) {
  const ctx = createExecutionContext();
  const res = await handleRequest(request, E, ctx, d);
  await waitOnExecutionContext(ctx);
  return res;
}

const edgeCache = () => (caches as unknown as { default: Cache }).default;

describe("CLOUD-22 router: public page", () => {
  it("serves from R2 via a KV hit — NO cold-source call, NO expansion", async () => {
    const r = route({ pageId: "page_pub" });
    await putRoute(E, "pub.example.com", "/p", r);
    await seedArtifact(r);

    const d = deps();
    const res = await run(req("pub.example.com", "/p"), d);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("etag")).toBe(`"${HASH}"`);
    expect(await res.text()).toBe(HTML);
    // KV hit → cold source must NOT be consulted (hot path stays dumb).
    expect(d.coldRoute).not.toHaveBeenCalled();
  });

  it("KV miss → cold source called once → served + KV populated", async () => {
    const r = route({ pageId: "page_cold" });
    await seedArtifact(r);
    const cold = vi.fn<ColdRouteSource>(async () => r);
    const d = deps({ coldRoute: cold });

    expect(await lookupRoute(E, "cold.example.com", "/c")).toBeNull();

    const res = await run(req("cold.example.com", "/c"), d);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(HTML);
    expect(cold).toHaveBeenCalledTimes(1);

    // KV is now populated; a second serve does not call cold again.
    expect(await lookupRoute(E, "cold.example.com", "/c")).toEqual(r);
    const res2 = await run(req("cold.example.com", "/c"), d);
    expect(res2.status).toBe(200);
    expect(cold).toHaveBeenCalledTimes(1);
  });

  it("caches the served response at the edge (request URL key)", async () => {
    const r = route({ pageId: "page_edge" });
    await putRoute(E, "edge.example.com", "/e", r);
    await seedArtifact(r);

    const url = "https://edge.example.com/e";
    expect(await edgeCache().match(url)).toBeUndefined();

    const res = await run(req("edge.example.com", "/e"), deps());
    expect(res.status).toBe(200);

    const cached = await edgeCache().match(url);
    expect(cached).not.toBeUndefined();
    expect(await cached!.text()).toBe(HTML);
    // Streamed: the original response body is still readable independently.
    expect(await res.text()).toBe(HTML);
  });
});

describe("CLOUD-22 router: visibility", () => {
  it("unlisted serves with X-Robots-Tag: noindex and no auth", async () => {
    const r = route({ pageId: "page_unl", visibility: "unlisted" });
    await putRoute(E, "unl.example.com", "/u", r);
    await seedArtifact(r);

    const res = await run(req("unl.example.com", "/u"), deps());
    expect(res.status).toBe(200);
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
    expect(await res.text()).toBe(HTML);
  });

  it("private → 401 without a token (validator not called)", async () => {
    const r = route({ pageId: "page_priv", visibility: "private" });
    await putRoute(E, "priv.example.com", "/pr", r);
    await seedArtifact(r);
    const validate = vi.fn<TokenValidator>(async () => true);

    const res = await run(req("priv.example.com", "/pr"), deps({ validateToken: validate }));
    expect(res.status).toBe(401);
    expect(validate).not.toHaveBeenCalled();
  });

  it("private → 401 with an invalid token", async () => {
    const r = route({ pageId: "page_priv2", visibility: "private" });
    await putRoute(E, "priv2.example.com", "/pr", r);
    await seedArtifact(r);
    const validate = vi.fn<TokenValidator>(async () => false);

    const res = await run(
      req("priv2.example.com", "/pr", { authorization: "Bearer nope" }),
      deps({ validateToken: validate }),
    );
    expect(res.status).toBe(401);
    expect(validate).toHaveBeenCalledTimes(1);
    expect(validate).toHaveBeenCalledWith("nope", r);
  });

  it("private → 200 with a valid token", async () => {
    const r = route({ pageId: "page_priv3", visibility: "private" });
    await putRoute(E, "priv3.example.com", "/pr", r);
    await seedArtifact(r);
    const validate = vi.fn<TokenValidator>(async () => true);

    const res = await run(
      req("priv3.example.com", "/pr", { authorization: "Bearer good-token" }),
      deps({ validateToken: validate }),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(HTML);
    expect(validate).toHaveBeenCalledWith("good-token", r);
  });
});

describe("CLOUD-22 router: lifecycle takedown states", () => {
  it("tombstoned → 410 Gone (no R2 read)", async () => {
    const r = route({ pageId: "page_tomb", lifecycle: "tombstoned" });
    await putRoute(E, "tomb.example.com", "/t", r);
    // intentionally do NOT seed R2 — refusal happens before the R2 read.

    const res = await run(req("tomb.example.com", "/t"), deps());
    expect(res.status).toBe(410);
  });

  it("quarantined → 451 Unavailable For Legal Reasons", async () => {
    const r = route({ pageId: "page_quar", lifecycle: "quarantined" });
    await putRoute(E, "quar.example.com", "/q", r);

    const res = await run(req("quar.example.com", "/q"), deps());
    expect(res.status).toBe(451);
  });
});

describe("CLOUD-22 router: not found", () => {
  it("unresolved route → 404", async () => {
    const res = await run(req("missing.example.com", "/x"), deps());
    expect(res.status).toBe(404);
  });

  it("route resolves but R2 object is missing → 404", async () => {
    const r = route({ pageId: "page_no_r2", artifactKey: "artifacts/acct_22/page_no_r2/absent.html" });
    await putRoute(E, "nor2.example.com", "/n", r);
    // no putArtifact → R2 miss

    const res = await run(req("nor2.example.com", "/n"), deps());
    expect(res.status).toBe(404);
  });
});

describe("CLOUD-SUBDOMAIN router: per-page subdomain serving", () => {
  it("serves a <subdomain>.shortwind.dev/ request via the cold source (host passed through)", async () => {
    const r = route({ pageId: "page_sub" });
    await seedArtifact(r);
    // The cold source (Convex resolveRoute) does the subdomain logic; the router
    // just passes the host + path through and caches under (host, path).
    const cold = vi.fn<ColdRouteSource>(async (host, path) =>
      host === "cloud-ops.shortwind.dev" && path === "/" ? r : null,
    );
    const d = deps({ coldRoute: cold });

    const res = await run(req("cloud-ops.shortwind.dev", "/"), d);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(HTML);
    expect(cold).toHaveBeenCalledWith("cloud-ops.shortwind.dev", "/");

    // The subdomain route is now cached under route:cloud-ops.shortwind.dev/ — a
    // repeat view is a KV hit (no second cold call).
    expect(await lookupRoute(E, "cloud-ops.shortwind.dev", "/")).toEqual(r);
    const res2 = await run(req("cloud-ops.shortwind.dev", "/"), d);
    expect(res2.status).toBe(200);
    expect(cold).toHaveBeenCalledTimes(1);
  });
});

describe("router: reserved/retired host redirect", () => {
  it("c.shortwind.dev (retired legacy serve host) → 301 to the apex", async () => {
    const cold = vi.fn<ColdRouteSource>(async () => null);
    const res = await run(req("c.shortwind.dev", "/"), deps({ coldRoute: cold }));
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("https://shortwind.dev/");
    // Reserved hosts redirect BEFORE resolution — no cold-source call.
    expect(cold).not.toHaveBeenCalled();
  });

  it("www.shortwind.dev (system label) → 301 to the apex", async () => {
    const res = await run(req("www.shortwind.dev", "/anything"), deps());
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("https://shortwind.dev/");
  });

  it("an unknown PAGE subdomain (typo'd slug) still 404s — NOT a redirect", async () => {
    const cold = vi.fn<ColdRouteSource>(async () => null);
    const res = await run(
      req("totally-unknown-slug.shortwind.dev", "/"),
      deps({ coldRoute: cold }),
    );
    expect(res.status).toBe(404);
    // A real page label is resolved against the cold source (which returns null).
    expect(cold).toHaveBeenCalledTimes(1);
  });
});

describe("CLOUD-22 kv: deleteRoute", () => {
  it("evicts a route from KV (idempotent)", async () => {
    const r = route({ pageId: "page_del" });
    await putRoute(E, "del.example.com", "/d", r);
    expect(await lookupRoute(E, "del.example.com", "/d")).toEqual(r);

    await deleteRoute(E, "del.example.com", "/d");
    expect(await lookupRoute(E, "del.example.com", "/d")).toBeNull();

    // idempotent: deleting an absent key does not throw.
    await expect(deleteRoute(E, "del.example.com", "/d")).resolves.toBeUndefined();
  });
});
