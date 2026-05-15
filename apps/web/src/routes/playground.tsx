import type { Registry } from "@shortwind/core";
import { buildRegistry, expand } from "@shortwind/core";
import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { loadCatalog } from "../lib/catalog-data";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

// `@shortwind/vite` scans this file at build time and rewrites any
// `class="@..."` it finds — including inside string literals. Interpolating
// the `@` symbol keeps the source from matching that pattern, so the example
// reaches the textarea unexpanded.
const AT = "@";
const DEFAULT_INPUT = `<div class="${AT}card-elevated">
  <h3 class="text-lg font-semibold">Greetings</h3>
  <p class="mt-2 text-muted-foreground">Type shorthand on the left.</p>
  <button class="${AT}btn-primary mt-4">Try it</button>
</div>`;

const getRegistry = createServerFn({ method: "GET" }).handler((): Registry => {
  const catalog = loadCatalog();
  const recipes = catalog.families.flatMap((f) =>
    f.recipes.map((r) => ({
      name: r.name,
      description: r.description,
      tokens: r.tokens,
      references: r.references,
      sourceFile: `${f.name}.css`,
      sourceLine: 1,
    })),
  );
  const built = buildRegistry(recipes);
  if (!built.ok) return { flattened: {}, families: {} };
  return { flattened: built.value.flattened, families: built.value.families };
});

export const Route = createFileRoute("/playground")({
  loader: () => getRegistry(),
  component: PlaygroundPage,
});

function PlaygroundPage() {
  const registry = Route.useLoaderData() as Registry;
  // SSR has no window, so the initial state must match what the server
  // rendered. We rehydrate the shared input from `location.hash` in an effect
  // after mount.
  const [input, setInput] = useState<string>(DEFAULT_INPUT);

  useEffect(() => {
    const fromHash = readShareHash();
    if (fromHash !== null) setInput(fromHash);
  }, []);

  const output = useMemo(() => expand(input, registry, { mode: "html" }), [
    input,
    registry,
  ]);

  useEffect(() => {
    const hash = encodeShareHash(input);
    if (window.location.hash !== `#${hash}`) {
      const url = `${window.location.pathname}#${hash}`;
      window.history.replaceState(null, "", url);
    }
  }, [input]);

  const inputChars = input.length;
  const outputChars = output.length;
  // Rule-of-thumb token estimate. OpenAI/Anthropic tokenizers average ~4
  // characters per token for English/code mixes; we use it for display only,
  // so we don't ship an actual tokenizer to the browser.
  const CHARS_PER_TOKEN = 4;
  const inputTokens = Math.max(1, Math.ceil(inputChars / CHARS_PER_TOKEN));
  const outputTokens = Math.max(1, Math.ceil(outputChars / CHARS_PER_TOKEN));
  const savings =
    outputTokens > inputTokens
      ? `${Math.round(((outputTokens - inputTokens) / outputTokens) * 100)}% smaller`
      : "0% — try adding more @recipes";

  return (
    <section className="@container max-w-7xl py-10">
      <header className="@stack-sm mb-6">
        <h1 className="@heading-lg text-3xl">Playground</h1>
        <p className="@body text-base text-muted-foreground">
          Type shorthand HTML on the left. The middle pane shows the expanded
          Tailwind output. The right pane renders it.
        </p>
        <div className="@row flex-wrap gap-2">
          <Badge variant="secondary">Input ≈ {inputTokens} tokens</Badge>
          <Badge variant="secondary">Output ≈ {outputTokens} tokens</Badge>
          <Badge variant={outputTokens > inputTokens ? "success" : "outline"}>
            {savings}
          </Badge>
          <CopyButton text={output} label="Copy expanded HTML" />
        </div>
      </header>

      <Separator className="my-6" />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Pane title="Shorthand">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            spellCheck={false}
            className="@textarea h-112 resize-none p-3 font-mono text-xs leading-relaxed"
          />
        </Pane>
        <Pane title="Expanded">
          <pre
            data-testid="playground-output"
            className="@code-block h-112 w-full overflow-auto p-3 text-xs leading-relaxed"
          >
            {output}
          </pre>
        </Pane>
        <Pane title="Rendered">
          <iframe
            title="Rendered preview"
            sandbox="allow-scripts"
            referrerPolicy="no-referrer"
            srcDoc={renderIframe(output)}
            className="h-112 w-full rounded-md border border-border bg-card"
          />
        </Pane>
      </div>
    </section>
  );
}

