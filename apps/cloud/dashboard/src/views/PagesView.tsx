import { useState } from "react";
import { useDashboardData } from "../lib/data";
import { formatTime, shortHash } from "../lib/format";
import type { PageWithVersions } from "../lib/types";

/**
 * Pages view (CLOUD-35): list every page + expandable per-page version history.
 * Read-only oversight — the operator confirms what exists and what it points at,
 * they do not author here (PRD §3).
 */
export function PagesView() {
  const { pages } = useDashboardData();

  if (pages === undefined) {
    return <div className="empty">Loading pages…</div>;
  }
  if (pages.length === 0) {
    return <div className="empty">No pages published yet.</div>;
  }

  return (
    <div className="panel" data-testid="pages-view">
      {pages.map((p) => (
        <PageRowItem key={p.page.id} entry={p} />
      ))}
    </div>
  );
}

function PageRowItem({ entry }: { entry: PageWithVersions }) {
  const [open, setOpen] = useState(false);
  const { page, versions } = entry;
  return (
    <div className="row" style={{ flexDirection: "column" }}>
      <div style={{ display: "flex", gap: 12, width: "100%" }}>
        <button
          className="tab"
          aria-expanded={open}
          aria-label={`Toggle version history for ${page.slug}`}
          onClick={() => setOpen((o) => !o)}
          style={{ minWidth: 28 }}
        >
          {open ? "−" : "+"}
        </button>
        <div style={{ flex: 1 }}>
          <div>
            <strong>/{page.slug}</strong>{" "}
            <span className="muted mono">v{page.currentVersion}</span>
          </div>
          <div className="muted">
            <span className="badge">{page.visibility}</span>{" "}
            <span
              className={`badge${page.lifecycle !== "active" ? " danger" : ""}`}
            >
              {page.lifecycle}
            </span>{" "}
            {page.customDomain ? (
              <span className="mono">{page.customDomain}</span>
            ) : null}{" "}
            {page.tags.length > 0 ? (
              <span className="mono">[{page.tags.join(", ")}]</span>
            ) : null}
          </div>
        </div>
        <div className="muted mono">{formatTime(page.updatedAt)}</div>
      </div>
      {open ? (
        <div
          data-testid={`versions-${page.slug}`}
          style={{ width: "100%", marginTop: 8, paddingLeft: 40 }}
        >
          <div className="section-title">Version history</div>
          {versions.length === 0 ? (
            <div className="muted">No published versions.</div>
          ) : (
            versions.map((v) => (
              <div key={v.id} className="muted mono">
                v{v.version} · src {shortHash(v.sourceHash)} · out{" "}
                {shortHash(v.expandedHash)} · {formatTime(v.createdAt)}
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
