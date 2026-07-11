import { useRef, useState } from "react";
import { useDashboardData } from "../lib/data";
import { CopyValue } from "../components/CopyValue";
import { Dialog } from "../components/Dialog";
import type { Visibility } from "../lib/types";

/**
 * Publish from the browser (web/CLI parity). Drop a single `.html` file, several
 * files, or a whole folder. When more than one file is present you choose:
 *
 *   • Linked bundle — one multi-page site under a single address. Needs an
 *     `index.html` (the entry the address routes to); siblings serve at
 *     `<slug>.shortwind.app/<path>` and relative links resolve. (→ publishBundle)
 *   • Separate pages — each `.html` file publishes as its own page, named after
 *     its file. (→ publishPage per file)
 *
 * `@recipe` shorthand is expanded server-side against the account's stored
 * palette in every mode. No CLI, no local recipes needed; plain HTML works too.
 */

const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2 MB per HTML file.
const MAX_TOTAL_BYTES = 50 * 1024 * 1024; // 50 MB per upload (server cap).
const MAX_FILES = 2000;
const VISIBILITIES: Visibility[] = ["public", "unlisted", "private"];
// Mirror the shared `validateSlug` grammar (apps/cloud/shared/src/slug.ts).
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** One collected file: a bundle-relative POSIX path + its HTML text. */
type Item = { path: string; html: string };

/** Normalize a file NAME to the slug grammar (default address for a page). */
function slugFromFilename(name: string): string {
  return name
    .replace(/^.*\//, "") // basename
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

/**
 * Map a publish failure to a friendly line. ConvexError codes ride on `.data`;
 * a plain server Error has none, and we NEVER surface its raw message (the
 * "[CONVEX A(pages:publishFromWeb)] … Server Error" wrapper is noise).
 */
function friendlyError(err: unknown): string {
  const data = (err as { data?: { code?: string; reason?: string; message?: string } })
    ?.data;
  const code = data?.code;
  if (code === "RATE_LIMITED")
    return "You're publishing too fast. Wait a moment and try again.";
  if (code === "CONTENT_BLOCKED")
    return "This content was blocked by the scanner.";
  if (code === "CSAM_BLOCKED")
    return "This content was blocked and cannot be published.";
  if (code === "UNAUTHORIZED" || data?.reason === "no_account")
    return "Your account isn't ready yet. Reload and try again.";
  const raw = data?.message ?? (err as Error)?.message ?? "";
  if (/slug must be lowercase|reserved slug/i.test(raw))
    return "That address is invalid. Use lowercase letters, numbers, and single dashes.";
  return "Couldn't publish. Please try again.";
}

const isHtmlName = (name: string) => /\.html?$/i.test(name);

/** Recursively read every entry under a directory reader (batched API). */
function readAllEntries(
  reader: FileSystemDirectoryReader,
): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    const all: FileSystemEntry[] = [];
    const step = () =>
      reader.readEntries((batch) => {
        if (batch.length === 0) resolve(all);
        else {
          all.push(...batch);
          step();
        }
      }, reject);
    step();
  });
}

async function walkEntry(
  entry: FileSystemEntry,
  prefix: string,
  out: { path: string; file: File }[],
): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((res, rej) =>
      (entry as FileSystemFileEntry).file(res, rej),
    );
    out.push({ path: prefix + entry.name, file });
  } else if (entry.isDirectory) {
    const entries = await readAllEntries(
      (entry as FileSystemDirectoryEntry).createReader(),
    );
    for (const child of entries) await walkEntry(child, prefix + entry.name + "/", out);
  }
}

/**
 * Collect files from a drop. A dropped FOLDER contributes its contents with
 * paths RELATIVE to the folder (so a folder `site/` yields `index.html`, not
 * `site/index.html`); dropped files contribute their bare name.
 */
async function collectDropped(dt: DataTransfer): Promise<{ path: string; file: File }[]> {
  const out: { path: string; file: File }[] = [];
  const items = Array.from(dt.items).filter((i) => i.kind === "file");
  const entries = items
    .map((i) => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null))
    .filter((e): e is FileSystemEntry => e !== null);
  if (entries.length > 0) {
    for (const entry of entries) {
      if (entry.isDirectory) {
        // Descend into the folder so paths are relative to its root.
        const children = await readAllEntries(
          (entry as FileSystemDirectoryEntry).createReader(),
        );
        for (const child of children) await walkEntry(child, "", out);
      } else {
        await walkEntry(entry, "", out);
      }
    }
    return out;
  }
  // Fallback: no entry API — use the flat file list.
  for (const file of Array.from(dt.files)) out.push({ path: file.name, file });
  return out;
}

