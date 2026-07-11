import { useRef, useState } from "react";
import { useDashboardData } from "../lib/data";
import { CopyValue } from "../components/CopyValue";
import { Dialog } from "../components/Dialog";
import type { Visibility } from "../lib/types";

/**
 * Publish a page from the browser (web/CLI parity, epic feature 1). Drag-and-drop
 * or pick an `.html` file; it is read in-browser and published via the
 * session-authed `publishPage` seam (→ `pages.publishFromWeb`), which expands any
 * `@recipe` shorthand server-side against the account's stored palette. No CLI,
 * no local recipes needed. Plain HTML works too.
 */

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB — a single HTML page.
const VISIBILITIES: Visibility[] = ["public", "unlisted", "private"];
// Mirror the shared `validateSlug` grammar (apps/cloud/shared/src/slug.ts): a
// client-side check so a bad address fails fast with a friendly message instead
// of a raw server error.
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

type Picked = { name: string; html: string };

/**
 * Default address for an uploaded file: normalize the FILE NAME to the slug
 * grammar (strip extension, lowercase, non-alphanumerics → single dashes). This
 * is the sensible default when the user leaves the address blank — far better
 * than the server deriving a slug from the raw HTML ("doctype-html-html-lang…").
 * Returns "" for a name that normalizes to nothing (e.g. all punctuation).
 */
function slugFromFilename(name: string): string {
  return name
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

/**
 * Map a publish failure to a friendly line. ConvexError codes ride on `.data`;
 * a plain server `Error` has none, and we must NEVER surface its raw message
 * (e.g. the "[CONVEX A(pages:publishFromWeb)] … Server Error" wrapper) to the
 * user — that's noise. Known cases get specific copy; everything else gets a
 * clean generic line.
 */
function friendlyError(err: unknown): string {
  const data = (err as { data?: { code?: string; reason?: string; message?: string } })
    ?.data;
  const code = data?.code;
  if (code === "RATE_LIMITED")
    return "You're publishing too fast. Wait a moment and try again.";
  if (code === "CONTENT_BLOCKED")
    return "This page was blocked by the content scanner.";
  if (code === "CSAM_BLOCKED")
    return "This page was blocked and cannot be published.";
  if (code === "UNAUTHORIZED" || data?.reason === "no_account")
    return "Your account isn't ready yet. Reload and try again.";
  const raw = data?.message ?? (err as Error)?.message ?? "";
  // Backstop: a slug-format failure can arrive as a plain Error (no code).
  if (/slug must be lowercase|reserved slug/i.test(raw))
    return "That address is invalid. Use lowercase letters, numbers, and single dashes.";
  return "Couldn't publish that page. Please try again.";
}

export function UploadPageDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { publishPage } = useDashboardData();
  const [picked, setPicked] = useState<Picked | null>(null);
  const [slug, setSlug] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("public");
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ url: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function reset() {
    setPicked(null);
    setSlug("");
    setVisibility("public");
    setError(null);
    setDone(null);
    setBusy(false);
  }
  function close() {
    reset();
    onClose();
  }

  async function acceptFile(file: File) {
    setError(null);
    const isHtml =
      file.type === "text/html" || /\.html?$/i.test(file.name);
    if (!isHtml) {
      setError("Please choose an .html file.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("That file is over 2 MB. Web uploads are for a single page.");
      return;
    }
    const html = await file.text();
    if (html.trim() === "" || !html.includes("<")) {
      setError("That file doesn't look like HTML.");
      return;
    }
    setPicked({ name: file.name, html });
    // Pre-fill the address from the file name (only if the user hasn't typed
    // one), so the default slug is predictable and editable.
    setSlug((cur) => (cur.trim() ? cur : slugFromFilename(file.name)));
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void acceptFile(file);
  }

  async function publish() {
    if (!picked || busy) return;
    // Fall back to the file-name slug when the address was cleared, so we never
    // let the server derive a slug from the raw HTML.
    const typed = slug.trim();
    if (typed && !SLUG_RE.test(typed)) {
      setError(
        "Address must be lowercase letters, numbers, and single dashes (no spaces or capitals).",
      );
      return;
    }
    const finalSlug = typed || slugFromFilename(picked.name) || undefined;
    setBusy(true);
    setError(null);
    try {
      const result = await publishPage({
        html: picked.html,
        slug: finalSlug,
        visibility,
      });
      if (result.ok) {
        setDone({ url: result.url });
      } else {
        setError("That address is taken. Pick a different name.");
      }
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={close} labelledBy="upload-page-title">
      <div className="space-y-4">
        <div className="@stack-xs">
          <h3 id="upload-page-title" className="text-sm font-semibold">
            Publish a page
          </h3>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Drop an HTML file to host it. Any HTML works; `@recipe` shorthand is
            expanded for you.
          </p>
        </div>

        {done ? (
          <div className="@stack-sm" data-testid="upload-done">
            <div className="flex items-center gap-2 text-sm text-term">
              <span aria-hidden="true">●</span> Published
            </div>
            <div className="rounded-md border border-border bg-secondary/50 px-2 py-1.5">
              <CopyValue value={done.url} />
            </div>
            <div className="flex justify-end gap-2">
              <a
                href={done.url}
                target="_blank"
                rel="noreferrer"
                className="@button-secondary-sm"
              >
                Visit →
              </a>
              <button
                type="button"
                onClick={close}
                className="@button-primary-sm"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Drop zone / file picker */}
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              data-testid="upload-dropzone"
              className={
                "flex w-full flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed px-4 py-8 text-center transition-colors " +
                (dragging
                  ? "border-term bg-secondary/60"
                  : "border-border hover:bg-secondary/40")
              }
            >
              <span className="text-lg text-muted-foreground/60" aria-hidden="true">
                ▚
              </span>
              <span className="text-sm font-medium">
                {picked ? picked.name : "Drop an .html file or click to browse"}
              </span>
              {!picked && (
                <span className="text-xs text-muted-foreground">
                  Up to 2 MB
                </span>
              )}
            </button>
            <input
              ref={inputRef}
              type="file"
              accept=".html,.htm,text/html"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void acceptFile(file);
                e.target.value = "";
              }}
            />

            {/* Options */}
            <div className="grid gap-2.5 sm:grid-cols-2">
              <label className="@stack-xs text-xs text-muted-foreground">
                Address (optional)
                <input
                  type="text"
                  value={slug}
                  onChange={(e) => {
                    setSlug(e.target.value);
                    if (error) setError(null);
                  }}
                  placeholder="my-page"
                  aria-label="Page address slug"
                  className="@input"
                />
              </label>
              <label className="@stack-xs text-xs text-muted-foreground">
                Visibility
                <select
                  value={visibility}
                  onChange={(e) => setVisibility(e.target.value as Visibility)}
                  aria-label="Page visibility"
                  className="@input"
                >
                  {VISIBILITIES.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {error && (
              <p
                role="alert"
                className="text-sm break-words text-destructive"
                data-testid="upload-error"
              >
                {error}
              </p>
            )}

            <div className="flex items-center justify-between gap-3">
              <a
                href="https://shortwind.dev/docs/cloud-quickstart"
                target="_blank"
                rel="noreferrer"
                className="text-xs text-muted-foreground underline"
              >
                or use the CLI
              </a>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={close}
                  className="@button-secondary-sm"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={publish}
                  disabled={!picked || busy}
                  data-testid="upload-publish"
                  className="@button-primary-sm disabled:opacity-50"
                >
                  {busy ? "Publishing…" : "Publish"}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
