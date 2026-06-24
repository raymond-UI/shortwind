import { useState } from "react";
import { useDashboardData } from "../lib/data";
import { formatTime } from "../lib/format";

/**
 * Policy toggles (CLOUD-35, PRD §7.2) — restyled and folded into Settings
 * (epic #184). The one place the dashboard WRITES: flipping a toggle calls
 * `setAccountPolicy`. Today's single toggle is `customDomainNeedsApproval`.
 */
export function PolicyView() {
  const { policy, setPolicy } = useDashboardData();
  const [saving, setSaving] = useState(false);

  if (policy === undefined) {
    return <div className="text-sm text-muted-foreground">Loading policy…</div>;
  }

  async function toggleCustomDomain() {
    if (!policy) return;
    setSaving(true);
    try {
      await setPolicy({
        customDomainNeedsApproval: !policy.customDomainNeedsApproval,
      });
    } finally {
      setSaving(false);
    }
  }

  const on = policy.customDomainNeedsApproval;

  return (
    <div
      data-testid="policy-view"
      className="rounded-lg border border-border bg-card"
    >
      <div className="flex items-center gap-4 p-4">
        <span
          data-testid="custom-domain-state"
          className={
            "inline-flex w-10 shrink-0 justify-center rounded border px-1.5 py-0.5 text-[11px] font-medium " +
            (on ? "border-term/40 text-term" : "border-border text-muted-foreground")
          }
        >
          {on ? "ON" : "OFF"}
        </span>
        <div className="flex-1">
          <div className="text-sm font-medium">Custom domain needs approval</div>
          <div className="text-xs text-muted-foreground">
            When on, a custom-domain bind waits for human approval before going
            live (PRD §7.2).
          </div>
        </div>
        <button
          type="button"
          onClick={toggleCustomDomain}
          disabled={saving}
          data-testid="toggle-custom-domain"
          className="rounded-md border border-border px-3 py-1.5 text-xs transition-colors hover:bg-secondary disabled:opacity-50"
        >
          {saving ? "Saving…" : on ? "Turn off" : "Turn on"}
        </button>
      </div>
      <div className="border-t border-border px-4 py-2 text-xs text-muted-foreground tabular-nums">
        last set:{" "}
        {policy.updatedAt === null
          ? "never (defaults)"
          : formatTime(policy.updatedAt)}
      </div>
    </div>
  );
}
