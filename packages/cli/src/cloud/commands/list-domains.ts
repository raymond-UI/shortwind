import type { AccountDomain, DomainCapableClient } from "../api-client.js";

/**
 * `domains` — GET /v1/domains: list the account's custom domains (CLI ↔ web
 * parity with the dashboard's Domains view). Read-only; needs only a
 * `pages:read` bearer. `--json` emits the stable machine shape.
 */
export interface ListDomainsOptions {
  json?: boolean;
}

export function renderListDomains(
  domains: AccountDomain[],
  json: boolean,
): string {
  if (json) return JSON.stringify({ domains }, null, 2);
  if (domains.length === 0) {
    return "no custom domains — bind one with `shortwind cloud bind-domain <hostname>`";
  }
  // hostname + status, one per line (pad the hostname column for readability).
  const width = Math.max(...domains.map((d) => d.hostname.length));
  return domains
    .map((d) => `${d.hostname.padEnd(width)}  ${d.status}`)
    .join("\n");
}

export async function runListDomains(
  opts: ListDomainsOptions,
  client: Pick<DomainCapableClient, "listDomains">,
): Promise<string> {
  const { domains } = await client.listDomains();
  return renderListDomains(domains, Boolean(opts.json));
}
