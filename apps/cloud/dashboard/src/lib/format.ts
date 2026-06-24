/**
 * Tiny display helpers (CLOUD-35). Pure functions — unit-friendly and reused by
 * the views. No locale assumptions beyond the host environment.
 */

/** Epoch-ms → a short, stable UTC timestamp for the audit/feed rows. */
export function formatTime(ms: number): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toISOString().replace("T", " ").replace(/\.\d+Z$/, "Z");
}

/** First 8 chars of a hex hash — enough to eyeball, not enough to drown a row. */
export function shortHash(hash: string): string {
  return hash.length > 8 ? hash.slice(0, 8) : hash;
}

/**
 * Epoch-ms → a compact relative phrase ("just now", "3h ago", "2d ago"), for
 * card meta where an absolute timestamp is too heavy. `now` is injectable for
 * deterministic tests. Falls back to a date for anything older than ~30 days.
 */
export function relativeTime(ms: number, now: number = Date.now()): string {
  const diff = now - ms;
  if (!Number.isFinite(diff)) return "—";
  if (diff < 0) return "just now";
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Bytes → a short human size for the storage meter (CLOUD-43). Binary units
 * (1024-step) since storage is measured in bytes; one decimal past KiB. `0 B`
 * for an empty/never-published account. Deterministic — golden-testable.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  const rounded = unit === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unit]}`;
}

/**
 * The canonical recipe-edit phrasing the human reads (PRD §5.4):
 *   "@card 0.4.0 → 0.5.0, affects 12 pages on next publish"
 * For a family's first version (`fromVersion === null`) we say "created".
 */
export function describeRecipeEdit(edit: {
  family: string;
  fromVersion: string | null;
  toVersion: string;
  affectedPages: number;
}): string {
  const at = `@${edit.family}`;
  const transition =
    edit.fromVersion === null
      ? `created ${edit.toVersion}`
      : `${edit.fromVersion} → ${edit.toVersion}`;
  const n = edit.affectedPages;
  const pages = `${n} ${n === 1 ? "page" : "pages"}`;
  return `${at} ${transition}, affects ${pages} on next publish`;
}
