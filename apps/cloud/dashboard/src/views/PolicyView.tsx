import { useState } from "react";
import { useDashboardData } from "../lib/data";
import { formatTime } from "../lib/format";

/**
 * Policy view (CLOUD-35, PRD §3/§7.2): operator policy toggles. The one place
 * the dashboard WRITES — flipping a toggle calls `setAccountPolicy`. Today's
 * single toggle is `customDomainNeedsApproval` (the human-gated custom-domain
 * bind). Read-mostly everywhere else; this is the operator's lever.
 */
export function PolicyView() {
  const { policy, setPolicy } = useDashboardData();
  const [saving, setSaving] = useState(false);

  if (policy === undefined) {
    return <div className="empty">Loading policy…</div>;
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

  return (
    <div className="panel" data-testid="policy-view">
      <div className="toggle">
        <span
          className={`badge${policy.customDomainNeedsApproval ? "" : " danger"}`}
          data-testid="custom-domain-state"
        >
          {policy.customDomainNeedsApproval ? "ON" : "OFF"}
        </span>
        <div style={{ flex: 1 }}>
          <div>Custom domain needs approval</div>
          <div className="muted">
            When on, a custom-domain bind waits for human approval before going
            live (PRD §7.2).
          </div>
        </div>
        <button
          onClick={toggleCustomDomain}
          disabled={saving}
          data-testid="toggle-custom-domain"
        >
          {saving
            ? "Saving…"
            : policy.customDomainNeedsApproval
              ? "Turn off"
              : "Turn on"}
        </button>
      </div>
      <div className="row muted mono">
        last set:{" "}
        {policy.updatedAt === null ? "never (defaults)" : formatTime(policy.updatedAt)}
      </div>
    </div>
  );
}
