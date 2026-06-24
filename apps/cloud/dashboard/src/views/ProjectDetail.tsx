import { useState } from "react";
import { useDashboardData } from "../lib/data";
import { formatTime, relativeTime, shortHash } from "../lib/format";
import { pageHost, pageUrl } from "../lib/urls";
import { Badge, LifecycleStatus, VisibilityBadge } from "../components/Badge";
import { EmptyState } from "../components/EmptyState";
import type {
  PageVersionRow,
  PageWithVersions,
  Visibility,
} from "../lib/types";

type DetailTab = "overview" | "deployments" | "settings";

/**
 * Project detail (epic #184, issue #3) — a single hosted page: its live URL,
 * status, deployment (version) history, and settings. Drilled into from the
 * Overview grid. Reads the selected page out of the already-loaded `listPages`
 * dataset (each row carries its versions), so no extra query is needed.
 *
 * Read-side + open/copy actions land here; mutating actions (change visibility,
 * delete) require an operator-session write path on the backend and arrive with
 * issue #190.
 */
export function ProjectDetail({
  pageId,
  onBack,
}: {
  pageId: string;
  onBack: () => void;
}) {
  const { pages } = useDashboardData();
  const [tab, setTab] = useState<DetailTab>("overview");

  if (pages === undefined) {
    return <div className="text-sm text-muted-foreground">Loading…</div>;
  }
  const entry = pages.find((p) => p.page.id === pageId);
  if (!entry) {
    return (
      <EmptyState
        icon="∅"
        title="Page not found"
        description="It may have been deleted."
      >
        <BackButton onBack={onBack} />
      </EmptyState>
    );
  }

  const { page } = entry;
  const url = pageUrl(page.slug, page.customDomain);

  return (
    <div className="space-y-6" data-testid="project-detail">
      <div className="space-y-3">
        <BackButton onBack={onBack} />
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold tracking-tight">{page.slug}</h2>
          <LifecycleStatus lifecycle={page.lifecycle} />
          <VisibilityBadge visibility={page.visibility} />
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-muted-foreground hover:text-term"
          >
            {pageHost(page.slug, page.customDomain)} ↗
          </a>
          <CopyButton value={url} />
        </div>
      </div>

      <nav className="flex gap-1 border-b border-border" aria-label="Project">
        {(["overview", "deployments", "settings"] as DetailTab[]).map((t) => (
          <button
            key={t}
            type="button"
            aria-current={t === tab}
            onClick={() => setTab(t)}
            className={
              "-mb-px border-b-2 px-3 py-2 text-sm capitalize transition-colors " +
              (t === tab
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground")
            }
          >
            {t}
          </button>
        ))}
      </nav>

      {tab === "overview" ? <OverviewTab entry={entry} /> : null}
      {tab === "deployments" ? <DeploymentsTab entry={entry} /> : null}
      {tab === "settings" ? (
        <SettingsTab entry={entry} onBack={onBack} />
      ) : null}
    </div>
  );
}

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <button
      type="button"
      onClick={onBack}
      className="text-xs text-muted-foreground transition-colors hover:text-foreground"
    >
      ← All pages
    </button>
  );
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      className="rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
    >
      {copied ? "copied" : "copy URL"}
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-border/60 py-2 text-sm last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}

function OverviewTab({ entry }: { entry: PageWithVersions }) {
  const { page } = entry;
  return (
    <div className="max-w-xl rounded-lg border border-border bg-card px-4">
      <Field label="Slug">{page.slug}</Field>
      <Field label="Live URL">
        <a
          href={pageUrl(page.slug, page.customDomain)}
          target="_blank"
          rel="noreferrer"
          className="hover:text-term"
        >
          {pageHost(page.slug, page.customDomain)}
        </a>
      </Field>
      <Field label="Visibility">
        <VisibilityBadge visibility={page.visibility} />
      </Field>
      <Field label="Status">
        <LifecycleStatus lifecycle={page.lifecycle} />
      </Field>
      <Field label="Current version">v{page.currentVersion}</Field>
      <Field label="Tags">
        {page.tags.length ? page.tags.join(", ") : "—"}
      </Field>
      <Field label="Created">{formatTime(page.createdAt)}</Field>
      <Field label="Updated">
        {formatTime(page.updatedAt)} ({relativeTime(page.updatedAt)})
      </Field>
    </div>
  );
}

