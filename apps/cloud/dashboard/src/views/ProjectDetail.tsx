import { useState } from "react";
import { useDashboardData } from "../lib/data";
import { formatTime, relativeTime, shortHash } from "../lib/format";
import { pageHost, pageUrl } from "../lib/urls";
import { Badge, LifecycleStatus, VisibilityBadge } from "../components/Badge";
import { EmptyState } from "../components/EmptyState";
import { Dialog } from "../components/Dialog";
import { Menu, MenuItem } from "../components/Menu";
import type {
  PageVersionRow,
  PageWithVersions,
  Visibility,
} from "../lib/types";

export type DetailTab = "overview" | "deployments" | "settings";

/** Narrow an arbitrary string (e.g. a `?tab=` param) to a known detail tab. */
export function isDetailTab(value: string | null | undefined): value is DetailTab {
  return value === "overview" || value === "deployments" || value === "settings";
}

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
  tab: controlledTab,
  onTabChange,
}: {
  pageId: string;
  onBack: () => void;
  /** When provided, the active tab is URL-driven (deep-linkable via `?tab=`). */
  tab?: DetailTab;
  onTabChange?: (tab: DetailTab) => void;
}) {
  const { pages } = useDashboardData();
  // Controlled when the route supplies `tab`/`onTabChange`; otherwise internal.
  const [internalTab, setInternalTab] = useState<DetailTab>("overview");
  const tab = controlledTab ?? internalTab;
  const setTab = onTabChange ?? setInternalTab;

  if (pages === undefined) {
    return <div className="@muted">Loading…</div>;
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
  const url = pageUrl(page.slug);

  return (
    <div className="space-y-6" data-testid="project-detail">
      <div className="space-y-3">
        <BackButton onBack={onBack} />
        {/* Same exceptions-only rule as the Overview cards: live is a dot,
            dead states keep their word. Visibility lives in the properties
            card, not here — the header is identity + address only. */}
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="@heading-md">{page.slug}</h2>
          {page.lifecycle === "active" ? (
            <span className="flex" title="live">
              <span
                aria-hidden="true"
                className="h-2 w-2 rounded-full bg-term"
              />
              <span className="sr-only">live</span>
            </span>
          ) : (
            <LifecycleStatus lifecycle={page.lifecycle} />
          )}
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="@link @caption"
          >
            {pageHost(page.slug)} ↗
          </a>
          <CopyButton value={url} />
        </div>
      </div>

      <div
        role="tablist"
        aria-label="Project sections"
        className="flex gap-1 border-b border-border"
      >
        {(["overview", "deployments", "settings"] as DetailTab[]).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            id={`tab-${t}`}
            aria-selected={t === tab}
            aria-controls={`panel-${t}`}
            onClick={() => setTab(t)}
            className={
              t === tab ? "@tab-active -mb-px capitalize" : "@tab -mb-px capitalize"
            }
          >
            {t}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id={`panel-${tab}`}
        aria-labelledby={`tab-${tab}`}
        tabIndex={0}
        className="focus:outline-none"
      >
        {tab === "overview" ? (
          <OverviewTab
            entry={entry}
            onViewDeployments={() => setTab("deployments")}
          />
        ) : null}
        {tab === "deployments" ? <DeploymentsTab entry={entry} /> : null}
        {tab === "settings" ? (
          <SettingsTab entry={entry} onBack={onBack} />
        ) : null}
      </div>
    </div>
  );
}

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <button type="button" onClick={onBack} className="@btn-ghost-sm">
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
      className="@btn-ghost-sm"
    >
      {copied ? "copied" : "copy URL"}
    </button>
  );
}

/**
 * Overview tab, reworked (console redesign): no key-value dump repeating the
 * header. A "Current deployment" hero (the thing an owner checks first) next
 * to a compact properties card; timestamps are relative with the absolute in
 * the tooltip.
 */
