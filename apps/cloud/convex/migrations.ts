import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * One-shot migrations. Run via `npx convex run migrations:<name>` against the
 * target deployment, then delete once applied everywhere.
 */

/**
 * dropPageCustomDomain — clear the DEPRECATED per-page `customDomain` field off
 * every `pages` row so the field can be removed from the schema entirely. Custom
 * domains are account-level now (`accountDomains`). Idempotent: rows without the
 * field are skipped. Returns how many rows it cleared.
 */
export const dropPageCustomDomain = internalMutation({
  args: {},
  returns: v.object({ cleared: v.number() }),
  handler: async (ctx) => {
    const rows = await ctx.db.query("pages").collect();
    let cleared = 0;
    for (const row of rows) {
      if ("customDomain" in row && row.customDomain !== undefined) {
        // Patching a field to `undefined` removes it from the document.
        await ctx.db.patch(row._id, {
          customDomain: undefined,
        } as unknown as Record<string, never>);
        cleared++;
      }
    }
    return { cleared };
  },
});
