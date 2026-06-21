import { type StubResult } from "./stub.js";

/**
 * `init-global` — write the global Cloud config (endpoint + credential store
 * location) so subsequent verbs run unattended. `--force` overwrites an
 * existing config.
 */
export interface InitGlobalOptions {
  endpoint?: string;
  force?: boolean;
}

export function initGlobal(opts: InitGlobalOptions): StubResult {
  return {
    verb: "init-global",
    implementedBy: "CLOUD-25",
    parsed: {
      endpoint: opts.endpoint ?? null,
      force: Boolean(opts.force),
    },
  };
}