function Pane({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="@caption mb-2 font-medium uppercase tracking-wider">
        {title}
      </p>
      {children}
    </div>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => {
        if (typeof navigator !== "undefined" && navigator.clipboard) {
          void navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }
      }}
    >
      {copied ? "Copied" : label}
    </Button>
  );
}

function renderIframe(html: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><script src="https://unpkg.com/@tailwindcss/browser@4"></script><style type="text/tailwindcss">${IFRAME_THEME}</style><style>body{font-family:ui-sans-serif,system-ui,sans-serif;margin:16px;background:var(--background);color:var(--foreground)}</style></head><body>${html}</body></html>`;
}

// CDN Tailwind inside the iframe doesn't know about our app's @theme tokens, so
// `bg-card` and friends would resolve to undefined and the preview would look
// broken. Inline the theme variable block so the rendered output matches the
// app's design system.
const IFRAME_THEME = `
:root {
  --background: oklch(0.9816 0.0017 247.8390);
  --foreground: oklch(0.1649 0.0352 281.8285);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.1649 0.0352 281.8285);
  --primary: oklch(0.6726 0.2904 341.4084);
  --primary-foreground: oklch(1 0 0);
  --secondary: oklch(0.9595 0.0200 286.0164);
  --secondary-foreground: oklch(0.1649 0.0352 281.8285);
  --muted: oklch(0.9595 0.0200 286.0164);
  --muted-foreground: oklch(0.4500 0.0300 281.8285);
  --accent: oklch(0.8903 0.1739 171.2690);
  --accent-foreground: oklch(0.1649 0.0352 281.8285);
  --destructive: oklch(0.6535 0.2348 34.0370);
  --destructive-foreground: oklch(1 0 0);
  --border: oklch(0.9205 0.0086 225.0878);
  --input: oklch(0.9205 0.0086 225.0878);
  --ring: oklch(0.6726 0.2904 341.4084);
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
}
`;

function toBase64(utf8: string): string {
  // Round-trip via `TextEncoder` so unicode characters survive base64 — the
  // legacy `unescape(encodeURIComponent(...))` trick is deprecated and lints
  // poorly in modern toolchains.
  if (typeof btoa !== "undefined" && typeof TextEncoder !== "undefined") {
    const bytes = new TextEncoder().encode(utf8);
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
    return btoa(bin);
  }
  return Buffer.from(utf8, "utf8").toString("base64");
}

function fromBase64(b64: string): string {
  if (typeof atob !== "undefined" && typeof TextDecoder !== "undefined") {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  return Buffer.from(b64, "base64").toString("utf8");
}

export function encodeShareHash(input: string): string {
  return "share=" + toBase64(input);
}

// 50 KB encoded ceiling — well above any reasonable hand-typed snippet,
// well below the multi-MB inputs that would freeze expand() in the tab.
export const MAX_SHARE_HASH_BYTES = 50 * 1024;

export function decodeShareHash(hash: string): string | null {
  const m = hash.match(/share=([^&]+)/);
  if (!m) return null;
  const payload = m[1]!;
  if (payload.length > MAX_SHARE_HASH_BYTES) return null;
  try {
    return fromBase64(payload);
  } catch {
    return null;
  }
}

function readShareHash(): string | null {
  if (typeof window === "undefined") return null;
  const hash = window.location.hash.replace(/^#/, "");
  return decodeShareHash(hash);
}
