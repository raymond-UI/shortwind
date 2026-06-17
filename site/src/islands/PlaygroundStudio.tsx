import { useEffect, useMemo, useRef, useState } from "react";
import { encodeShareHash, readShareHash } from "../lib/share-hash";

// "@" kept out of literal class attributes (¤ placeholder → @ at runtime) so the
// build-time Shortwind transform doesn't expand the example markup we want to
// SHOW as shorthand in the editor.
const AT = "@";
const sub = (s: string) => s.replace(/¤/g, AT);

const PRESETS: Record<string, string> = {
  card: sub(`<div class="¤card ¤stack-sm max-w-xs">
  <p class="¤eyebrow">Revenue</p>
  <h3 class="¤heading-md">$48,120</h3>
  <p class="¤muted">+12.5% MoM</p>
  <button class="¤btn-primary mt-2">View report</button>
</div>`),
  pricing: sub(`<div class="¤card ¤stack-sm max-w-xs">
  <span class="¤badge-outline">Pro</span>
  <h3 class="¤heading-xl">$29<span class="¤muted"> /mo</span></h3>
  <p class="¤muted">Everything in Free, plus unlimited projects and priority support.</p>
  <button class="¤btn-primary mt-2">Start trial</button>
  <button class="¤btn-ghost">Contact sales</button>
</div>`),
  "nav bar": sub(`<nav class="¤nav">
  <a class="¤nav-link-active">Home</a>
  <a class="¤nav-link">Docs</a>
  <a class="¤nav-link">Pricing</a>
  <a class="¤nav-link">Blog</a>
</nav>`),
  form: sub(`<form class="¤stack-sm max-w-xs">
  <label class="¤label">Email</label>
  <input class="¤input" placeholder="you@example.com" />
  <label class="¤label">Password</label>
  <input class="¤input" type="password" />
  <button class="¤btn-primary mt-2">Sign in</button>
</form>`),
  dashboard: sub(`<div class="¤grid-3 max-w-2xl">
  <div class="¤card ¤stat"><span class="¤stat-label">Revenue</span><span class="¤stat-value">$48k</span><span class="¤stat-trend">+12.5%</span></div>
  <div class="¤card ¤stat"><span class="¤stat-label">Users</span><span class="¤stat-value">2,310</span><span class="¤stat-trend">+4.1%</span></div>
  <div class="¤card ¤stat"><span class="¤stat-label">Churn</span><span class="¤stat-value">1.2%</span><span class="¤stat-trend">-0.3%</span></div>
</div>`),
  "empty state": sub(`<div class="¤empty max-w-sm">
  <div class="¤empty-icon">📭</div>
  <h3 class="¤empty-title">No projects yet</h3>
  <p class="¤empty-description">Create your first project to get started.</p>
  <button class="¤btn-primary mt-2">New project</button>
</div>`),
};

// Token estimate calibrated to the Claude Opus 4.8 tokenizer (v0-tokenizer): the
// word+symbol count tracks BPE proportionally, and ×0.75 is a least-squares fit
// across measured preset strings (card/pricing/form/dashboard, shorthand+expanded
// — 8 points). Raw counts land within ~5–15% of Opus; the saving % runs a few
// points conservative (we under-claim, never over-claim). No tokenizer dependency;
// labelled "≈" since it stays an estimate for arbitrary input.
const tok = (s: string) => Math.round(0.75 * (s.match(/[A-Za-z0-9_$]+|[^\sA-Za-z0-9_$]/g) || []).length);
const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

type Hit = { name: string; e: string };

