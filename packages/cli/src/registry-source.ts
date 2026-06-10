import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type Presets = Record<string, string[] | "*">;

export type RegistrySource = {
  origin: string;
  loadPresets: () => Promise<Presets>;
  loadFamily: (family: string) => Promise<string>;
  listAllFamilies: () => Promise<string[]>;
};

// Family names are surfaced from network/file inputs and are interpolated
// into filesystem and HTTP paths; restrict to a safe alphabet to refuse
// "../etc", "foo/bar", whitespace, and other traversal/injection attempts.
const FAMILY_RE = /^[a-z0-9][a-z0-9-]{0,63}$/i;

export function assertValidFamilyName(family: string): void {
  if (!FAMILY_RE.test(family)) {
    throw new Error(
      `invalid family name: ${JSON.stringify(family)} (must match ${FAMILY_RE})`,
    );
  }
}

export function createRegistrySource(origin: string): RegistrySource {
  if (origin.startsWith("http://") || origin.startsWith("https://")) {
    return httpSource(origin);
  }
  return fileSource(origin);
}

// Resolve a registry origin to a source. The default (absent, or the bundled
// sentinel) prefers the latest published @shortwind/catalog (fetched from
// jsDelivr's immutable CDN) and falls back to the catalog bundled in the CLI
// when offline. An http(s) URL or filesystem path is a custom/BYO registry.
// This is what every command should call.
export async function resolveSource(origin: string | undefined): Promise<RegistrySource> {
  if (origin && origin !== BUNDLED_ORIGIN) return createRegistrySource(origin);
  return defaultCatalogSource();
}

const CATALOG_PACKAGE = "@shortwind/catalog";
const NPM_TIMEOUT_MS = 3000;

// Prefer the newest published catalog; fall back to the embedded snapshot when
// the network is unavailable. One decision per run (all-CDN or all-bundle) so a
// preset can't reference a family resolved at a different version.
async function defaultCatalogSource(): Promise<RegistrySource> {
  try {
    const version = await resolveCatalogVersion();
    // jsDelivr serves npm package files at immutable, versioned URLs — cached
    // for free, correctly. The catalog tarball nests its output under
    // dist/registry, matching the http source's path layout.
    const base = `https://cdn.jsdelivr.net/npm/${CATALOG_PACKAGE}@${version}/dist/registry`;
    const cdn = httpSource(base);
    await cdn.loadPresets(); // probe — throws if unreachable, triggering fallback
    return cdn;
  } catch {
    return bundledSource();
  }
}

async function resolveCatalogVersion(): Promise<string> {
  const res = await fetch(`https://registry.npmjs.org/${CATALOG_PACKAGE}`, {
    signal: AbortSignal.timeout(NPM_TIMEOUT_MS),
    headers: { accept: "application/vnd.npm.install-v1+json" },
  });
  if (!res.ok) throw new Error(`npm: ${res.status}`);
  const body = (await res.json()) as { "dist-tags"?: Record<string, string> };
  const tags = body["dist-tags"] ?? {};
  const version = tags["latest"] ?? tags["beta"];
  if (!version) throw new Error("no published catalog version");
  return version;
}

// The default catalog, embedded in the CLI (see catalog.generated.ts). Resolves
// presets/families/recipes with zero network, so `init`/`add` always work even
// offline or if a registry host is down — the failure that made an agent
// reimplement Shortwind from scratch in a dogfood run.
export const BUNDLED_ORIGIN = "bundled:@shortwind/catalog";

export function bundledSource(): RegistrySource {
  // Imported lazily so the (large) generated module only loads when the bundled
  // catalog is actually used, not for every CLI invocation.
  let cache: Promise<typeof import("./catalog.generated.js")> | null = null;
  const load = (): Promise<typeof import("./catalog.generated.js")> => {
    cache ??= import("./catalog.generated.js");
    return cache;
  };
  return {
    origin: BUNDLED_ORIGIN,
    async loadPresets() {
      return (await load()).CATALOG_PRESETS;
    },
    async loadFamily(family) {
      assertValidFamilyName(family);
      const { CATALOG_RECIPES } = await load();
      const css = CATALOG_RECIPES[family];
      if (css === undefined) throw new Error(`unknown family: ${family}`);
      return css;
    },
    async listAllFamilies() {
      return [...(await load()).CATALOG_FAMILIES];
    },
  };
}

function fileSource(origin: string): RegistrySource {
  const root = origin.startsWith("file://") ? fileURLToPath(origin) : origin;
  return {
    origin,
    async loadPresets() {
      const body = await readFile(path.join(root, "presets.json"), "utf8");
      return JSON.parse(body) as Presets;
    },
    async loadFamily(family) {
      assertValidFamilyName(family);
      return readFile(path.join(root, "recipes", `${family}.css`), "utf8");
    },
    async listAllFamilies() {
      const { readdir } = await import("node:fs/promises");
      const files = await readdir(path.join(root, "recipes"));
      return files
        .filter((f) => f.endsWith(".css"))
        .map((f) => f.replace(/\.css$/, ""))
        .filter((name) => FAMILY_RE.test(name))
        .sort();
    },
  };
}

function httpSource(origin: string): RegistrySource {
  const base = origin.replace(/\/+$/, "");
  return {
    origin,
    async loadPresets() {
      const res = await fetch(`${base}/presets.json`);
      if (!res.ok) throw new Error(`presets.json: ${res.status} ${res.statusText}`);
      return (await res.json()) as Presets;
    },
    async loadFamily(family) {
      assertValidFamilyName(family);
      const res = await fetch(`${base}/recipes/${family}.css`);
      if (!res.ok) throw new Error(`${family}.css: ${res.status} ${res.statusText}`);
      return res.text();
    },
    async listAllFamilies() {
      const res = await fetch(`${base}/index.json`);
      if (!res.ok) throw new Error(`index.json: ${res.status} ${res.statusText}`);
      const body = (await res.json()) as { families: string[] };
      return body.families.filter((name) => FAMILY_RE.test(name));
    },
  };
}

export function resolvePresetFamilies(
  preset: string,
  presets: Presets,
  allFamilies: string[],
): string[] {
  if (preset === "none") return [];
  const entry = presets[preset];
  if (entry === undefined) {
    throw new Error(
      `Unknown preset '${preset}'. Available: ${Object.keys(presets).join(", ")}`,
    );
  }
  if (entry === "*") return allFamilies;
  return entry;
}
