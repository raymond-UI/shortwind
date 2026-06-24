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
    return <div className="text-sm text-muted-foreground">Loading audit log…</div>;
  }
  if (auditLog.length === 0) {
    return <EmptyState icon="◷" title="No audit events yet" />;
  }

  return (
    <div
      data-testid="audit-view"
      className="overflow-hidden rounded-lg border border-border"
    >
      {auditLog.map((e) => (
        <div
          key={e.id}
          data-testid="audit-row"
          className="flex items-center gap-3 border-b border-border px-4 py-2.5 text-sm last:border-0"
        >
          <span className="w-44 shrink-0 text-xs text-muted-foreground tabular-nums">
            {formatTime(e.createdAt)}
          </span>
          <Badge>{e.action}</Badge>
          <span className="truncate text-xs text-muted-foreground">
            {e.targetId ?? "—"}
          </span>
        </div>
      ))}
    </div>
  );
}
