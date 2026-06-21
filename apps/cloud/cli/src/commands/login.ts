import { toArray, type StubResult } from "./stub.js";

/**
 * `login` — run the OAuth device flow (CLOUD-01 plumbing) and store the token.
 *
 * `--scope` is repeatable so an agent can request the human-gated
 * `domains:bind` step-up grant (PRD §7.2) alongside the default
 * `pages:read`/`pages:write`.
 */
export interface LoginOptions {
  scope?: string | string[];
  /** Override the auth origin (defaults to the production Cloud endpoint). */
  endpoint?: string;
}

export function login(opts: LoginOptions): StubResult {
  return {
    verb: "login",
    implementedBy: "CLOUD-25",
    parsed: {
      scopes: toArray(opts.scope),
      endpoint: opts.endpoint ?? null,
    },
  };
}
