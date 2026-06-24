import { Link, createFileRoute, useRouteContext } from "@tanstack/react-router";

/**
 * Public marketing landing page for Shortwind Cloud (agent-native HTML hosting).
 *
 * This route is intentionally NOT auth-gated — it is the public `/cloud` index
 * (https://shortwind.dev/cloud). The `_authed` layout still guards the operator
 * dashboard. We read `isAuthenticated` (seeded by `__root.beforeLoad`) only to
 * swap the CTA: an already-signed-in operator gets "Open dashboard" instead of
 * the sign-in / sign-up pair.
 */
export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { name: "robots", content: "index, follow" },
      { title: "Shortwind Cloud — Agent-native HTML hosting" },
      {
        name: "description",
        content:
          "Publish agent-built HTML to the web — one command, a durable URL. Expanded and frozen server-side, served at the edge.",
      },
    ],
  }),
  component: LandingPage,
});

const STEPS = [
  {
    n: "1",
    title: "Agent authors HTML",
    body: "Your agent writes a page in Shortwind shorthand — compact recipe tokens like a stat, a chip, a panel — instead of long utility-class strings.",
  },
  {
    n: "2",
    title: "publish",
    body: "One call expands the shorthand to Tailwind server-side, freezes the result, and stores it as an immutable artifact.",
  },
  {
    n: "3",
    title: "Live at the edge",
    body: "The frozen page is served from a durable URL — https://<name>.shortwind.dev — with zero origin compute.",
  },
];

const FEATURES = [
  {
    title: "Server-side expansion",
    body: "Shorthand recipes expand to Tailwind at publish time, not in the prompt — roughly 40% fewer tokens to author the same page.",
  },
  {
    title: "Frozen, served at the edge",
    body: "Published pages are immutable artifacts served from the edge with zero origin compute. A viral page costs ~nothing.",
  },
  {
    title: "Trust & safety built in",
    body: "A global kill path, quarantine, and hash-scan coverage ship by default — abuse is contained in under 30 seconds.",
  },
  {
    title: "Per-page subdomains + custom domains",
    body: "Every page gets its own <name>.shortwind.dev subdomain. Bring your own domain via Cloudflare for SaaS.",
  },
  {
    title: "A small agent API",
    body: "find, publish, and update — three verbs an agent can drive. No build step, no deploy pipeline to wire up.",
  },
  {
    title: "Versioned & durable",
    body: "Every publish is a new immutable version. Recipe edits are tracked, and pages can be reverted or audited.",
  },
];

