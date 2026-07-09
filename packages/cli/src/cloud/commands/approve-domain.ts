import { validateHostname } from "../contract/slug.js";
import type { DomainBindResult, DomainCapableClient } from "../api-client.js";
import { InvalidHostnameError, renderBindDomain } from "./bind-domain.js";

/**
 * `approve-domain <hostname>` — POST /v1/domains/approve: approve a
 * `pending-human` account domain and provision it (CLI ↔ web parity with the
 * dashboard's "Approve" action; the human/operator gate in PRD §7.2). Unlike
 * `bind`, approval needs only a `pages:read` bearer (no step-up). Reuses the
 * bind-state renderer so the output matches `bind-domain`.
 */
export interface ApproveDomainOptions {
  json?: boolean;
}

export async function runApproveDomain(
  hostname: string,
  opts: ApproveDomainOptions,
  client: Pick<DomainCapableClient, "approveDomain">,
): Promise<string> {
  const valid = validateHostname(hostname);
  if (!valid.ok) {
    throw new InvalidHostnameError(
      `invalid hostname "${hostname}": ${valid.error}`,
    );
  }
  const result: DomainBindResult = await client.approveDomain(hostname);
  return renderBindDomain(result, Boolean(opts.json));
}
