/**
 * #198 item 3 — notify on a new abuse report (PRD §8.2 "reachable, MONITORED
 * endpoint"). The intake (`moderation.reportAbuse`, reached via `POST /v1/abuse`)
 * writes a `moderation` row + audit entry and stops — a report then sits in the
 * table until a human happens to open the dashboard. This module dispatches an
 * out-of-band notification (webhook) the moment a real report lands, so intake is
 * actually monitored and an SLA is possible.
 *
 * `reportAbuse` is a mutation (no `fetch`), so the POST is SCHEDULED to run in an
 * action right after it commits (`ctx.scheduler.runAfter`), the same pattern as
 * the KV eviction / R2 seal.
 *
 * Config (set on the Convex deployment via `npx convex env set`):
 *   - `ABUSE_WEBHOOK_URL` — a JSON webhook (Slack / Discord / generic incoming
 *     webhook). Absent ⇒ notification is skipped (dev/test), the report still
 *     lands in the DB.
 *
 * PII: the payload deliberately carries only the actionable triage fields
 * (pageId, category, reason) — NOT the reporter's contact (audit #158 flagged
 * reporter-PII exposure). An operator looks up the case for follow-up contact.
 *
 * Fail-safe: a webhook failure is logged and SWALLOWED — a down notifier must
 * never fail the intake (the report is already persisted).
 */
import { v } from "convex/values";
import { internalAction } from "../_generated/server.js";

/** Minimal `process.env` accessor (workspace types against workers-types). */
declare const process: { env: Record<string, string | undefined> };

/**
 * POST a new-abuse-report notification to the configured webhook. Returns whether
 * it was sent. Never throws. Emits a broadly-compatible body: `text` (Slack) +
 * `content` (Discord) + the structured fields a generic webhook can consume.
 */
export async function notifyAbuseReport(args: {
  pageId: string;
  accountId: string;
  category: string;
  reason: string;
}): Promise<boolean> {
  const url = process.env.ABUSE_WEBHOOK_URL;
  if (!url) return false; // Unconfigured (dev/test): report still persisted, no notify.

  const summary =
    `🚩 New abuse report [${args.category}] on page ${args.pageId} — ` +
    `${args.reason.slice(0, 300)}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: summary,
        content: summary,
        category: args.category,
        pageId: args.pageId,
        accountId: args.accountId,
        reason: args.reason,
      }),
    });
    if (res.ok) return true;
    console.error(
      `[abuse_notify] webhook POST failed (${res.status}) for page ${args.pageId}`,
    );
    return false;
  } catch (err) {
    console.error(`[abuse_notify] webhook threw for page ${args.pageId}:`, err);
    return false;
  }
}

/** The internalAction that POSTs the notification (scheduled from the intake). */
export const notifyAbuseAction = internalAction({
  args: {
    pageId: v.string(),
    accountId: v.string(),
    category: v.string(),
    reason: v.string(),
  },
  returns: v.null(),
  handler: async (_ctx, args) => {
    await notifyAbuseReport(args);
    return null;
  },
});

/** The scheduler slice needed to schedule the notification (structural). */
export interface NotifySchedulerCtx {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  scheduler: { runAfter: (delayMs: number, ref: any, args: any) => Promise<any> };
}

/**
 * Schedule the abuse-report notification to run in an action right after the
 * intake mutation commits (a mutation cannot `fetch`).
 */
export async function scheduleAbuseNotification(
  ctx: NotifySchedulerCtx,
  args: { pageId: string; accountId: string; category: string; reason: string },
): Promise<void> {
  const { internal } = await import("../_generated/api.js");
  await ctx.scheduler.runAfter(
    0,
    internal.lib.abuse_notify.notifyAbuseAction,
    args,
  );
}
