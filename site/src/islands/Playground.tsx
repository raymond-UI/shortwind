import { useEffect, useMemo, useState } from "react";
import type { Registry } from "@shortwind/core";
import { expand } from "@shortwind/core";
import { encodeShareHash, readShareHash } from "../lib/share-hash";

// The shortwind transform rewrites any literal class="@..." in this source,
// including inside string literals — splitting the @ keeps the example intact.
const AT = "@";
const DEFAULT_INPUT = `<div class="${AT}card">
  <p class="${AT}eyebrow">Revenue</p>
  <h3 class="${AT}heading-md">$48,120</h3>
  <p class="${AT}muted">+12.5% vs last month</p>
  <button class="${AT}btn-primary mt-4">View report</button>
</div>`;

const CHARS_PER_TOKEN = 4;
const tok = (s: string) => Math.max(1, Math.ceil(s.length / CHARS_PER_TOKEN));

export default function Playground({
  flattened,
}: {
  flattened: Record<string, string[]>;
}) {
  // expand() only reads registry.flattened — families can be empty.
  const registry: Registry = useMemo(
    () => ({ flattened, families: {} }),
    [flattened],
  );
  const [input, setInput] = useState(DEFAULT_INPUT);
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const fromHash = readShareHash();
    if (fromHash !== null) setInput(fromHash);
  }, []);

  // Keep the iframe preview's palette in sync with the active site theme.
  useEffect(() => {
    const el = document.documentElement;
    const update = () => setDark(el.classList.contains("dark"));
    update();
    const obs = new MutationObserver(update);
    obs.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  const output = useMemo(
    () => expand(input, registry, { mode: "html" }),
    [input, registry],
  );

  useEffect(() => {
    const hash = encodeShareHash(input);
    if (window.location.hash !== `#${hash}`) {
      window.history.replaceState(null, "", `${window.location.pathname}#${hash}`);
    }
  }, [input]);

  const inTok = tok(input);
  const outTok = tok(output);
  const savings =
    outTok > inTok
      ? `${Math.round(((outTok - inTok) / outTok) * 100)}% fewer tokens`
      : "add more @recipes";

  return (
    <div>
      <div className="@row mb-5 flex-wrap gap-2 font-mono">
        <span className="@badge-outline">shorthand {inTok} tok</span>
        <span className="@badge-outline">raw tailwind {outTok} tok</span>
        <span className={outTok > inTok ? "@badge-success" : "@badge"}>{savings}</span>
        <CopyButton text={output} label="copy expanded html" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Pane title="shorthand">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            spellCheck={false}
            className="@textarea h-44 lg:h-[28rem] resize-none p-3 font-mono text-xs leading-relaxed"
          />
        </Pane>
        <Pane title="expanded">
          <pre className="@code-block h-44 lg:h-[28rem] w-full overflow-auto p-3 text-xs leading-relaxed">
            {output}
          </pre>
        </Pane>
        <Pane title="rendered">
          {/*
            SECURITY: a #share= link can put attacker-controlled markup into
            `output`, which is injected here via srcDoc. The sandbox MUST stay
            "allow-scripts" only — never add "allow-same-origin" (it would give
            that markup access to this page's DOM/cookies/storage), nor
            allow-forms/allow-popups/allow-top-navigation. referrerPolicy stays
            no-referrer so the iframe leaks no URL.
          */}
          <iframe
            title="Rendered preview"
            sandbox="allow-scripts"
            referrerPolicy="no-referrer"
            srcDoc={renderIframe(output, dark)}
            className="h-72 lg:h-[28rem] w-full rounded-md border border-border bg-card"
          />
        </Pane>
      </div>
    </div>
  );
}

function Pane({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="@stack-xs">
      <p className="@caption font-mono uppercase tracking-wider">{title}</p>
      {children}
    </div>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        if (typeof navigator !== "undefined" && navigator.clipboard) {
          void navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }
      }}
      className="rounded px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      {copied ? "copied" : label}
    </button>
  );
}

// Pinned to an exact version + SRI rather than the floating `@4` tag: a floating
// tag can't carry an integrity hash, so unpkg serving compromised bytes would
// run unsandboxed-of-SRI. Bump the version and recompute the hash periodically:
//   curl -sL <url> | openssl dgst -sha384 -binary | openssl base64 -A
const TW_BROWSER_SRC = "https://unpkg.com/@tailwindcss/browser@4.3.0/dist/index.global.js";
const TW_BROWSER_SRI = "sha384-nWTzRTCY/9V4Bo352ehygr1c4cnst4XN6lMR3fipakEQrhVpc0hEM5Dii3Amz0sT";

function renderIframe(html: string, dark: boolean): string {
  const cls = dark ? ' class="dark"' : "";
  return `<!doctype html><html${cls}><head><meta charset="utf-8"><script src="${TW_BROWSER_SRC}" integrity="${TW_BROWSER_SRI}" crossorigin="anonymous"></script><style type="text/tailwindcss">${IFRAME_THEME}</style><style>body{font-family:ui-sans-serif,system-ui,sans-serif;margin:16px;background:var(--background);color:var(--foreground)}</style></head><body>${html}</body></html>`;
}

// CDN Tailwind in the iframe doesn't know our @theme tokens, so inline them.
// Mirrors src/index.css (neutral dev-raw palette + terminal accent).
const IFRAME_THEME = `
:root {
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.145 0 0);
  --primary: oklch(0.205 0 0);
  --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.97 0 0);
  --secondary-foreground: oklch(0.205 0 0);
  --muted: oklch(0.97 0 0);
  --muted-foreground: oklch(0.556 0 0);
  --accent: oklch(0.97 0 0);
  --accent-foreground: oklch(0.205 0 0);
  --destructive: oklch(0.577 0.245 27.325);
  --destructive-foreground: oklch(0.985 0 0);
  --border: oklch(0.922 0 0);
  --input: oklch(0.922 0 0);
  --ring: oklch(0.708 0 0);
  --term: oklch(0.62 0.17 150);
}
.dark {
  --background: oklch(0.145 0 0);
  --foreground: oklch(0.985 0 0);
  --card: oklch(0.205 0 0);
  --card-foreground: oklch(0.985 0 0);
  --primary: oklch(0.922 0 0);
  --primary-foreground: oklch(0.205 0 0);
  --secondary: oklch(0.269 0 0);
  --secondary-foreground: oklch(0.985 0 0);
  --muted: oklch(0.269 0 0);
  --muted-foreground: oklch(0.708 0 0);
  --accent: oklch(0.269 0 0);
  --accent-foreground: oklch(0.985 0 0);
  --destructive: oklch(0.704 0.191 22.216);
  --destructive-foreground: oklch(0.985 0 0);
  --border: oklch(1 0 0 / 10%);
  --input: oklch(1 0 0 / 15%);
  --ring: oklch(0.556 0 0);
  --term: oklch(0.78 0.18 150);
}
@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-term: var(--term);
}
`;
