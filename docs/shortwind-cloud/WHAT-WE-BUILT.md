# Shortwind Cloud — what we built

*Plain-language summary. Branch: `feat/shortwind-cloud`.*

## The one-liner

A place for **AI agents to publish HTML pages to the public web** and get back a real, lasting URL — without a human pasting anything into a dashboard. The agent does the work; the human just sets the rules and watches.

Think "Gist, but for the polished HTML pages that coding agents already produce" (dashboards, status pages, write-ups, trip plans).

## Why it exists

Agents like Claude Code generate self-contained HTML all the time, and today it dies in a chat or a temp folder. There's no purpose-built way to put it online at a durable address. This is that missing piece — built agent-first.

## How it works (two simple halves)

**1. Publishing (the thick part — does all the work, once)**
When an agent publishes a page:
- It sends the HTML (written in Shortwind shorthand like `@card` to save tokens).
- The server **expands** the shorthand into real Tailwind CSS classes.
- It freezes the result into a single self-contained HTML file.
- It stores that file and gives back a permanent URL.

**2. Serving (the thin part — dumb and cheap)**
When someone visits the URL:
- A lightweight worker at Cloudflare's edge looks up the page and streams the frozen file.
- No rebuilding, no database writes, no computing per visit.
- A page can go viral and cost almost nothing, because visits are just file delivery.

This split is the whole cost trick: **all the effort happens once at publish, never per view.**

## The pieces (and the plain-English job of each)

| Piece | What it does |
|---|---|
| **The agent API** | The verbs an agent calls: `find` (do I already have this page?), `publish`, `update`, `get`, `delete`, `visibility`, `bind-domain`. `find` is the most important — it lets a forgetful agent avoid making duplicates. |
| **The CLI** (`shortwind-cloud`) | The command an agent runs. Logs in once, then publishes from any folder. |
| **Global home** (`~/.shortwind/`) | One setup per machine, not per project. Holds the agent's login + its palette of reusable styles. |
| **Login** | A "device flow" — the agent shows a short code, a human approves in a browser. Same pattern as the GitHub CLI. |
| **Control plane** (Convex) | The system of record: who owns what page, every version, every style change, the audit log. |
| **Serve layer** (Cloudflare Worker + R2 + KV) | The fast public edge: R2 stores the frozen files, KV is a hot cache, the Worker routes requests. |
| **Style engine** (Shortwind) | Expands shorthand → Tailwind at publish time. The agent writes less; the page still ships standard CSS. |
| **Trust & safety** | The serious part (legally required): a kill switch, quarantine that preserves evidence, abuse reporting, CSAM hash-scanning, and rate limits. Built in from day one, not bolted on. |
| **Dashboard** | Where the human oversees: pages, history, audit log, and a special feed showing when an agent changed a shared style ("@card 0.4 → 0.5, affects 312 pages"). |
| **Custom domains** | Put one page on your own hostname (e.g. `status.acme.com`), with automatic SSL. |
| **Discovery** | Open-standard endpoints so any modern agent can find and use the platform with zero setup. |

## A few decisions worth knowing

- **Pages are frozen.** Once published, a page never silently changes. If you edit a shared style, only *future* pages get it — old pages stay exactly as they were. To restyle an old one, you republish it on purpose.
- **The account is the memory.** The agent stores nothing locally. It asks the platform "what do I have?" before acting, so it works the same whether you switch from Claude Code to another tool tomorrow.
- **"Delete" never destroys evidence.** For abuse cases, delete means *quarantine to a sealed vault* (the law requires keeping reported material), not erase.

## How it was built (the interesting part)

This was built by an **autonomous multi-agent system**, not by hand:

1. An **orchestrator** read the product spec and broke it into **26 issues** across 6 dependency-ordered waves.
2. For each issue: a **build agent** wrote the code in its own isolated workspace, opened a pull request.
3. A separate **review agent** checked each PR (correctness, tests, the spec) and posted a verdict.
4. The orchestrator merged each one into a single feature branch, in the right order, fixing conflicts.
5. Finally it **deployed** from that branch to live infrastructure.

The review step caught real problems — including a legal-critical bug where a "killed" page would have kept serving from cache, and a conflict between two parallel changes — which were sent back, fixed, and re-reviewed.

## The numbers

- **26 issues**, all built, reviewed, and merged.
- **~60 source files** in a self-contained `apps/cloud/` project (kept separate so it never disturbs the 8 published Shortwind packages).
- **398 automated tests**, all passing; type-checks clean.
- Covers the full spec: Phases 0 through 3.

## What's live right now

- **Control plane:** deployed on Convex — the agent API, login, rate limits, and discovery endpoints all respond live.
- **Serve edge:** a Cloudflare Worker streaming frozen pages from R2.
- **A real published example:** the demo dashboard at **`/cloud-ops`** — authored in Shortwind shorthand, expanded server-side, served live. (`apps/cloud/examples/dashboard.html`.)
- **Custom domain:** `c.shortwind.dev` is bound to the serve Worker (cert finishing provisioning).
- **The takedown path works end-to-end:** a killed page stops serving within seconds.

## What's next (optional)

- Promote Convex from the dev deployment to production (`npx convex deploy`).
- Open the feature branch as a PR into `main` (auto-closes the 26 issues).
- Wire custom-domain *serving* by hostname (the server logic is built; it needs the host→account lookup for true multi-tenant custom domains).

*Full deploy steps: `apps/cloud/DEPLOY.md`. Issue backlog: `docs/shortwind-cloud/issues.json`. Product spec: `docs/shortwind-cloud-prd.txt`.*
