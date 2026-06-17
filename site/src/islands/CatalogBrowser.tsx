import { useEffect, useMemo, useRef, useState } from "react";
import type { CatalogFamily } from "../lib/catalog-data";

// Recipes whose expansion takes the element out of flow can't render a sensible
// inline preview — show a note instead (mirrors the old catalog).
const NON_PREVIEW = ["fixed", "absolute", "inset-0", "inset-x-0", "inset-y-0"];
const isPreviewable = (e: string[]) => !e.some((c) => NON_PREVIEW.includes(c));

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Recipe ref built dynamically (prefix + name) so the build-time Shortwind
// transform never sees a literal recipe token in this source and pre-expands
// it — expansion stays the island's job at runtime.
const R = (n: string) => "@" + n;

type Meta = { e: string; d: string | null; f: string };

export default function CatalogBrowser({
  families,
  flattened,
  recipeCount,
}: {
  families: CatalogFamily[];
  flattened: Record<string, string[]>;
  recipeCount: number;
}) {
  const REG = useMemo(() => {
    const m: Record<string, Meta> = {};
    for (const fam of families)
      for (const r of fam.recipes)
        m[r.name] = { e: r.expansion.join(" "), d: r.description, f: fam.name };
    return m;
  }, [families]);

  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(families[0]?.recipes[0]?.name ?? "");
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // class-attribute-aware @recipe → Tailwind expansion (for the live preview)
  const expand = (src: string) =>
    src.replace(/class="([^"]*)"/g, (_, cls: string) => {
      const out = cls
        .split(/\s+/)
        .map((t) => (t[0] === "@" && flattened[t.slice(1)] ? flattened[t.slice(1)].join(" ") : t))
        .join(" ");
      return `class="${out}"`;
    });

  const { groups, order } = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^@/, "");
    const groups: { name: string; count: number; recipes: string[] }[] = [];
    const order: string[] = [];
    for (const fam of families) {
      const recs = fam.recipes
        .filter(
          (r) =>
            !q ||
            r.name.includes(q) ||
            (r.description ?? "").toLowerCase().includes(q) ||
            fam.name.includes(q),
        )
        .map((r) => r.name);
      if (!recs.length) continue;
      groups.push({ name: fam.name, count: fam.recipes.length, recipes: recs });
      order.push(...recs);
    }
    return { groups, order };
  }, [families, query]);

  // keep a valid selection as the filter narrows
  useEffect(() => {
    if (order.length && !order.includes(selected)) setSelected(order[0]);
  }, [order, selected]);

  // keep the selected row in view
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-name="${selected}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  // "/" focuses search; ↑↓ walk the list from anywhere
  useEffect(() => {
    const move = (d: number) => {
      const i = Math.max(0, order.indexOf(selected));
      if (order.length) setSelected(order[(i + d + order.length) % order.length]);
    };
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      const inSearch = e.target === searchRef.current;
      if (e.key === "/" && tag !== "INPUT" && tag !== "TEXTAREA") {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === "ArrowDown" && (inSearch || tag === "BODY")) {
        e.preventDefault();
        move(1);
      } else if (e.key === "ArrowUp" && (inSearch || tag === "BODY")) {
        e.preventDefault();
        move(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [order, selected]);

  return (
    <div className="grid h-full grid-rows-[15rem_1fr] md:grid-rows-1 md:grid-cols-[17rem_minmax(0,1fr)]">
      {/* palette rail — scrolls independently */}
      <aside className="flex min-h-0 flex-col border-b border-border bg-card/40 md:border-b-0 md:border-r">
        <div className="shrink-0 border-b border-border p-3">
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery((e.target as HTMLInputElement).value)}
            placeholder='search recipes — press "/"'
            className="w-full rounded-md border border-input bg-background px-3 py-1.5 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:border-term focus:outline-none"
          />
          {query.trim() && (
            <p className="mt-2 text-[10px] uppercase tracking-wider text-muted-foreground">
              {order.length} recipes match “{query.trim()}”
            </p>
          )}
        </div>
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-2 text-sm">
          {order.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">no matches</p>
          ) : (
            groups.map((g) => (
              <div key={g.name}>
                <p className="mt-2 px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                  {g.name} · {g.count}
                </p>
                {g.recipes.map((n) => (
                  <button
                    key={n}
                    type="button"
                    data-name={n}
                    onClick={() => setSelected(n)}
                    className={
                      "block w-full truncate rounded px-2 py-1 text-left font-mono text-xs " +
                      (n === selected
                        ? "bg-term/10 text-term"
                        : "text-muted-foreground hover:bg-term/10 hover:text-foreground")
                    }
                  >
                    @{n}
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      </aside>

      {/* detail — scrolls independently */}
      <main className="min-h-0 overflow-y-auto">
        {selected && REG[selected] && (
          <Detail name={selected} meta={REG[selected]} expand={expand} />
        )}
      </main>
    </div>
  );
}

function Detail({
  name,
  meta,
  expand,
}: {
  name: string;
  meta: Meta;
  expand: (s: string) => string;
}) {
  const classes = meta.e;
  const utils = classes.split(" ");
  const previewable = isPreviewable(utils);

  return (
    <div className="mx-auto max-w-3xl px-5 py-6 sm:px-8 sm:py-8">
      {/* mobile: chip + copy on row 1, title on row 2. desktop: chip · title · copy(right) in one row. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="order-1 w-fit shrink-0 rounded-md border border-border bg-card px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
          {meta.f}
        </span>
        <Copy
          text={`@${name}`}
          label={`copy @${name}`}
          className="order-2 ml-auto shrink-0 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground sm:order-3"
        />
        <h1 className="order-3 w-full min-w-0 break-words font-mono text-xl font-bold sm:order-2 sm:w-auto sm:text-2xl">
          <span className="text-term">@</span>
          {name}
        </h1>
      </div>
      {meta.d && (
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">{meta.d}</p>
      )}

      <p className="mt-8 mb-2 text-xs uppercase tracking-wider text-muted-foreground">preview</p>
      {previewable ? (
        // SECURITY: example() builds markup only from fixed templates over known
        // recipe names (no user input); expand() applies our flattened registry.
        <div
          className="grid min-h-[12rem] place-items-center rounded-lg border border-dashed border-border bg-background p-8"
          dangerouslySetInnerHTML={{ __html: expand(example(name, meta.f)) }}
        />
      ) : (
        <div className="grid min-h-[8rem] place-items-center rounded-lg border border-dashed border-border bg-background p-8 text-center">
          <p className="font-mono text-xs text-muted-foreground italic">
            positioning / overlay recipe — pair it with your own layout
          </p>
        </div>
      )}

      <p className="mt-8 mb-2 text-xs uppercase tracking-wider text-muted-foreground">shorthand</p>
      <div className="rounded-lg border border-border bg-card px-4 py-2.5">
        <code className="font-mono text-sm text-foreground">
          &lt;div class="<span className="text-term">@{name}</span>"&gt;…&lt;/div&gt;
        </code>
      </div>

      <div className="mt-8 mb-2 flex items-center justify-between">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          expands to {utils.length} utilities
        </p>
        <Copy text={classes} label="copy all ⧉" className="text-xs text-muted-foreground hover:text-foreground" />
      </div>
      <div className="flex flex-wrap gap-1.5 rounded-lg border border-border bg-card p-4">
        {utils.map((c) => (
          <span key={c} className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
            {c}
          </span>
        ))}
      </div>

      <p className="mt-8 mb-2 text-xs uppercase tracking-wider text-muted-foreground">
        install the {meta.f} family
      </p>
      <div className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-2.5">
        <code className="font-mono text-sm text-muted-foreground">
          <span className="text-term">$</span> npx @shortwind/cli@beta add {meta.f}
        </code>
        <Copy text={`npx @shortwind/cli@beta add ${meta.f}`} label="copy ⧉" className="text-xs text-muted-foreground hover:text-foreground" />
      </div>
    </div>
  );
}

function Copy({ text, label, className: cls }: { text: string; label: string; className: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={cls}
      onClick={() => {
        navigator.clipboard?.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
    >
      {copied ? "copied ✓" : label}
    </button>
  );
}

// family-aware live example markup (uses @recipe via R(); expanded by the island)
const box = (n: string) =>
  `<div style="display:grid;place-items:center;height:2.5rem;width:2.5rem;border:1px solid var(--border);border-radius:6px;font-size:11px;color:var(--muted-foreground)">${n}</div>`;

function example(name: string, fam: string): string {
  const c = R(name);
  switch (fam) {
    case "button":
      return `<button class="${c}">Button</button>`;
    case "badge":
      return `<span class="${c}">Badge</span>`;
    case "text":
      if (name === "link") return `<a class="${c}" href="#">a link</a>`;
      if (["eyebrow", "label", "caption"].includes(name)) return `<p class="${c}">${name}</p>`;
      return `<p class="${c}">The quick brown fox</p>`;
    case "code":
      if (name === "code-block") return `<pre class="${c}">expand(input, registry)</pre>`;
      if (name === "kbd") return `<kbd class="${c}">⌘K</kbd>`;
      return `<code class="${c}">npm i shortwind</code>`;
    case "form":
      if (name === "textarea") return `<textarea class="${c}" rows="2">Text…</textarea>`;
      if (name === "checkbox" || name === "radio")
        return `<input type="${name === "radio" ? "radio" : "checkbox"}" class="${c}" checked />`;
      if (name === "label") return `<label class="${c}">Email address</label>`;
      if (name === "select") return `<select class="${c}"><option>Choose…</option></select>`;
      if (["field", "fieldset"].includes(name))
        return `<div class="${c}"><label class="${R("label")}">Email</label><input class="${R("input")}" placeholder="you@example.com"/></div>`;
      if (["help", "field-error"].includes(name)) return `<p class="${c}">Helper text for the field.</p>`;
      return `<input class="${c}" placeholder="you@example.com" />`;
    case "stat":
      if (name === "stat")
        return `<div class="${R("card")} ${c}" style="max-width:14rem"><span class="${R("stat-label")}">Revenue</span><span class="${R("stat-value")}">$48,120</span><span class="${R("stat-trend")}">+12.5%</span></div>`;
      return `<p class="${c}">${name === "stat-value" ? "$48,120" : name === "stat-trend" ? "+12.5%" : "Revenue"}</p>`;
    case "layout":
      return `<div class="${c}">${box("1")}${box("2")}${box("3")}</div>`;
    case "card":
      if (["card", "card-elevated", "card-flat", "card-interactive"].includes(name))
        return `<div class="${c}" style="max-width:16rem"><p class="${R("eyebrow")}">Eyebrow</p><h3 class="${R("heading-md")}">Card title</h3><p class="${R("muted")}">A short description inside the card.</p></div>`;
      return `<div class="${R("card")}" style="max-width:16rem"><div class="${c}">${name.replace("card-", "")}</div></div>`;
    case "navigation":
      if (name === "nav")
        return `<nav class="${c}"><a class="${R("nav-link-active")}">Home</a><a class="${R("nav-link")}">Docs</a><a class="${R("nav-link")}">Pricing</a></nav>`;
      if (name === "breadcrumb") return `<nav class="${c}">Home / Docs / Catalog</nav>`;
      if (name.includes("tab"))
        return `<div class="${R("nav")}"><span class="${R("tab-active")}">Active</span><span class="${R("tab")}">Tab</span></div>`;
      return `<a class="${c}">Nav link</a>`;
    case "list":
      if (["list", "list-bordered"].includes(name))
        return `<ul class="${c}"><li class="${R("list-item")}">First item</li><li class="${R("list-item")}">Second item</li></ul>`;
      if (name.startsWith("description") || ["dl", "dt", "dd"].includes(name))
        return `<dl class="${R("description-list")}"><dt class="${R("dt")}">Plan</dt><dd class="${R("dd")}">Pro</dd></dl>`;
      return `<div class="${R("list")}"><div class="${c}">List item</div></div>`;
    case "feedback":
      return `<div class="${c}">A short ${name} message for the user.</div>`;
    case "empty":
      if (name === "empty")
        return `<div class="${c}"><div class="${R("empty-icon")}">📭</div><h3 class="${R("empty-title")}">Nothing here yet</h3><p class="${R("empty-description")}">Create something to get started.</p></div>`;
      return `<div class="${R("empty")}"><div class="${c}">${name.replace("empty-", "")}</div></div>`;
    case "progress":
      if (name === "spinner") return `<div class="${c}"></div>`;
      return `<div class="${R("progress-track")}" style="width:12rem"><div class="${R("progress-bar")}" style="width:60%"></div></div>`;
    case "media":
      if (name.startsWith("avatar")) return `<div class="${c}"></div>`;
      return `<div class="${c}" style="width:8rem"></div>`;
    case "icon":
      return `<span class="${c}">★</span>`;
    case "surface":
      return `<div class="${c}">Surface content</div>`;
    case "segmented":
      if (name === "segmented")
        return `<div class="${c}"><button class="${R("segmented-item")}">Day</button><button class="${R("segmented-item")}">Week</button></div>`;
      return `<button class="${c}">Item</button>`;
    case "switch":
      return `<div class="${R("switch")}"><div class="${R("switch-thumb")}"></div></div>`;
    case "skeleton":
      return `<div class="${c}" style="width:10rem"></div>`;
    case "menu":
      if (name === "menu")
        return `<div class="${c}"><div class="${R("menu-item")}">Edit</div><div class="${R("menu-item")}">Duplicate</div></div>`;
      return `<div class="${R("menu")}"><div class="${c}">${name.replace("menu-", "")}</div></div>`;
    default:
      return `<div class="${c}">Aa Bb Cc</div>`;
  }
}
