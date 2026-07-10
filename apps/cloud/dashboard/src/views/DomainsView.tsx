import { useState } from "react";
import { useDashboardData } from "../lib/data";
import { formatTime, relativeTime } from "../lib/format";
import { CopyValue } from "../components/CopyValue";
import { SectionHeader } from "../components/SectionHeader";
import { SkeletonPanel } from "../components/Skeleton";
import type { AccountDomainRow, DomainStatus } from "../lib/types";

/**
 * Domains — ACCOUNT-level custom domains, managed from the UI (CLI ↔ web
 * parity). A domain aliases the whole account: every page serves at
 * `<hostname>/<slug>` (plus its `<slug>.shortwind.app` vanity URL).
 *
 * Flow: enter a subdomain you own → we create the Cloudflare-for-SaaS custom
 * hostname → you add ONE CNAME → click "Check status" until the cert is active.
 * Binding here uses the operator SESSION (auto-approved); agent/CLI binds honor
 * the `domains:bind` scope + approval policy.
 */

/**
 * Extract a human message + code from a thrown error. A Convex function that
 * throws `ConvexError({ code, message })` surfaces the payload on `error.data`
 * (NOT `error.message`, the "[Request ID …] Server Error" wrapper).
 */
function readError(e: unknown): { message: string; code?: string } {
  const data = (e as { data?: unknown } | null | undefined)?.data;
  if (data && typeof data === "object") {
    const d = data as { code?: unknown; message?: unknown };
    if (typeof d.message === "string" && d.message.length > 0) {
      return {
        message: d.message,
        code: typeof d.code === "string" ? d.code : undefined,
      };
    }
  }
  return { message: "Something went wrong. Please try again." };
}

/**
 * Per-status presentation via the theme's tone system (data-tone on @badge) —
 * no raw palette colors; the dot inherits the tone's foreground (bg-current).
 */
const STATUS_STYLE: Record<
  DomainStatus,
  { label: string; tone: "success" | "warning" | "info" | "danger"; pulse?: boolean; hint: string }
> = {
  active: {
    label: "Active",
    tone: "success",
    hint: "Live — your pages serve on this domain.",
  },
  "pending-cert": {
    label: "Verifying",
    tone: "warning",
    pulse: true,
    hint: "Add the CNAME below, then Check status.",
  },
  queued: {
    label: "Queued",
    tone: "warning",
    pulse: true,
    hint: "Waiting on Cloudflare — retry shortly.",
  },
  "pending-human": {
    label: "Needs approval",
    tone: "info",
    hint: "Approve to provision the certificate.",
  },
  failed: {
    label: "Failed",
    tone: "danger",
    hint: "Check the CNAME record, then Check status.",
  },
};

function StatusBadge({ status }: { status: DomainStatus }) {
  const s = STATUS_STYLE[status];
  return (
    <span className="@badge shrink-0 gap-1.5" data-tone={s.tone}>
      <span
        className={
          "h-1.5 w-1.5 rounded-full bg-current" +
          (s.pulse ? " animate-pulse" : "")
        }
        aria-hidden
      />
      {s.label}
    </span>
  );
}

