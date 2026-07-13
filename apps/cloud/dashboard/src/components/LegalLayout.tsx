import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { SiteHeader } from "@/components/SiteHeader";
import { LEGAL_CONFIG } from "@/config/legal";

/**
 * Shared shell for the public legal pages (Terms, Acceptable Use, Privacy, Copyright).
 *
 * These pages ship REAL, product-accurate copy — Shortwind Cloud is an
 * open-source product, so a self-hoster gets a working baseline they adapt to
 * their own entity + jurisdiction (the `[bracketed]` fields) and have reviewed by
 * counsel. The banner makes that adaptation duty explicit; the copy itself is not
 * a placeholder. Styled on the shared `index.css` tokens (mono display, `--term`
 * accent, `font-sans` prose) so the legal surface reads as one product.
 */

/** The four legal documents, for the cross-nav + footer. */
export const LEGAL_DOCS = [
  { to: "/legal/terms", label: "Terms of Service" },
  { to: "/legal/acceptable-use", label: "Acceptable Use" },
  { to: "/legal/privacy", label: "Privacy Policy" },
  { to: "/legal/copyright", label: "Copyright" },
] as const;

export function LegalLayout({
  title,
  summary,
  children,
}: {
  title: string;
  /** One-line description of what this document covers. */
  summary: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background font-sans text-foreground antialiased">
      <div className="sw-legal-hairline" aria-hidden="true" />

      {/* The SAME shared site header as the landing page (no bespoke header). */}
      <SiteHeader />

      {/* The header spans the page; the prose stays a narrow, readable column. */}
      <main className="mx-auto w-full max-w-3xl px-4 pb-24 pt-10 sm:px-6">
        {/* Template-adaptation notice (this is the "get counsel" gate). */}
        <div className="rounded-lg border border-term/40 bg-card p-4 text-sm leading-relaxed text-muted-foreground">
          <p>
            <span className="font-mono font-semibold text-term">TEMPLATE — </span>
            Shortwind Cloud is open source. This document is a real, product-
            accurate starting point, not legal advice. If you self-host, replace
            every <code className="text-foreground">[bracketed]</code> field with
            your own legal entity, jurisdiction, and contact details, and have it
            reviewed by qualified counsel before you rely on it.
          </p>
        </div>

        <div className="mt-10">
          <p className="font-mono text-xs font-medium uppercase tracking-[0.25em] text-muted-foreground">
            Legal
          </p>
          <h1 className="mt-3 font-mono text-3xl font-extrabold tracking-tight sm:text-4xl">
            {title}
          </h1>
          <p className="mt-3 max-w-2xl text-base leading-relaxed text-muted-foreground">
            {summary}
          </p>
          <p className="mt-4 font-mono text-xs text-muted-foreground">
            Effective date:{" "}
            <span className="text-foreground">{LEGAL_CONFIG.effectiveDate}</span>{" "}
            · Operator:{" "}
            <span className="text-foreground">{LEGAL_CONFIG.legalEntity}</span>
          </p>
        </div>

        {/* Cross-nav between the four documents. */}
        <nav className="mt-8 flex flex-wrap gap-2 border-y border-border py-4">
          {LEGAL_DOCS.map((d) => (
            <Link
              key={d.to}
              to={d.to}
              className="rounded-md border border-border px-3 py-1.5 font-mono text-xs text-muted-foreground transition-colors hover:border-term hover:text-foreground data-[status=active]:border-term data-[status=active]:text-foreground"
              activeOptions={{ exact: true }}
            >
              {d.label}
            </Link>
          ))}
        </nav>

        <article className="sw-legal mt-10">{children}</article>

        <footer className="mt-16 flex flex-wrap items-center justify-between gap-4 border-t border-border pt-8 font-mono text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5 font-bold">
            <span className="text-term">▚</span>
            <span>shortwind</span>
            <span className="text-muted-foreground">Cloud</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            {LEGAL_DOCS.map((d) => (
              <Link key={d.to} to={d.to} className="hover:text-foreground">
                {d.label}
              </Link>
            ))}
          </div>
        </footer>
      </main>

      {/* Scoped prose styling so each page writes plain semantic JSX. */}
      <style>{`
        .sw-legal-hairline {
          position: fixed; inset: 0 0 auto 0; height: 2px; z-index: 50;
          background: linear-gradient(90deg, transparent, oklch(0.6 0.2 277), oklch(0.65 0.22 320), transparent);
          box-shadow: 0 0 18px oklch(0.6 0.2 277 / 60%);
        }
        .sw-legal { line-height: 1.7; }
        .sw-legal h2 {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 1.25rem; font-weight: 700; letter-spacing: -0.01em;
          margin-top: 2.5rem; padding-top: 1.25rem; border-top: 1px solid var(--border);
        }
        .sw-legal h2:first-child { margin-top: 0; padding-top: 0; border-top: 0; }
        .sw-legal h3 { font-weight: 700; font-size: 1rem; margin-top: 1.75rem; }
        .sw-legal p { margin-top: 1rem; color: var(--muted-foreground); }
        .sw-legal ul, .sw-legal ol { margin-top: 1rem; padding-left: 1.25rem; color: var(--muted-foreground); }
        .sw-legal ul { list-style: none; }
        .sw-legal ul > li { position: relative; margin-top: 0.5rem; padding-left: 1.1rem; }
        .sw-legal ul > li::before {
          content: "▚"; position: absolute; left: 0; top: 0.05rem;
          font-family: var(--font-mono, monospace); font-size: 0.7rem; color: color-mix(in oklch, var(--term) 70%, transparent);
        }
        .sw-legal ol { list-style: decimal; }
        .sw-legal ol > li { margin-top: 0.5rem; padding-left: 0.25rem; }
        .sw-legal strong { color: var(--foreground); font-weight: 600; }
        .sw-legal code {
          font-family: var(--font-mono, monospace); font-size: 0.85em;
          background: var(--secondary); padding: 0.1em 0.35em; border-radius: 0.25rem; color: var(--foreground);
        }
        .sw-legal a { color: var(--foreground); text-decoration: underline; text-underline-offset: 2px; }
        .sw-legal a:hover { color: var(--term); }
      `}</style>
    </div>
  );
}
