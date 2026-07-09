import { describe, expect, it } from "vitest";
import { renderGet, runGet } from "./get.js";
import type { ApiClient, GetResult } from "../api-client.js";

/** get tests — render metadata + versions against a mocked api-client. */

const RESULT: GetResult = {
  page: {
    id: "pg_1",
    slug: "status",
    url: "https://shortwind.dev/status",
    visibility: "unlisted",
    currentVersion: 2,
    tags: ["ops"],
    updatedAt: 1717000000000,
  },
  versions: [
    { id: "ver_2", version: 2, artifactKey: "k2", expandedHash: "e2", sourceHash: "s2", createdAt: 2000 },
    { id: "ver_1", version: 1, artifactKey: "k1", expandedHash: "e1", sourceHash: "s1", createdAt: 1000 },
  ],
};

describe("renderGet — golden output", () => {
  it("renders metadata + a version table (human)", () => {
    const out = renderGet(RESULT, false);
    expect(out).toContain("id:         pg_1");
    expect(out).toContain("version:    v2");
    expect(out).toContain("VERSION");
    expect(out).toContain("v1");
    expect(out).toContain("v2");
  });

  it("emits the raw { page, versions } envelope under --json", () => {
    expect(JSON.parse(renderGet(RESULT, true))).toEqual(RESULT);
  });
});

describe("runGet", () => {
  it("fetches by id and renders", async () => {
    let seenId: string | undefined;
    const client: ApiClient = {
      findPages: async () => ({ pages: [] }),
      getPage: async (id) => {
        seenId = id;
        return RESULT;
      },
      publishPage: async () => {
        throw new Error("unused");
      },
      updatePage: async () => {
        throw new Error("unused");
      },
    };
    const out = await runGet(client, "pg_1", { json: true });
    expect(seenId).toBe("pg_1");
    expect(JSON.parse(out)).toEqual(RESULT);
  });
});
