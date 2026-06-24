import { useDashboardData } from "../lib/data";
import { EmptyState } from "../components/EmptyState";

/**
 * Domains (epic #184, issue #4 — initial). Custom hostnames bound across the
 * account's pages. The page record carries the bound `customDomain`; richer
 * bind-status (pending-cert / active / failed) + a bind action land in #4 proper.
 */
export function DomainsView() {
  const { pages } = useDashboardData();

  if (pages === undefined) {
    return <div className="text-sm text-muted-foreground">Loading domains…</div>;
  }

  const domains = pages
    .filter((p) => p.page.customDomain)
    .map((p) => ({
      domain: p.page.customDomain as string,
      slug: p.page.slug,
      id: p.page.id,
    }));

  if (domains.length === 0) {
    return (
      <EmptyState
        icon="🌐"
        title="No custom domains yet"
        description="Bind a custom hostname to a page to serve it on your own domain."
        testId="domains-empty"
      />
    );
  }

  return (
    <div
      data-testid="domains-view"
      className="divide-y divide-border overflow-hidden rounded-lg border border-border"
    >
      {domains.map((d) => (
        <div
          key={d.id}
          className="flex items-center justify-between px-4 py-3 text-sm"
        >
          <span className="font-medium">{d.domain}</span>
          <span className="text-xs text-muted-foreground">/{d.slug}</span>
        </div>
      ))}
    </div>
  );
}
