import { describe, expect, it } from "vitest";
import { renderFind, runFind, toFindQuery } from "./find.js";
import { assembleUpdatePayload, runUpdate } from "./update.js";
import type { ApiClient, PageSummary, UpdatePayload } from "../api-client.js";
import type { Lockfile } from "../contract/lockfile-diff.js";

/**
 * find tests + the STATELESS agent loop: find → reuse the returned id to
 * update, with NO local page-id persistence (PRD §4). All against a mocked
 * api-client; no network.
 */

const PAGE: PageSummary = {
  id: "pg_42",
  slug: "status",
  url: "https://shortwind.dev/status",
  visibility: "public",
  customDomain: null,
  currentVersion: 3,
  tags: ["ops", "live"],
  updatedAt: 1717000000000,
};

describe("toFindQuery", () => {
  it("normalizes flags into the api-client query (repeatable tags)", () => {
    expect(toFindQuery({ q: "s", domain: "d", tag: ["a", "b"] })).toEqual({
      q: "s",
      domain: "d",
      tags: ["a", "b"],
    });
    expect(toFindQuery({})).toEqual({ tags: [] });
  });
});

describe("renderFind — golden output", () => {
  it("emits a human table", () => {
    const out = renderFind([PAGE], false);
    expect(out).toContain("ID");
    expect(out).toContain("pg_42");
    expect(out).toContain("v3");
    expect(out).toContain("ops,live");
  });

  it("prints a human 'no pages found' on empty", () => {
    expect(renderFind([], false)).toBe("no pages found");
  });

  it("emits the raw { pages } envelope under --json (stable shape)", () => {
    expect(renderFind([], true)).toBe('{\n  "pages": []\n}');
    expect(JSON.parse(renderFind([PAGE], true))).toEqual({ pages: [PAGE] });
  });
});

describe("runFind", () => {
  it("calls findPages with the normalized query and renders the result", async () => {
    let seen: unknown;
    const client = stubClient({
      findPages: async (q) => {
        seen = q;
        return { pages: [PAGE] };
      },
    });
    const out = await runFind(client, { q: "status", json: true });
    expect(seen).toEqual({ q: "status", tags: [] });
    expect(JSON.parse(out)).toEqual({ pages: [PAGE] });
  });
});

describe("stateless agent loop: find → update reuses the returned id", () => {
  it("updates the id from find WITHOUT any local persistence", async () => {
    const calls: { updateId?: string; payload?: UpdatePayload } = {};
    const client = stubClient({
      findPages: async () => ({ pages: [PAGE] }),
      updatePage: async (id, payload) => {
        calls.updateId = id;
        calls.payload = payload;
        return { id, url: PAGE.url, version: PAGE.currentVersion + 1 };
      },
    });

    // 1. find — the only source of the id (no disk read).
    const found = await client.findPages({ q: "status" });
    const id = found.pages[0]!.id;
    expect(id).toBe("pg_42");

    // 2. update — feed that id straight back. No file written, no id cached.
    const lockfile: Lockfile = { version: 1, registry: "default", families: {} };
    const payload = await assembleUpdatePayload({ html: "<h1>v4</h1>", lockfile, candidates: [] });
    const { result } = await runUpdate(client, id, payload, false);

    expect(calls.updateId).toBe("pg_42");
    expect(calls.payload).toMatchObject({ html: "<h1>v4</h1>" });
    // assembleUpdatePayload drops the slug (URL is fixed on update).
    expect("slug" in (calls.payload as unknown as Record<string, unknown>)).toBe(false);
    expect(result.version).toBe(4);
  });
});

/** A fully-stubbed ApiClient; override only the methods a test exercises. */
function stubClient(overrides: Partial<ApiClient>): ApiClient {
  return {
    findPages: async () => ({ pages: [] }),
    getPage: async () => {
      throw new Error("unused");
    },
    publishPage: async () => {
      throw new Error("unused");
    },
    updatePage: async () => {
      throw new Error("unused");
    },
    ...overrides,
  };
}
