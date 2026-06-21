import { type StubResult } from "./stub.js";

/**
 * `get <id>` — GET /v1/pages/{id}: metadata + version list so the agent can
 * confirm before acting (PRD §4).
 */
export interface GetOptions {
  json?: boolean;
}

export function get(id: string, opts: GetOptions): StubResult {
  return {
    verb: "get",
    implementedBy: "CLOUD-34",
    parsed: {
      id,
      json: Boolean(opts.json),
    },
  };
}
