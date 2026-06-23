/**
 * Lockfile diffing for cloud publish (PRD 5.3).
 *
 * Pure plain-data comparison: no IO, no Node built-ins, no classes. The CLI owns
 * the IO (read/write the file on disk); this module owns only the *comparison*,
 * so the worker / convex publish path and the CLI agree on what "the lockfile
 * changed" means.
 *
 * The `Lockfile`/`LockEntry` shape is the CLI's single canonical definition
 * (`packages/cli/src/lockfile.ts`) — imported here, not re-declared, so the home
 * lockfile, the local recipe lockfile, and this diff all reference one type.
 * (The apps/cloud server keeps its own byte-identical copy under
 * `apps/cloud/shared/`; see ./README.md for why these stay vendored.)
 */

import type { Lockfile, LockEntry } from "../../lockfile.js";
// Re-export so existing importers of these names from this module keep resolving.
export type { Lockfile, LockEntry };

// ---------------------------------------------------------------------------
// Diff result — plain serializable data.
// ---------------------------------------------------------------------------

/** A family newly present in `incoming` (absent from `stored`). */
export type AddedFamily = { family: string; version: string; sha: string };

/** A family present in both whose `{ version, sha }` identity differs. */
export type ChangedFamily = {
  family: string;
  from: LockEntry;
  to: LockEntry;
};

/** A family present in `stored` but dropped from `incoming`. */
export type RemovedFamily = { family: string; version: string; sha: string };

export type LockfileDiff = {
  added: AddedFamily[];
  changed: ChangedFamily[];
  removed: RemovedFamily[];
};

function families(lock: Lockfile | null | undefined): Record<string, LockEntry> {
  return lock?.families ?? {};
}

function sameEntry(a: LockEntry, b: LockEntry): boolean {
  // Both the resolved version and the body sha are part of a family's identity:
  // a version bump with the same body, or a body change at the same version,
  // are both "the locked family moved" and must surface on publish.
  return a.version === b.version && a.sha === b.sha;
}

/**
 * Diff an incoming lockfile against the stored one, keyed by recipe family.
 *
 * Each list is sorted by family name so the output is deterministic (stable
 * audit events, stable snapshot tests).
 */
export function diffLockfiles(
  incoming: Lockfile | null | undefined,
  stored: Lockfile | null | undefined,
): LockfileDiff {
  const inc = families(incoming);
  const old = families(stored);

  const added: AddedFamily[] = [];
  const changed: ChangedFamily[] = [];
  const removed: RemovedFamily[] = [];

  for (const family of Object.keys(inc).sort()) {
    const to = inc[family]!;
    const from = old[family];
    if (from === undefined) {
      added.push({ family, version: to.version, sha: to.sha });
    } else if (!sameEntry(from, to)) {
      changed.push({ family, from, to });
    }
  }

  for (const family of Object.keys(old).sort()) {
    if (inc[family] === undefined) {
      const entry = old[family]!;
      removed.push({ family, version: entry.version, sha: entry.sha });
    }
  }

  return { added, changed, removed };
}
