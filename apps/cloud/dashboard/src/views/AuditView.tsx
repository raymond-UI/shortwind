import { useDashboardData } from "../lib/data";
import { formatTime } from "../lib/format";
import { Badge } from "../components/Badge";
import { EmptyState } from "../components/EmptyState";

/**
 * Audit log view (CLOUD-35, PRD §6.3) — the chronological actor/action feed,
 * restyled as a timeline (epic #184, #189). Newest first.
 */
export function AuditView() {
  const { auditLog } = useDashboardData();

  if (auditLog === undefined) {
    return <div className="@muted">Loading audit log…</div>;
  }
  if (auditLog.length === 0) {
    return <EmptyState icon="◷" title="No audit events yet" />;
  }

  return (
    <ul data-testid="audit-view" className="@list-bordered list-none">
      {auditLog.map((e) => (
        <li key={e.id} data-testid="audit-row" className="@list-item gap-3">

          <span className="w-44 shrink-0 text-xs text-muted-foreground tabular-nums">
            {formatTime(e.createdAt)}
          </span>
          <Badge>{e.action}</Badge>
          <span className="truncate text-xs text-muted-foreground">
            {e.targetId ?? "—"}
          </span>
        </li>
      ))}
    </ul>
  );
}
