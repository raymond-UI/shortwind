import { describe, expect, it } from "vitest";
import {
  ApiError,
  createApiClient,
  resolveBaseUrl,
  type FetchLike,
} from "./api-client.js";
import type { Lockfile } from "./contract/lockfile-diff.js";

/**
 * api-client tests — drive the typed REST client with a recording fake `fetch`
 * (no network). Asserts: URL/query/verb/header assembly, the JSON envelopes,
 * and the non-2xx → typed-error mapping (esp. 409 → existingId; PRD §4).
 */

interface Recorded {
  url: string;
  method?: string | undefined;
  headers?: Record<string, string> | undefined;
  body?: string | undefined;
}

/** A fetch fake that records the call and returns a canned response. */
function fakeFetch(
  response: { ok: boolean; status: number; body: string },
  sink: Recorded[],
): FetchLike {
  return async (url, init) => {
    sink.push({
      url,
      method: init?.method,
      headers: init?.headers,
      body: init?.body,
    });
    return {
      ok: response.ok,
      status: response.status,
      text: async () => response.body,
    };
  };
}

const LOCKFILE: Lockfile = { version: 1, registry: "default", families: {} };

describe("resolveBaseUrl", () => {
  it("prefers explicit, then env, then the default, and trims slashes", () => {
    expect(resolveBaseUrl("https://x.test/")).toBe("https://x.test");
    expect(resolveBaseUrl(undefined, { SHORTWIND_CLOUD_API: "https://env.test/" })).toBe(
      "https://env.test",
    );
    expect(resolveBaseUrl(undefined, {})).toBe("https://api.shortwind.dev");
    expect(resolveBaseUrl("", { SHORTWIND_CLOUD_API: "" })).toBe(
      "https://api.shortwind.dev",
    );
  });
});

describe("findPages", () => {
  it("builds the query string (q, domain, repeatable tags) and sends the bearer", async () => {
    const calls: Recorded[] = [];
    const client = createApiClient({
      baseUrl: "https://api.test/",
      token: "swc_secret",
      fetch: fakeFetch({ ok: true, status: 200, body: '{"pages":[]}' }, calls),
    });
    const result = await client.findPages({ q: "status", domain: "acme.com", tags: ["a", "b"] });
    expect(result).toEqual({ pages: [] });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("GET");
    expect(calls[0]!.url).toBe(
      "https://api.test/v1/pages?q=status&domain=acme.com&tag=a&tag=b",
    );
    expect(calls[0]!.headers?.Authorization).toBe("Bearer swc_secret");
  });

  it("omits the query string entirely when no filters are given", async () => {
    const calls: Recorded[] = [];
    const client = createApiClient({
      baseUrl: "https://api.test",
      token: "t",
      fetch: fakeFetch({ ok: true, status: 200, body: '{"pages":[]}' }, calls),
    });
    await client.findPages({});
    expect(calls[0]!.url).toBe("https://api.test/v1/pages");
  });

  it("normalizes a missing/null pages field to an empty array", async () => {
    const client = createApiClient({
      baseUrl: "https://api.test",
      token: "t",
      fetch: fakeFetch({ ok: true, status: 200, body: "{}" }, []),
    });
    expect(await client.findPages({})).toEqual({ pages: [] });
  });
});

describe("getPage", () => {
  it("GETs /v1/pages/{id} and returns the { page, versions } envelope", async () => {
    const calls: Recorded[] = [];
    const envelope = {
      page: {
        id: "pg_1",
        slug: "status",
        url: "https://shortwind.dev/status",
        visibility: "public",
        customDomain: null,
        currentVersion: 2,
        tags: ["ops"],
        updatedAt: 1000,
      },
      versions: [
        {
          id: "ver_2",
          version: 2,
          artifactKey: "k2",
          expandedHash: "e2",
          sourceHash: "s2",
          createdAt: 1000,
        },
      ],
    };
    const client = createApiClient({
      baseUrl: "https://api.test",
      token: "t",
      fetch: fakeFetch({ ok: true, status: 200, body: JSON.stringify(envelope) }, calls),
    });
    expect(await client.getPage("pg_1")).toEqual(envelope);
    expect(calls[0]!.url).toBe("https://api.test/v1/pages/pg_1");
  });

  it("maps 404 to a typed not_found error with the code", async () => {
    const client = createApiClient({
      baseUrl: "https://api.test",
      token: "t",
      fetch: fakeFetch(
        { ok: false, status: 404, body: '{"error":{"code":"NOT_FOUND"}}' },
        [],
      ),
    });
    await expect(client.getPage("nope")).rejects.toMatchObject({
      kind: "not_found",
      status: 404,
      code: "NOT_FOUND",
    });
  });
});

