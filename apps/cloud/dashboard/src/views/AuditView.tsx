import { useDashboardData } from "../lib/data";
import { formatTime } from "../lib/format";

/**
 * Audit log view (CLOUD-35, PRD §6.3): the chronological actor/action feed.
 * Newest first. This is the operator's catch-all oversight trail.
 */
export function AuditView() {
  const { auditLog } = useDashboardData();

  if (auditLog === undefined) {
    return <div className="empty">Loading audit log…</div>;
  }
  if (auditLog.length === 0) {
    return <div className="empty">No audit events yet.</div>;
  }

  return (
    <div className="panel" data-testid="audit-view">
      {auditLog.map((e) => (
        <div className="row" key={e.id} data-testid="audit-row">
          <span className="muted mono" style={{ minWidth: 168 }}>
            {formatTime(e.createdAt)}
          </span>
          <span className="badge">{e.action}</span>
          <span className="muted mono" style={{ flex: 1 }}>
            {e.targetId ?? "—"}
          </span>
        </div>
      ))}
    </div>
  );
}
