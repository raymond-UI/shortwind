import { useState } from "react";

/**
 * A mono value with a one-click copy affordance — the copy pattern proven on
 * the Domains screen (#213), extracted so every view can offer the same
 * "click to copy" for URLs, token ids, DNS targets, etc. On copy it flashes a
 * term-green "Copied ✓" for ~1.4s; the affordance label is hidden until hover.
 */
export function CopyValue({
  value,
  testId,
  className = "",
}: {
  value: string;
  testId?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard blocked — no-op */
    }
  }
  return (
    <button
      type="button"
      onClick={copy}
      data-testid={testId}
      title="Copy"
      className={
        "group inline-flex max-w-full items-center gap-2 rounded px-1.5 py-0.5 font-mono text-sm hover:bg-secondary " +
        className
      }
    >
      <span className="truncate">{value}</span>
      <span
        className={`shrink-0 text-[11px] ${
          copied
            ? "text-term"
            : "text-muted-foreground opacity-0 group-hover:opacity-100"
        }`}
      >
        {copied ? "Copied ✓" : "Copy"}
      </span>
    </button>
  );
}