type Done =
  | { kind: "single"; url: string }
  | { kind: "multi"; results: { name: string; url?: string; error?: string }[] };

export function UploadPageDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { publishPage, publishBundle } = useDashboardData();
  const [items, setItems] = useState<Item[]>([]);
  const [slug, setSlug] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("public");
  const [asBundle, setAsBundle] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const multi = items.length > 1;
  const mode: "single" | "bundle" | "separate" =
    items.length <= 1 ? "single" : asBundle ? "bundle" : "separate";
  const hasIndex = items.some((f) => f.path === "index.html");

  function reset() {
    setItems([]);
    setSlug("");
    setVisibility("public");
    setAsBundle(true);
    setError(null);
    setDone(null);
    setBusy(false);
  }
  function close() {
    reset();
    onClose();
  }

  /** Read + validate a set of {path, file} pairs into HTML items. */
  async function ingest(raw: { path: string; file: File }[]) {
    setError(null);
    const htmlFiles = raw.filter((r) => isHtmlName(r.path));
    const skipped = raw.length - htmlFiles.length;
    if (htmlFiles.length === 0) {
      setError("No .html files found. Only HTML files are published.");
      return;
    }
    if (htmlFiles.length > MAX_FILES) {
      setError(`Too many files (max ${MAX_FILES}).`);
      return;
    }
    let total = 0;
    const collected: Item[] = [];
    for (const { path, file } of htmlFiles) {
      if (file.size > MAX_FILE_BYTES) {
        setError(`"${path}" is over 2 MB.`);
        return;
      }
      total += file.size;
      if (total > MAX_TOTAL_BYTES) {
        setError("That upload is over 50 MB.");
        return;
      }
      const html = await file.text();
      if (html.trim() === "" || !html.includes("<")) {
        setError(`"${path}" doesn't look like HTML.`);
        return;
      }
      collected.push({ path, html });
    }
    setItems(collected);
    // Default the address from the entry (index.html) or the single file.
    const entry =
      collected.find((f) => f.path === "index.html") ?? collected[0]!;
    setSlug((cur) => (cur.trim() ? cur : slugFromFilename(entry.path)));
    if (skipped > 0) {
      setError(
        `${skipped} non-HTML file${skipped > 1 ? "s" : ""} skipped (CSS/JS/images aren't bundled yet).`,
      );
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    void collectDropped(e.dataTransfer).then(ingest);
  }

  async function publish() {
    if (items.length === 0 || busy) return;
    const typed = slug.trim();
    if ((mode === "single" || mode === "bundle") && typed && !SLUG_RE.test(typed)) {
      setError(
        "Address must be lowercase letters, numbers, and single dashes (no spaces or capitals).",
      );
      return;
    }
    if (mode === "bundle" && !hasIndex) {
      setError("A bundle needs an index.html at its root (the entry page).");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (mode === "single") {
        const only = items[0]!;
        const res = await publishPage({
          html: only.html,
          slug: typed || slugFromFilename(only.path) || undefined,
          visibility,
        });
        if (res.ok) setDone({ kind: "single", url: res.url });
        else setError("That address is taken. Pick a different name.");
      } else if (mode === "bundle") {
        const res = await publishBundle({
          files: items,
          entryPath: "index.html",
          slug: typed || undefined,
          visibility,
        });
        if (res.ok) setDone({ kind: "single", url: res.url });
        else setError("That address is taken. Pick a different name.");
      } else {
        // Separate pages: publish each file, collecting per-file results.
        const results: { name: string; url?: string; error?: string }[] = [];
        for (const f of items) {
          try {
            const res = await publishPage({
              html: f.html,
              slug: slugFromFilename(f.path) || undefined,
              visibility,
            });
            results.push(
              res.ok
                ? { name: f.path, url: res.url }
                : { name: f.path, error: "address taken" },
            );
          } catch (err) {
            results.push({ name: f.path, error: friendlyError(err) });
          }
        }
        setDone({ kind: "multi", results });
      }
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  const label =
    items.length === 0
      ? "Drop a file or folder, or click to browse"
      : items.length === 1
        ? items[0]!.path
        : `${items.length} files`;

  return (
    <Dialog open={open} onClose={close} labelledBy="upload-page-title">
      <div className="space-y-4">
        <div className="@stack-xs">
          <h3 id="upload-page-title" className="text-sm font-semibold">
            Publish
          </h3>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Drop an HTML file to host it, or a folder to publish a multi-page
            site. `@recipe` shorthand is expanded for you.
          </p>
        </div>

        {done ? (
          done.kind === "single" ? (
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
                <button type="button" onClick={close} className="@button-primary-sm">
                  Done
                </button>
              </div>
            </div>
          ) : (
            <div className="@stack-sm" data-testid="upload-done">
              <div className="flex items-center gap-2 text-sm text-term">
                <span aria-hidden="true">●</span> Published{" "}
                {done.results.filter((r) => r.url).length} of {done.results.length}
              </div>
              <ul className="max-h-56 space-y-1 overflow-y-auto text-sm">
                {done.results.map((r) => (
                  <li key={r.name} className="flex items-center justify-between gap-3">
                    <span className="truncate text-muted-foreground">{r.name}</span>
                    {r.url ? (
                      <a
                        href={r.url}
                        target="_blank"
                        rel="noreferrer"
                        className="shrink-0 text-term underline"
                      >
                        open →
                      </a>
                    ) : (
                      <span className="shrink-0 text-destructive">{r.error}</span>
                    )}
                  </li>
                ))}
              </ul>
              <div className="flex justify-end">
                <button type="button" onClick={close} className="@button-primary-sm">
                  Done
                </button>
              </div>
            </div>
          )
        ) : (
          <>
            {/* Drop zone / picker */}
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
              <span className="text-sm font-medium">{label}</span>
              {items.length === 0 && (
                <span className="text-xs text-muted-foreground">
                  .html files · up to 2 MB each
                </span>
              )}
            </button>
            <input
              ref={inputRef}
              type="file"
              accept=".html,.htm,text/html"
              multiple
              className="hidden"
              onChange={(e) => {
                const picked = Array.from(e.target.files ?? []).map((file) => ({
                  path: file.name,
                  file,
                }));
                if (picked.length) void ingest(picked);
                e.target.value = "";
              }}
            />

            {/* Multi-file mode choice */}
            {multi && (
              <div className="@stack-xs rounded-md border border-border bg-secondary/30 p-3">
                <label className="flex items-start gap-2.5 text-sm">
                  <input
                    type="checkbox"
                    checked={asBundle}
                    onChange={(e) => {
                      setAsBundle(e.target.checked);
                      if (error) setError(null);
                    }}
                    aria-label="Publish as a linked bundle"
                    data-testid="upload-bundle-toggle"
                    className="mt-0.5"
                  />
                  <span>
                    <span className="font-medium">Publish as one linked site</span>
                    <span className="block text-xs text-muted-foreground">
                      {asBundle
                        ? "Multi-page bundle under one address; index.html is the entry."
                        : "Off: each file publishes as its own separate page."}
                    </span>
                  </span>
                </label>
                {asBundle && !hasIndex && (
                  <p className="text-xs text-warning" data-testid="upload-no-index">
                    No index.html found — a bundle needs one at its root.
                  </p>
                )}
              </div>
            )}

            {/* Options: address (single/bundle only) + visibility */}
            <div className="grid gap-2.5 sm:grid-cols-2">
              {mode !== "separate" && (
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
              )}
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
                href="https://shortwind.dev/docs/cloud-publishing"
                target="_blank"
                rel="noreferrer"
                className="text-xs text-muted-foreground underline"
              >
                or use the CLI
              </a>
              <div className="flex gap-2">
                <button type="button" onClick={close} className="@button-secondary-sm">
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={publish}
                  disabled={items.length === 0 || busy || (mode === "bundle" && !hasIndex)}
                  data-testid="upload-publish"
                  className="@button-primary-sm disabled:opacity-50"
                >
                  {busy
                    ? "Publishing…"
                    : mode === "separate"
                      ? `Publish ${items.length} pages`
                      : "Publish"}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
