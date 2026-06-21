import { toArray, type StubResult } from "./stub.js";

/**
 * `find` — GET /v1/pages?q=&domain=&tag= : the load-bearing verb that lets a
 * stateless agent locate an existing page before acting, preventing duplicate
 * publishes (PRD §4). `--tag` is repeatable.
 */
export interface FindOptions {
  q?: string;
  domain?: string;
  tag?: string | string[];
  json?: boolean;
}

export function find(opts: FindOptions): StubResult {
  return {
    verb: "find",
    implementedBy: "CLOUD-34",
    parsed: {
      q: opts.q ?? null,
      domain: opts.domain ?? null,
      tags: toArray(opts.tag),
      json: Boolean(opts.json),
    },
  };
}
