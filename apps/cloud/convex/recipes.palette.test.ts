// @vitest-environment edge-runtime
import { describe, expect, it } from "vitest";
import { convexTest } from "convex-test";
import schema from "./schema.js";
import { internal } from "./_generated/api.js";

/**
 * `internal.recipes.listRecipePalette` — the account's latest recipe body per
 * family, powering the WEB publish path's server-side expansion. Proves it dedupes
 * to the newest version per family and returns raw bodies (no seal).
 */

declare global {
  interface ImportMeta {
    glob: (pattern: string) => Record<string, () => Promise<unknown>>;
  }
}
const modules = import.meta.glob("./**/*.ts");

describe("listRecipePalette", () => {
  it("returns the latest body per family for the account", async () => {
    const t = convexTest(schema, modules);
    const accountId = await t.run(async (ctx) => {
      const now = Date.now();
      const id = await ctx.db.insert("accounts", {
        authUserId: "auth_palette",
        name: "Palette Account",
        email: null,
        createdAt: now,
        updatedAt: now,
      });
      // card: two versions (0.1.0 then 0.2.0); button: one version.
      await ctx.db.insert("recipeVersions", {
        accountId: id,
        family: "card",
        version: "0.1.0",
        body: "@recipe card {\n  border p-2\n}\n",
        bodySha: "sha_card_1",
        createdAt: now,
      });
      await ctx.db.insert("recipeVersions", {
        accountId: id,
        family: "card",
        version: "0.2.0",
        body: "@recipe card {\n  rounded-lg border p-4\n}\n",
        bodySha: "sha_card_2",
        createdAt: now + 1000,
      });
      await ctx.db.insert("recipeVersions", {
        accountId: id,
        family: "button",
        version: "0.1.0",
        body: "@recipe button {\n  inline-flex px-3 py-2\n}\n",
        bodySha: "sha_btn_1",
        createdAt: now,
      });
      return id;
    });

    const palette: { family: string; body: string }[] = await t.query(
      internal.recipes.listRecipePalette,
      { accountId: accountId as never },
    );

    const byFamily = Object.fromEntries(palette.map((p) => [p.family, p.body]));
    expect(Object.keys(byFamily).sort()).toEqual(["button", "card"]);
    // card resolves to the NEWEST body (0.2.0), not 0.1.0.
    expect(byFamily["card"]).toContain("rounded-lg border p-4");
    expect(byFamily["card"]).not.toContain("border p-2\n}");
    // bodies are raw recipe sources (no seal comment).
    expect(byFamily["button"]).toContain("@recipe button");
    expect(byFamily["card"]).not.toContain("shortwind:");
  });

  it("returns an empty palette for an account with no recipes", async () => {
    const t = convexTest(schema, modules);
    const accountId = await t.run(async (ctx) => {
      const now = Date.now();
      return ctx.db.insert("accounts", {
        authUserId: "auth_empty",
        name: "Empty",
        email: null,
        createdAt: now,
        updatedAt: now,
      });
    });
    const palette = await t.query(internal.recipes.listRecipePalette, {
      accountId: accountId as never,
    });
    expect(palette).toEqual([]);
  });
});
