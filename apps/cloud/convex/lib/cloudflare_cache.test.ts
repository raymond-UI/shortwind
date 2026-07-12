import { afterEach, describe, expect, it, vi } from "vitest";
import { edgePurgeUrl, purgeEdgeByUrl } from "./cloudflare_cache.js";

/**
 * CLOUD-30 (#207/#165) — the zone cache-purge helper.
 *
 * Two contracts matter:
 *   1. `edgePurgeUrl` MUST produce the SAME key the Worker caches under
 *      (worker/src/cache.ts `edgeCacheKey`): `(host, pathname)`, query stripped,
 *      bare origin canonicalized to a trailing-slash root. A drift means a purge
 *      that misses the cached entry.
 *   2. `purgeEdgeByUrl` is fail-safe: no creds ⇒ no fetch, returns false; it
 *      never throws (a purge is a best-effort accelerator over the 60s TTL).
 */

describe("edgePurgeUrl matches the worker/src/cache.ts edgeCacheKey form", () => {
  it("canonicalizes a bare subdomain origin to a trailing-slash root", () => {
    expect(edgePurgeUrl("https://cloud-ops.shortwind.app")).toBe(
      "https://cloud-ops.shortwind.app/",
    );
  });

  it("strips the query string (audit #4 — routes key on host+path only)", () => {
    expect(edgePurgeUrl("https://cloud-ops.shortwind.app/?x=1&y=2")).toBe(
      "https://cloud-ops.shortwind.app/",
    );
  });

  it("preserves a non-root pathname", () => {
    expect(edgePurgeUrl("https://shortwind.app/my-slug?z=9")).toBe(
      "https://shortwind.app/my-slug",
    );
  });
});

describe("purgeEdgeByUrl fail-safe behavior", () => {
  const prevToken = process.env.CLOUDFLARE_API_TOKEN;
  const prevZone = process.env.CLOUDFLARE_ZONE_ID;

  afterEach(() => {
    process.env.CLOUDFLARE_API_TOKEN = prevToken;
    process.env.CLOUDFLARE_ZONE_ID = prevZone;
    vi.restoreAllMocks();
  });

  it("returns false and never fetches when creds are absent", async () => {
    delete process.env.CLOUDFLARE_API_TOKEN;
    delete process.env.CLOUDFLARE_ZONE_ID;
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect(await purgeEdgeByUrl("https://x.shortwind.app/")).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("POSTs the normalized URL to the zone purge_cache endpoint", async () => {
    process.env.CLOUDFLARE_API_TOKEN = "tok";
    process.env.CLOUDFLARE_ZONE_ID = "zone123";
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));
    expect(await purgeEdgeByUrl("https://x.shortwind.app?a=1")).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe(
      "https://api.cloudflare.com/client/v4/zones/zone123/purge_cache",
    );
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      files: ["https://x.shortwind.app/"],
    });
  });

  it("returns false (never throws) on a Cloudflare error response", async () => {
    process.env.CLOUDFLARE_API_TOKEN = "tok";
    process.env.CLOUDFLARE_ZONE_ID = "zone123";
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("forbidden", { status: 403 }),
    );
    expect(await purgeEdgeByUrl("https://x.shortwind.app/")).toBe(false);
  });

  it("returns false (never throws) when fetch itself throws", async () => {
    process.env.CLOUDFLARE_API_TOKEN = "tok";
    process.env.CLOUDFLARE_ZONE_ID = "zone123";
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network"));
    expect(await purgeEdgeByUrl("https://x.shortwind.app/")).toBe(false);
  });
});
