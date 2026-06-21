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
