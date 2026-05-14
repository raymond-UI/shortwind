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
