import { useState } from "react";
import { useDashboardData } from "../lib/data";
import { formatTime, relativeTime } from "../lib/format";
import { Skeleton } from "../components/Skeleton";

/**
 * Policy toggles (CLOUD-35, PRD §7.2) — restyled and folded into Settings
 * (epic #184). The one place the dashboard WRITES: flipping a toggle calls
 * `setAccountPolicy`. Today's single toggle is `customDomainNeedsApproval`.
 */
export function PolicyView() {
  const { policy, setPolicy } = useDashboardData();
  const [saving, setSaving] = useState(false);

  // The toggle's label/description are static (/ui: render known elements
  // immediately) — only the on/off state and "last set" wait on data.
  const loading = policy === undefined;

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

  const on = policy?.customDomainNeedsApproval ?? false;

  return (
    <div
      data-testid="policy-view"
      className="@card @stack-sm"
      {...(loading
        ? { role: "status", "aria-label": "Loading policy", "aria-busy": true }
        : {})}
    >
      <div className="@row flex items-center gap-4">
        {loading ? (
          <Skeleton className="h-5 w-10" />
        ) : (
          <span
            data-testid="custom-domain-state"
            className="@badge"
            {...(on ? { "data-tone": "success" } : {})}
          >
            {on ? "ON" : "OFF"}
          </span>
        )}
        <div className="flex-1">
          <div className="text-sm font-medium">Custom domain needs approval</div>
          <div className="@caption">
            When on, a custom-domain bind waits for human approval before going
            live (PRD §7.2).
          </div>
        </div>
        {loading ? (
          <Skeleton className="h-7 w-20 shrink-0" />
        ) : (
          <button
            type="button"
            onClick={toggleCustomDomain}
            disabled={saving}
            data-testid="toggle-custom-domain"
            className="@button-secondary-sm shrink-0"
          >
            {saving ? "Saving…" : on ? "Turn off" : "Turn on"}
          </button>
        )}
      </div>
      <div className="mt-2 border-t border-border pt-3 text-[11px] text-muted-foreground tabular-nums">
        last set:{" "}
        {policy === undefined ? (
          <Skeleton className="inline-block h-3 w-14 align-middle" />
        ) : policy.updatedAt === null ? (
          "never (defaults)"
        ) : (
          <span title={formatTime(policy.updatedAt)}>
            {relativeTime(policy.updatedAt)}
          </span>
        )}
      </div>
    </div>
  );
}
