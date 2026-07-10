import { Link, createFileRoute, useRouteContext } from "@tanstack/react-router";
import { ThemeToggle } from "@/components/ThemeToggle";

/**
 * Public marketing landing page for Shortwind Cloud (agent-native HTML hosting),
 * the public `/cloud` index (https://shortwind.dev/cloud). NOT auth-gated — the
 * `_authed` layout guards the operator dashboard. `isAuthenticated` only swaps
 * the CTA (already signed in → "Open dashboard").
 *
 * Styled on the SHARED theme (`index.css` tokens, ported from `site/src/index.css`)
 * so it reads as one product with shortwind.dev: mono display type, thin borders,
 * the `--term` green accent — no hardcoded colors. Per the design system's
 * "mono-forward UI, clean sans for prose" rule, body copy is `font-sans`; only
 * headings, labels, and code stay mono. The hero terminal replays the real CLI
 * publish output (`published <url>` / `version: v1`) and the API panel mirrors
 * the real `POST /v1/pages` contract from the CLI api-client.
 */
export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { name: "robots", content: "index, follow" },
      { title: "Shortwind Cloud — Agent-native HTML hosting" },
      {
        name: "description",
        content:
          "Your agent publishes a page and gets a live URL instantly. Free to publish and serve at <slug>.shortwind.app; bring your own domain on Pro.",
      },
      {
        property: "og:title",
        content: "Shortwind Cloud — Agent-native HTML hosting",
      },
      {
        property: "og:description",
        content:
          "Your agent builds it, we host it. Publish agent-built HTML to a live URL instantly, free. Bring your own domain on Pro ($5/mo).",
      },
      { property: "og:type", content: "website" },
      { name: "theme-color", content: "#0a0a0a" },
    ],
  }),
  component: LandingPage,
});

/* Hero terminal replay — mirrors the real `shortwind cloud publish` output. */
const TERM_LINES = [
  { text: "$ shortwind cloud publish launch.html", tone: "cmd" },
  { text: "  expanding 12 @recipe classes", tone: "dim" },
  { text: "  freezing immutable version", tone: "dim" },
  { text: "published https://launch-notes.shortwind.app", tone: "ok" },
  { text: "version: v1", tone: "dim" },
] as const;

const STEPS = [
  {
    n: "01",
    title: "Publish from the CLI or an agent",
    body: "One call ships any HTML file, frozen as an immutable version. If it uses @recipe shorthand, that expands to Tailwind server-side.",
  },
  {
    n: "02",
    title: "Get an instant live URL",
    body: "Every page serves at <slug>.shortwind.app. Public, unlisted, or private; serving is free.",
  },
  {
    n: "03",
    title: "Bring your own domain",
    body: "Bind a subdomain you own and every page also serves at your-domain/<slug>, TLS included.",
  },
];

const FEATURES = [
  {
    glyph: "▚",
    title: "Optional recipe expansion",
    body: "Publish plain HTML and it serves as-is. If a page uses @recipe shorthand, it expands to Tailwind at publish time, not in the prompt, so it takes fewer tokens to author.",
  },
  {
    glyph: "▞",
    title: "Frozen, served at the edge",
    body: "Published pages are immutable artifacts served from the edge with zero origin compute. A viral page costs ~nothing.",
  },
  {
    glyph: "▛",
    title: "A small agent API",
    body: "find, publish, update, delete. A handful of verbs an agent can drive with no repo and no pipeline.",
  },
  {
    glyph: "▜",
    title: "Versioned & durable",
    body: "Every publish is a new immutable version. Recipe edits are tracked; pages can be reverted or audited.",
  },
  {
    glyph: "▟",
    title: "Account-wide custom domains",
    body: "Bind one subdomain you own and it fans out to every page as your-domain/<slug>, with TLS handled for you.",
  },
  {
    glyph: "▙",
    title: "Trust & safety by default",
    body: "A global kill path, quarantine, and content scanning ship built in, so abuse is contained fast.",
  },
];

/* The real surface — methods and paths from the v1 API contract. */
const VERBS = [
  { method: "GET", path: "/v1/pages", verb: "find" },
  { method: "POST", path: "/v1/pages", verb: "publish" },
  { method: "PATCH", path: "/v1/pages/{id}", verb: "update" },
  { method: "DELETE", path: "/v1/pages/{id}", verb: "delete" },
];