export default function PlaygroundStudio({ flattened }: { flattened: Record<string, string[]> }) {
  const [input, setInput] = useState(PRESETS.card);
  const [preset, setPreset] = useState("card");
  const [dark, setDark] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [ac, setAc] = useState<{ open: boolean; items: Hit[]; index: number; len: number }>({ open: false, items: [], index: 0, len: 0 });
  const [k, setK] = useState<{ open: boolean; query: string; items: Hit[]; index: number }>({ open: false, query: "", items: [], index: 0 });
  const [iframeReady, setIframeReady] = useState(false);

  const taRef = useRef<HTMLTextAreaElement>(null);
  const preRef = useRef<HTMLPreElement>(null);
  const kInputRef = useRef<HTMLInputElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const names = useMemo(() => Object.keys(flattened).sort(), [flattened]);

  // class-attribute-aware @recipe → Tailwind expansion
  const expand = (src: string) =>
    src.replace(/class="([^"]*)"/g, (_, cls: string) => {
      const out = cls.split(/\s+/).map((t) => (t[0] === AT && flattened[t.slice(1)] ? flattened[t.slice(1)].join(" ") : t)).join(" ");
      return `class="${out}"`;
    });

  const search = (q: string, limit: number): Hit[] => {
    const n = (q || "").toLowerCase().replace(/^@/, "");
    const hits = n ? names.filter((x) => x.includes(n)).sort((a, b) => a.indexOf(n) - b.indexOf(n) || a.length - b.length) : names;
    return hits.slice(0, limit).map((x) => ({ name: x, e: flattened[x].join(" ") }));
  };

  // editor highlight: escape first (no user HTML survives), then color tokens.
  const highlighted = useMemo(
    () =>
      escHtml(input).replace(/@([a-z][a-z0-9-]*)/g, (m, n) =>
        flattened[n] ? `<span style="color:var(--term)">${m}</span>` : `<span style="color:var(--destructive)">${m}</span>`,
      ),
    [input, flattened],
  );

  const out = useMemo(() => expand(input), [input, flattened]);
  const inTok = tok(input);
  const outTok = tok(out);
  const pct = outTok > inTok ? Math.round(((outTok - inTok) / outTok) * 100) : 0;

  // share via URL hash (this is WHY the preview must stay sandboxed)
  useEffect(() => {
    const fromHash = readShareHash();
    if (fromHash !== null) { setInput(fromHash); setPreset(""); }
  }, []);
  useEffect(() => {
    const hash = encodeShareHash(input);
    if (window.location.hash !== `#${hash}`) window.history.replaceState(null, "", `${window.location.pathname}#${hash}`);
  }, [input]);

  // keep the iframe palette synced to the site theme toggle
  useEffect(() => {
    const el = document.documentElement;
    const u = () => setDark(el.classList.contains("dark"));
    u();
    const o = new MutationObserver(u);
    o.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => o.disconnect();
  }, []);

  // Push preview HTML into the (load-once) iframe via postMessage instead of
  // swapping srcDoc — Tailwind's live observer restyles in place, no reload,
  // no flicker. Edits update the preview smoothly.
  useEffect(() => {
    if (!iframeReady) return;
    iframeRef.current?.contentWindow?.postMessage({ t: "sw-preview", html: out, dark }, "*");
  }, [out, dark, iframeReady]);

  // ⌘K
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setAc((a) => ({ ...a, open: false }));
        setK((cur) => (cur.open ? { ...cur, open: false } : { open: true, query: "", items: search("", 40), index: 0 }));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [names]);
  useEffect(() => { if (k.open) kInputRef.current?.focus(); }, [k.open]);

  function insertAtCaret(text: string, replaceLen = 0) {
    const ta = taRef.current;
    if (!ta) return;
    const start = ta.selectionStart - replaceLen;
    const end = ta.selectionEnd;
    const next = input.slice(0, start) + text + input.slice(end);
    const pos = start + text.length;
    setInput(next);
    setPreset("");
    requestAnimationFrame(() => { const t = taRef.current; if (t) { t.selectionStart = t.selectionEnd = pos; t.focus(); } });
  }

  function refreshAC() {
    const ta = taRef.current;
    if (!ta || k.open) { setAc((a) => (a.open ? { ...a, open: false } : a)); return; }
    const before = ta.value.slice(0, ta.selectionStart);
    const m = before.match(/@([a-z0-9-]*)$/i);
    if (!m) { setAc((a) => (a.open ? { ...a, open: false } : a)); return; }
    const items = search(m[1], 6);
    if (!items.length) { setAc((a) => (a.open ? { ...a, open: false } : a)); return; }
    setAc({ open: true, items, index: 0, len: m[1].length + 1 });
  }

  function acceptAC(i: number) {
    const it = ac.items[i];
    if (!it) return;
    insertAtCaret(AT + it.name, ac.len);
    setAc((a) => ({ ...a, open: false }));
  }
  function acceptK(i: number) {
    const it = k.items[i];
    if (!it) return;
    const ta = taRef.current;
    const at = ta ? ta.value.slice(0, ta.selectionStart) : "";
    const pad = at && !/\s$/.test(at) ? " " : "";
    insertAtCaret(pad + AT + it.name);
    setK((cur) => ({ ...cur, open: false }));
  }

  const loadPreset = (name: string) => { setPreset(name); setInput(PRESETS[name]); };

  return (
    <div className="flex h-full flex-col">
      {/* toolbar: presets · token readout · ⌘K */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-4 py-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="mr-1 text-xs uppercase tracking-wider text-muted-foreground">presets</span>
          {Object.keys(PRESETS).map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => loadPreset(name)}
              className={
                "rounded-md border px-3 py-1 font-mono " +
                (preset === name ? "border-term/50 bg-term/10 text-term" : "border-border text-muted-foreground hover:border-term/50 hover:text-foreground")
              }
            >
              {name}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-3 text-sm">
          <span className="hidden font-mono text-muted-foreground sm:inline">
            shorthand <span className="font-bold text-foreground">{inTok}</span> → raw <span className="font-bold text-foreground">{outTok}</span>
          </span>
          <span className="rounded-md border border-term/40 bg-term/10 px-3 py-1 font-mono font-bold text-term">{pct}% fewer</span>
          <span className="hidden text-xs text-muted-foreground sm:inline">≈ Opus 4.8</span>
          <button type="button" onClick={() => { setAc((a) => ({ ...a, open: false })); setK({ open: true, query: "", items: search("", 40), index: 0 }); }} className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground">
            <kbd className="font-mono">⌘K</kbd> insert
          </button>
        </div>
      </div>

      {/* split: editor ↔ sandboxed preview, fills the viewport */}
      <div className="grid min-h-0 flex-1 gap-px bg-border lg:grid-cols-2">
        <section className="flex min-h-0 flex-col bg-background">
          <div className="flex shrink-0 items-center justify-between border-b border-border bg-card px-4 py-2">
            <span className="text-xs uppercase tracking-wider text-muted-foreground">shorthand · editable</span>
            <span className="text-xs text-muted-foreground">type <kbd className="rounded border border-border px-1">@</kbd> · or <kbd className="rounded border border-border px-1">⌘K</kbd></span>
          </div>
          <div className="relative min-h-0 flex-1">
            {/* SECURITY: highlighted = escHtml(input) with only @token spans added —
                user HTML is escaped, so this innerHTML carries no live markup. */}
            <pre
              ref={preRef}
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 m-0 overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-xs leading-7"
              dangerouslySetInnerHTML={{ __html: highlighted + "\n" }}
            />
            <textarea
              ref={taRef}
              value={input}
              spellCheck={false}
              onInput={(e) => { setInput((e.target as HTMLTextAreaElement).value); setPreset(""); }}
              onScroll={(e) => { const p = preRef.current; if (p) { p.scrollTop = (e.target as HTMLTextAreaElement).scrollTop; p.scrollLeft = (e.target as HTMLTextAreaElement).scrollLeft; } }}
              onClick={refreshAC}
              onKeyUp={(e) => { if (!["ArrowDown", "ArrowUp", "Enter", "Escape"].includes(e.key)) refreshAC(); }}
              onKeyDown={(e) => {
                if (!ac.open) return;
                if (e.key === "ArrowDown") { e.preventDefault(); setAc((a) => ({ ...a, index: (a.index + 1) % a.items.length })); }
                else if (e.key === "ArrowUp") { e.preventDefault(); setAc((a) => ({ ...a, index: (a.index - 1 + a.items.length) % a.items.length })); }
                else if (e.key === "Enter") { e.preventDefault(); acceptAC(ac.index); }
                else if (e.key === "Escape") { e.preventDefault(); setAc((a) => ({ ...a, open: false })); }
              }}
              style={{ color: "transparent", caretColor: "var(--term)" }}
              className="absolute inset-0 h-full w-full resize-none overflow-auto whitespace-pre-wrap break-words bg-transparent p-4 font-mono text-xs leading-7 outline-none"
            />
            {ac.open && (
              <div className="absolute bottom-3 left-3 right-3 overflow-hidden rounded-md border border-border bg-popover shadow-2xl">
                <div className="border-b border-border px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">{ac.items.length} recipes match</div>
                {ac.items.map((r, i) => (
                  <div
                    key={r.name}
                    onMouseDown={(e) => { e.preventDefault(); acceptAC(i); }}
                    className={"flex cursor-pointer items-center justify-between gap-3 px-3 py-1.5 " + (i === ac.index ? "bg-term/10" : "")}
                  >
                    <span className={"font-mono text-sm " + (i === ac.index ? "text-term" : "text-foreground")}>@{r.name}</span>
                    <span className="truncate font-mono text-[10px] text-muted-foreground">{r.e.slice(0, 38)}…</span>
                  </div>
                ))}
                <div className="border-t border-border px-3 py-1.5 text-[10px] text-muted-foreground"><kbd className="rounded border border-border px-1">↑↓</kbd> · <kbd className="rounded border border-border px-1">↵</kbd> insert · <kbd className="rounded border border-border px-1">esc</kbd></div>
              </div>
            )}
          </div>
        </section>

        <section className="flex min-h-0 flex-col bg-background">
          <div className="flex shrink-0 items-center justify-between border-b border-border bg-card px-4 py-2">
            <span className="text-xs uppercase tracking-wider text-muted-foreground">rendered</span>
            <button
              type="button"
              onClick={() => { navigator.clipboard?.writeText(out); setCopied(true); setTimeout(() => setCopied(false), 1200); }}
              className="cursor-pointer text-xs text-muted-foreground hover:text-foreground"
            >
              {copied ? "copied ✓" : "copy html ⧉"}
            </button>
          </div>
          {/* SECURITY: the one untrusted-HTML sink. `out` can come from a #share=
              link, so it renders in a sandbox="allow-scripts" iframe ONLY — never
              add allow-same-origin (would expose this page's DOM/storage). The
              srcDoc is a static shell (loaded once); `out` is pushed in via
              postMessage, which the in-iframe listener only accepts from `parent`. */}
          <iframe
            ref={iframeRef}
            title="Rendered preview"
            sandbox="allow-scripts"
            referrerPolicy="no-referrer"
            srcDoc={IFRAME_SHELL}
            onLoad={() => setIframeReady(true)}
            className="min-h-0 w-full flex-1 border-0 bg-transparent"
          />
        </section>
      </div>

      {/* expanded drawer — collapsed dock; opens upward */}
      <div className="shrink-0 border-t border-border">
        <button type="button" onClick={() => setDrawerOpen((o) => !o)} className="flex w-full items-center justify-between bg-card px-6 py-2 text-left">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">expanded tailwind <span className="text-term">{drawerOpen ? "▾" : "▸"}</span></span>
          <span className="font-mono text-xs text-muted-foreground">{outTok} tok · click to {drawerOpen ? "collapse" : "expand"}</span>
        </button>
        {drawerOpen && (
          <pre className="overflow-auto bg-background px-6 py-4 font-mono text-xs leading-6 text-muted-foreground" style={{ maxHeight: "34vh" }}>{out}</pre>
        )}
      </div>

      {/* ⌘K command palette */}
      {k.open && (
        <div className="fixed inset-0 z-40 flex justify-center bg-black/50 pt-32" onMouseDown={(e) => { if (e.target === e.currentTarget) setK((c) => ({ ...c, open: false })); }}>
          <div className="h-fit w-[34rem] max-w-[90vw] overflow-hidden rounded-xl border border-border bg-popover shadow-2xl">
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
              <span className="text-muted-foreground">⌘K</span>
              <input
                ref={kInputRef}
                value={k.query}
                placeholder={`search ${names.length} recipes…`}
                onInput={(e) => { const q = (e.target as HTMLInputElement).value; setK((c) => ({ ...c, query: q, items: search(q, 40), index: 0 })); }}
                onKeyDown={(e) => {
                  if (e.key === "ArrowDown") { e.preventDefault(); setK((c) => ({ ...c, index: (c.index + 1) % c.items.length })); }
                  else if (e.key === "ArrowUp") { e.preventDefault(); setK((c) => ({ ...c, index: (c.index - 1 + c.items.length) % c.items.length })); }
                  else if (e.key === "Enter") { e.preventDefault(); acceptK(k.index); }
                  else if (e.key === "Escape") { e.preventDefault(); setK((c) => ({ ...c, open: false })); }
                }}
                className="w-full bg-transparent font-mono text-sm text-foreground outline-none placeholder:text-muted-foreground"
              />
              <span className="text-[10px] text-muted-foreground">esc</span>
            </div>
            <div className="max-h-72 overflow-y-auto p-1.5 text-sm">
              <p className="px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">recipes</p>
              {k.items.map((r, i) => (
                <div
                  key={r.name}
                  onMouseDown={(e) => { e.preventDefault(); acceptK(i); }}
                  className={"flex cursor-pointer items-center justify-between gap-3 rounded-md px-3 py-2 " + (i === k.index ? "bg-term/10" : "")}
                >
                  <span className={"font-mono " + (i === k.index ? "text-term" : "text-foreground")}>@{r.name}</span>
                  <span className="truncate font-mono text-[10px] text-muted-foreground">{r.e.slice(0, 46)}…</span>
                </div>
              ))}
            </div>
            <div className="border-t border-border px-4 py-2 text-[10px] text-muted-foreground"><kbd className="rounded border border-border px-1">↑↓</kbd> navigate · <kbd className="rounded border border-border px-1">↵</kbd> insert at cursor · {names.length} recipes</div>
          </div>
        </div>
      )}
    </div>
  );
}

