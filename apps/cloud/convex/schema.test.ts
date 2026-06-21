import { describe, expect, it } from "vitest";
import schema from "./schema.js";

/**
 * CLOUD-10 schema-validation unit.
 *
 * The schema is the system of record (PRD 6.3). Two invariants are asserted
 * statically (no live deployment needed):
 *   1. Every plain-data record type in `shared/src/types.ts` maps 1:1 to a
 *      Convex table (CLAUDE.md: one table per record type).
 *   2. The `find`-query indexes named in the CLOUD-10 spec exist on the right
 *      tables, with the expected key fields.
 *
 * We introspect `schema.tables[name].export()` — the serialized table shape
 * Convex produces for codegen — so the assertions track the actual definition,
 * not a hand-maintained mirror.
 */

type ExportedIndex = { indexDescriptor: string; fields: string[] };
type ExportedField = {
  fieldType: { type: string; tableName?: string };
  optional: boolean;
};
type ExportedTable = {
  indexes: ExportedIndex[];
  documentType: { value: Record<string, ExportedField> };
};

// `export()` is an internal method Convex uses for codegen; it isn't on the
// public `TableDefinition` type, so we reach it through `unknown`.
const tables = schema.tables as unknown as Record<
  string,
  { export: () => ExportedTable }
>;

function exported(table: string): ExportedTable {
  expect(tables, `table "${table}" is defined`).toHaveProperty(table);
  return tables[table].export();
}

function indexNames(table: string): string[] {
  return exported(table).indexes.map((i) => i.indexDescriptor);
}

function indexFields(table: string, name: string): string[] {
  const idx = exported(table).indexes.find((i) => i.indexDescriptor === name);
  expect(idx, `index "${name}" exists on "${table}"`).toBeDefined();
  return idx!.fields;
}

function fieldNames(table: string): string[] {
  return Object.keys(exported(table).documentType.value);
}

describe("every shared record type maps 1:1 to a table", () => {
  // Each shared/src/types.ts record interface -> its backing table name.
  const recordToTable: Record<string, string> = {
    Account: "accounts",
    Page: "pages",
    PageVersion: "pageVersions",
    RecipeVersion: "recipeVersions",
    RecipeEditEvent: "recipeEditEvents",
    Token: "tokens",
    AuditEvent: "auditLog",
    Moderation: "moderation",
    IdempotencyKey: "idempotencyKeys",
  };

  for (const [record, table] of Object.entries(recordToTable)) {
    it(`${record} -> ${table}`, () => {
      expect(Object.keys(tables)).toContain(table);
    });
  }

  it("defines exactly the nine record tables (no extras, none missing)", () => {
    expect(new Set(Object.keys(tables))).toEqual(
      new Set(Object.values(recordToTable)),
    );
  });
});

describe("find-query indexes exist (CLOUD-10 spec)", () => {
  it("pages has by_slug, by_account, by_customDomain, by_tag", () => {
    expect(indexNames("pages")).toEqual(
      expect.arrayContaining([
        "by_slug",
        "by_account",
        "by_customDomain",
        "by_tag",
      ]),
    );
    expect(indexFields("pages", "by_slug")).toEqual(["accountId", "slug"]);
    expect(indexFields("pages", "by_account")).toEqual(["accountId"]);
    expect(indexFields("pages", "by_customDomain")).toEqual(["customDomain"]);
    expect(indexFields("pages", "by_tag")).toEqual(["tags"]);
  });

  it("pageVersions has by_page", () => {
    expect(indexFields("pageVersions", "by_page")).toEqual(["pageId"]);
  });

  it("recipeVersions has by_account_family", () => {
    expect(indexFields("recipeVersions", "by_account_family")).toEqual([
      "accountId",
      "family",
    ]);
  });

  it("recipeEditEvents has by_account", () => {
    expect(indexFields("recipeEditEvents", "by_account")).toEqual([
      "accountId",
    ]);
  });

  it("auditLog has by_account", () => {
    expect(indexFields("auditLog", "by_account")).toEqual(["accountId"]);
  });

  it("moderation has by_page and by_state", () => {
    expect(indexFields("moderation", "by_page")).toEqual(["pageId"]);
    expect(indexFields("moderation", "by_state")).toEqual(["state"]);
  });

  it("idempotencyKeys has by_key", () => {
    // Compound (accountId, key): keys are unique per account (shared types),
    // and the index still serves the (account, key) idempotency lookup.
    expect(indexFields("idempotencyKeys", "by_key")).toEqual([
      "accountId",
      "key",
    ]);
  });
});

describe("CLOUD-01 auth tables are preserved exactly", () => {
  it("accounts keeps its CLOUD-01 fields and by_authUserId index", () => {
    expect(new Set(fieldNames("accounts"))).toEqual(
      new Set(["authUserId", "name", "email", "createdAt", "updatedAt"]),
    );
    expect(indexFields("accounts", "by_authUserId")).toEqual(["authUserId"]);
  });

  it("tokens keeps its CLOUD-01 fields and by_tokenHash / by_account indexes", () => {
    expect(new Set(fieldNames("tokens"))).toEqual(
      new Set([
        "accountId",
        "tokenHash",
        "scopes",
        "label",
        "createdAt",
        "revokedAt",
        "expiresAt",
      ]),
    );
    expect(indexFields("tokens", "by_tokenHash")).toEqual(["tokenHash"]);
    expect(indexFields("tokens", "by_account")).toEqual(["accountId"]);
  });
});

describe("foreign-key columns are typed as v.id(...) to the right table", () => {
  function idTarget(table: string, field: string): string | undefined {
    const f = exported(table).documentType.value[field];
    return f?.fieldType.type === "id" ? f.fieldType.tableName : undefined;
  }

  it("pages.accountId -> accounts; pages.currentVersionId -> pageVersions (nullable)", () => {
    expect(idTarget("pages", "accountId")).toBe("accounts");
    // currentVersionId is v.union(v.id("pageVersions"), v.null()), not a bare id.
    const cv = exported("pages").documentType.value.currentVersionId;
    expect(cv.fieldType.type).toBe("union");
  });

  it("pageVersions.pageId -> pages, .accountId -> accounts", () => {
    expect(idTarget("pageVersions", "pageId")).toBe("pages");
    expect(idTarget("pageVersions", "accountId")).toBe("accounts");
  });

  it("moderation.pageId -> pages, .accountId -> accounts", () => {
    expect(idTarget("moderation", "pageId")).toBe("pages");
    expect(idTarget("moderation", "accountId")).toBe("accounts");
  });
});
