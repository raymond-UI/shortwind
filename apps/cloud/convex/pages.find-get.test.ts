import { describe, expect, it } from "vitest";
import {
  applyResidualFilters,
  isFindable,
  normalizeFindFilters,
  planFindIndex,
  selectGetVersions,
  toPageSummary,
  type FindFilters,
  type PageRowLike,
} from "./pages.js";

/**
 * CLOUD-24 — `find` / `get` read-model tests.
 *
 * apps/cloud has no convex-test harness (see pages.schema.test.ts), so per the
 * CLOUD-23 convention the non-trivial decision logic of these verbs is factored
 * into PURE helpers exported from `pages.ts` and exercised here offline:
 *
 *   - the INDEX plan (proves find is index-backed + account-scoped, never a full
 *     scan): planFindIndex
 *   - the residual substring `q` filter the adapter applies after the index
 *     narrows the candidate set: applyResidualFilters
 *   - the query-param normalization (blank ⇒ absent): normalizeFindFilters
 *   - the summary projection (the exact JSON the CLI consumes): toPageSummary
 *   - the get version ordering (descending, newest first): selectGetVersions
 */

const BASE = "https://shortwind.app";

function row(over: Partial<PageRowLike>): PageRowLike {
  return {
    _id: "pg_1",
    slug: "status",
    visibility: "public",
    lifecycle: "active",
    currentVersion: 3,
    tags: ["ops"],
    // CLOUD-51 (additive): defaults for the new fields.
    expiresAt: null,
    projectGroup: null,
    updatedAt: 1000,
    ...over,
  };
}

describe("normalizeFindFilters", () => {
  it("trims values and drops blank / whitespace-only ones", () => {
    expect(normalizeFindFilters({ q: "  status ", tags: ["   "] })).toEqual({
      q: "status",
      tags: undefined,
      group: undefined,
    });
  });

  it("treats missing/null params as absent", () => {
    expect(normalizeFindFilters({})).toEqual({
      q: undefined,
      tags: undefined,
      group: undefined,
    });
    expect(normalizeFindFilters({ q: null, tags: null })).toEqual({
      q: undefined,
      tags: undefined,
      group: undefined,
    });
    // An empty repeated param (`GET /v1/pages` with no `tag=`) is "no filter",
    // never "match a page with zero tags".
    expect(normalizeFindFilters({ tags: [] }).tags).toBeUndefined();
  });

  it("keeps every repeated tag, trimmed and de-duplicated", () => {
    // `--tag` is repeatable, so `?tag=ops&tag=+&tag=+prod+&tag=ops` is {ops,prod}.
    expect(normalizeFindFilters({ tags: ["ops", " ", " prod ", "ops"] })).toEqual({
      q: undefined,
      tags: ["ops", "prod"],
      group: undefined,
    });
  });
});

describe("planFindIndex — find is index-backed (never a full scan)", () => {
  it("uses by_project when a group filter is present", () => {
    expect(planFindIndex({ group: "marketing" })).toEqual({
      index: "by_project",
      group: "marketing",
    });
  });

  it("falls back to by_account (account-scoped) for tag-only / q-only / empty", () => {
    expect(planFindIndex({})).toEqual({ index: "by_account" });
    expect(planFindIndex({ q: "status" })).toEqual({ index: "by_account" });
    // tag membership cannot be served by the whole-array by_tag index, so it
    // rides the account-scoped scan as a residual filter.
    expect(planFindIndex({ tags: ["ops"] })).toEqual({ index: "by_account" });
  });
});