function LandingPage() {
  const { isAuthenticated } = useRouteContext({ from: Route.id });

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 antialiased [font-family:Inter,ui-sans-serif,system-ui,sans-serif] selection:bg-emerald-400/30">
      <div className="mx-auto max-w-5xl px-6 py-10">
        {/* Top bar */}
        <header className="flex items-center justify-between border-b border-white/10 pb-6">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-lg border border-white/15 bg-white/5 font-mono text-emerald-400">
              ▚
            </div>
            <span className="text-sm font-semibold tracking-tight">
              Shortwind Cloud
            </span>
          </div>
          <nav className="flex items-center gap-2 text-xs">
            {isAuthenticated ? (
              <Link
                to="/dashboard"
                className="rounded-md border border-white/10 px-3 py-1.5 text-zinc-300 hover:bg-white/5"
              >
                Open dashboard
              </Link>
            ) : (
              <>
                <Link
                  to="/login"
                  className="rounded-md border border-white/10 px-3 py-1.5 text-zinc-300 hover:bg-white/5"
                >
                  Sign in
                </Link>
                <Link
                  to="/signup"
                  className="rounded-md border border-emerald-400/40 bg-emerald-400/10 px-3 py-1.5 font-medium text-emerald-300 hover:bg-emerald-400/20"
                >
                  Get started
                </Link>
              </>
            )}
          </nav>
        </header>

        {/* Hero */}
        <section className="py-20 sm:py-28">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-zinc-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            Agent-native HTML hosting
          </div>
          <h1 className="mt-6 max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">
            Publish agent-built HTML to the web — one command, a durable URL.
          </h1>
          <p className="mt-5 max-w-2xl text-base text-zinc-400 sm:text-lg">
            Shortwind Cloud takes the HTML an agent writes, expands and freezes
            it server-side, and serves it from the edge at a permanent address.
            No build step, no deploy pipeline.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            {isAuthenticated ? (
              <Link
                to="/dashboard"
                className="rounded-lg bg-emerald-400 px-5 py-2.5 text-sm font-semibold text-zinc-950 hover:bg-emerald-300"
              >
                Open dashboard
              </Link>
            ) : (
              <>
                <Link
                  to="/signup"
                  className="rounded-lg bg-emerald-400 px-5 py-2.5 text-sm font-semibold text-zinc-950 hover:bg-emerald-300"
                >
                  Get started
                </Link>
                <Link
                  to="/login"
                  className="rounded-lg border border-white/15 px-5 py-2.5 text-sm font-medium text-zinc-200 hover:bg-white/5"
                >
                  Sign in
                </Link>
              </>
            )}
          </div>
        </section>

        {/* How it works */}
        <section className="border-t border-white/10 py-16">
          <h2 className="text-xs uppercase tracking-wider text-zinc-500">
            How it works
          </h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            {STEPS.map((s) => (
              <div
                key={s.n}
                className="rounded-xl border border-white/10 bg-white/[0.02] p-5"
              >
                <div className="grid h-7 w-7 place-items-center rounded-md border border-white/15 bg-white/5 font-mono text-sm text-emerald-400">
                  {s.n}
                </div>
                <h3 className="mt-4 text-sm font-medium text-zinc-100">
                  {s.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                  {s.body}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Why */}
        <section className="border-t border-white/10 py-16">
          <h2 className="text-xs uppercase tracking-wider text-zinc-500">
            Why Shortwind Cloud
          </h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="rounded-xl border border-white/10 bg-white/[0.02] p-5"
              >
                <h3 className="text-sm font-medium text-zinc-100">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-zinc-400">
                  {f.body}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Closing CTA */}
        <section className="border-t border-white/10 py-16">
          <div className="rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-transparent p-8 text-center sm:p-12">
            <h2 className="text-2xl font-semibold tracking-tight">
              Give your agent a place to publish.
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-sm text-zinc-400">
              Create an operator account and start shipping durable pages from
              find, publish, and update.
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              {isAuthenticated ? (
                <Link
                  to="/dashboard"
                  className="rounded-lg bg-emerald-400 px-5 py-2.5 text-sm font-semibold text-zinc-950 hover:bg-emerald-300"
                >
                  Open dashboard
                </Link>
              ) : (
                <>
                  <Link
                    to="/signup"
                    className="rounded-lg bg-emerald-400 px-5 py-2.5 text-sm font-semibold text-zinc-950 hover:bg-emerald-300"
                  >
                    Get started
                  </Link>
                  <Link
                    to="/login"
                    className="rounded-lg border border-white/15 px-5 py-2.5 text-sm font-medium text-zinc-200 hover:bg-white/5"
                  >
                    Sign in
                  </Link>
                </>
              )}
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-white/10 pt-6 text-xs text-zinc-500">
          <div className="flex items-center gap-2">
            <span className="font-mono text-emerald-400/70">▚</span>
            <span>Shortwind Cloud</span>
          </div>
          <div className="flex items-center gap-4">
            <a
              href="https://shortwind.dev"
              className="hover:text-zinc-300"
            >
              shortwind.dev
            </a>
            <Link to="/dashboard" className="hover:text-zinc-300">
              Operator dashboard
            </Link>
          </div>
        </footer>
      </div>
    </div>
  );
}
