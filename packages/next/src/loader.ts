import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import {
  findResidualRecipeTokens,
  findUnexpandedRecipes,
  loadRegistryFromDir,
  modeForFile,
  residualRecipeMessage,
  syncSourceDirectiveToFile,
  transformContent,
  type TransformOptions,
} from "@shortwind/tailwind";
import type { Registry } from "@shortwind/core";

export type ShortwindLoaderOptions = {
  recipesDir: string;
  mode?: TransformOptions["mode"];
  // Fail the module (and so the build) when a known recipe token survives in
  // transformed output anywhere — including the silent variable-indirection
  // case (#67). Off by default; see @shortwind/vite's option of the same name.
  strict?: boolean;
  // Tailwind entry stylesheets discovered by withShortwind at config-eval
  // time. When the registry is rebuilt (a recipe changed mid-session), the
  // on-disk `@source inline(...)` safelist in these files is refreshed so
  // Tailwind regenerates with the new candidate set (#73).
  entryCss?: readonly string[];
};

type CacheEntry = {
  registry: Registry;
  files: string[];
  signature: string;
};

const registryCache = new Map<string, CacheEntry>();

function recipesSignature(recipesDir: string): { signature: string; files: string[] } {
  if (!existsSync(recipesDir)) return { signature: "", files: [] };
  const files = readdirSync(recipesDir)
    .filter((f) => f.endsWith(".css"))
    .sort()
    .map((f) => path.join(recipesDir, f));
  const parts: string[] = [];
  for (const full of files) {
    const st = statSync(full);
    parts.push(`${full}:${st.size}:${st.mtimeMs}`);
  }
  return { signature: parts.join("|"), files };
}

function getRegistry(recipesDir: string, entryCss: readonly string[] = []): CacheEntry {
  const { signature, files } = recipesSignature(recipesDir);
  const cached = registryCache.get(recipesDir);
  if (cached && cached.signature === signature) return cached;
  const entry: CacheEntry = {
    registry: loadRegistryFromDir(recipesDir),
    files,
    signature,
  };
  registryCache.set(recipesDir, entry);
  // Recipes changed since withShortwind's config-eval sync — refresh the
  // on-disk safelist so a recipe authored mid-`next dev` renders styled (#73).
  // The write is content-guarded (no-op when nothing changed) and best-effort:
  // a read-only filesystem must not fail the module.
  for (const cssPath of entryCss) {
    try {
      syncSourceDirectiveToFile(cssPath, entry.registry);
    } catch {
      // covered again at the next config evaluation
    }
  }
  return entry;
}

export function clearRegistryCache(): void {
  registryCache.clear();
}

type LoaderContext = {
  getOptions: () => ShortwindLoaderOptions;
  resourcePath: string;
  addDependency?: (file: string) => void;
  addContextDependency?: (dir: string) => void;
  emitError?: (err: Error) => void;
  emitWarning?: (err: Error) => void;
};

export default function shortwindLoader(this: LoaderContext, source: string): string {
  // Never transform or strict-scan vendored code (#75). The webpack rule
  // excludes node_modules, but Turbopack rule keys are include-globs with no
  // negation syntax — and Next 16's Turbopack applies custom loader rules to
  // node_modules, so without this guard strict mode fails the build on files
  // the user doesn't own (a JSDoc `{@link …}` in next's own dist collided
  // with the catalog's @link recipe). Guarding here makes the scan scope
  // bundler-independent, matching @shortwind/vite's transform.
  if (this.resourcePath.split(path.sep).join("/").includes("/node_modules/")) {
    return source;
  }
  const options = this.getOptions();
  if (this.addContextDependency) this.addContextDependency(options.recipesDir);

  let entry: CacheEntry;
  try {
    entry = getRegistry(options.recipesDir, options.entryCss ?? []);
  } catch (err) {
    const wrapped =
      err instanceof Error ? err : new Error(`shortwind: failed to load registry: ${String(err)}`);
    if (this.emitError) this.emitError(wrapped);
    return source;
  }

  if (this.addDependency) {
    for (const file of entry.files) this.addDependency(file);
  }
  const mode = options.mode ?? modeForFile(this.resourcePath);
  const out = transformContent(source, entry.registry, { mode });

  // Leak reporting (#67), consistent with @shortwind/vite: strict mode scans
  // the whole output (the class-value scan can't see a recipe assigned to a
  // variable/prop) and errors the module so `next build` fails instead of
  // shipping unstyled UI; the default surfaces a webpack warning for the
  // class-value cases it can attribute.
  if (options.strict) {
    const residual = findResidualRecipeTokens(out, entry.registry);
    if (residual.length > 0 && this.emitError) {
      this.emitError(
        new Error(
          `${residualRecipeMessage(this.resourcePath, residual)} (strict mode: failing the build — pass strict: false to demote this to a warning)`,
        ),
      );
    }
  } else {
    const leftover = findUnexpandedRecipes(out, entry.registry);
    if (leftover.length > 0 && this.emitWarning) {
      this.emitWarning(new Error(residualRecipeMessage(this.resourcePath, leftover)));
    }
  }
  return out;
}
