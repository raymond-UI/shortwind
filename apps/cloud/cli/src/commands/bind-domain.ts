import { type StubResult } from "./stub.js";
import { SCOPE_DOMAINS_BIND } from "../../../shared/src/scopes.js";
import { ApiError, type DomainBindResult, type DomainCapableClient } from "../api-client.js";

/**
 * `bind-domain <id> <hostname>` — POST /v1/pages/{id}/domain: bind a custom
 * hostname. Privileged: requires the `domains:bind` scope, which is
 * human-gated (PRD §4, §7.2). `login --scope domains:bind` requests it.
 *
 * {@link bindDomain} is the retained CLOUD-04 parse stub (cli.test.ts). The
 * REAL behavior is {@link runBindDomain} (CLOUD-41), unit-tested against a
 * MOCKED api-client + a MOCKED step-up; cli.ts wires `runBindDomain` into the
 * production program.
 *
 * The step-up grant (PRD §7.2): the default device-flow token carries only
 * `pages:read`/`pages:write`. When the active token lacks `domains:bind` the
 * handler does NOT fail flatly — it re-authorizes through the device flow with
 * the elevated scope (the human approves the privileged grant), then proceeds.
 * The server is the second gate: a 403 (a token the local scope check thought
 * was sufficient but the server rejected) also routes through one step-up
 * retry before surfacing.
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

/** The privileged scope a custom-hostname bind requires (PRD §7.2). */
export const BIND_SCOPE = SCOPE_DOMAINS_BIND;

/**
 * The scopes the active account currently holds. Injected (rather than read
 * from the home here) so the handler stays pure and testable — cli.ts supplies
 * the real lookup from `readActiveAccount(...).scopes`.
 */
export type ReadScopes = () => readonly string[];

/**
 * Run the step-up grant: re-authorize the active account through the device
 * flow with `domains:bind` added, returning whether the human approved it.
 * Injected so cli.ts can wire the real `login --scope domains:bind` while tests
 * drive a deterministic fake (no network).
 */
export type StepUp = () => Promise<StepUpOutcome>;

/** The outcome of a step-up grant attempt. */
export type StepUpOutcome =
  | { ok: true; scopes: readonly string[] }
  | { ok: false; reason: "denied" | "expired" };

/** Thrown when the human declines / lets the privileged grant expire (PRD §7.2). */
export class StepUpDeniedError extends Error {
  constructor(public readonly reason: "denied" | "expired") {
    super(
      `domain bind needs the ${BIND_SCOPE} scope, but the step-up grant was ${reason} — re-run \`shortwind-cloud login --scope ${BIND_SCOPE}\` to authorize`,
    );
    this.name = "StepUpDeniedError";
  }
}

/** Does this scope set include `domains:bind`? */
export function hasBindScope(scopes: readonly string[]): boolean {
  return scopes.includes(BIND_SCOPE);
}

/**
 * Render the bind result. `--json` emits the server's bind state verbatim (the
 * stable machine contract: `{ state, hostname, cloudflareHostnameId, pageId }`);
 * human mode prints a one-line state summary.
 */
export function renderBindDomain(result: DomainBindResult, json: boolean): string {
  if (json) return JSON.stringify(result, null, 2);
  const tail = result.reason ? ` — ${result.reason}` : "";
  return `bind ${result.hostname} → ${result.pageId}: ${result.state}${tail}`;
}

/**
 * The injected seams for {@link runBindDomain}. Keeping them in one bag mirrors
 * the delete handler's `Confirm` injection and lets cli.ts pass real IO while
 * tests pass fakes.
 */
export interface BindDomainContext {
  client: DomainCapableClient;
  /** Current scopes of the active account (drives the pre-flight step-up). */
  readScopes: ReadScopes;
  /** Re-authorize with `domains:bind` (PRD §7.2). */
  stepUp: StepUp;
}

/**
 * Run `bind-domain` against an injected api-client.
 *
 *   1. If the active token lacks `domains:bind`, trigger the step-up grant
 *      BEFORE any request (don't burn a guaranteed-403). A denied/expired grant
 *      throws {@link StepUpDeniedError} (cli.ts → clean error line + exit 1).
 *   2. Call `bindDomain`. If the server still answers 403 (a `forbidden`
 *      {@link ApiError} — e.g. the local scope view was stale), run the step-up
 *      ONCE and retry. A second 403, or a denied step-up, surfaces.
 *   3. Render the resulting bind state (`--json` for the stable shape).
 *
 * Returns the rendered line; the bind STATE lives in the parsed JSON for
 * machine callers (pending-human / queued / pending-cert / active / failed).
 */
export async function runBindDomain(
  id: string,
  hostname: string,
  opts: BindDomainOptions,
  ctx: BindDomainContext,
): Promise<string> {
  const json = Boolean(opts.json);

  // (1) Local pre-flight: avoid a guaranteed-403 round trip — step up first.
  if (!hasBindScope(ctx.readScopes())) {
    const granted = await ctx.stepUp();
    if (!granted.ok) throw new StepUpDeniedError(granted.reason);
  }

  try {
    const result = await ctx.client.bindDomain(id, hostname);
    return renderBindDomain(result, json);
  } catch (err) {
    // (2) Server-side gate: a 403 means our local scope view was insufficient.
    // Re-authorize once with the elevated scope, then retry the bind.
    if (err instanceof ApiError && err.kind === "forbidden") {
      const granted = await ctx.stepUp();
      if (!granted.ok) throw new StepUpDeniedError(granted.reason);
      const result = await ctx.client.bindDomain(id, hostname);
      return renderBindDomain(result, json);
    }
    throw err;
  }
}