function DeploymentsTab({ entry }: { entry: PageWithVersions }) {
  const { versions } = entry;
  if (versions.length === 0) {
    return (
      <EmptyState icon="⏳" title="No deployments yet" testId="deployments-empty" />
    );
  }
  return (
    <div
      data-testid="deployments"
      className="overflow-hidden rounded-lg border border-border"
    >
      {versions.map((v, i) => (
        <DeploymentRow key={v.id} version={v} current={i === 0} />
      ))}
    </div>
  );
}

function DeploymentRow({
  version,
  current,
}: {
  version: PageVersionRow;
  current: boolean;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-border px-4 py-3 text-sm last:border-0">
      <span className="font-medium">v{version.version}</span>
      {current ? <Badge tone="accent">current</Badge> : null}
      <span className="text-xs text-muted-foreground">
        src {shortHash(version.sourceHash)} · out {shortHash(version.expandedHash)}
      </span>
      <span className="ml-auto text-xs text-muted-foreground">
        {relativeTime(version.createdAt)}
      </span>
    </div>
  );
}

const VISIBILITIES: Visibility[] = ["public", "unlisted", "private"];

function SettingsTab({
  entry,
  onBack,
}: {
  entry: PageWithVersions;
  onBack: () => void;
}) {
  const { setVisibility, deletePage } = useDashboardData();
  const { page } = entry;
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const dead = page.lifecycle !== "active";

  async function changeVisibility(next: Visibility) {
    if (next === page.visibility || busy) return;
    setBusy(true);
    try {
      await setVisibility(page.id, next);
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    setBusy(true);
    try {
      await deletePage(page.id);
      onBack();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-xl space-y-6">
      <div className="space-y-3 rounded-lg border border-border bg-card p-4">
        <div className="text-sm font-medium">Visibility</div>
        <div className="flex gap-2" role="group" aria-label="Visibility">
          {VISIBILITIES.map((vis) => {
            const current = vis === page.visibility;
            return (
              <button
                key={vis}
                type="button"
                disabled={busy || dead}
                aria-pressed={current}
                data-testid={`visibility-${vis}`}
                onClick={() => changeVisibility(vis)}
                className={
                  "rounded-md border px-3 py-1.5 text-xs capitalize transition-colors disabled:opacity-50 " +
                  (current
                    ? "border-foreground bg-secondary text-foreground"
                    : "border-border text-muted-foreground hover:text-foreground")
                }
              >
                {vis}
              </button>
            );
          })}
        </div>
      </div>

      {dead ? null : (
        <div className="space-y-3 rounded-lg border border-destructive/40 p-4">
          <div className="text-sm font-medium text-destructive">Danger zone</div>
          <p className="text-xs text-muted-foreground">
            Deleting tombstones the page — it stops serving (410) but its versions
            are retained (§8.2).
          </p>
          {confirming ? (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onDelete}
                disabled={busy}
                data-testid="confirm-delete"
                className="rounded-md border border-destructive bg-destructive px-3 py-1.5 text-xs text-destructive-foreground disabled:opacity-50"
              >
                {busy ? "Deleting…" : "Confirm delete"}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={busy}
                className="rounded-md border border-border px-3 py-1.5 text-xs"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              data-testid="delete-page"
              className="rounded-md border border-destructive/60 px-3 py-1.5 text-xs text-destructive transition-colors hover:bg-destructive/10"
            >
              Delete page
            </button>
          )}
        </div>
      )}
    </div>
  );
}