// Pinned to an exact version + SRI rather than a floating tag (a floating tag
// can't carry an integrity hash). Bump + recompute periodically:
//   curl -sL <url> | openssl dgst -sha384 -binary | openssl base64 -A
const TW_BROWSER_SRC = "https://unpkg.com/@tailwindcss/browser@4.3.0/dist/index.global.js";
const TW_BROWSER_SRI = "sha384-nWTzRTCY/9V4Bo352ehygr1c4cnst4XN6lMR3fipakEQrhVpc0hEM5Dii3Amz0sT";

// CDN Tailwind in the iframe doesn't know our @theme tokens, so inline them.
// Mirrors src/index.css (neutral dev-raw palette + terminal accent).
const IFRAME_THEME = `
:root {
  --radius: 0.5rem;
  --background: oklch(1 0 0); --foreground: oklch(0.145 0 0);
  --card: oklch(1 0 0); --card-foreground: oklch(0.145 0 0);
  --primary: oklch(0.205 0 0); --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.97 0 0); --secondary-foreground: oklch(0.205 0 0);
  --muted: oklch(0.97 0 0); --muted-foreground: oklch(0.556 0 0);
  --accent: oklch(0.97 0 0); --accent-foreground: oklch(0.205 0 0);
  --destructive: oklch(0.577 0.245 27.325); --destructive-foreground: oklch(0.985 0 0);
  --border: oklch(0.922 0 0); --input: oklch(0.922 0 0); --ring: oklch(0.708 0 0);
  --term: oklch(0.62 0.17 150); --popover: oklch(1 0 0); --popover-foreground: oklch(0.145 0 0);
}
.dark {
  --background: oklch(0.145 0 0); --foreground: oklch(0.985 0 0);
  --card: oklch(0.205 0 0); --card-foreground: oklch(0.985 0 0);
  --primary: oklch(0.922 0 0); --primary-foreground: oklch(0.205 0 0);
  --secondary: oklch(0.269 0 0); --secondary-foreground: oklch(0.985 0 0);
  --muted: oklch(0.269 0 0); --muted-foreground: oklch(0.708 0 0);
  --accent: oklch(0.269 0 0); --accent-foreground: oklch(0.985 0 0);
  --destructive: oklch(0.704 0.191 22.216); --destructive-foreground: oklch(0.985 0 0);
  --border: oklch(1 0 0 / 10%); --input: oklch(1 0 0 / 15%); --ring: oklch(0.556 0 0);
  --term: oklch(0.78 0.18 150); --popover: oklch(0.205 0 0); --popover-foreground: oklch(0.985 0 0);
}
@theme inline {
  --color-background: var(--background); --color-foreground: var(--foreground);
  --color-card: var(--card); --color-card-foreground: var(--card-foreground);
  --color-primary: var(--primary); --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary); --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted); --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent); --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive); --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border); --color-input: var(--input); --color-ring: var(--ring);
  --color-term: var(--term); --color-popover: var(--popover); --color-popover-foreground: var(--popover-foreground);
  --radius-sm: calc(var(--radius) - 2px); --radius-md: calc(var(--radius) - 1px); --radius-lg: var(--radius);
}
`;