/** DNS record the customer must add. CF for SaaS uses HTTP DV → one CNAME. */
function DnsInstructions({
  hostname,
  cnameTarget,
}: {
  hostname: string;
  cnameTarget: string | undefined;
}) {
  const rows: Array<{ label: string; value: string; copy: boolean }> = [
    { label: "Type", value: "CNAME", copy: false },
    { label: "Name", value: hostname, copy: true },
    { label: "Target", value: cnameTarget ?? "…", copy: Boolean(cnameTarget) },
  ];
  return (
    <div className="rounded-md border border-border bg-background/60 p-3">
      <div className="@caption mb-2">
        Add this record at your DNS provider:
      </div>
      <div className="divide-y divide-border/60 rounded-md border border-border/60">
        {rows.map((r) => (
          <div
            key={r.label}
            className="flex items-center gap-3 px-3 py-2 text-sm"
          >
            <span className="w-16 shrink-0 text-xs uppercase tracking-wide text-muted-foreground">
              {r.label}
            </span>
            {r.copy ? (
              <CopyValue
                value={r.value}
                testId={`domain-copy-${r.label.toLowerCase()}`}
              />
            ) : (
              <span className="font-mono">{r.value}</span>
            )}
          </div>
        ))}
      </div>
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
  const [error, setError] = useState<{ message: string; code?: string } | null>(
    null,
  );

  // The header is static — render it immediately and skeleton only the cards.
  const header = (
    <SectionHeader
      eyebrow="Custom domain"
      title="Bring your own domain"
      description={
        <>
          Bind a subdomain you own — every page also serves at{" "}
          <span className="font-mono">your-domain/&lt;slug&gt;</span>.
        </>
      }
    />
  );

  if (accountDomains === undefined) {
    return (
      <div className="space-y-5">
        {header}
        <SkeletonPanel lines={3} label="Loading domains" />
      </div>
    );
  }

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(readError(e));
    } finally {
      setBusy(null);
    }
  }

  // Plan caps active domains at 1 today, so the bind form shows only when the
  // account has none; otherwise we manage the existing one.
  const canBind = accountDomains.length === 0;

  return (
    <div className="space-y-5" data-testid="domains-view">
      {header}

      {canBind ? (
        <form
          className="@card space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            const h = hostname.trim();
            if (h) void run("bind", () => bindDomain(h));
          }}
          data-testid="domain-bind-form"
        >
          <label className="@caption block" htmlFor="domain-input">
            Subdomain you own
          </label>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              id="domain-input"
              type="text"
              value={hostname}
              onChange={(e) => setHostname(e.target.value)}
              placeholder="pages.example.com"
              className="@input min-w-0 sm:flex-1"
              data-testid="domain-input"
            />
            <button
              type="submit"
              className="@button-primary-sm shrink-0"
              disabled={busy !== null || hostname.trim().length === 0}
              data-testid="domain-connect"
            >
              {busy === "bind" ? "Connecting…" : "Connect"}
            </button>
          </div>
        </form>
      ) : null}

      {accountDomains.map((d: AccountDomainRow) => {
        const s = STATUS_STYLE[d.status];
        const active = d.status === "active";
        // Same anatomy as the Overview cards: identity block + semibold name
        // over a dim sub-line, dot-only for the good state (words are for
        // exceptions), and a quiet border-separated footer with the meta +
        // the action that applies.
        return (
          <div
            key={d.id}
            data-testid={`domain-${d.hostname}`}
            className="@card flex flex-col p-5"
          >
            <div className="flex items-start gap-3">
              <span
                aria-hidden="true"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border bg-secondary text-xs font-semibold text-term"
              >
                ⊞
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] font-semibold leading-6 tracking-tight">
                  {d.hostname}
                </div>
                <div className="truncate text-xs text-muted-foreground/80">
                  {d.hostname}/&lt;slug&gt;
                </div>
              </div>
              {active ? (
                <span className="mt-1.5 flex shrink-0" title="active">
                  <span
                    className="h-2 w-2 rounded-full bg-term"
                    aria-hidden="true"
                  />
                  <span className="sr-only">active</span>
                  <span data-testid={`domain-active-${d.hostname}`} hidden />
                </span>
              ) : (
                <StatusBadge status={d.status} />
              )}
            </div>

            {!active ? (
              <div className="mt-4">
                <DnsInstructions
                  hostname={d.hostname}
                  cnameTarget={cnameTarget}
                />
              </div>
            ) : null}

            <div className="mt-6 flex items-center gap-3 border-t border-border pt-3">
              <span className="min-w-0 truncate text-[11px] text-muted-foreground">
                {active ? (
                  d.verifiedAt !== null ? (
                    <span title={formatTime(d.verifiedAt)}>
                      verified {relativeTime(d.verifiedAt)}
                    </span>
                  ) : (
                    "verified"
                  )
                ) : (
                  s.hint
                )}
              </span>
              {!active ? (
                <span className="ml-auto shrink-0">
                  {d.status === "pending-human" ? (
                    <button
                      type="button"
                      className="@button-secondary-sm"
                      disabled={busy !== null}
                      onClick={() =>
                        void run("approve", () => approveDomain(d.hostname))
                      }
                      data-testid={`domain-approve-${d.hostname}`}
                    >
                      {busy === "approve" ? "Approving…" : "Approve"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="@button-secondary-sm"
                      disabled={busy !== null}
                      onClick={() =>
                        void run("recheck", () => recheckDomain(d.hostname))
                      }
                      data-testid={`domain-recheck-${d.hostname}`}
                    >
                      {busy === "recheck" ? "Checking…" : "Check status"}
                    </button>
                  )}
                </span>
              ) : null}
            </div>
          </div>
        );
      })}

      {error ? (
        <div
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3"
          data-testid="domain-error"
          role="alert"
        >
          <p className="text-sm text-destructive">{error.message}</p>
          {error.code === "NOT_ENTITLED" ? (
            <p className="@caption mt-1">
              Open the <span className="font-medium">Billing</span> tab to
              upgrade to Pro, then bind your domain.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
