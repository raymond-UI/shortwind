// Load the recipe registry from the consumer's project — the real version of
// the spike's hardcoded catalog. Walks up from a source file to the nearest
// `shortwind.config.json`, reads `recipesDir`, and resolves via the same
// `loadRegistryFromDir` the build adapters use. Cached per recipes dir and
// invalidated by an mtime/size signature, so editing a recipe updates
// completions/hover live (the trick the Next/Vite loaders use).

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Registry } from "@shortwind/core";
import { loadRegistryFromDir } from "@shortwind/tailwind";

const EMPTY: Registry = { flattened: {}, families: {} };

function findConfigDir(start: string): string | null {
  let dir = start;
  for (let i = 0; i < 16; i++) {
    if (existsSync(join(dir, "shortwind.config.json"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

function recipesDirFor(configDir: string): string {
  try {
    const cfg = JSON.parse(readFileSync(join(configDir, "shortwind.config.json"), "utf8")) as {
      recipesDir?: unknown;
    };
    if (typeof cfg.recipesDir === "string") return join(configDir, cfg.recipesDir);
  } catch {
    /* malformed config — fall back to the default location */
  }
  return join(configDir, "recipes");
}

function signature(recipesDir: string): string {
  if (!existsSync(recipesDir)) return "";
  const parts: string[] = [];
  for (const f of readdirSync(recipesDir).filter((n) => n.endsWith(".css")).sort()) {
    const s = statSync(join(recipesDir, f));
    parts.push(`${f}:${s.size}:${s.mtimeMs}`);
  }
  return parts.join("|");
}

type Entry = { sig: string; recipesDir: string; registry: Registry };
const cache = new Map<string, Entry>(); // keyed by recipesDir

// Resolve the registry for the project containing `fromDir`. Returns EMPTY when
// the project has no shortwind.config.json or the recipes fail to resolve —
// the plugin degrades silently rather than erroring the editor.
export function loadProjectRegistry(fromDir: string): { registry: Registry; recipesDir: string | null } {
  const configDir = findConfigDir(fromDir);
  if (!configDir) return { registry: EMPTY, recipesDir: null };
  const recipesDir = recipesDirFor(configDir);
  const sig = signature(recipesDir);
  const hit = cache.get(recipesDir);
  if (hit && hit.sig === sig) return { registry: hit.registry, recipesDir };
  let registry: Registry = EMPTY;
  try {
    registry = loadRegistryFromDir(recipesDir);
  } catch {
    registry = EMPTY;
  }
  cache.set(recipesDir, { sig, recipesDir, registry });
  return { registry, recipesDir };
}

// Locate the `@recipe <name>` block in the recipes dir, for go-to-definition.
export function findRecipeDefinition(
  recipesDir: string,
  name: string,
): { fileName: string; start: number; length: number } | null {
  if (!existsSync(recipesDir)) return null;
  const re = new RegExp(`@recipe\\s+(${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})\\b`);
  for (const f of readdirSync(recipesDir).filter((n) => n.endsWith(".css")).sort()) {
    const fileName = join(recipesDir, f);
    const text = readFileSync(fileName, "utf8");
    const m = re.exec(text);
    if (m) return { fileName, start: m.index + m[0].length - m[1]!.length, length: m[1]!.length };
  }
  return null;
}