describe("publishPage", () => {
  it("POSTs /v1/pages with the JSON body and returns { id, url, version }", async () => {
    const calls: Recorded[] = [];
    const client = createApiClient({
      baseUrl: "https://api.test",
      token: "t",
      fetch: fakeFetch(
        {
          ok: true,
          status: 200,
          body: '{"id":"pg_9","url":"https://shortwind.dev/x","version":1}',
        },
        calls,
      ),
    });
    const result = await client.publishPage({
      html: "<h1>hi</h1>",
      lockfile: LOCKFILE,
      recipes: [],
    });
    expect(result).toEqual({ id: "pg_9", url: "https://shortwind.dev/x", version: 1 });
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.url).toBe("https://api.test/v1/pages");
    expect(JSON.parse(calls[0]!.body!)).toEqual({
      html: "<h1>hi</h1>",
      lockfile: LOCKFILE,
      recipes: [],
    });
  });

  it("maps 409 to a conflict error carrying existingId", async () => {
    const client = createApiClient({
      baseUrl: "https://api.test",
      token: "t",
      fetch: fakeFetch({ ok: false, status: 409, body: '{"existingId":"pg_dup"}' }, []),
    });
    await expect(
      client.publishPage({ html: "x", lockfile: LOCKFILE, recipes: [] }),
    ).rejects.toMatchObject({ kind: "conflict", status: 409, existingId: "pg_dup" });
  });

  it("maps 401 / 403 to unauthorized / forbidden", async () => {
    const c401 = createApiClient({
      baseUrl: "https://api.test",
      token: "t",
      fetch: fakeFetch({ ok: false, status: 401, body: '{"error":{"code":"UNAUTHORIZED"}}' }, []),
    });
    await expect(c401.publishPage({ html: "x", lockfile: LOCKFILE, recipes: [] })).rejects.toMatchObject(
      { kind: "unauthorized", status: 401 },
    );
    const c403 = createApiClient({
      baseUrl: "https://api.test",
      token: "t",
      fetch: fakeFetch({ ok: false, status: 403, body: '{"error":{"code":"FORBIDDEN"}}' }, []),
    });
    await expect(c403.publishPage({ html: "x", lockfile: LOCKFILE, recipes: [] })).rejects.toMatchObject(
      { kind: "forbidden", status: 403 },
    );
  });

  it("wraps a thrown fetch as a network ApiError", async () => {
    const client = createApiClient({
      baseUrl: "https://api.test",
      token: "t",
      fetch: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    const err = await client
      .publishPage({ html: "x", lockfile: LOCKFILE, recipes: [] })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.kind).toBe("network");
  });
});

describe("updatePage", () => {
  it("PATCHes /v1/pages/{id} with the body", async () => {
    const calls: Recorded[] = [];
    const client = createApiClient({
      baseUrl: "https://api.test",
      token: "t",
      fetch: fakeFetch(
        {
          ok: true,
          status: 200,
          body: '{"id":"pg_1","url":"https://shortwind.dev/x","version":3}',
        },
        calls,
      ),
    });
    const result = await client.updatePage("pg_1", {
      html: "<h2>v3</h2>",
      lockfile: LOCKFILE,
      recipes: [],
    });
    expect(result.version).toBe(3);
    expect(calls[0]!.method).toBe("PATCH");
    expect(calls[0]!.url).toBe("https://api.test/v1/pages/pg_1");
  });
});

describe("deletePage (CLOUD-34)", () => {
  it("DELETEs /v1/pages/{id} with the bearer and no body", async () => {
    const calls: Recorded[] = [];
    const client = createApiClient({
      baseUrl: "https://api.test",
      token: "swc_secret",
      // A tombstone returns an empty body (204-ish) — request normalizes it.
      fetch: fakeFetch({ ok: true, status: 204, body: "" }, calls),
    });
    await expect(client.deletePage!("pg_1")).resolves.toBeUndefined();
    expect(calls[0]!.method).toBe("DELETE");
    expect(calls[0]!.url).toBe("https://api.test/v1/pages/pg_1");
    expect(calls[0]!.headers?.Authorization).toBe("Bearer swc_secret");
    expect(calls[0]!.body).toBeUndefined();
  });

  it("maps 404 / 403 to typed errors", async () => {
    const c404 = createApiClient({
      baseUrl: "https://api.test",
      token: "t",
      fetch: fakeFetch({ ok: false, status: 404, body: '{"error":{"code":"NOT_FOUND"}}' }, []),
    });
    await expect(c404.deletePage!("nope")).rejects.toMatchObject({ kind: "not_found", status: 404 });
    const c403 = createApiClient({
      baseUrl: "https://api.test",
      token: "t",
      fetch: fakeFetch({ ok: false, status: 403, body: '{"error":{"code":"FORBIDDEN"}}' }, []),
    });
    await expect(c403.deletePage!("pg_1")).rejects.toMatchObject({ kind: "forbidden", status: 403 });
  });
});

describe("setVisibility (CLOUD-34)", () => {
  const SUMMARY = {
    id: "pg_1",
    slug: "status",
    url: "https://shortwind.dev/status",
    visibility: "private",
    customDomain: null,
    currentVersion: 2,
    tags: [],
    updatedAt: 1000,
  };

  it("PATCHes /v1/pages/{id}/visibility with { visibility } and returns the summary", async () => {
    const calls: Recorded[] = [];
    const client = createApiClient({
      baseUrl: "https://api.test",
      token: "t",
      fetch: fakeFetch({ ok: true, status: 200, body: JSON.stringify(SUMMARY) }, calls),
    });
    const updated = await client.setVisibility!("pg_1", "private");
    expect(updated).toEqual(SUMMARY);
    expect(calls[0]!.method).toBe("PATCH");
    expect(calls[0]!.url).toBe("https://api.test/v1/pages/pg_1/visibility");
    expect(JSON.parse(calls[0]!.body!)).toEqual({ visibility: "private" });
  });

  it("maps 401 to unauthorized", async () => {
    const client = createApiClient({
      baseUrl: "https://api.test",
      token: "t",
      fetch: fakeFetch({ ok: false, status: 401, body: '{"error":{"code":"UNAUTHORIZED"}}' }, []),
    });
    await expect(client.setVisibility!("pg_1", "public")).rejects.toMatchObject({
      kind: "unauthorized",
      status: 401,
    });
  });
});
