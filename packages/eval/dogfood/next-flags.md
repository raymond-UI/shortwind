# Dogfood build prompt — Next.js (feature-flags console, beta.14)

Tests the beta.14 catalog: the new families (menu / sheet / stat / segmented /
switch) and data-driven tone coloring. The brief demands all of them without
naming them — point the agent at shortwind.dev and see what it discovers and
whether it works. Run against the published `@shortwind/*` packages in a fresh,
empty dir. Hand verbatim to a fresh session.

---

Build a **Feature Flags admin console** as a fresh **Next.js (App Router)** app.

**Stack:** `npx create-next-app@latest` (TypeScript, App Router, Tailwind v4) +
React. Style it with **Shortwind** — https://shortwind.dev.

**What to build** — one console page (no routing, no backend; hardcode the data),
rich enough to be a believable internal tool:

1. **Top bar** — product name, a global search, a dark-mode toggle, and a primary
   "New flag" button.
2. **Summary band** — 4–5 metric tiles (Total flags, Enabled, Rolling out,
   Stale, Owners).
3. **Status filter** — a segmented control (`All · Enabled · Disabled · Rolling
   out · Stale`); selecting one filters the list, the active choice highlighted.
4. **Flag list** — ~8 flags. Each row has:
   - a **toggle** to enable/disable the flag (flips its state live),
   - an **environment badge** (`prod` / `staging` / `dev`) and a **status badge**
     (`enabled` / `disabled` / `rolling-out` / `stale`) — the badge color is
     **chosen from each flag's data at render time**, not hardcoded per row,
   - the flag key (mono), description, owner, a rollout % , a relative
     "updated" time, and a **"…" actions menu** (Edit, Duplicate, Archive) that
     opens on click.
   - Stale rows read muted; a flag that's `rolling-out` reads emphasized.
5. **A density toggle** (Comfortable / Compact) for row padding.
6. **An edit panel** — clicking a flag (or "Edit" / "New flag") opens a
   **slide-over** with: name, key, description, environment (select), a few
   **on/off toggles** (e.g. "kill switch", "sticky bucketing"), a rollout
   percentage, and save/cancel. Saving updates the row.

Make it look like a real, polished internal tool — consistent spacing, hover
states, a distinct accent color, working dark mode.

**Done when:**
- `npm run dev` renders and **search + status filter + density toggle +
  row toggles + actions menu + edit slide-over** all work, in light and dark.
- `npm run build` succeeds **with the default command** (don't silently switch
  bundlers to make it pass — if you change the build command, say so and why).
- The built output is clean: grep `.next/` (HTML, RSC payloads, **and** JS
  chunks) and confirm the styling actually rendered — that the classes resolved
  to real CSS, not that class names merely appear. A green build that ships
  unstyled markup is a failure to report, not to paper over. If anything is off,
  say exactly what you saw before fixing it.

**Then write a short, candid retro:** where it saved effort vs. plain Tailwind,
where you got stuck or confused, what surprised you, and what it made awkward or
impossible. Specifically call out:
- which Shortwind recipes you reached for, and anything you **expected to exist
  but couldn't find** (or had to build by hand),
- how you handled the parts where **styling changes based on data** (the badge
  colors, the toggle states, the active filter segment),
- what `npm run build` did vs. `npm run dev`, and whether the build/render check
  passed on the first try.

If you hit a wall, quote the command and the output.
