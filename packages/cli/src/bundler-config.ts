import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { Bundler } from "./detect.js";

// init installs the bundler adapter and copies recipes, but the plugin still
// has to be added to the bundler config. Agents (and humans) shouldn't have to
// reverse-engineer that — wire Vite automatically, and for Next/Astro hand back
// the exact snippet to paste.

export type BundlerWireAction = "patched" | "manual" | "skipped";
export type BundlerWireResult = {
  configPath: string | null;
  action: BundlerWireAction;
  snippet?: string;
  reason?: string;
};

const VITE_CONFIGS = [
  "vite.config.ts",
  "vite.config.mts",
  "vite.config.cts",
  "vite.config.js",
  "vite.config.mjs",
  "vite.config.cjs",
];

const VITE_SNIPPET = [
  `import { shortwind } from "@shortwind/vite";`,
  `// add shortwind() to the Vite plugins array — it runs in the pre phase,`,
  `// before Tailwind's scan:`,
  `//   plugins: [shortwind(), tailwindcss(), react()]`,
].join("\n");

export async function wireBundler(cwd: string, bundler: Bundler): Promise<BundlerWireResult> {
  if (bundler === "vite") return wireVite(cwd);
  if (bundler === "next") {
    return {
      configPath: null,
      action: "manual",
      snippet: `import { withShortwind } from "@shortwind/next";\n// withShortwind is curried — wrap your Next config:\n//   export default withShortwind()(nextConfig);`,
      reason: "Next config wiring is manual",
    };
  }
  if (bundler === "astro") {
    return {
      configPath: null,
      action: "manual",
      snippet: `import shortwind from "@shortwind/astro";\n// add to integrations: integrations: [shortwind()]`,
      reason: "Astro config wiring is manual",
    };
  }
  return { configPath: null, action: "skipped", reason: "no supported bundler detected" };
}

async function wireVite(cwd: string): Promise<BundlerWireResult> {
  const configPath = VITE_CONFIGS.map((f) => path.join(cwd, f)).find((p) => existsSync(p));
  if (!configPath) {
    return { configPath: null, action: "manual", snippet: VITE_SNIPPET, reason: "no vite config found" };
  }

  const source = await readFile(configPath, "utf8");
  if (/@shortwind\/vite/.test(source)) {
    return { configPath, action: "skipped", reason: "plugin already wired" };
  }

  // Inject `shortwind()` at the head of the plugins array so it's visibly
  // first; the plugin's own `enforce: "pre"` guarantees it runs ahead of
  // Tailwind regardless of position.
  const pluginsMatch = source.match(/plugins\s*:\s*\[/);
  if (!pluginsMatch) {
    // Unusual config shape — don't risk corrupting it; hand back the snippet.
    return { configPath, action: "manual", snippet: VITE_SNIPPET, reason: "no plugins array found" };
  }

  const withImport = addImport(source, `import { shortwind } from "@shortwind/vite";`);
  const at = withImport.indexOf(pluginsMatch[0]) + pluginsMatch[0].length;
  const patched = withImport.slice(0, at) + "shortwind(), " + withImport.slice(at);
  await writeFile(configPath, patched);
  return { configPath, action: "patched" };
}

// Insert an import after the last existing top-level import, or at the top.
function addImport(source: string, line: string): string {
  const importRe = /^[ \t]*import[\s\S]*?from\s+["'][^"']+["'];?[ \t]*$/gm;
  let lastEnd = -1;
  for (const m of source.matchAll(importRe)) {
    lastEnd = (m.index ?? 0) + m[0].length;
  }
  if (lastEnd === -1) return `${line}\n${source}`;
  return source.slice(0, lastEnd) + `\n${line}` + source.slice(lastEnd);
}
