import type { Registry } from "@shortwind/core";
import { expandClassList, expandDOM } from "./expand-lite.js";
import { DEFAULT_REGISTRY } from "./registry.generated.js";

export { DEFAULT_REGISTRY, expandClassList, expandDOM };
export type { Registry };

declare global {
  interface Window {
    shortwind?: ShortwindGlobal;
  }
}

export type ShortwindGlobal = {
  registry: Registry;
  expandClassList: typeof expandClassList;
  expandDOM: typeof expandDOM;
  run: (root?: Element) => void;
};

export function createGlobal(registry: Registry = DEFAULT_REGISTRY): ShortwindGlobal {
  return {
    registry,
    expandClassList,
    expandDOM,
    run(root?: Element): void {
      if (typeof document === "undefined") return;
      const target = root ?? document.documentElement;
      expandDOM(target, registry);
    },
  };
}

export function install(target?: Window): ShortwindGlobal {
  const win = target ?? (typeof window !== "undefined" ? window : undefined);
  const api = createGlobal();
  if (win) win.shortwind = api;
  return api;
}

export function autostart(): void {
  if (typeof document === "undefined") return;
  const api = install();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => api.run(), { once: true });
  } else {
    api.run();
  }
}

// Autostart is intentionally not invoked on import. Consumers who want the
// IIFE bundle to run on page load should import from `@shortwind/runtime/auto`,
// which calls `autostart()` for them. Importing only `expandClassList` from
// the main entry stays side-effect-free.
