/**
 * Lockfile diffing for cloud publish (PRD 5.3).
 *
 * A pure plain-data port of the `.shortwind-lock.json` shape from
 * `packages/cli/src/lockfile.ts`. The CLI owns the IO (read/write the file on
 * disk); this module owns only the *comparison*, so the worker / convex publish
 * path and the CLI agree on what "the lockfile changed" means without sharing a
 * Node-flavoured module across the workspace boundary.
 *
 * No IO, no Node built-ins, no classes — plain data in, plain data out.
 */

// ---------------------------------------------------------------------------
// Shape — kept byte-for-byte compatible with packages/cli/src/lockfile.ts so a
// CLI-written lockfile diffs without any translation.
// ---------------------------------------------------------------------------

/** One locked recipe family: the resolved version and its body content sha. */
export type LockEntry = { version: string; sha: string };

/** The `.shortwind-lock.json` document. */
export type Lockfile = {
  version: number;
  registry: string;
  families: Record<string, LockEntry>;
};

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
