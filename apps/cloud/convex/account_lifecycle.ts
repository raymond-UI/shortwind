import { v } from "convex/values";
import { mutation, query } from "./_generated/server.js";
import { requireRead, requireWrite } from "./lib/auth_guard.js";
import type { Doc } from "./_generated/dataModel.js";

/**
 * #202 (data lifecycle) — GDPR/CCPA account data PORTABILITY + CLOSURE.
 *
 * `exportAccountData` returns a machine-readable bundle of everything the account
 * owns (portability / a subject-access request). `closeAccount` performs the
 * safe, reversible-by-support parts of erasure: it REVOKES every credential (so
 * the account can no longer act) and TOMBSTONES its active pages (so nothing it
 * published keeps serving), then audits the closure.
 *
 * LEGAL-HOLD RECONCILIATION (PRD §8.2 preserve-not-delete): closure deliberately
 * does NOT touch quarantined/preserved moderation material or the moderation
 * cases — a §2258A/CSAM legal hold SURVIVES an erasure request. Full row-level
 * purge of non-held data (recipes, themes, domains, audit) on a retention
 * schedule is a documented follow-up; closure here is the credential + serving
 * kill, which is the part that must be immediate and is safe to automate.
 */

/**
 * Export all data an account owns, as a portability bundle. Bearer-authed
 * (`pages:read`); an account can only export ITSELF (the token's account). The
 * per-account row sets are bounded by the account's own footprint.
 */
export const exportAccountData = query({
  args: { bearer: v.string() },
  handler: async (ctx, args) => {
    const auth = await requireRead(ctx, args.bearer);
    const accountId = auth.accountId;

    const account = await ctx.db.get(accountId);
    const [pages, versions, domains, themes, recipes, moderation] =
      await Promise.all([
        ctx.db.query("pages").withIndex("by_account", (q) => q.eq("accountId", accountId)).collect(),
        ctx.db.query("pageVersions").withIndex("by_account", (q) => q.eq("accountId", accountId)).collect(),
        ctx.db.query("accountDomains").withIndex("by_account", (q) => q.eq("accountId", accountId)).collect(),
        ctx.db.query("accountThemes").withIndex("by_account", (q) => q.eq("accountId", accountId)).collect(),
        ctx.db.query("recipeVersions").withIndex("by_account_family", (q) => q.eq("accountId", accountId)).collect(),
        ctx.db.query("moderation").withIndex("by_account", (q) => q.eq("accountId", accountId)).collect(),
      ]);

    return {
      exportedFor: accountId,
      account: account
        ? { name: account.name, email: account.email, createdAt: account.createdAt }
        : null,
      pages: pages.map((p: Doc<"pages">) => ({
        id: p._id,
        slug: p.slug,
        subdomain: p.subdomain ?? null,
        visibility: p.visibility,
        lifecycle: p.lifecycle,
        currentVersion: p.currentVersion,
        tags: p.tags,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      })),
      pageVersions: versions.map((vrow: Doc<"pageVersions">) => ({
        pageId: vrow.pageId,
        version: vrow.version,
        artifactKey: vrow.artifactKey,
        createdAt: vrow.createdAt,
      })),
      customDomains: domains.map((d: Doc<"accountDomains">) => ({
        hostname: d.hostname,
        status: d.status,
      })),
      theme: themes.map((t: Doc<"accountThemes">) => ({
        accent: t.accent,
        radius: t.radius,
      })),
      recipes: recipes.map((r: Doc<"recipeVersions">) => ({
        family: r.family,
        version: r.version,
      })),
      // Moderation cases are included for transparency (the subject's own data),
      // but the SEALED material behind a legal hold is not exportable.
      moderationCases: moderation.map((m: Doc<"moderation">) => ({
        pageId: m.pageId,
        state: m.state,
        reason: m.reason,
        createdAt: m.createdAt,
      })),
    };
  },
});

/**
 * Close (erase) an account: revoke every credential and tombstone every active
 * page, then audit. Bearer-authed (`pages:write`); an account closes ITSELF.
 * Preserves quarantined/preserved material + moderation cases (legal hold).
 * Idempotent: re-closing an already-closed account is a no-op sum of zeros.
 */
export const closeAccount = mutation({
  args: { bearer: v.string() },
  returns: v.object({
    revokedTokens: v.number(),
    revokedRefreshTokens: v.number(),
    tombstonedPages: v.number(),
    preservedPages: v.number(),
  }),
  handler: async (ctx, args) => {
    const auth = await requireWrite(ctx, args.bearer);
    const accountId = auth.accountId;
    const now = Date.now();

    // 1. Revoke every access + refresh token (the account can no longer act).
    let revokedTokens = 0;
    for (const t of await ctx.db
      .query("tokens")
      .withIndex("by_account", (q) => q.eq("accountId", accountId))
      .collect()) {
      if (t.revokedAt === null) {
        await ctx.db.patch(t._id, { revokedAt: now });
        revokedTokens++;
      }
    }
    let revokedRefreshTokens = 0;
    for (const r of await ctx.db
      .query("refreshTokens")
      .withIndex("by_account", (q) => q.eq("accountId", accountId))
      .collect()) {
      if (r.revokedAt === null) {
        await ctx.db.patch(r._id, { revokedAt: now });
        revokedRefreshTokens++;
      }
    }

    // 2. Tombstone active pages (stop serving) — but LEAVE quarantined/preserved
    //    pages untouched (legal hold survives erasure, PRD §8.2).
    let tombstonedPages = 0;
    let preservedPages = 0;
    for (const p of await ctx.db
      .query("pages")
      .withIndex("by_account", (q) => q.eq("accountId", accountId))
      .collect()) {
      if (p.lifecycle === "quarantined") {
        preservedPages++;
        continue;
      }
      if (p.lifecycle === "active") {
        await ctx.db.patch(p._id, { lifecycle: "tombstoned", updatedAt: now });
        tombstonedPages++;
      }
    }

    await ctx.db.insert("auditLog", {
      accountId,
      action: "account.close",
      targetId: null,
      actorTokenId: auth.tokenId,
      metadata: {
        revokedTokens,
        revokedRefreshTokens,
        tombstonedPages,
        preservedPages,
      },
      createdAt: now,
    });

    return { revokedTokens, revokedRefreshTokens, tombstonedPages, preservedPages };
  },
});
