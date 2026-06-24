import { useDashboardData } from "../lib/data";
import { formatTime } from "../lib/format";
import { Badge } from "../components/Badge";
import { EmptyState } from "../components/EmptyState";
import type { ModerationState } from "../lib/types";

/**
 * Moderation view (epic #184, #192) — restyled as an OWNER-scoped safety view:
 * the signed-in account's own reported/quarantined pages (auth is account-scoped;
 * there is no cross-account operator console yet). Preserve-not-delete (§8.2):
 * `preservedR2Key` surfaces the sealed-store pointer so the object is shown as
 * sealed, not lost.
 */
const STATE_LABEL: Record<ModerationState, string> = {
  reported: "reported",
  quarantined: "quarantined",
  preserved: "preserved",
  cleared: "cleared",
};

export function ModerationView() {
  const { moderation } = useDashboardData();

  if (moderation === undefined) {
    return (
      <div className="text-sm text-muted-foreground">
        Loading moderation queue…
      </div>
    );
  }
  if (moderation.length === 0) {
    return (
      <EmptyState
        icon="🛡"
        title="No moderation cases"
        description="None of your pages have been reported or quarantined."
      />
    );
  }

  return (
    <div data-testid="moderation-view" className="space-y-2">
      {moderation.map((m) => {
        const danger = m.state === "reported" || m.state === "quarantined";
        return (
          <div
            key={m.id}
            data-testid="moderation-row"
            className="flex gap-3 rounded-lg border border-border bg-card p-3 text-sm"
          >
            <Badge tone={danger ? "danger" : "neutral"}>
              {STATE_LABEL[m.state]}
            </Badge>
            <div className="flex-1 space-y-0.5">
              <div className="font-medium">{m.pageId}</div>
              <div className="text-xs text-muted-foreground">
                {m.reason ?? "—"}
              </div>
              {m.preservedR2Key ? (
                <div className="text-xs text-muted-foreground tabular-nums">
                  sealed: {m.preservedR2Key}
                </div>
              ) : null}
              {m.ncmecReportId ? (
                <div className="text-xs text-muted-foreground tabular-nums">
                  ncmec: {m.ncmecReportId}
                </div>
              ) : null}
            </div>
            <span className="text-xs text-muted-foreground tabular-nums">
              {formatTime(m.updatedAt)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
