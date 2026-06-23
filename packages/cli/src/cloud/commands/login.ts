import { DEFAULT_SCOPES } from "../contract/scopes.js";
import {
  createHttpDeviceFlowIO,
  runDeviceFlow,
  type DeviceFlowIO,
  type DeviceToken,
} from "../device-flow.js";
import { addAccount, globalHomeRoot, type Account, type HomeEnv } from "../../home.js";
import { resolveBaseUrl } from "../api-client.js";
import { toArray } from "./stub.js";

/**
 * `login` — run the OAuth device flow (CLOUD-01) and bind the minted token to a
 * cloud account in the global home's credentials store (PRD §7.1).
 *
 * The home is **singular per machine** but stores multiple accounts: logging in
 * adds the account and makes it active (gh-auth-switch semantics) — a second
 * `login` for a different account switches the active binding while retaining
 * the first account's token for a later `switchAccount` (PRD §5.2).
 *
 * `--scope` is repeatable so an agent can request the human-gated `domains:bind`
 * step-up grant (§7.2) alongside the default `pages:read`/`pages:write`.
 *
 * IO is injected (the device-flow IO + the account resolver) so the command is
 * driven by deterministic fakes in tests — no live server (CLOUD-04 "no
 * network" carries forward).
 */
export interface LoginOptions {
  scope?: string | string[];
  /** Override the auth origin (defaults to the production Cloud endpoint). */
  endpoint?: string;
  /**
   * Scopes to PERSIST into the credential store, when they should differ from
   * the scopes REQUESTED over the wire (`scope`). The bind-domain step-up uses
   * this to request the elevated `domains:bind` grant for a single operation
   * WITHOUT persisting that privileged scope into every later token (PRD §7.2).
   * Defaults to the requested scopes.
   */
  persistScopes?: string[];
}

/** The account a token is bound to, resolved after a successful device flow. */
export interface ResolvedAccount {
  /** Stable cloud account id. */
  id: string;
  /** Human label (email / handle) shown in account listings. */
  label: string;
}

/**
 * Injected dependencies. Production wires the HTTP device-flow IO + a real
 * userinfo lookup; tests pass fakes.
 */
export interface LoginContext {
  env?: HomeEnv;
  /** The device-flow IO (defaults to the HTTP one against `endpoint`). */
  io?: DeviceFlowIO;
  /**
   * Resolve which account a freshly-minted token belongs to. Defaults to
   * deriving a stable id from the token (a real userinfo call lands with the
   * cloud API client in a later wave).
   */
  resolveAccount?: (token: DeviceToken) => Promise<ResolvedAccount>;
  /** Clock injection for the credential `addedAt` timestamp. */
  now?: () => Date;
}

export type LoginResult =
  | { ok: true; account: Account }
  | { ok: false; reason: "denied" | "expired" };

/** Public client id for the device flow (no secret — RFC 8628 public client). */
export const CLIENT_ID = "shortwind-cli";

/**
 * Resolve the device-flow endpoints from the SAME origin every other cloud verb
 * uses ({@link resolveBaseUrl}: `--endpoint` → `SHORTWIND_CLOUD_API` → the
 * branded `https://api.shortwind.dev`). This is deliberately NOT a separate
 * `shortwind.dev` default: that is the marketing/docs apex, which 404s
 * `/oauth/*` with an empty body — and `res.json()` on an empty body throws a raw
 * `SyntaxError`, which is exactly how login broke when the two origins diverged.
 */
export function loginEndpoints(
  opts: { endpoint?: string },
  env: { SHORTWIND_CLOUD_API?: string | undefined } = process.env,
) {
  const base = resolveBaseUrl(opts.endpoint, env);
  return {
    deviceAuthorizationUrl: `${base}/oauth/device/code`,
    tokenUrl: `${base}/oauth/token`,
  };
}

/** Build the space-delimited scope request, defaulting to the standard grant. */
function scopeString(scope: string | string[] | undefined): string {
  const requested = toArray(scope);
  const scopes = requested.length > 0 ? requested : [...DEFAULT_SCOPES];
  return scopes.join(" ");
}

export async function login(
  opts: LoginOptions,
  ctx: LoginContext = {},
): Promise<LoginResult> {
  const env = ctx.env ?? (process.env as HomeEnv);
  const io =
    ctx.io ??
    createHttpDeviceFlowIO(
      loginEndpoints({ ...(opts.endpoint ? { endpoint: opts.endpoint } : {}) }),
    );
  const scope = scopeString(opts.scope);

  const outcome = await runDeviceFlow(io, { clientId: CLIENT_ID, scope });
  if (!outcome.ok) {
    return { ok: false, reason: outcome.reason };
  }

  const resolve = ctx.resolveAccount ?? defaultResolveAccount;
  const who = await resolve(outcome.token);

  const home = globalHomeRoot(env);
  // Persist `persistScopes` when given (the step-up requests an elevated scope
  // over the wire but must NOT bake it into the stored credential); otherwise
  // persist what was requested.
  const persisted = opts.persistScopes ?? scope.split(" ").filter(Boolean);
  const creds = addAccount(home, {
    id: who.id,
    label: who.label,
    token: outcome.token,
    scopes: persisted,
    ...(ctx.now ? { now: ctx.now } : {}),
  });
  const account = creds.accounts[who.id]!;
  return { ok: true, account };
}

/**
 * Fallback account resolver: derive a stable id from the token's value. The
 * real cloud API exposes a userinfo endpoint (a later wave) — until then a
 * deterministic id keyed off the token is enough to bind + switch accounts.
 */
async function defaultResolveAccount(token: DeviceToken): Promise<ResolvedAccount> {
  const id = `acct_${token.accessToken.slice(0, 12)}`;
  return { id, label: id };
}
