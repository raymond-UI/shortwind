# Dogfood build prompt — Vite (feature-flags console, beta.16)

The Vite counterpart to next-flags. Exercises the tone system, the new families
(menu/sheet/stat/segmented/switch), and a class-based dark toggle on the Vite
adapter (`load`-hook injection, `dist/` output). Run against the published
`@shortwind/*` packages in a fresh, empty dir. Hand verbatim to a fresh session.

---

Build a **Feature Flags admin console** as a fresh **Vite + React + TypeScript**
app.

**Stack:** `npm create vite@latest` (React + TypeScript) + Tailwind v4. Style it
with **Shortwind** — https://shortwind.dev. Set it up the way the tool tells you
to; don't hand-write a Tailwind config it doesn't ask for.

**What to build** — one console page (no routing, no backend; hardcode the data),
rich enough to be a believable internal tool:

1. **Top bar** — product name, a global search, a **dark-mode toggle**, and a
   primary "New flag" button.
2. **Summary band** — 4–5 metric tiles (Total flags, Enabled, Rolling out,
   Stale, Owners).
3. **Status filter** — a segmented control (`All · Enabled · Disabled · Rolling
   out · Stale`); selecting one filters the list, the active choice highlighted.
4. **Flag list** — ~8 flags. Each row has:
   - a **toggle** to enable/disable the flag (flips its state live),
   - an **environment badge** (`prod` / `staging` / `dev`) and a **status badge**
     (`enabled` / `disabled` / `rolling-out` / `stale`) — the badge color is
     **chosen from each flag's data at render time**, not hardcoded per row,
   - the flag key (mono), description, owner, a rollout %, a relative "updated"
     time, and a **"…" actions menu** (Edit, Duplicate, Archive) that opens on
     click.
   - Stale rows read muted; a `rolling-out` flag reads emphasized.
5. **A density toggle** (Comfortable / Compact) for row padding.
6. **An edit panel** — clicking a flag (or "Edit" / "New flag") opens a
   **slide-over** with: name, key, description, environment (select), a few
   **on/off toggles**, a rollout percentage, and save/cancel. Saving updates the
   row.

Make it look like a real, polished internal tool — consistent spacing, hover
states, a distinct accent color, and a **dark mode that actually toggles** (not
just system preference).

**Done when:**
- `npm run dev` renders and **search + status filter + density toggle + row
  toggles + actions menu + edit slide-over + the dark-mode toggle** all work.
- `npm run build` succeeds with the default command, and the preview
  (`npm run preview`) renders the built output.
- The built `dist/` is clean: grep it (HTML, JS, CSS) and confirm the styling
  actually rendered — that the classes resolved to real CSS, not that class
  names merely appear. A green build that ships unstyled markup is a failure to
  report, not to paper over. If anything is off, say exactly what you saw before
  fixing it.

**Then write a short, candid retro:** where it saved effort vs. plain Tailwind,
where you got stuck or confused, what surprised you, what it made awkward or
impossible. Specifically call out:
- which Shortwind recipes you reached for, and anything you **expected to exist
  but couldn't find** (or had to build by hand),
- how you handled the parts where **styling changes based on data** (the badge
  colors, the toggle states, the active filter segment),
- how **dark mode** came together — what the tool set up for you vs. what you had
  to wire yourself,
- whether the build/render check passed on the first try.

If you hit a wall, quote the command and the output.
