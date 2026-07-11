import { useRef, useState } from "react";
import { useDashboardData } from "../lib/data";
import { CopyValue } from "../components/CopyValue";
import { Dialog } from "../components/Dialog";
import { Segmented } from "../components/Segmented";
import { Select } from "../components/Select";
import { Switch } from "../components/Switch";
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
const VISIBILITY_OPTIONS: { value: Visibility; label: string }[] = [
  { value: "public", label: "Public" },
  { value: "unlisted", label: "Unlisted" },
  { value: "private", label: "Private" },
];

/** One collected file: a bundle-relative POSIX path + its HTML text. */
type Item = { path: string; html: string };

/**
 * Coerce any user text into a valid slug (the shared `validateSlug` grammar):
 * lowercase, non-alphanumerics → single dashes, no leading/trailing dashes.
 * "Aceme Dashboard" → "aceme-dashboard". We normalize rather than reject so the
 * address field never blocks the user on a fixable typo.
 */
function normalizeSlug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

/** Default address for a file: its NAME (sans dir + extension), normalized. */
function slugFromFilename(name: string): string {
  return normalizeSlug(name.replace(/^.*\//, "").replace(/\.[^.]+$/, ""));
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
  // Whether to publish the files as ONE linked bundle. The choice is always
  // offered for multiple files, but the DEFAULT keys on whether an index.html is
  // present (its natural entry) — NOT on folder-vs-multiselect. Five unrelated
  // files shouldn't default to a bundle; a set that includes index.html should.
  const [asBundle, setAsBundle] = useState(false);
  // The bundle's entry (root) page — the file the address opens. Defaults to
  // index.html when present, else the first file; the user can change it.
  const [entryPath, setEntryPath] = useState("");
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const multi = items.length > 1;
  const mode: "single" | "bundle" | "separate" =
    items.length <= 1 ? "single" : asBundle ? "bundle" : "separate";

  function reset() {
    setItems([]);
    setSlug("");
    setVisibility("public");
    setAsBundle(false);
    setEntryPath("");
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
    // Default to a bundle only when an index.html is present (its entry). Multi
    // without an index → default to separate pages; the user can still opt in
    // and pick any file as the entry.
    const indexFile = collected.find((f) => f.path === "index.html");
    const entry = indexFile ?? collected[0]!;
    setAsBundle(indexFile !== undefined && collected.length > 1);
    setEntryPath(entry.path);
    // Default the address from the entry file's name.
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
    // Normalize whatever the user typed into a valid slug rather than rejecting
    // it ("Aceme Dashboard" → "aceme-dashboard").
    const typed = normalizeSlug(slug);
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
          entryPath: entryPath || items[0]!.path,
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
    <Dialog open={open} onClose={close} labelledBy="upload-page-title" size="lg">
      <div className="@stack-lg">
        <div className="@stack-xs">
          <h2 id="upload-page-title" className="text-lg font-semibold tracking-tight">
            Publish
          </h2>
          <p className="max-w-md font-sans text-sm leading-relaxed text-muted-foreground">
            Drop an HTML file to host it, or a folder to publish a multi-page
            site. Your <code className="@code-inline">@recipe</code> shorthand is
            expanded for you.
          </p>
        </div>

        {done ? (
          done.kind === "single" ? (
            <div className="@stack-sm" data-testid="upload-done">
              <div className="flex items-center gap-2 text-sm font-medium text-term">
                <span
                  className="inline-block h-2 w-2 rounded-full bg-term"
                  aria-hidden="true"
                />
                Published
              </div>
              <div className="rounded-lg border border-border bg-secondary/40 px-3 py-2">
                <CopyValue value={done.url} />
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <a
                  href={done.url}
                  target="_blank"
                  rel="noreferrer"
                  className="@button-secondary"
                >
                  Visit →
                </a>
                <button type="button" onClick={close} className="@button-primary">
                  Done
                </button>
              </div>
            </div>
          ) : (
            <div className="@stack-sm" data-testid="upload-done">
              <div className="flex items-center gap-2 text-sm font-medium text-term">
                <span
                  className="inline-block h-2 w-2 rounded-full bg-term"
                  aria-hidden="true"
                />
                Published {done.results.filter((r) => r.url).length} of{" "}
                {done.results.length}
              </div>
              <ul className="max-h-64 divide-y divide-border overflow-y-auto rounded-lg border border-border">
                {done.results.map((r) => (
                  <li
                    key={r.name}
                    className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                  >
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
              <div className="flex justify-end pt-1">
                <button type="button" onClick={close} className="@button-primary">
                  Done
                </button>
              </div>
            </div>
          )
        ) : (
          <div className="@stack-md">
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
                "group flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-6 py-12 text-center transition-colors " +
                (dragging
                  ? "border-term bg-term/5"
                  : items.length > 0
                    ? "border-term/40 bg-secondary/30"
                    : "border-border hover:border-muted-foreground/50 hover:bg-secondary/30")
              }
            >
              <span
                className={
                  "text-2xl transition-colors " +
                  (items.length > 0
                    ? "text-term"
                    : "text-muted-foreground/50 group-hover:text-muted-foreground")
                }
                aria-hidden="true"
              >
                {items.length > 0 ? "◳" : "▚"}
              </span>
              <span className="text-sm font-medium">{label}</span>
              <span className="text-xs text-muted-foreground">
                {items.length === 0
                  ? ".html files · up to 2 MB each"
                  : "Click to choose different files"}
              </span>
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
              <div className="@stack-sm rounded-xl border border-border bg-secondary/20 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="@stack-xs">
                    <span className="text-sm font-medium">
                      Publish as one linked site
                    </span>
                    <span className="font-sans text-xs leading-relaxed text-muted-foreground">
                      {asBundle
                        ? "Multi-page bundle under one address; pick the entry page below."
                        : "Off: each file publishes as its own separate page."}
                    </span>
                  </div>
                  <Switch
                    checked={asBundle}
                    onChange={(next) => {
                      setAsBundle(next);
                      if (error) setError(null);
                    }}
                    label="Publish as one linked site"
                    testId="upload-bundle-toggle"
                  />
                </div>
                {asBundle && (
                  <div className="@stack-xs border-t border-border pt-3">
                    <span className="text-xs text-muted-foreground">
                      Entry page (opens at the address)
                    </span>
                    <Select
                      value={entryPath}
                      options={items.map((f) => f.path)}
                      onChange={setEntryPath}
                      label="Bundle entry page"
                      testId="upload-entry"
                    />
                  </div>
                )}
              </div>
            )}

            {/* Options: address (single/bundle only) + visibility */}
            <div className="@stack-md">
              {mode !== "separate" && (
                <div className="@stack-xs">
                  <span className="text-xs text-muted-foreground">
                    Address (optional)
                  </span>
                  <div className="flex h-9 items-center rounded-md border border-input bg-transparent pr-3 transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 dark:bg-input/30">
                    <input
                      type="text"
                      value={slug}
                      onChange={(e) => {
                        setSlug(e.target.value);
                        if (error) setError(null);
                      }}
                      onBlur={(e) => {
                        const n = normalizeSlug(e.target.value);
                        if (n !== e.target.value) setSlug(n);
                      }}
                      placeholder="my-page"
                      aria-label="Page address slug"
                      className="min-w-0 flex-1 bg-transparent px-3 py-1 text-sm outline-none placeholder:text-muted-foreground"
                    />
                    <span className="shrink-0 text-xs text-muted-foreground">
                      .shortwind.app
                    </span>
                  </div>
                </div>
              )}
              <div className="@stack-xs">
                <span className="text-xs text-muted-foreground">Visibility</span>
                <Segmented
                  options={VISIBILITY_OPTIONS}
                  value={visibility}
                  onChange={setVisibility}
                  label="Page visibility"
                />
              </div>
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

            <div className="flex items-center justify-between gap-3 border-t border-border pt-4">
              <a
                href="https://shortwind.dev/docs/cloud-publishing"
                target="_blank"
                rel="noreferrer"
                className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
              >
                or use the CLI
              </a>
              <div className="flex gap-2">
                <button type="button" onClick={close} className="@button-secondary">
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={publish}
                  disabled={items.length === 0 || busy}
                  data-testid="upload-publish"
                  className="@button-primary disabled:opacity-50"
                >
                  {busy
                    ? "Publishing…"
                    : mode === "separate"
                      ? `Publish ${items.length} pages`
                      : "Publish"}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}
