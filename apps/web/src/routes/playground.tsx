import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { expand } from "@shortwind/core";
import type { Registry } from "@shortwind/core";
import { loadCatalog } from "../lib/catalog-data";
import { buildRegistry, parseRecipeFile } from "@shortwind/core";

const DEFAULT_INPUT = `<div class="@card-elevated">
  <h3 class="text-lg font-semibold">Greetings</h3>
  <p class="mt-2 text-slate-600">Type shorthand on the left.</p>
  <button class="@button mt-4">Try it</button>
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
        <p className="@body text-base text-zinc-600 dark:text-zinc-400">
          Type shorthand HTML on the left. The middle pane shows the expanded
          Tailwind output. The right pane renders it.
        </p>
        <div className="@row gap-3">
          <span className="@muted">
            Input ≈ {inputTokens} tokens · Output ≈ {outputTokens} tokens ·{" "}
            <span className="font-medium text-zinc-700 dark:text-zinc-300">
              {savings}
            </span>
          </span>
          <CopyButton text={output} label="Copy expanded HTML" />
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Pane title="Shorthand">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            spellCheck={false}
            className="@textarea h-[28rem] resize-none p-3 font-mono text-xs leading-relaxed"
          />
        </Pane>
        <Pane title="Expanded">
          <pre
            data-testid="playground-output"
            className="@code-block h-[28rem] w-full overflow-auto p-3 text-xs leading-relaxed"
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
            className="h-[28rem] w-full rounded-md border border-zinc-200 bg-white dark:border-zinc-800"
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
    <button
      type="button"
      onClick={() => {
        if (typeof navigator !== "undefined" && navigator.clipboard) {
          void navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }
      }}
      className="@btn-ghost-sm"
    >
      {copied ? "Copied" : label}
    </button>
  );
}

function renderIframe(html: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><script src="https://unpkg.com/@tailwindcss/browser@4"></script><style>body{font-family:ui-sans-serif,system-ui,sans-serif;margin:16px}</style></head><body>${html}</body></html>`;
}

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
