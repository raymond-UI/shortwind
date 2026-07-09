import { useState } from "react";
import { useDashboardData } from "../lib/data";
import type { AccountDomainRow, DomainStatus } from "../lib/types";

/**
 * Domains — ACCOUNT-level custom domains, managed from the UI (CLI ↔ web
 * parity). A domain aliases the whole account: every page serves at
 * `<hostname>/<slug>` (plus its `<slug>.shortwind.app` vanity URL).
 *
 * Flow: enter a subdomain you own → we create the Cloudflare-for-SaaS custom
 * hostname (HTTP DV) → you add ONE CNAME to your DNS → click "Check status"
 * until the cert goes active. Binding here uses the operator SESSION (the
 * account owner), so it's auto-approved; agent/CLI binds still honor the
 * `domains:bind` scope + approval policy.
 */

const STATUS_LABEL: Record<DomainStatus, string> = {
  "pending-human": "Awaiting approval",
  queued: "Queued (Cloudflare rate limit)",
  "pending-cert": "Verifying — add the CNAME below, then Check status",
  active: "Active",
  failed: "Verification failed — check the CNAME, then Check status",
};

/** DNS record the customer must add. CF for SaaS uses HTTP DV → one CNAME. */
function DnsInstructions({
  hostname,
  cnameTarget,
}: {
  hostname: string;
  cnameTarget: string | undefined;
}) {
  return (
    <div className="mt-2 rounded-md border border-border bg-background p-3">
      <div className="@caption mb-2">
        Add this record at your DNS provider (for {hostname}):
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm tabular-nums">
        <dt className="@caption">Type</dt>
        <dd>CNAME</dd>
        <dt className="@caption">Name</dt>
        <dd className="break-all">{hostname}</dd>
        <dt className="@caption">Target</dt>
        <dd className="break-all">{cnameTarget ?? "…"}</dd>
      </dl>
    </div>
  );
}

export function DomainsView() {
  const {
    accountDomains,
    cnameTarget,
    bindDomain,
    recheckDomain,
    approveDomain,
  } = useDashboardData();

  const [hostname, setHostname] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (accountDomains === undefined) {
    return <div className="@muted">Loading domains…</div>;
  }

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(
        e instanceof Error && e.message
          ? e.message.replace(/^\[.*?\]\s*/, "")
          : "Something went wrong. Please try again.",
      );
    } finally {
      setBusy(null);
    }
  }

  // Plan caps active domains at 1 today, so the bind form shows only when the
  // account has none; otherwise we manage the existing one.
  const canBind = accountDomains.length === 0;

  return (
    <div className="space-y-4" data-testid="domains-view">
      <p className="@caption">
        A custom domain is account-wide — every page also serves at{" "}
        <span className="tabular-nums">your-domain/&lt;slug&gt;</span>. Bind a
        subdomain you own (e.g. <span className="tabular-nums">pages.example.com</span>),
        not a bare apex.
      </p>

      {canBind ? (
        <form
          className="@card flex flex-col gap-2 sm:flex-row sm:items-center"
          onSubmit={(e) => {
            e.preventDefault();
            const h = hostname.trim();
            if (h) void run("bind", () => bindDomain(h));
          }}
          data-testid="domain-bind-form"
        >
          <input
            type="text"
            value={hostname}
            onChange={(e) => setHostname(e.target.value)}
            placeholder="pages.example.com"
            aria-label="Custom domain (a subdomain you own)"
            className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
            data-testid="domain-input"
          />
          <button
            type="submit"
            className="@btn-outline shrink-0"
            disabled={busy !== null || hostname.trim().length === 0}
            data-testid="domain-connect"
          >
            {busy === "bind" ? "Connecting…" : "Connect"}
          </button>
        </form>
      ) : null}

      {accountDomains.map((d: AccountDomainRow) => (
        <div
          key={d.id}
          data-testid={`domain-${d.hostname}`}
          className="@card space-y-2"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col">
              <span className="font-medium">{d.hostname}</span>
              <span className="@caption">{STATUS_LABEL[d.status]}</span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {d.status === "pending-human" ? (
                <button
                  type="button"
                  className="@btn-outline"
                  disabled={busy !== null}
                  onClick={() => void run("approve", () => approveDomain(d.hostname))}
                  data-testid={`domain-approve-${d.hostname}`}
                >
                  {busy === "approve" ? "Approving…" : "Approve"}
                </button>
              ) : null}
              {d.status === "active" ? (
                <span className="@badge text-term" data-testid={`domain-active-${d.hostname}`}>
                  active
                </span>
              ) : (
                <button
                  type="button"
                  className="@btn-outline"
                  disabled={busy !== null}
                  onClick={() => void run("recheck", () => recheckDomain(d.hostname))}
                  data-testid={`domain-recheck-${d.hostname}`}
                >
                  {busy === "recheck" ? "Checking…" : "Check status"}
                </button>
              )}
            </div>
          </div>

          {d.status !== "active" ? (
            <DnsInstructions hostname={d.hostname} cnameTarget={cnameTarget} />
          ) : null}
        </div>
      ))}

      {error ? (
        <p className="@caption text-destructive" data-testid="domain-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
