import {
  loadRegistryFromDir,
  transformContent,
  type TransformOptions,
} from "@shortwind/tailwind";
import type { Registry } from "@shortwind/core";

export type ShortwindLoaderOptions = {
  recipesDir: string;
  mode?: TransformOptions["mode"];
};

const registryCache = new Map<string, Registry>();

function getRegistry(recipesDir: string): Registry {
  let cached = registryCache.get(recipesDir);
  if (!cached) {
    cached = loadRegistryFromDir(recipesDir);
    registryCache.set(recipesDir, cached);
  }
  return cached;
}

export function clearRegistryCache(): void {
  registryCache.clear();
}

type LoaderContext = {
  getOptions: () => ShortwindLoaderOptions;
  resourcePath: string;
  addDependency?: (file: string) => void;
};

export default function shortwindLoader(this: LoaderContext, source: string): string {
  const options = this.getOptions();
  const registry = getRegistry(options.recipesDir);
  const mode = options.mode ?? (this.resourcePath.endsWith(".html") ? "html" : "jsx");
  return transformContent(source, registry, { mode });
}
