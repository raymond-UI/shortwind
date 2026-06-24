import { EmptyState } from "../components/EmptyState";

/**
 * Analytics (epic #184, issue #7). Per-page request/bandwidth/visitor telemetry
 * does not exist in the backend yet (serving is stateless; no metrics table), so
 * this is a deliberately-designed empty state — the UI shape real edge analytics
 * (Cloudflare Analytics Engine / Logpush) will drop into. Usage/billing meters
 * live under the Usage section; this is traffic, which is a separate feature.
 */
export function AnalyticsView() {
  return (
    <div className="space-y-4" data-testid="analytics-view">
      <EmptyState
        icon="📈"
        title="Traffic analytics are coming"
        description={
          <>
            Requests, bandwidth, and visitor trends per page aren’t collected yet
            — serving is stateless by design. Edge telemetry will populate this
            view without any change to how you publish.
          </>
        }
        testId="analytics-empty"
      />
    </div>
  );
}
