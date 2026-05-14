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
  const parsed = JSON.parse(body) as Partial<Lockfile>;
  return {
    version: parsed.version ?? LOCK_VERSION,
    registry: parsed.registry ?? "",
    families: parsed.families ?? {},
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
