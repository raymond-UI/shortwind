/**
 * #198 item 2 — NCMEC CyberTipline reporting seam (18 U.S.C. §2258A).
 *
 * On ACTUAL KNOWLEDGE of CSAM (a proactive known-hash match at publish, or an
 * operator CSAM kill), a US provider must file a CyberTipline report ≤ 60 days
 * and preserve the material. The manual kill path already REQUIRES an operator-
 * supplied `ncmecReportId`; the gap this closes is the AUTO-detected path
 * (hash-match block), which recorded `ncmecReportId: null` with no outbound
 * submission. This module submits the report and stamps the returned id on the
 * moderation case.
 *
 * ACTIVATION REQUIRES NCMEC ESP ONBOARDING — a legal/vendor process (a
 * registered Electronic Service Provider account + CyberTipline API credentials).
 * There is no way to self-provision or test this against NCMEC's live system, so
 * the integration is config-gated: absent creds ⇒ it records no id (today's
 * behavior) and logs that a report is DUE (so the obligation is visible), rather
 * than silently doing nothing. Once `NCMEC_CYBERTIP_URL` + `NCMEC_ESP_CREDENTIAL`
 * are set on the deployment, real submission activates with no code change.
 *
 * The submission `fetch` runs in an ACTION (scheduled from the sealing mutation).
 * Fail-safe: a submission failure logs and leaves the id null — the 60-day clock
 * + sealed evidence are already recorded, so an operator can re-file; alerting on
 * a failed/absent filing is the #202 observability work.
 */
import { v } from "convex/values";
import { internalAction } from "../_generated/server.js";
import { alertOps } from "./ops_alert.js";

/** Minimal `process.env` accessor (workspace types against workers-types). */
declare const process: { env: Record<string, string | undefined> };

/**
 * Submit a CyberTipline report for a CSAM hit. Returns the NCMEC report id on a
 * successful filing, or null when unconfigured or on any failure (never throws).
 */
export async function submitCyberTipReport(args: {
  pageId: string;
  accountId: string;
  listId: string;
  hash: string;
}): Promise<string | null> {
  const url = process.env.NCMEC_CYBERTIP_URL;
  const credential = process.env.NCMEC_ESP_CREDENTIAL;
  if (!url || !credential) {
    // Obligation is DUE but the integration is not onboarded — make it loud
    // (an operator must file manually within the window) rather than silent.
    console.error(
      `[ncmec] CyberTipline report DUE for page ${args.pageId} (list ${args.listId}) ` +
        `but NCMEC_CYBERTIP_URL/NCMEC_ESP_CREDENTIAL are not configured — file manually.`,
    );
    return null;
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${credential}`,
      },
      body: JSON.stringify({
        incidentType: "CSAM",
        detection: "proactive-hash-match",
        hashListId: args.listId,
        fileHash: args.hash,
        // Internal references so a filed report ties back to the sealed evidence.
        providerReference: { pageId: args.pageId, accountId: args.accountId },
      }),
    });
    if (!res.ok) {
      console.error(
        `[ncmec] CyberTipline submission failed (${res.status}) for page ${args.pageId}`,
      );
      return null;
    }
    const body = (await res.json().catch(() => ({}))) as { reportId?: unknown };
    return typeof body.reportId === "string" ? body.reportId : null;
  } catch (err) {
    console.error(`[ncmec] CyberTipline submission threw for page ${args.pageId}:`, err);
    return null;
  }
}

/**
 * The internalAction that submits the report and, on a returned id, stamps it on
 * the moderation case (via an internal mutation — the action cannot write the DB
 * directly). Scheduled from the CSAM auto-block path.
 */
export const submitCyberTipReportAction = internalAction({
  args: {
    pageId: v.id("pages"),
    accountId: v.id("accounts"),
    listId: v.string(),
    hash: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const reportId = await submitCyberTipReport({
      pageId: args.pageId,
      accountId: args.accountId,
      listId: args.listId,
      hash: args.hash,
    });
    if (reportId) {
      const { internal } = await import("../_generated/api.js");
      await ctx.runMutation(internal.moderation.stampNcmecReportId, {
        pageId: args.pageId,
        ncmecReportId: reportId,
      });
    } else {
      // #202 alerting: a CSAM report that was NOT filed (unconfigured or a
      // submission failure) is a legal obligation gap (18 U.S.C. §2258A) — page
      // an operator to file manually within the 60-day window.
      await alertOps("ncmec.report_not_filed", {
        pageId: args.pageId,
        listId: args.listId,
      });
    }
    return null;
  },
});

/** The scheduler slice needed to schedule the submission (structural). */
export interface NcmecSchedulerCtx {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  scheduler: { runAfter: (delayMs: number, ref: any, args: any) => Promise<any> };
}

/**
 * Schedule the CyberTipline submission to run in an action after the CSAM-block
 * mutation commits (a mutation cannot `fetch`).
 */
export async function scheduleCyberTipReport(
  ctx: NcmecSchedulerCtx,
  args: { pageId: string; accountId: string; listId: string; hash: string },
): Promise<void> {
  const { internal } = await import("../_generated/api.js");
  await ctx.scheduler.runAfter(
    0,
    internal.lib.ncmec.submitCyberTipReportAction,
    args,
  );
}
