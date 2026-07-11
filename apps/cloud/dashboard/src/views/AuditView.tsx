import { History } from "lucide-react";
import { useDashboardData } from "../lib/data";
import { formatTime, relativeTime } from "../lib/format";
import { CopyValue } from "../components/CopyValue";
import { EmptyState } from "../components/EmptyState";
import { SkeletonRows } from "../components/Skeleton";

/** Exceptions-only: destructive actions read as danger, the rest stay quiet. */
function isDestructive(action: string): boolean {
  return /delete|revoke|quarantine|kill|remove/i.test(action);
}

/**
 * Audit log view (CLOUD-35, PRD §6.3) — the chronological actor/action feed,
 * restyled as a timeline (epic #184; console redesign). Newest first. The
 * action is quiet mono text (a badge per row was chip soup); only destructive
 * actions get the danger color. Times are relative with the absolute in the
 * tooltip.
 */
export function AuditView() {
  const { auditLog } = useDashboardData();

  if (auditLog === undefined) {
    return <SkeletonRows count={5} label="Loading audit log" />;
  }
  if (auditLog.length === 0) {
    return (
      <EmptyState
        icon={<History className="h-6 w-6" aria-hidden="true" />}
        title="No audit events yet"
      />
    );
  }

  return (
    <ul data-testid="audit-view" className="@list-bordered list-none">
      {auditLog.map((e) => {
        const danger = isDestructive(e.action);
        return (
          <li
            key={e.id}
            data-testid="audit-row"
            className="@list-item items-center gap-3"
          >
            <span
              className={
                "h-1.5 w-1.5 shrink-0 rounded-full " +
                (danger ? "bg-destructive" : "bg-term")
              }
              aria-hidden="true"
            />
            <span
              className={
                "shrink-0 font-mono text-xs font-medium " +
                (danger ? "text-destructive" : "")
              }
            >
              {e.action}
            </span>
            {e.targetId ? (
              <CopyValue value={e.targetId} className="min-w-0 text-xs" />
            ) : null}
            <span
              className="ml-auto shrink-0 text-[11px] text-muted-foreground tabular-nums"
              title={formatTime(e.createdAt)}
            >
              {relativeTime(e.createdAt)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
