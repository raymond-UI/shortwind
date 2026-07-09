import { Link, createFileRoute, useRouteContext } from "@tanstack/react-router";
import { ThemeToggle } from "@/components/ThemeToggle";

/**
 * Public marketing landing page for Shortwind Cloud (agent-native HTML hosting),
 * the public `/cloud` index (https://shortwind.dev/cloud). NOT auth-gated — the
 * `_authed` layout guards the operator dashboard. `isAuthenticated` only swaps
 * the CTA (already signed in → "Open dashboard").
 *
 * Styled on the SHARED theme (`index.css` tokens, ported from `site/src/index.css`)
 * so it reads as one product with shortwind.dev: mono-forward, thin borders,
 * sharp radius, the `--term` green accent (`text-term`) — no hardcoded colors.
 */
export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { name: "robots", content: "index, follow" },
      { title: "Shortwind Cloud — Agent-native HTML hosting" },
      {
        name: "description",
        content:
          "Your agent publishes a page and gets a live URL instantly — free to publish and serve at <slug>.shortwind.app. Bring your own domain on Pro.",
      },
      {
        property: "og:title",
        content: "Shortwind Cloud — Agent-native HTML hosting",
      },
      {
        property: "og:description",
        content:
          "Your agent builds it, we host it. Publish agent-built HTML to a live URL instantly — free. Bring your own domain on Pro ($5/mo).",
      },
      { property: "og:type", content: "website" },
      { name: "theme-color", content: "#0a0a0a" },
    ],
  }),
  component: LandingPage,
});

const STEPS = [
  {
    n: "01",
    title: "Publish from the CLI or an agent",
    body: "One call ships an HTML file — your @recipe classes expanded server-side — as a frozen, immutable version.",
  },
  {
    n: "02",
    title: "Get an instant live URL",
    body: "Every page serves at <slug>.shortwind.app — public, unlisted, or private. Serving is free; a viral page costs nothing.",
  },
  {
    n: "03",
    title: "Bring your own domain",
    body: "Bind a subdomain you own — every page then also serves at your-domain/<slug>, with an auto-issued certificate.",
  },
];

const FEATURES = [
  {
    title: "Server-side expansion",
    body: "Shorthand @recipe classes expand to Tailwind at publish time, not in the prompt — fewer tokens to author the same page.",
  },
  {
    title: "Frozen, served at the edge",
    body: "Published pages are immutable artifacts served from the edge with zero origin compute. A viral page costs ~nothing.",
  },
  {
    title: "A small agent API",
    body: "find, publish, update, delete — a handful of verbs an agent can drive. No repo, no build step, no deploy pipeline.",
  },
  {
    title: "Versioned & durable",
    body: "Every publish is a new immutable version. Recipe edits are tracked; pages can be reverted or audited.",
  },
  {
    title: "Account-wide custom domains",
    body: "Bind one subdomain you own and it fans out to every page — your-domain/<slug> — with TLS handled for you.",
  },
  {
    title: "Trust & safety by default",
    body: "A global kill path, quarantine, and content scanning ship built in, so abuse is contained fast.",
  },
];

