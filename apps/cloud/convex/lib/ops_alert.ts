/**
 * #202 (observability) — structured operational logging + alerting for failures
 * that must NEVER be silent (PRD §8 kill-path / R2 / KV / cert / NCMEC).
 *
 * The fail-safe effects across the codebase (edge eviction, R2 seal, cache purge,
 * CyberTipline submission) deliberately SWALLOW their errors so a Cloudflare/R2
 * hiccup never breaks a publish or a DB kill. That safety has a cost: a swallowed
 * failure is invisible. This module makes those failures observable:
 *
 *   - `logOps(level, event, fields)` emits ONE structured JSON line (a log
 *     aggregator / error tracker ingests these; the shape is stable + greppable).
 *   - `alertOps(event, fields)` ALSO posts to a configured ops webhook
 *     (`OPS_ALERT_WEBHOOK_URL`) for the must-never-be-silent class, so a human is
 *     paged rather than the failure sitting only in logs.
 *
 * Both are best-effort and NEVER throw — an observability failure must not
 * escalate into a functional one. Absent `OPS_ALERT_WEBHOOK_URL`, `alertOps`
 * degrades to just the structured log (dev/test). Wiring a hosted error tracker
 * (Sentry DSN) is a config swap behind `alertOps` — the call sites don't change.
 */

/** Minimal `process.env` accessor (workspace types against workers-types). */
declare const process: { env: Record<string, string | undefined> };

export type OpsLevel = "info" | "warn" | "error";

/**
 * Emit a structured, greppable JSON log line. Stable keys (`sw_ops`, `level`,
 * `event`) so a log query can select all ops events / a specific event. Never
 * throws.
 */
export function logOps(
  level: OpsLevel,
  event: string,
  fields: Record<string, unknown> = {},
): void {
  try {
    const line = JSON.stringify({ sw_ops: true, level, event, ...fields });
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  } catch {
    // A serialization failure must not break the caller.
    console.error(`[ops] ${level} ${event}`);
  }
}

/**
 * Log AND page: emit the structured error line and, when an ops webhook is
 * configured, POST an alert so a must-never-be-silent failure reaches a human.
 * Best-effort, never throws. Returns whether the webhook was posted.
 */
export async function alertOps(
  event: string,
  fields: Record<string, unknown> = {},
): Promise<boolean> {
  logOps("error", event, fields);
  const url = process.env.OPS_ALERT_WEBHOOK_URL;
  if (!url) return false;
  const summary = `🚨 ${event} — ${JSON.stringify(fields).slice(0, 400)}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: summary, content: summary, event, ...fields }),
    });
    return res.ok;
  } catch {
    // The structured error line already landed; a down pager must not throw.
    return false;
  }
}