function OverviewTab({
  entry,
  onViewDeployments,
}: {
  entry: PageWithVersions;
  onViewDeployments: () => void;
}) {
  const { page, versions } = entry;
  const current = versions.length > 0 ? versions[0] : null;
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <section
        data-testid="current-deployment"
        className="@card flex flex-col p-5 lg:col-span-2"
      >
        <div className="flex items-center justify-between">
          <span className="@stat-label">Current deployment</span>
          <LifecycleStatus lifecycle={page.lifecycle} />
        </div>
        <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="@stat-value">v{page.currentVersion}</span>
          <span
            className="text-xs text-muted-foreground"
            title={formatTime(page.updatedAt)}
          >
            published {relativeTime(page.updatedAt)} via CLI
          </span>
        </div>
        {current ? (
          <p className="mt-2 text-xs text-muted-foreground">
            src {shortHash(current.sourceHash)} · out{" "}
            {shortHash(current.expandedHash)}
          </p>
        ) : null}
        <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border pt-3 text-xs">
          <a
            href={pageUrl(page.slug)}
            target="_blank"
            rel="noreferrer"
            className="@link text-muted-foreground hover:text-term"
          >
            Open live page ↗
          </a>
          <button
            type="button"
            data-testid="view-deployments"
            onClick={onViewDeployments}
            className="@link text-muted-foreground hover:text-term"
          >
            Deployment history ({versions.length}) →
          </button>
        </div>
      </section>

      <section className="@card space-y-4 p-5">
        <PropertyRow label="Visibility">
          <VisibilityBadge visibility={page.visibility} />
        </PropertyRow>
        <PropertyRow label="Tags">
          {page.tags.length ? (
            <span className="flex flex-wrap justify-end gap-1.5">
              {page.tags.map((t) => (
                <Badge key={t}>{t}</Badge>
              ))}
            </span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </PropertyRow>
        <PropertyRow label="Created">
          <span title={formatTime(page.createdAt)}>
            {relativeTime(page.createdAt)}
          </span>
        </PropertyRow>
        <PropertyRow label="Updated">
          <span title={formatTime(page.updatedAt)}>
            {relativeTime(page.updatedAt)}
          </span>
        </PropertyRow>
      </section>
    </div>
  );
}

/** One quiet label/value line in the properties card. */
function PropertyRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
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
    <ul data-testid="deployments" className="@list-bordered list-none">
      {versions.map((v, i) => (
        <DeploymentRow key={v.id} version={v} current={i === 0} />
      ))}
    </ul>
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
    <li className="@list-item gap-3">
      <span className="font-medium">v{version.version}</span>
      {current ? <Badge tone="success">current</Badge> : null}
      <span className="@caption">
        src {shortHash(version.sourceHash)} · out {shortHash(version.expandedHash)}
      </span>
      <span className="ml-auto text-xs text-muted-foreground">
        {relativeTime(version.createdAt)}
      </span>
    </li>
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
  const [confirmOpen, setConfirmOpen] = useState(false);
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
      <div className="@card @stack-sm">
        <div className="text-sm font-medium">Visibility</div>
        {/* Dropdown (Menu = @menu recipes) instead of a segmented row. */}
        <Menu
          label="Change visibility"
          trigger={
            <span className="@btn-outline capitalize">{page.visibility} ▾</span>
          }
        >
          {(close) =>
            VISIBILITIES.map((vis) => (
              <MenuItem
                key={vis}
                testId={`visibility-${vis}`}
                active={vis === page.visibility}
                onSelect={() => {
                  close();
                  void changeVisibility(vis);
                }}
              >
                <span className="capitalize">{vis}</span>
              </MenuItem>
            ))
          }
        </Menu>
      </div>

      {dead ? null : (
        <div className="space-y-3 rounded-lg border border-destructive/40 p-4">
          <div className="text-sm font-medium text-destructive">Danger zone</div>
          <p className="@caption">
            Deleting tombstones the page — it stops serving (410) but its versions
            are retained (§8.2).
          </p>
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            data-testid="delete-page"
            className="@btn-outline text-destructive"
          >
            Delete page
          </button>
        </div>
      )}

      {/* Delete confirmation — the Dialog component (@dialog recipes). */}
      <Dialog
        open={confirmOpen}
        onClose={() => {
          if (!busy) setConfirmOpen(false);
        }}
        labelledBy="delete-dialog-title"
      >
        <div className="@dialog-header">
          <h3 id="delete-dialog-title" className="text-sm font-semibold">
            Delete {page.slug}?
          </h3>
          <p className="@caption">
            This tombstones the page — it stops serving (410). Its versions are
            retained (§8.2) and it cannot be re-published at this URL.
          </p>
        </div>
        <div className="@dialog-footer">
          <button
            type="button"
            className="@btn-outline"
            disabled={busy}
            onClick={() => setConfirmOpen(false)}
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="confirm-delete"
            className="@btn-danger"
            disabled={busy}
            onClick={onDelete}
          >
            {busy ? "Deleting…" : "Delete page"}
          </button>
        </div>
      </Dialog>
    </div>
  );
}
