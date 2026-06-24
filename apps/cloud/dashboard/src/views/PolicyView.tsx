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
    return <div className="@muted">Loading policy…</div>;
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
    <div data-testid="policy-view" className="@card @stack-sm">
      <div className="@row flex items-center gap-4">
        <span
          data-testid="custom-domain-state"
          className="@badge"
          {...(on ? { "data-tone": "success" } : {})}
        >
          {on ? "ON" : "OFF"}
        </span>
        <div className="flex-1">
          <div className="text-sm font-medium">Custom domain needs approval</div>
          <div className="@caption">
            When on, a custom-domain bind waits for human approval before going
            live (PRD §7.2).
          </div>
        </div>
        <button
          type="button"
          onClick={toggleCustomDomain}
          disabled={saving}
          data-testid="toggle-custom-domain"
          className="@btn-outline shrink-0"
        >
          {saving ? "Saving…" : on ? "Turn off" : "Turn on"}
        </button>
      </div>
      <div className="@caption tabular-nums">
        last set:{" "}
        {policy.updatedAt === null
          ? "never (defaults)"
          : formatTime(policy.updatedAt)}
      </div>
    </div>
  );
}