function LandingPage() {
  const { isAuthenticated } = useRouteContext({ from: Route.id });

  return (
    <div className="min-h-screen bg-background font-mono text-foreground antialiased">
      {/* Gradient hairline — the one hit of color, matching shortwind.dev. */}
      <div className="sw-hairline" aria-hidden="true" />

      <div className="mx-auto w-full max-w-5xl px-4 sm:px-6 lg:px-8">
        {/* Top bar — mirrors the site header. */}
        <header className="flex h-14 items-center justify-between border-b border-border/80">
          <a
            href="https://shortwind.dev"
            className="flex items-center gap-1.5 text-sm font-bold tracking-tight"
          >
            <span className="text-term">▚</span>
            <span>shortwind</span>
            <span className="text-muted-foreground">Cloud</span>
          </a>
          <nav className="flex items-center gap-2 text-xs">
            <a
              href="https://shortwind.dev/docs"
              className="rounded-md px-2.5 py-1.5 text-muted-foreground transition-colors hover:text-foreground"
            >
              docs
            </a>
            {isAuthenticated ? (
              <Link
                to="/dashboard"
                className="rounded-md border border-border px-3 py-1.5 text-foreground transition-colors hover:bg-secondary"
              >
                Open dashboard
              </Link>
            ) : (
              <>
                <Link
                  to="/login"
                  className="rounded-md px-2.5 py-1.5 text-muted-foreground transition-colors hover:text-foreground"
                >
                  Sign in
                </Link>
                <Link
                  to="/signup"
                  className="sw-btn-primary rounded-md px-3 py-1.5 font-medium"
                >
                  Get started
                </Link>
              </>
            )}
            <span className="mx-1 h-5 w-px bg-border" />
            <ThemeToggle />
          </nav>
        </header>

        {/* Hero */}
        <section className="mx-auto max-w-2xl pt-16 pb-4 text-center sm:pt-24">
          <span className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-term" />
            Shortwind Cloud · public beta
          </span>
          <h1 className="mt-6 text-[1.75rem] font-extrabold leading-[1.2] tracking-tight sm:text-4xl sm:leading-[1.1] md:text-5xl">
            Your agent builds it.
            <br className="hidden sm:inline" />{" "}
            <span className="text-term">We host it.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-lg text-base leading-relaxed text-muted-foreground sm:text-lg">
            Agent-native HTML hosting. An agent publishes a page and gets a{" "}
            <span className="text-foreground">live URL instantly</span> — no
            repo, no build step, no deploy config. Publishing and serving are
            free.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            {isAuthenticated ? (
              <Link
                to="/dashboard"
                className="sw-btn-primary rounded-md px-5 py-2.5 text-sm font-semibold"
              >
                Open dashboard →
              </Link>
            ) : (
              <>
                <Link
                  to="/signup"
                  className="sw-btn-primary rounded-md px-5 py-2.5 text-sm font-semibold"
                >
                  Start free →
                </Link>
                <Link
                  to="/login"
                  className="rounded-md border border-border px-5 py-2.5 text-sm font-medium transition-colors hover:bg-secondary"
                >
                  Sign in
                </Link>
              </>
            )}
          </div>
        </section>

        {/* How it works */}
        <section className="mx-auto max-w-xl pt-16 text-left">
          <ol className="space-y-5">
            {STEPS.map((s) => (
              <li key={s.n} className="flex items-start gap-4">
                <span className="text-term">{s.n}</span>
                <div>
                  <h3 className="text-sm font-semibold">{s.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    {s.body}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* Why */}
        <section className="pt-20">
          <p className="text-center text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
            Why Shortwind Cloud
          </p>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="rounded-lg border border-border bg-card p-5"
              >
                <h3 className="text-sm font-semibold">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {f.body}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Pricing */}
        <section className="mx-auto max-w-3xl pt-20">
          <p className="text-center text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">
            Pricing
          </p>
          <h2 className="mt-2 text-center text-2xl font-bold tracking-tight">
            Free to publish. <span className="text-term">$5</span> for your own
            domain.
          </h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-border bg-card p-5">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">Free</span>
                <span className="text-sm text-muted-foreground">$0</span>
              </div>
              <ul className="mt-3 space-y-1.5 text-sm text-muted-foreground">
                <li>▚ Unlimited publishes</li>
                <li>
                  ▚ <span className="tabular-nums">&lt;slug&gt;.shortwind.app</span> URLs
                </li>
                <li>▚ Public / unlisted / private</li>
                <li>▚ Free serving — page views aren&rsquo;t billed</li>
              </ul>
            </div>
            <div className="rounded-lg border border-term/40 bg-card p-5">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">Pro</span>
                <span className="text-sm">
                  <span className="text-term">$5</span>
                  <span className="text-muted-foreground">/mo</span>
                </span>
              </div>
              <ul className="mt-3 space-y-1.5 text-sm text-muted-foreground">
                <li>
                  <span className="text-term">▚</span> Everything in Free
                </li>
                <li>
                  <span className="text-term">▚</span> Bring your own domain
                </li>
                <li>
                  <span className="text-term">▚</span>{" "}
                  <span className="tabular-nums">your-domain/&lt;slug&gt;</span>
                </li>
                <li>
                  <span className="text-term">▚</span> Auto-issued TLS certificate
                </li>
              </ul>
            </div>
          </div>
        </section>

        {/* Closing CTA */}
        <section className="pt-20">
          <div className="rounded-lg border border-border bg-gradient-to-b from-secondary/40 to-transparent p-8 text-center sm:p-12">
            <h2 className="text-2xl font-bold tracking-tight">
              Give your agent a place to publish.
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-sm text-muted-foreground">
              Create an account and start shipping durable pages from{" "}
              <span className="font-medium text-foreground">find</span>,{" "}
              <span className="font-medium text-foreground">publish</span>, and{" "}
              <span className="font-medium text-foreground">update</span>.
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              {isAuthenticated ? (
                <Link
                  to="/dashboard"
                  className="sw-btn-primary rounded-md px-5 py-2.5 text-sm font-semibold"
                >
                  Open dashboard →
                </Link>
              ) : (
                <Link
                  to="/signup"
                  className="sw-btn-primary rounded-md px-5 py-2.5 text-sm font-semibold"
                >
                  Create an account →
                </Link>
              )}
            </div>
          </div>
        </section>

        {/* Footer — mirrors the site footer, links back to shortwind.dev. */}
        <footer className="mt-20 flex flex-wrap items-center justify-between gap-4 border-t border-border py-8 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5 font-bold">
            <span className="text-term">▚</span>
            <span>shortwind</span>
            <span className="text-muted-foreground">Cloud</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <a href="https://shortwind.dev" className="hover:text-foreground">
              shortwind.dev
            </a>
            <a href="https://shortwind.dev/docs" className="hover:text-foreground">
              docs
            </a>
            <Link to="/dashboard" className="hover:text-foreground">
              console
            </Link>
            <span className="text-muted-foreground/60">© 2026</span>
          </div>
        </footer>
      </div>

      <style>{`
        .sw-hairline {
          position: fixed;
          inset: 0 0 auto 0;
          height: 2px;
          z-index: 50;
          background: linear-gradient(90deg, transparent, oklch(0.6 0.2 277), oklch(0.65 0.22 320), transparent);
          box-shadow: 0 0 18px oklch(0.6 0.2 277 / 60%);
        }
      `}</style>
    </div>
  );
}
