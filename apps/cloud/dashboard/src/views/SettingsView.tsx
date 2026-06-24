import { useState } from "react";
import { useDashboardData } from "../lib/data";
import { formatTime } from "../lib/format";
import { PolicyView } from "./PolicyView";
import { Badge } from "../components/Badge";
import { EmptyState } from "../components/EmptyState";
import type { TokenRow } from "../lib/types";

/**
 * Settings (epic #184, issue #6) — account configuration: policy toggles (folded
 * in from the old standalone Policy view) and API tokens (list + revoke). The
 * token list/revoke go through the operator-gated, account-scoped
 * `dashboard.listTokens` / `dashboard.revokeToken` (the raw token functions are
 * internal-only now — the un-gated public ones were a cross-account hole).
 */
export function SettingsView() {
  return (
    <div className="max-w-2xl space-y-10" data-testid="settings-view">
      <section className="space-y-3">
        <div>
          <h2 className="@heading-sm">Policy</h2>
          <p className="@caption">
            Account-wide controls applied to every page.
          </p>
        </div>
        <PolicyView />
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="@heading-sm">API tokens</h2>
          <p className="@caption">
            Scoped bearer tokens used by the CLI and agents. Revoke any you no
            longer trust.
          </p>
        </div>
        <TokenList />
      </section>
    </div>
  );
}

function TokenList() {
  const { tokens } = useDashboardData();

  if (tokens === undefined) {
    return <div className="@muted">Loading tokens…</div>;
  }
  if (tokens.length === 0) {
    return (
      <EmptyState
        icon="🔑"
        title="No API tokens"
        description="Run `shortwind cloud login` to mint one."
        testId="tokens-empty"
      />
    );
  }

  return (
    <ul data-testid="tokens-view" className="@list-bordered list-none">

      {tokens.map((t) => (
        <TokenRowItem key={t.tokenId} token={t} />
      ))}
    </ul>
  );
}

function TokenRowItem({ token }: { token: TokenRow }) {
  const { revokeToken } = useDashboardData();
  const [busy, setBusy] = useState(false);
  const revoked = token.revokedAt !== null;

  async function onRevoke() {
    setBusy(true);
    try {
      await revokeToken(token.tokenId);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li data-testid="token-row" className="@list-item items-start gap-3">

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">
            {token.label ?? "(unlabeled)"}
          </span>
          {revoked ? <Badge tone="danger">revoked</Badge> : null}
        </div>
        <div className="mt-0.5 flex flex-wrap gap-1">
          {token.scopes.map((s) => (
            <Badge key={s}>{s}</Badge>
          ))}
        </div>
        <div className="mt-1 text-xs text-muted-foreground tabular-nums">
          created {formatTime(token.createdAt)}
          {token.expiresAt !== null
            ? ` · expires ${formatTime(token.expiresAt)}`
            : ""}
        </div>
      </div>
      {revoked ? null : (
        <button
          type="button"
          onClick={onRevoke}
          disabled={busy}
          data-testid={`revoke-${token.tokenId}`}
          className="shrink-0 rounded-md border border-destructive/60 px-2.5 py-1 text-xs text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
        >
          {busy ? "Revoking…" : "Revoke"}
        </button>
      )}
    </li>
  );
}
