# Dogfood build prompt — Next.js (complex)

Round-3 follow-up: a heavier Next.js brief, run against the published
`@shortwind/*` packages in a fresh, empty project dir. No guidance on Shortwind —
the agent figures it out from shortwind.dev. Hand verbatim to a fresh session.

---

Build an **Incident Management console** as a fresh **Next.js (App Router)** app.

**Stack:** `npx create-next-app@latest` (TypeScript, App Router, Tailwind v4) +
React. Style it with **Shortwind** — https://shortwind.dev.

**What to build** — one console page (no routing, no backend; hardcode the data),
rich enough to be a believable internal tool:

1. **Top bar** — product name, a global search input, a dark-mode toggle, and a
   primary "Declare incident" button that opens a form panel.
2. **Summary band** — 4–5 stat tiles (Open, Acknowledged, Resolved today, MTTR,
   On-call).
3. **Severity filter** — a segmented control over severities
   (`SEV1 · SEV2 · SEV3 · SEV4 · All`), each with its own visual treatment.
   Selecting one filters the incident list; the selected segment is highlighted.
4. **Incident list** — ~8 incidents. Each row: a severity badge and a status
   badge (`open` / `acknowledged` / `mitigated` / `resolved`), a mono service
   name, a title, the assignee, a relative timestamp, and a "…" actions menu.
   Severity and status styling is chosen from the incident's data at render time,
   not hardcoded per row. Resolved rows read as muted; SEV1 rows read as urgent
   (e.g. a colored left edge).
5. **A density toggle** (Comfortable / Compact) that changes row padding.
6. **A "Declare incident" form** — title, service (select), severity (select),
   assignee, description (textarea), and a submit/cancel pair. Submitting
   prepends a new incident to the list.

Make it look like a real, polished internal tool — consistent spacing, hover
states, a distinct accent color, working dark mode.

**Done when:**
- `npm run dev` renders and **search + severity filter + density toggle +
  declare-incident form** all work, in both light and dark mode.
- `npm run build` succeeds **with the default command** (don't silently switch
  bundlers to make it pass — if you change the build command, say so and why).
- The built output is clean: grep `.next/` (HTML, RSC payloads, **and** JS
  chunks) and confirm the styling actually rendered — that the classes resolved
  to real CSS, not that class names merely appear in the output. A green build
  that ships unstyled markup is a failure to report, not to paper over. If
  anything is off, say exactly what you saw before fixing it.

**Then write a short, candid retro:** where it saved effort vs. plain Tailwind,
where you got stuck or confused, what surprised you, what it made awkward or
impossible, and — specifically — what `npm run build` did vs. `npm run dev`, and
whether the build/render check passed on the first try. If you hit a wall, quote
the command and the output.
