import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type LockEntry = { version: string; sha: string };
export type Lockfile = {
  version: number;
  registry: string;
  families: Record<string, LockEntry>;
};

export const LOCK_FILENAME = ".shortwind-lock.json";
export const LOCK_VERSION = 1;

export function lockPath(recipesDir: string): string {
  return path.join(recipesDir, LOCK_FILENAME);
}

export async function readLockfile(recipesDir: string): Promise<Lockfile> {
  const p = lockPath(recipesDir);
  if (!existsSync(p)) {
    return { version: LOCK_VERSION, registry: "", families: {} };
  }
  const body = await readFile(p, "utf8");
  const raw = JSON.parse(body) as unknown;
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`${p}: lockfile must be a JSON object`);
  }
  const r = raw as Record<string, unknown>;
  const families: Record<string, LockEntry> = {};
  if (r["families"] !== undefined) {
    if (typeof r["families"] !== "object" || r["families"] === null) {
      throw new Error(`${p}: "families" must be an object`);
    }
    for (const [name, entry] of Object.entries(r["families"] as Record<string, unknown>)) {
      if (typeof entry !== "object" || entry === null) {
        throw new Error(`${p}: families["${name}"] must be an object`);
      }
      const e = entry as Record<string, unknown>;
      if (typeof e["version"] !== "string" || typeof e["sha"] !== "string") {
        throw new Error(
          `${p}: families["${name}"] must have string "version" and "sha"`,
        );
      }
      families[name] = { version: e["version"], sha: e["sha"] };
    }
  }
  return {
    version: typeof r["version"] === "number" ? r["version"] : LOCK_VERSION,
    registry: typeof r["registry"] === "string" ? r["registry"] : "",
    families,
  };
}

export async function writeLockfile(recipesDir: string, lock: Lockfile): Promise<void> {
  const sorted: Lockfile = {
    version: lock.version || LOCK_VERSION,
    registry: lock.registry,
    families: Object.fromEntries(
      Object.entries(lock.families).sort(([a], [b]) => a.localeCompare(b)),
    ),
  };
  await writeFile(lockPath(recipesDir), JSON.stringify(sorted, null, 2) + "\n");
}
