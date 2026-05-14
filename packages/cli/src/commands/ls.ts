import path from "node:path";
import { createRegistrySource } from "../registry-source.js";
import { readConfig, installedFamilies } from "../project.js";
import { readLockfile } from "../lockfile.js";

export type LsOptions = {
  cwd: string;
  registry?: string;
  installedOnly?: boolean;
  availableOnly?: boolean;
};

export type LsResult = {
  installed: { family: string; version: string | null }[];
  available: string[];
};

export async function ls(options: LsOptions): Promise<LsResult> {
  const cwd = path.resolve(options.cwd);
  const config = await readConfig(cwd);
  const recipesDir = path.join(cwd, config.recipesDir);
  const lock = await readLockfile(recipesDir);

  const installed = options.availableOnly
    ? []
    : installedFamilies(recipesDir).map((family) => {
        const entry = lock.families[family];
        return { family, version: entry?.version ?? null };
      });

  let available: string[] = [];
  if (!options.installedOnly) {
    const registry = options.registry ?? config.registry;
    const source = createRegistrySource(registry);
    try {
      available = await source.listAllFamilies();
    } catch {
      available = [];
    }
  }

  return { installed, available };
}

export function formatLsText(result: LsResult): string {
  const installedSet = new Set(result.installed.map((i) => i.family));
  const lines: string[] = [];
  lines.push("Installed:");
  if (result.installed.length === 0) lines.push("  (none)");
  for (const { family, version } of result.installed) {
    lines.push(`  ${family}${version ? `  ${version}` : ""}`);
  }
  lines.push("");
  lines.push("Available:");
  if (result.available.length === 0) lines.push("  (registry unreachable)");
  for (const family of result.available) {
    const marker = installedSet.has(family) ? "*" : " ";
    lines.push(`  ${marker} ${family}`);
  }
  return lines.join("\n");
}
