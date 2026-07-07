import { useState } from "react";
import { useDashboardData } from "../lib/data";
import { EmptyState } from "../components/EmptyState";
import type { DomainStatus } from "../lib/types";

/**
 * Domains — ACCOUNT-level custom domains. A domain is an alias of the whole
 * account: every page serves at `<hostname>/<slug>` (plus its
 * `<slug>.shortwind.app` vanity URL). Binding is an agent/CLI action (needs a
 * `domains:bind` token); the operator's job here is to VIEW status and APPROVE a
 * domain parked in `pending-human` by the approval policy.
 */

const STATUS_LABEL: Record<DomainStatus, string> = {
  "pending-human": "Awaiting your approval",
  queued: "Queued (Cloudflare rate limit)",
  "pending-cert": "Issuing certificate…",
  active: "Active",
  failed: "Failed",
};

export function DomainsView() {
  const { accountDomains, approveDomain } = useDashboardData();
  const [busy, setBusy] = useState<string | null>(null);

  if (accountDomains === undefined) {
    return <div className="@muted">Loading domains…</div>;
  }

  if (accountDomains.length === 0) {
    return (
      <EmptyState
        icon="🌐"
        title="No custom domain yet"
        description="Bind a subdomain you own (e.g. pages.example.com) from the CLI. Every page then serves at your-domain/slug."
        testId="domains-empty"
      />
    );
  }

  async function onApprove(hostname: string) {
    setBusy(hostname);
    try {
      await approveDomain(hostname);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3" data-testid="domains-view">
      <p className="@caption">
        A custom domain is account-wide — every page also serves at{" "}
        <span className="tabular-nums">your-domain/&lt;slug&gt;</span>.
      </p>
      <ul className="@list-bordered list-none">
        {accountDomains.map((d) => (
          <li
            key={d.id}
            data-testid={`domain-${d.hostname}`}
            className="@list-item justify-between"
          >
            <span className="flex flex-col">
              <span className="font-medium">{d.hostname}</span>
              <span className="@caption">{STATUS_LABEL[d.status]}</span>
            </span>
            {d.status === "pending-human" ? (
              <button
                type="button"
                className="@btn-outline shrink-0"
                disabled={busy !== null}
                onClick={() => onApprove(d.hostname)}
                data-testid={`domain-approve-${d.hostname}`}
              >
                {busy === d.hostname ? "Approving…" : "Approve"}
              </button>
            ) : (
              <span
                className={
                  d.status === "active"
                    ? "@badge text-term"
                    : "@caption tabular-nums"
                }
              >
                {d.status}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
