import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";

/**
 * Recipe-version writes + recipe-edit audit (CLOUD-23, PRD §5.4).
 *
 * Recipes are forward-only (PRD §5.4): an edit produces a NEW `recipeVersions`
 * row; nothing is overwritten. Because a recipe change is higher-consequence
 * than a page change, every edit also emits a distinct `recipeEditEvents` row
 * AND a `recipe.edit` `auditLog` entry, so the human operator can see e.g.
 * "agent modified @card (0.4.0 → 0.5.0)" and roll back if they care.
 *
 * These are thin Convex adapters over `ctx.db`. The DECISION of which recipes
 * are touched and what the next version is lives in the pure `lib/publish-core`
 * pipeline (driven by the shared `selectTouchedRecipes` fingerprint rule); this
 * module only persists the rows that the pipeline decides on. They are
 * `internal*` because the only caller is the publish action's data port — never
 * the public API surface.
 *
 * Offline-codegen note (CLAUDE.md / CLOUD-23 brief): these are referenced as
 * `internal.recipes.*` from `pages.ts`. `_generated/api.d.ts` is hand-extended
 * to declare the `recipes` module so tsc resolves the refs offline; a real
 * `convex dev` (CLOUD-30) regenerates it.
 */

/** The latest recorded version of a family within an account, or null. */
export const latestRecipeVersion = internalQuery({
  args: { accountId: v.id("accounts"), family: v.string() },
  returns: v.union(
    v.object({
      family: v.string(),
      version: v.string(),
      bodySha: v.string(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    // `by_account_family` is ordered by insertion (Convex `_creationTime`); the
    // last row is the newest version. We take the most recent via `.order("desc")`.
    const row = await ctx.db
      .query("recipeVersions")
      .withIndex("by_account_family", (q) =>
        q.eq("accountId", args.accountId).eq("family", args.family),
      )
      .order("desc")
      .first();
    if (!row) return null;
    return { family: row.family, version: row.version, bodySha: row.bodySha };
  },
});

/**
 * Persist one touched recipe forward-only: a new `recipeVersions` row, a
 * distinct `recipeEditEvents` row, and a `recipe.edit` `auditLog` entry. One
 * mutation so the three writes commit atomically.
 */
export const commitRecipeEdit = internalMutation({
  args: {
    accountId: v.id("accounts"),
    family: v.string(),
    fromVersion: v.union(v.string(), v.null()),
    toVersion: v.string(),
    body: v.string(),
    bodySha: v.string(),
    actorTokenId: v.union(v.id("tokens"), v.null()),
  },
  returns: v.object({ recipeVersionId: v.id("recipeVersions") }),
  handler: async (ctx, args) => {
    const now = Date.now();
    const recipeVersionId = await ctx.db.insert("recipeVersions", {
      accountId: args.accountId,
      family: args.family,
      version: args.toVersion,
      body: args.body,
      bodySha: args.bodySha,
      createdAt: now,
    });
    await ctx.db.insert("recipeEditEvents", {
      accountId: args.accountId,
      family: args.family,
      fromVersion: args.fromVersion,
      toVersion: args.toVersion,
      bodySha: args.bodySha,
      actorTokenId: args.actorTokenId,
      createdAt: now,
    });
    await ctx.db.insert("auditLog", {
      accountId: args.accountId,
      action: "recipe.edit",
      targetId: args.family,
      actorTokenId: args.actorTokenId,
      metadata: {
        family: args.family,
        fromVersion: args.fromVersion,
        toVersion: args.toVersion,
        bodySha: args.bodySha,
      },
      createdAt: now,
    });
    return { recipeVersionId };
  },
});

/** List an account's recipe palette (latest version per family). For CLOUD-25. */
export const listRecipeVersions = internalQuery({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("recipeVersions")
      .withIndex("by_account_family", (q) => q.eq("accountId", args.accountId))
      .collect();
    return rows.map((r: Doc<"recipeVersions">) => ({
      family: r.family,
      version: r.version,
      bodySha: r.bodySha,
      createdAt: r.createdAt,
    }));
  },
});
