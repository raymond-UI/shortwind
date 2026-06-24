import { PolicyView } from "./PolicyView";
import { EmptyState } from "../components/EmptyState";

/**
 * Settings (epic #184, issue #6 — initial). Account-level configuration: the
 * policy toggles (folded in from the old standalone Policy view) plus API
 * tokens. The token list/revoke UI + its backend auth-gating land in #6 proper.
 */
export function SettingsView() {
  return (
    <div className="max-w-2xl space-y-10" data-testid="settings-view">
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold">Policy</h2>
          <p className="text-xs text-muted-foreground">
            Account-wide controls applied to every page.
          </p>
        </div>
        <PolicyView />
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold">API tokens</h2>
          <p className="text-xs text-muted-foreground">
            Scoped bearer tokens used by the CLI and agents.
          </p>
        </div>
        <EmptyState
          icon="🔑"
          title="Token management is coming"
          description="List and revoke your API tokens here."
          testId="tokens-empty"
        />
      </section>
    </div>
  );
}
