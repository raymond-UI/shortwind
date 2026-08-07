import { toArray, type StubResult } from "./stub.js";
import type { ApiClient, FindQuery, PageSummary } from "../api-client.js";

/**
 * `find` — GET /v1/pages?q=&tag= : the load-bearing verb that lets a stateless
 * agent locate an existing page before acting, preventing duplicate publishes
 * (PRD §4). `--tag` is repeatable and each one NARROWS: a page must carry every
 * tag passed (the server ANDs them). (The per-page `--domain` filter was removed
 * with the per-page custom-domain model; domains are account-level now.)
 *
 * The pure {@link find} parse function below is retained for the CLI skeleton's
 * parse-only assertions (CLOUD-04 wiring + cli.test.ts). The REAL behavior —
 * the api-client call + output rendering — lives in {@link toFindQuery} /
 * {@link renderFind} / {@link runFind}, which are unit-tested against a MOCKED
 * api-client with no network (CLOUD-25). CLOUD-30 wires `runFind` into cli.ts
 * once the deployed base URL/env exists.
 */
export interface FindOptions {
  q?: string;
  tag?: string | string[];
  json?: boolean;
}

export function find(opts: FindOptions): StubResult {
  return {
    verb: "find",
    implementedBy: "CLOUD-25",
    parsed: {
      q: opts.q ?? null,
      tags: toArray(opts.tag),
      json: Boolean(opts.json),
    },
  };
}

/** Normalize the cac flags into the api-client {@link FindQuery}. Pure. */
export function toFindQuery(opts: FindOptions): FindQuery {
  return {
    ...(opts.q ? { q: opts.q } : {}),
    tags: toArray(opts.tag),
  };
}

/**
 * Render a `find` result for the terminal. With `--json` the raw `{ pages }`
 * envelope is emitted verbatim (stable machine contract). Otherwise a compact
 * table; an empty result prints a single human line so the agent/operator sees
 * "no match" explicitly rather than silence.
 */
export function renderFind(pages: PageSummary[], json: boolean): string {
  if (json) return JSON.stringify({ pages }, null, 2);
  if (pages.length === 0) return "no pages found";
  const header = ["ID", "SLUG", "VERSION", "VISIBILITY", "TAGS"];
  const rows = pages.map((p) => [
    p.id,
    p.slug,
    `v${p.currentVersion}`,
    p.visibility,
    p.tags.join(","),
  ]);
  return formatTable([header, ...rows]);
}

/** Left-aligned, space-padded column table. Pure (shared by find/get). */
export function formatTable(rows: string[][]): string {
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, i) => {
      widths[i] = Math.max(widths[i] ?? 0, cell.length);
    });
  }
  return rows
    .map((row) =>
      row
        .map((cell, i) => cell.padEnd(i === row.length - 1 ? 0 : widths[i]!))
        .join("  "),
    )
    .join("\n");
}

/**
 * Run `find` against an api-client and return the rendered output. The client
 * is injected so this is fully testable without a live server (PRD §4 agent
 * loop: find → decide publish-vs-update, with NO local state).
 */
export async function runFind(
  client: ApiClient,
  opts: FindOptions,
): Promise<string> {
  const result = await client.findPages(toFindQuery(opts));
  return renderFind(result.pages, Boolean(opts.json));
}