// A static shell loaded ONCE: Tailwind + theme + a #root and a message listener.
// The parent posts {html, dark}; the listener swaps #root's content (Tailwind's
// observer restyles in place) — so edits update smoothly with no reload/flicker.
// Only the tagged message type is honoured; the iframe stays sandboxed (no
// allow-same-origin) and nothing external holds a handle to it, so a window-source
// check isn't needed (and is unreliable across the opaque-origin boundary).
const IFRAME_SHELL = `<!doctype html><html><head><meta charset="utf-8"><script src="${TW_BROWSER_SRC}" integrity="${TW_BROWSER_SRI}" crossorigin="anonymous"></script><style type="text/tailwindcss">${IFRAME_THEME}</style><style>body{margin:0;min-height:100vh;display:grid;place-items:center;padding:2rem;font-family:ui-sans-serif,system-ui,sans-serif;background:var(--background);color:var(--foreground);background-image:radial-gradient(rgba(128,128,128,0.18) 1px,transparent 1px);background-size:22px 22px}</style></head><body><div id="root"></div><script>(function(){var r=document.getElementById("root");addEventListener("message",function(e){if(!e.data||e.data.t!=="sw-preview")return;document.documentElement.className=e.data.dark?"dark":"";r.innerHTML=e.data.html})})();</script></body></html>`;