describe("applyResidualFilters — filters no index can serve (q substring, tag membership)", () => {
  const rows = [
    row({ _id: "pg_a", slug: "status-page", tags: ["ops"] }),
    row({ _id: "pg_b", slug: "marketing", tags: ["sales"] }),
    row({ _id: "pg_c", slug: "STATUS-mirror", tags: ["ops", "prod"] }),
  ];

  it("filters by case-insensitive slug substring", () => {
    const got = applyResidualFilters(rows, { q: "status" });
    expect(got.map((r) => r._id)).toEqual(["pg_a", "pg_c"]);
  });

  it("filters by tag membership (not whole-array equality)", () => {
    const got = applyResidualFilters(rows, { tags: ["ops"] });
    expect(got.map((r) => r._id)).toEqual(["pg_a", "pg_c"]);
  });

  it("ANDs repeated tags: every one must be on the page", () => {
    // Repeating `--tag` narrows. pg_c is the only row carrying both.
    expect(
      applyResidualFilters(rows, { tags: ["ops", "prod"] }).map((r) => r._id),
    ).toEqual(["pg_c"]);
    // A tag no page carries yields nothing, rather than falling back to OR.
    expect(applyResidualFilters(rows, { tags: ["ops", "sales"] })).toEqual([]);
  });

  it("combines q and tag filters", () => {
    const got = applyResidualFilters(rows, { q: "status", tags: ["prod"] });
    expect(got.map((r) => r._id)).toEqual(["pg_c"]);
  });

  it("returns all candidates when no residual filter is set", () => {
    expect(applyResidualFilters(rows, {}).map((r) => r._id)).toEqual([
      "pg_a",
      "pg_b",
      "pg_c",
    ]);
  });

  it("returns [] when nothing matches (empty find -> publish-vs-update)", () => {
    expect(applyResidualFilters(rows, { q: "nope" })).toEqual([]);
  });
});

describe("isFindable — find excludes dead pages (CLOUD-31)", () => {
  it("keeps only active pages discoverable; tombstoned/quarantined are excluded", () => {
    expect(isFindable({ lifecycle: "active" })).toBe(true);
    expect(isFindable({ lifecycle: "tombstoned" })).toBe(false);
    expect(isFindable({ lifecycle: "quarantined" })).toBe(false);
  });
});

describe("toPageSummary — the exact CLI-facing JSON shape", () => {
  it("projects every summary field and builds the public url", () => {
    expect(
      toPageSummary(
        row({
          _id: "pg_x",
          slug: "status",
          visibility: "unlisted",
          currentVersion: 7,
          tags: ["ops", "prod"],
          expiresAt: 9999,
          projectGroup: "marketing",
          updatedAt: 4242,
        }),
        BASE,
      ),
    ).toEqual({
      id: "pg_x",
      slug: "status",
      url: "https://shortwind.app/status",
      visibility: "unlisted",
      lifecycle: "active",
      currentVersion: 7,
      tags: ["ops", "prod"],
      expiresAt: 9999,
      projectGroup: "marketing",
      updatedAt: 4242,
    });
  });

  it("surfaces the page lifecycle so callers can see a page's state (CLOUD-31)", () => {
    expect(toPageSummary(row({ lifecycle: "tombstoned" }), BASE).lifecycle).toBe(
      "tombstoned",
    );
    expect(
      toPageSummary(row({ lifecycle: "quarantined" }), BASE).lifecycle,
    ).toBe("quarantined");
  });

  it("does not leak accountId or other internal fields", () => {
    const summary = toPageSummary(row({}), BASE);
    expect(Object.keys(summary).sort()).toEqual(
      [
        "currentVersion",
        "expiresAt",
        "id",
        "lifecycle",
        "projectGroup",
        "slug",
        "tags",
        "updatedAt",
        "url",
        "visibility",
      ].sort(),
    );
  });
});

describe("selectGetVersions — get returns version history, newest first", () => {
  it("orders versions descending by version number", () => {
    const versions = [
      { id: "v1", version: 1, artifactKey: "k1", expandedHash: "e1", sourceHash: "s1", createdAt: 100 },
      { id: "v3", version: 3, artifactKey: "k3", expandedHash: "e3", sourceHash: "s3", createdAt: 300 },
      { id: "v2", version: 2, artifactKey: "k2", expandedHash: "e2", sourceHash: "s2", createdAt: 200 },
    ];
    expect(selectGetVersions(versions).map((v) => v.version)).toEqual([3, 2, 1]);
  });

  it("returns [] for a page with no versions yet", () => {
    expect(selectGetVersions([])).toEqual([]);
  });
});
