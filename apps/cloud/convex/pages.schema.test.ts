import { describe, expect, it } from "vitest";
import schema from "./schema.js";

/**
 * CLOUD-23 schema-shape guard.
 *
 * convex-test is not available in apps/cloud, so per the CLOUD-23 brief the pure
 * `publish-core` tests + this schema-shape assertion stand in for an in-harness
 * integration test. It asserts that the exact fields the thin `pages.ts` /
 * `recipes.ts` adapters WRITE exist on the real schema, so a future schema edit
 * that drifts from the adapter is caught at test time rather than at deploy.
 */

type ExportedField = { fieldType: { type: string }; optional: boolean };
type ExportedTable = { documentType: { value: Record<string, ExportedField> } };

const tables = schema.tables as unknown as Record<
  string,
  { export: () => ExportedTable }
>;

function fields(table: string): string[] {
  return Object.keys(tables[table].export().documentType.value);
}

describe("publish/update adapters write fields the schema declares", () => {
  it("commitNewPage writes every pages field", () => {
    // commitNewPage inserts: accountId, slug, customDomain, visibility,
    // lifecycle, tags, currentVersionId, currentVersion, createdAt, updatedAt,
    // plus the CLOUD-51 additive expiresAt / projectGroup (default null).
    expect(new Set(fields("pages"))).toEqual(
      new Set([
        "accountId",
        "slug",
        "customDomain",
        "visibility",
        "lifecycle",
        "tags",
        "currentVersionId",
        "currentVersion",
        // CLOUD-51 (additive).
        "expiresAt",
        "projectGroup",
        "createdAt",
        "updatedAt",
      ]),
    );
  });

  it("commitVersion writes every pageVersions field", () => {
    expect(new Set(fields("pageVersions"))).toEqual(
      new Set([
        "pageId",
        "accountId",
        "version",
        "artifactKey",
        "expandedHash",
        "sourceHash",
        "lockfile",
        "createdAt",
      ]),
    );
  });

  it("commitRecipeEdit writes recipeVersions + recipeEditEvents fields", () => {
    expect(new Set(fields("recipeVersions"))).toEqual(
      new Set(["accountId", "family", "version", "body", "bodySha", "createdAt"]),
    );
    expect(new Set(fields("recipeEditEvents"))).toEqual(
      new Set([
        "accountId",
        "family",
        "fromVersion",
        "toVersion",
        "bodySha",
        "actorTokenId",
        "createdAt",
      ]),
    );
  });

  it("commitVersion / commitRecipeEdit write auditLog fields", () => {
    expect(new Set(fields("auditLog"))).toEqual(
      new Set([
        "accountId",
        "action",
        "targetId",
        "actorTokenId",
        "metadata",
        "createdAt",
      ]),
    );
  });

  it("commitIdempotency writes every idempotencyKeys field", () => {
    expect(new Set(fields("idempotencyKeys"))).toEqual(
      new Set(["accountId", "key", "resultId", "result", "createdAt"]),
    );
  });
});
