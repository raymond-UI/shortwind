# Dogfood build prompt

The brief run against all three adapters on 2026-06-11 to test the real adoption
experience of the published `0.1.0-beta.10` packages. The **UI spec and
done-criteria are byte-identical** across the three; only the framework scaffold,
the Shortwind adapter, and where interactivity has to live differ — so any
difference in the retros is attributable to the integration, not the task.

Each was run in its own fresh agent session against an empty project dir.

## Shared brief

> Build a "Deployments" dashboard panel as a fresh **`<framework>`** app, styled
> with Shortwind.
>
> **Stack:** `<framework scaffold>` + React + TypeScript, Tailwind v4, and
> **Shortwind** for the component styling layer (on npm as `@shortwind/cli` + the
> `<adapter>`). Set it up the way the tool tells you to; don't hand-write a
> Tailwind config it doesn't ask for.
>
> **What to build** — one page, no routing, no backend (hardcode the data):
> - A header with the product name, a search input, and a primary "New
>   deployment" button.
> - A row of 4 stat cards (Total, Succeeded, Failed, Avg. duration).
> - A segmented control / tab bar (`All · Production · Preview · Failed`) — the
>   selected tab visually highlighted, clicking filters the rows.
> - A list of ~6 deployment rows: status badge (`success`/`failed`/`building`/
>   `queued`), mono branch name, commit message, author, relative timestamp, a
>   "…" actions button. Failed rows read slightly differently (e.g. red left edge).
> - A density toggle ("Comfortable / Compact") that changes row padding.
>
> Make it look like a real, polished internal tool — consistent spacing, hover
> states, dark-mode-aware if Shortwind gives you that for free.
>
> **Done when:**
> - `npm run dev` renders and the tabs + density toggle + search work.
> - `npm run build` succeeds and the built output contains **no leftover
>   `@recipe` tokens** (grep the build to confirm). If any leaked, fix it.
>
> **Then write a short, candid retro:** where Shortwind saved effort vs. plain
> Tailwind, where you got stuck or confused, what surprised you, and anything the
> tool made awkward or impossible. If you hit a wall, say exactly what you tried
> and what the tool/docs did or didn't tell you.

## Per-framework variables

| Framework | Scaffold | Adapter | Where interactivity lives | Build output grepped |
| --- | --- | --- | --- | --- |
| Vite  | `npm create vite@latest`        | `@shortwind/vite`  | plain React state          | `dist/`  |
| Astro | `npm create astro@latest` + react | `@shortwind/astro` | hydrated `.tsx` island     | `dist/`  |
| Next  | `npx create-next-app@latest`    | `@shortwind/next`  | `"use client"` boundary    | `.next/` |
