import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import {
  buildRegistry,
  expand,
  parseRecipeFile,
  type ExpandMode,
  type Recipe,
  type Registry,
} from "@shortwind/core";

export type TransformOptions = {
  mode?: ExpandMode;
  mergeConflicts?: boolean;
};

export type TailwindMajor = 3 | 4;

export class TailwindAdapterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TailwindAdapterError";
  }
}

export function transformContent(
  content: string,
  registry: Registry,
  options: TransformOptions = {},
): string {
  return expand(content, registry, {
    mode: options.mode ?? "jsx",
    mergeConflicts: options.mergeConflicts ?? true,
  });
}

export function loadRegistryFromDir(recipesDir: string): Registry {
  if (!existsSync(recipesDir)) return { families: {}, flattened: {} };
  const files = readdirSync(recipesDir)
    .filter((f) => f.endsWith(".css"))
    .sort();
  const recipes: Recipe[] = [];
  for (const file of files) {
    const source = readFileSync(path.join(recipesDir, file), "utf8");
    const parsed = parseRecipeFile(source, file);
    if (!parsed.ok) {
      throw new TailwindAdapterError(
        `Failed to parse ${file}: ${parsed.errors.map((e) => e.message).join("; ")}`,
      );
    }
    recipes.push(...parsed.value.recipes);
  }
  const result = buildRegistry(recipes);
  if (!result.ok) {
    throw new TailwindAdapterError(
      `Failed to resolve recipes: ${result.errors.map((e) => e.message).join("; ")}`,
    );
  }
  return result.value;
}

export function detectTailwindMajor(cwd: string): TailwindMajor | null {
  const pkgPath = path.join(cwd, "package.json");
  if (!existsSync(pkgPath)) return null;
  let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try {
    pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  } catch {
    return null;
  }
  const range =
    pkg.dependencies?.["tailwindcss"] ?? pkg.devDependencies?.["tailwindcss"] ?? null;
  if (!range) return null;
  // tailwindcss is declared but pinned with a non-semver range we can't read
  // a major out of (e.g. "latest", "workspace:*", or "npm:tw-fork@*"). Silently
  // returning null would surface the misleading "tailwindcss not found" error;
  // throw so the user fixes the range explicitly.
  const m = range.match(/(\d+)/);
  if (!m) {
    throw new TailwindAdapterError(
      `tailwindcss is declared as "${range}" — pin a numeric major (^3 or ^4) so Shortwind can pick the right adapter.`,
    );
  }
  const major = Number(m[1]);
  if (major === 3) return 3;
  if (major === 4) return 4;
  throw new TailwindAdapterError(
    `tailwindcss major ${major} is not supported. Shortwind supports Tailwind v3 and v4.`,
  );
}

export type ShortwindPluginOptions = {
  recipesDir?: string;
  cwd?: string;
};

export type ShortwindV3Plugin = {
  major: 3;
  content: { transform: Record<string, (content: string) => string> };
  transform: (content: string) => string;
};

// Tailwind v4 collects utilities by parsing source files directly; it does not
// invoke a JS plugin handler the way v3 did. Shortwind expands `@recipe` tokens
// upstream of Tailwind's scan via the Vite/Next adapters (which call
// `transform` on each source file). The `handler` field is kept as a no-op so
// the returned object satisfies the v4 Plugin shape without claiming behavior
// it doesn't deliver — users should not depend on it doing anything.
export type ShortwindV4Plugin = {
  major: 4;
  handler: () => void;
  transform: (content: string) => string;
};

export function shortwindPlugin(
  options: ShortwindPluginOptions = {},
): ShortwindV3Plugin | ShortwindV4Plugin {
  const cwd = options.cwd ?? process.cwd();
  const recipesDir = options.recipesDir ?? path.join(cwd, "recipes");
  const major = detectTailwindMajor(cwd);
  if (major === null) {
    throw new TailwindAdapterError(
      "tailwindcss not found in package.json. Install with `npm install -D tailwindcss` (v3 or v4).",
    );
  }
  const registry = loadRegistryFromDir(recipesDir);
  const transform = (content: string): string => transformContent(content, registry);

  if (major === 3) {
    const exts = ["html", "js", "jsx", "ts", "tsx", "vue", "svelte", "astro", "md", "mdx"];
    const transforms: Record<string, (c: string) => string> = {};
    for (const ext of exts) transforms[ext] = transform;
    return { major: 3, content: { transform: transforms }, transform };
  }
  return { major: 4, handler: () => {}, transform };
}

export function shortwindV3Content(
  files: string[],
  options: ShortwindPluginOptions = {},
): { files: string[]; transform: Record<string, (c: string) => string> } {
  const plugin = shortwindPlugin(options);
  if (plugin.major !== 3) {
    throw new TailwindAdapterError(
      "shortwindV3Content is only valid in a Tailwind v3 project. Use the v4 plugin form instead.",
    );
  }
  return { files, transform: plugin.content.transform };
}