function Eyebrow({ n, children }: { n: string; children: string }) {
  return (
    <p className="font-mono text-xs font-medium uppercase tracking-[0.25em] text-muted-foreground">
      <span className="text-term">{n}</span>
      <span className="mx-2 text-border">/</span>
      {children}
    </p>
  );
}

function LandingPage() {
  const { isAuthenticated } = useRouteContext({ from: Route.id });

  return (
    <div className="min-h-screen bg-background font-mono text-foreground antialiased">
      {/* Gradient hairline — the one hit of color, matching shortwind.dev. */}
      <div className="sw-hairline" aria-hidden="true" />

      {/* Top bar — sticky, mirrors the site header. */}
      <header className="sticky top-0 z-40 border-b border-border/80 bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-8">
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
              className="hidden rounded-md px-2.5 py-1.5 text-muted-foreground transition-colors hover:text-foreground sm:inline-block"
            >
              docs
            </a>
            {isAuthenticated ? (
              <Link
                to="/dashboard/$section"
                params={{ section: "overview" }}
                className="rounded-md border border-border px-3 py-1.5 text-foreground transition-colors hover:bg-secondary"
              >
                Open dashboard
              </Link>
            ) : (
              <>
                <Link
                  to="/login"
                  className="hidden whitespace-nowrap rounded-md px-2.5 py-1.5 text-muted-foreground transition-colors hover:text-foreground sm:inline-block"
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
        </div>
      </header>

      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
        {/* ── Hero: editorial left column + publish-replay artifact ─────── */}
        <section className="relative grid items-center gap-12 pt-16 pb-8 sm:pt-20 lg:grid-cols-[1.05fr_1fr] lg:gap-16 lg:pt-24">
          <div className="sw-rise text-left">
            <span className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
              <span className="h-1.5 w-1.5 rounded-full bg-term" />
              Shortwind Cloud · public beta
            </span>
            <h1 className="mt-7 text-[clamp(2.5rem,6.5vw,4.5rem)] font-extrabold leading-[1.02] tracking-tighter">
              Your agent
              <br />
              builds it.
              <br />
              <span className="text-term">We host it.</span>
            </h1>
            <p className="mt-6 max-w-md font-sans text-base leading-relaxed text-muted-foreground sm:text-lg">
              Agent-native hosting for any HTML. One call turns a file into a{" "}
              <span className="text-foreground">live URL</span>. No repo, no
              build step, no deploy config.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              {isAuthenticated ? (
                <Link
                  to="/dashboard/$section"
                  params={{ section: "overview" }}
                  className="sw-btn-primary rounded-md px-6 py-3 text-sm font-semibold"
                >
                  Open dashboard →
                </Link>
              ) : (
                <>
                  <Link
                    to="/signup"
                    className="sw-btn-primary rounded-md px-6 py-3 text-sm font-semibold"
                  >
                    Start free →
                  </Link>
                  <a
                    href="https://shortwind.dev/docs"
                    className="rounded-md border border-border px-6 py-3 text-sm font-medium transition-colors hover:bg-secondary"
                  >
                    Read the docs
                  </a>
                </>
              )}
            </div>
            <p className="mt-6 text-xs text-muted-foreground">
              $0 to publish and serve · live at{" "}
              <span className="text-foreground">&lt;slug&gt;.shortwind.app</span>
            </p>
          </div>

          {/* Publish replay: terminal card, then the live page frame lands on top. */}
          <div className="relative mx-auto w-full max-w-lg lg:mx-0">
            {/* dot-grid backdrop */}
            <div className="sw-dots absolute -inset-6 -z-10" aria-hidden="true" />

            <div className="sw-rise overflow-hidden rounded-lg border border-border bg-card shadow-sm [animation-delay:150ms]">
              <div className="flex items-center gap-1.5 border-b border-border px-4 py-2.5">
                <span className="h-2.5 w-2.5 rounded-full bg-destructive/70" />
                <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/40" />
                <span className="h-2.5 w-2.5 rounded-full bg-term/70" />
                <span className="ml-2 text-xs text-muted-foreground">
                  agent session
                </span>
              </div>
              <div className="space-y-1.5 p-5 text-xs leading-6 sm:text-[0.8125rem]">
                {TERM_LINES.map((line, i) => (
                  <p
                    key={line.text}
                    className={`sw-term-line whitespace-pre ${
                      line.tone === "ok"
                        ? "text-term"
                        : line.tone === "dim"
                          ? "text-muted-foreground"
                          : "text-foreground"
                    }`}
                    style={{ animationDelay: `${400 + i * 350}ms` }}
                  >
                    {line.text}
                  </p>
                ))}
                <p
                  className="sw-term-line text-foreground"
                  style={{ animationDelay: `${400 + TERM_LINES.length * 350}ms` }}
                >
                  $ <span className="sw-caret">▌</span>
                </p>
              </div>
            </div>

            {/* The published page, live. Overlaps the terminal on purpose. */}
            <div
              className="sw-pop relative -mt-8 ml-auto w-[88%] overflow-hidden rounded-lg border border-border bg-background shadow-2xl sm:-mt-10"
              style={{ animationDelay: `${600 + TERM_LINES.length * 350}ms` }}
            >
              <div className="flex items-center gap-2 border-b border-border bg-card px-3 py-2">
                <span className="flex-1 truncate rounded border border-border bg-background px-2.5 py-1 text-[0.6875rem] text-muted-foreground">
                  <span className="text-term">https://</span>
                  launch-notes.shortwind.app
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-term/40 px-2 py-0.5 text-[0.625rem] font-semibold uppercase tracking-wider text-term">
                  <span className="sw-live-dot h-1.5 w-1.5 rounded-full bg-term" />
                  live
                </span>
              </div>
              {/* skeleton render of the published page */}
              <div className="space-y-2.5 p-5" aria-hidden="true">
                <div className="h-2 w-16 rounded-sm bg-term/50" />
                <div className="h-3.5 w-4/5 rounded-sm bg-foreground/80" />
                <div className="h-3.5 w-3/5 rounded-sm bg-foreground/80" />
                <div className="h-2 w-full rounded-sm bg-muted-foreground/25" />
                <div className="h-2 w-11/12 rounded-sm bg-muted-foreground/25" />
                <div className="flex gap-2 pt-1.5">
                  <div className="h-6 w-20 rounded bg-foreground/80" />
                  <div className="h-6 w-20 rounded border border-border" />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── 01 · How it works ──────────────────────────────────────────── */}
        <section className="pt-24 sm:pt-28">
          <Eyebrow n="01">How it works</Eyebrow>
          <div className="mt-8 grid gap-10 sm:grid-cols-3 sm:gap-6">
            {STEPS.map((s) => (
              <div
                key={s.n}
                className="relative border-t-2 border-border pt-5 transition-colors hover:border-term"
              >
                <span
                  className="pointer-events-none absolute -top-3 right-0 text-6xl font-extrabold leading-none tracking-tighter text-foreground/[0.06] select-none"
                  aria-hidden="true"
                >
                  {s.n}
                </span>
                <span className="text-xs font-semibold text-term">{s.n}</span>
                <h3 className="mt-2 text-base font-bold tracking-tight">
                  {s.title}
                </h3>
                <p className="mt-2 font-sans text-sm leading-relaxed text-muted-foreground">
                  {s.body}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ── 02 · Why: index grid, 1px gaps ────────────────────────────── */}
        <section className="pt-24 sm:pt-28">
          <Eyebrow n="02">Why Shortwind Cloud</Eyebrow>
          <h2 className="mt-3 max-w-xl text-2xl font-extrabold leading-tight tracking-tight sm:text-3xl">
            Hosting shaped like an API,{" "}
            <span className="text-muted-foreground">not a pipeline.</span>
          </h2>
          <div className="mt-8 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="group bg-background p-6 transition-colors hover:bg-card"
              >
                <span className="text-lg text-muted-foreground/60 transition-colors group-hover:text-term">
                  {f.glyph}
                </span>
                <h3 className="mt-3 text-sm font-bold tracking-tight">
                  {f.title}
                </h3>
                <p className="mt-2 font-sans text-sm leading-relaxed text-muted-foreground">
                  {f.body}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ── 03 · The agent API: real verbs, real contract ─────────────── */}
        <section className="pt-24 sm:pt-28">
          <Eyebrow n="03">The agent API</Eyebrow>
          <div className="mt-8 grid items-start gap-10 lg:grid-cols-[1fr_1.15fr] lg:gap-16">
            <div>
              <h2 className="text-2xl font-extrabold leading-tight tracking-tight sm:text-3xl">
                Four verbs.
                <br />
                <span className="text-muted-foreground">
                  That&rsquo;s the whole deploy story.
                </span>
              </h2>
              <p className="mt-4 max-w-sm font-sans text-sm leading-relaxed text-muted-foreground">
                The surface is small on purpose: an agent can hold all of it in
                one prompt. Publishing is a single request; everything else is
                bookkeeping.
              </p>
              <ul className="mt-6 divide-y divide-border border-y border-border text-sm">
                {VERBS.map((v) => (
                  <li key={v.verb} className="flex items-center gap-4 py-3">
                    <span className="w-16 shrink-0 text-xs font-semibold text-term">
                      {v.method}
                    </span>
                    <span className="flex-1 truncate text-muted-foreground">
                      {v.path}
                    </span>
                    <span className="font-semibold">{v.verb}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="overflow-hidden rounded-lg border border-border bg-card">
              <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
                <span className="text-xs text-muted-foreground">
                  publish a page
                </span>
                <span className="rounded-full border border-border px-2 py-0.5 text-[0.625rem] uppercase tracking-wider text-muted-foreground">
                  api.shortwind.dev
                </span>
              </div>
              <pre className="overflow-x-auto p-5 text-xs leading-6">
                <code>
                  <span className="text-term">POST</span> /v1/pages{"\n"}
                  <span className="text-muted-foreground">
                    {"{"}
                    {"\n"}
                    {"  "}&quot;html&quot;:{" "}
                  </span>
                  &quot;&lt;main class=\&quot;@hero\&quot;&gt;…&lt;/main&gt;&quot;
                  <span className="text-muted-foreground">
                    ,{"\n"}
                    {"  "}&quot;slug&quot;:{" "}
                  </span>
                  &quot;launch-notes&quot;
                  <span className="text-muted-foreground">
                    ,{"\n"}
                    {"  "}&quot;visibility&quot;:{" "}
                  </span>
                  &quot;public&quot;
                  <span className="text-muted-foreground">
                    {"\n"}
                    {"}"}
                  </span>
                  {"\n\n"}
                  <span className="text-term">201</span> Created{"\n"}
                  <span className="text-muted-foreground">
                    {"{"}
                    {"\n"}
                    {"  "}&quot;url&quot;:{" "}
                  </span>
                  <span className="text-term">
                    &quot;https://launch-notes.shortwind.app&quot;
                  </span>
                  <span className="text-muted-foreground">
                    ,{"\n"}
                    {"  "}&quot;version&quot;:{" "}
                  </span>
                  1{"\n"}
                  <span className="text-muted-foreground">{"}"}</span>
                </code>
              </pre>
            </div>
          </div>
        </section>

        {/* ── 04 · Pricing ──────────────────────────────────────────────── */}
        <section className="pt-24 sm:pt-28">
          <div className="text-center">
            <Eyebrow n="04">Pricing</Eyebrow>
          </div>
          <h2 className="mt-3 text-center text-2xl font-extrabold tracking-tight sm:text-3xl">
            Free to publish. <span className="text-term">$5</span> for your own
            domain.
          </h2>
          <div className="mx-auto mt-10 grid max-w-3xl gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-border bg-card p-6">
              <div className="flex items-baseline justify-between">
                <span className="text-base font-bold">Free</span>
                <span className="text-2xl font-extrabold tracking-tight">
                  $0
                </span>
              </div>
              <p className="mt-1 font-sans text-xs text-muted-foreground">
                For every page your agent ships.
              </p>
              <ul className="mt-5 space-y-2.5 font-sans text-sm text-muted-foreground">
                {[
                  "Unlimited publishes",
                  "<slug>.shortwind.app URLs",
                  "Public / unlisted / private",
                  "Free serving; page views aren't billed",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2.5">
                    <span className="mt-0.5 font-mono text-xs text-muted-foreground/60">
                      ▚
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-lg border border-term/50 bg-card p-6">
              <div className="flex items-baseline justify-between">
                <span className="text-base font-bold">Pro</span>
                <span className="text-2xl font-extrabold tracking-tight">
                  <span className="text-term">$5</span>
                  <span className="text-sm font-medium text-muted-foreground">
                    /mo
                  </span>
                </span>
              </div>
              <p className="mt-1 font-sans text-xs text-muted-foreground">
                Your pages on your domain.
              </p>
              <ul className="mt-5 space-y-2.5 font-sans text-sm text-muted-foreground">
                {[
                  "Everything in Free",
                  "Bring your own domain",
                  "your-domain/<slug>",
                  "Auto-issued TLS certificate",
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2.5">
                    <span className="mt-0.5 font-mono text-xs text-term">▚</span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* ── Closing CTA ───────────────────────────────────────────────── */}
        <section className="pt-24 sm:pt-28">
          <div className="relative overflow-hidden rounded-lg border border-border p-10 text-center sm:p-16">
            <div className="sw-dots absolute inset-0 -z-10" aria-hidden="true" />
            <h2 className="mx-auto max-w-2xl text-[clamp(1.75rem,4vw,2.75rem)] font-extrabold leading-tight tracking-tight">
              Give your agent a place{" "}
              <span className="text-term">to publish.</span>
            </h2>
            <p className="mx-auto mt-4 max-w-md font-sans text-sm leading-relaxed text-muted-foreground">
              Create an account and start shipping durable pages from{" "}
              <span className="font-mono text-foreground">find</span>,{" "}
              <span className="font-mono text-foreground">publish</span>, and{" "}
              <span className="font-mono text-foreground">update</span>.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              {isAuthenticated ? (
                <Link
                  to="/dashboard/$section"
                  params={{ section: "overview" }}
                  className="sw-btn-primary rounded-md px-6 py-3 text-sm font-semibold"
                >
                  Open dashboard →
                </Link>
              ) : (
                <Link
                  to="/signup"
                  className="sw-btn-primary rounded-md px-6 py-3 text-sm font-semibold"
                >
                  Create an account →
                </Link>
              )}
            </div>
          </div>
        </section>

        {/* Footer — mirrors the site footer, links back to shortwind.dev. */}
        <footer className="mt-24 flex flex-wrap items-center justify-between gap-4 border-t border-border py-8 text-xs text-muted-foreground">
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
            <Link
              to="/dashboard/$section"
              params={{ section: "overview" }}
              className="hover:text-foreground"
            >
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
        /* dot-grid backdrop, theme-aware via the foreground token */
        .sw-dots {
          background-image: radial-gradient(color-mix(in oklch, var(--foreground) 12%, transparent) 1px, transparent 1px);
          background-size: 22px 22px;
          mask-image: radial-gradient(ellipse at center, black 40%, transparent 75%);
          -webkit-mask-image: radial-gradient(ellipse at center, black 40%, transparent 75%);
        }
        @keyframes sw-rise {
          from { opacity: 0; transform: translateY(14px); }
          to { opacity: 1; transform: none; }
        }
        .sw-rise { animation: sw-rise 0.7s cubic-bezier(0.2, 0.7, 0.2, 1) both; }
        .sw-term-line { animation: sw-rise 0.4s cubic-bezier(0.2, 0.7, 0.2, 1) both; }
        @keyframes sw-pop {
          from { opacity: 0; transform: translateY(20px) scale(0.96); }
          to { opacity: 1; transform: none; }
        }
        .sw-pop { animation: sw-pop 0.6s cubic-bezier(0.2, 0.7, 0.2, 1) both; }
        @keyframes sw-caret-blink { 50% { opacity: 0; } }
        .sw-caret {
          color: var(--term);
          animation: sw-caret-blink 1.1s step-end infinite;
        }
        @keyframes sw-live-pulse {
          0%, 100% { box-shadow: 0 0 0 0 color-mix(in oklch, var(--term) 55%, transparent); }
          70% { box-shadow: 0 0 0 5px transparent; }
        }
        .sw-live-dot { animation: sw-live-pulse 2s ease-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .sw-rise, .sw-term-line, .sw-pop, .sw-caret, .sw-live-dot {
            animation: none;
          }
        }
      `}</style>
    </div>
  );
}
