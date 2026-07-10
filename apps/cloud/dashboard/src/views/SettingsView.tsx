import { useState } from "react";
import { useDashboardData } from "../lib/data";
import { formatTime, relativeTime } from "../lib/format";
import { PolicyView } from "./PolicyView";
import { Badge } from "../components/Badge";
import { CopyValue } from "../components/CopyValue";
import { SectionHeader } from "../components/SectionHeader";
import { SkeletonRows } from "../components/Skeleton";
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
      <section className="space-y-4">
        <SectionHeader eyebrow="Policy" title="Account policy" />
        <PolicyView />
      </section>

      <section className="space-y-4">
        <SectionHeader eyebrow="Access" title="API tokens" />
        <TokenList />
      </section>
    </div>
  );
}

function TokenList() {
  const { tokens } = useDashboardData();

  if (tokens === undefined) {
    return <SkeletonRows count={3} label="Loading tokens" />;
  }
  if (tokens.length === 0) {
    // Same ghost pattern as the Overview archive card — compact, with the
    // CLI command right there to copy instead of a hero-sized empty state.
    return (
      <div
        data-testid="tokens-empty"
        className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border p-6 text-center text-xs text-muted-foreground"
      >
        <span>No API tokens yet. Mint one from the CLI:</span>
        <div className="rounded-md border border-border bg-secondary/50 px-2 py-1">
          <CopyValue value="shortwind cloud login" />
        </div>
      </div>
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
      <span
        aria-hidden="true"
        className={
          "mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-md border text-sm " +
          (revoked
            ? "border-border bg-secondary text-muted-foreground opacity-60"
            : "border-term/30 bg-term/10 text-term")
        }
      >
        🔑
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className={
              "truncate font-medium " + (revoked ? "line-through opacity-70" : "")
            }
          >
            {token.label ?? "(unlabeled)"}
          </span>
          {revoked ? <Badge tone="danger">revoked</Badge> : null}
        </div>
        <div className="mt-1 flex flex-wrap gap-1">
          {token.scopes.map((s) => (
            <Badge key={s} outline>
              {s}
            </Badge>
          ))}
        </div>
        <div className="mt-1.5 text-xs text-muted-foreground tabular-nums">
          <span title={formatTime(token.createdAt)}>
            created {relativeTime(token.createdAt)}
          </span>
          {/* Expiry is in the future — relative phrasing can't say that. */}
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
