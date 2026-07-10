import { useDashboardData } from "../lib/data";
import { formatTime } from "../lib/format";
import { Badge } from "../components/Badge";
import { CopyValue } from "../components/CopyValue";
import { EmptyState } from "../components/EmptyState";
import { SkeletonRows } from "../components/Skeleton";
import type { Tone } from "../components/Badge";

/** Destructive actions read as danger; everything else stays neutral. */
function actionTone(action: string): Tone | undefined {
  if (/delete|revoke|quarantine|kill|remove/i.test(action)) return "danger";
  if (/publish|create|approve|bind/i.test(action)) return "success";
  return undefined;
}

/**
 * Audit log view (CLOUD-35, PRD §6.3) — the chronological actor/action feed,
 * restyled as a timeline (epic #184, #189). Newest first.
 */
export function AuditView() {
  const { auditLog } = useDashboardData();

  if (auditLog === undefined) {
    return <SkeletonRows count={5} label="Loading audit log" />;
  }
  if (auditLog.length === 0) {
    return <EmptyState icon="◷" title="No audit events yet" />;
  }

  return (
    <ul data-testid="audit-view" className="@list-bordered list-none">
      {auditLog.map((e) => (
        <li
          key={e.id}
          data-testid="audit-row"
          className="@list-item items-center gap-3"
        >
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-term"
            aria-hidden="true"
          />
          <span className="w-40 shrink-0 text-xs text-muted-foreground tabular-nums">
            {formatTime(e.createdAt)}
          </span>
          <Badge tone={actionTone(e.action)}>{e.action}</Badge>
          {e.targetId ? (
            <CopyValue value={e.targetId} className="min-w-0 text-xs" />
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          )}
        </li>
      ))}
    </ul>
  );
}
