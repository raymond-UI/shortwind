import { type StubResult } from "./stub.js";
import { formatTable } from "./find.js";
import type { ApiClient, GetResult } from "../api-client.js";

/**
 * `get <id>` — GET /v1/pages/{id}: metadata + version list so the agent can
 * confirm before acting (PRD §4).
 *
 * {@link get} is the retained CLOUD-04 parse stub (cli.test.ts). The REAL
 * behavior is {@link renderGet} / {@link runGet}, unit-tested against a MOCKED
 * api-client (CLOUD-25); CLOUD-30 wires `runGet` into cli.ts.
 */
export interface GetOptions {
  json?: boolean;
}

export function get(id: string, opts: GetOptions): StubResult {
  return {
    verb: "get",
    implementedBy: "CLOUD-25",
    parsed: {
      id,
      json: Boolean(opts.json),
    },
  };
}

/**
 * Render a page's metadata + version history. With `--json` the raw
 * `{ page, versions }` envelope is emitted verbatim (stable machine contract).
 */
export function renderGet(result: GetResult, json: boolean): string {
  if (json) return JSON.stringify(result, null, 2);
  const { page, versions } = result;
  const meta = [
    `id:         ${page.id}`,
    `slug:       ${page.slug}`,
    `url:        ${page.url}`,
    `visibility: ${page.visibility}`,
    `domain:     ${page.customDomain ?? "(none)"}`,
    `version:    v${page.currentVersion}`,
    `tags:       ${page.tags.length > 0 ? page.tags.join(", ") : "(none)"}`,
  ].join("\n");
  if (versions.length === 0) return `${meta}\n\nno versions`;
  const header = ["VERSION", "ARTIFACT", "EXPANDED", "SOURCE"];
  const rows = versions.map((v) => [
    `v${v.version}`,
    v.artifactKey,
    v.expandedHash,
    v.sourceHash,
  ]);
  return `${meta}\n\n${formatTable([header, ...rows])}`;
}

/**
 * Run `get` against an injected api-client and return the rendered output.
 */
export async function runGet(
  client: ApiClient,
  id: string,
  opts: GetOptions,
): Promise<string> {
  const result = await client.getPage(id);
  return renderGet(result, Boolean(opts.json));
}
