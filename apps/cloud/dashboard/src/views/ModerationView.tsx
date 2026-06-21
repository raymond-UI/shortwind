import { useDashboardData } from "../lib/data";
import { formatTime } from "../lib/format";
import type { ModerationState } from "../lib/types";

/**
 * Moderation view (CLOUD-35, PRD §8): the abuse/quarantine queue. Oversight of
 * the kill path — the operator confirms reported/killed objects are handled and
 * (per §8.2) preserved, not deleted. `preservedR2Key` surfaces the sealed-store
 * pointer so the human can see the object was sealed, not lost.
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
    return <div className="empty">Loading moderation queue…</div>;
  }
  if (moderation.length === 0) {
    return <div className="empty">No moderation cases.</div>;
  }

  return (
    <div className="panel" data-testid="moderation-view">
      {moderation.map((m) => {
        const danger = m.state === "reported" || m.state === "quarantined";
        return (
          <div className="row" key={m.id} data-testid="moderation-row">
            <span className={`badge${danger ? " danger" : ""}`}>
              {STATE_LABEL[m.state]}
            </span>
            <div style={{ flex: 1 }}>
              <div className="mono">{m.pageId}</div>
              <div className="muted">{m.reason ?? "—"}</div>
              {m.preservedR2Key ? (
                <div className="muted mono">sealed: {m.preservedR2Key}</div>
              ) : null}
              {m.ncmecReportId ? (
                <div className="muted mono">ncmec: {m.ncmecReportId}</div>
              ) : null}
            </div>
            <span className="muted mono">{formatTime(m.updatedAt)}</span>
          </div>
        );
      })}
    </div>
  );
}
