import { type StubResult } from "./stub.js";

/**
 * `bind-domain <id> <hostname>` — POST /v1/pages/{id}/domain: bind a custom
 * hostname. Privileged: requires the `domains:bind` scope, which is
 * human-gated (PRD §4, §7.2). `login --scope domains:bind` requests it.
 */
export interface BindDomainOptions {
  json?: boolean;
}

export function bindDomain(id: string, hostname: string, opts: BindDomainOptions): StubResult {
  return {
    verb: "bind-domain",
    implementedBy: "CLOUD-41",
    parsed: {
      id,
      hostname,
      json: Boolean(opts.json),
    },
  };
}
