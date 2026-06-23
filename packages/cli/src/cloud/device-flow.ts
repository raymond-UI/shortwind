/**
 * RFC 8628 OAuth 2.0 Device Authorization Grant — client side (CLI).
 *
 * Shortwind Cloud's CLI is a **public client**: there is no embedded client
 * secret. It identifies itself only by `client_id`. The flow is:
 *
 *   1. POST {device_authorization_endpoint}  -> device_code, user_code,
 *      verification_uri, interval, expires_in              (request phase)
 *   2. Show the human the short `user_code` + `verification_uri` and wait.
 *   3. POST {token_endpoint} grant_type=device_code, repeatedly, honoring
 *      `authorization_pending` (keep waiting), `slow_down` (back off),
 *      `expired_token` (give up), `access_denied` (give up), success.
 *
 * Per CLAUDE.md the transition logic is pure (no IO, no timers, no network) so
 * it is unit- and golden-testable without a live server. The IO — actual
 * fetches and sleeps — is injected into {@link runDeviceFlow} so the loop can
 * be driven by deterministic fakes in tests.
 */

// ---------------------------------------------------------------------------
// Plain-data protocol shapes (RFC 8628 §3.2 / §3.5)
// ---------------------------------------------------------------------------

/** Successful response to the device-authorization request (RFC 8628 §3.2). */
export interface DeviceAuthorization {
  /** Long opaque code the client polls with (never shown to the human). */
  deviceCode: string;
  /** Short, human-enterable code (e.g. "WDJB-MJHT"). */
  userCode: string;
  /** Where the human goes to enter the user code. */
  verificationUri: string;
  /** Optional URI with the user code pre-filled (RFC 8628 §3.2 `verification_uri_complete`). */
  verificationUriComplete?: string | undefined;
  /** Seconds until the device code expires. */
  expiresIn: number;
  /** Minimum seconds between polls; defaults to 5 per RFC 8628 §3.5. */
  interval: number;
}

/** A minted access token returned on a successful poll (RFC 8628 §3.5). */
export interface DeviceToken {
  accessToken: string;
  tokenType: string;
  /** Present when the grant issues refresh tokens. */
  refreshToken?: string | undefined;
  /** Seconds until the access token expires, if provided. */
  expiresIn?: number | undefined;
  /** Space-delimited granted scopes, if the server narrowed them. */
  scope?: string | undefined;
}

/**
 * The four RFC 8628 §3.5 polling error codes plus a catch-all. These are the
 * `error` field of an OAuth error response, mapped to our union.
 */
export type DeviceFlowErrorCode =
  | "authorization_pending"
  | "slow_down"
  | "access_denied"
  | "expired_token"
  | "unknown";

/**
 * The raw outcome of a single token-endpoint poll, normalized to plain data.
 * The runner turns this + the current state into the next {@link PollState}.
 */
export type PollResponse =
  | { kind: "token"; token: DeviceToken }
  | { kind: "error"; code: DeviceFlowErrorCode };

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

/**
 * The client's polling state. `intervalMs` is the *current* backoff-adjusted
 * delay; `deadline` is the absolute ms timestamp after which the device code is
 * considered expired even if the server hasn't said so yet.
 */
export interface PollState {
  status: "pending" | "slow_down" | "authorized" | "denied" | "expired";
  /** Current poll interval in ms (grows on `slow_down`). */
  intervalMs: number;
  /** Absolute expiry deadline in ms (epoch). */
  deadline: number;
  /** Set once `status === "authorized"`. */
  token?: DeviceToken;
}

/** RFC 8628 §3.5 default minimum poll interval, in seconds. */
export const DEFAULT_POLL_INTERVAL_SECONDS = 5;

/** How much to grow the interval on each `slow_down` (RFC 8628 §3.5: +5s). */
export const SLOW_DOWN_INCREMENT_SECONDS = 5;

/**
 * Build the initial polling state from a device-authorization response and the
 * current clock. Pure.
 */
export function initialPollState(
  auth: DeviceAuthorization,
  nowMs: number,
): PollState {
  const interval =
    auth.interval && auth.interval > 0
      ? auth.interval
      : DEFAULT_POLL_INTERVAL_SECONDS;
  return {
    status: "pending",
    intervalMs: interval * 1000,
    deadline: nowMs + auth.expiresIn * 1000,
  };
}

/**
 * The pure transition: given the current state, a poll response, and the
 * current clock, compute the next state. Never throws, never does IO.
 *
 * Rules (RFC 8628 §3.5):
 *  - token success  -> authorized (terminal).
 *  - access_denied  -> denied (terminal).
 *  - expired_token  -> expired (terminal).
 *  - authorization_pending -> keep current interval, stay pending.
 *  - slow_down      -> increase interval by 5s, stay pending.
 *  - unknown error  -> treated as TRANSIENT (network blip / 5xx / malformed
 *                      body): stay pending and keep polling, backing off like a
 *                      slow_down so we don't hammer a struggling server. Only an
 *                      explicit `access_denied` is terminal denial; the deadline
 *                      still bounds the loop so a permanently-down server expires.
 *  - Independently: if `nowMs >= deadline`, the device code has expired
 *    regardless of what the server said, so we transition to `expired`.
 */
export function nextPollState(
  state: PollState,
  response: PollResponse,
  nowMs: number,
): PollState {
  // Terminal states never move.
  if (
    state.status === "authorized" ||
    state.status === "denied" ||
    state.status === "expired"
  ) {
    return state;
  }

  if (response.kind === "token") {
    return { ...state, status: "authorized", token: response.token };
  }

  switch (response.code) {
    case "access_denied":
      return { ...state, status: "denied" };
    case "expired_token":
      return { ...state, status: "expired" };
    case "slow_down":
      return {
        ...state,
        status: "slow_down",
        intervalMs:
          state.intervalMs + SLOW_DOWN_INCREMENT_SECONDS * 1000,
      };
    case "authorization_pending":
      // Stay pending; a prior slow_down keeps its grown interval.
      return { ...state, status: "pending" };
    case "unknown":
    default:
      // Transient (5xx / network / malformed): keep polling with a backed-off
      // interval rather than declaring a terminal denial. The deadline still
      // caps the loop, so a server that never recovers ends as `expired`.
      return {
        ...state,
        status: "pending",
        intervalMs: state.intervalMs + SLOW_DOWN_INCREMENT_SECONDS * 1000,
      };
  }
}

/**
 * Whether the runner should keep polling. A state is non-terminal while it is
 * `pending` or `slow_down` AND the deadline has not passed.
 */
export function shouldKeepPolling(state: PollState, nowMs: number): boolean {
  if (
    state.status === "authorized" ||
    state.status === "denied" ||
    state.status === "expired"
  ) {
    return false;
  }
  return nowMs < state.deadline;
}

// ---------------------------------------------------------------------------
// IO-injected runner
// ---------------------------------------------------------------------------

/** The injectable IO surface — fakes drive the loop deterministically in tests. */
export interface DeviceFlowIO {
  /** Request a device + user code. */
  requestDeviceAuthorization(input: {
    clientId: string;
    scope?: string | undefined;
  }): Promise<DeviceAuthorization>;
  /** Poll the token endpoint once with the device code. */
  pollToken(input: {
    clientId: string;
    deviceCode: string;
  }): Promise<PollResponse>;
  /** Present the user code + verification URI to the human. */
  onUserCode(auth: DeviceAuthorization): void;
  /** Sleep `ms` (real timer in prod; resolved-immediately fake in tests). */
  sleep(ms: number): Promise<void>;
  /** Current wall clock in ms. Injected so tests advance a fake clock. */
  now(): number;
}

export interface DeviceFlowConfig {
  /** Public client identifier (no secret). */
  clientId: string;
  /** Optional space-delimited scope request. */
  scope?: string;
}

/** Terminal outcome of the whole flow. */
export type DeviceFlowResult =
  | { ok: true; token: DeviceToken }
  | { ok: false; reason: "denied" | "expired" };

/**
 * Drive the full device flow to a terminal state. Pure orchestration over the
 * injected {@link DeviceFlowIO}: it owns no timers and no network of its own.
 *
 * Returns a result object rather than throwing on the normal denied/expired
 * paths (CLAUDE.md: throwing is reserved for bugs — a real network failure in
 * `pollToken`/`requestDeviceAuthorization` is the IO layer's to surface).
 */
export async function runDeviceFlow(
  io: DeviceFlowIO,
  config: DeviceFlowConfig,
): Promise<DeviceFlowResult> {
  const auth = await io.requestDeviceAuthorization({
    clientId: config.clientId,
    scope: config.scope,
  });
  io.onUserCode(auth);

  let state = initialPollState(auth, io.now());

  while (shouldKeepPolling(state, io.now())) {
    await io.sleep(state.intervalMs);
    // Re-check the deadline after sleeping: a long backoff may have crossed it.
    if (!shouldKeepPolling(state, io.now())) break;

    const response = await io.pollToken({
      clientId: config.clientId,
      deviceCode: auth.deviceCode,
    });
    state = nextPollState(state, response, io.now());
  }

  if (state.status === "authorized" && state.token) {
    return { ok: true, token: state.token };
  }
  if (state.status === "denied") {
    return { ok: false, reason: "denied" };
  }
  // Either the server said expired_token, or we ran past the deadline.
  return { ok: false, reason: "expired" };
}

// ---------------------------------------------------------------------------
// HTTP IO adapter (production)
// ---------------------------------------------------------------------------

/** Endpoints the production IO talks to. */
export interface DeviceFlowEndpoints {
  deviceAuthorizationUrl: string;
  tokenUrl: string;
}

/**
 * Parse a raw token-endpoint JSON body into our normalized {@link PollResponse}.
 * Pure — exported for golden tests of the wire mapping. A body with an
 * `access_token` is a success; otherwise the `error` field is mapped to a
 * {@link DeviceFlowErrorCode}.
 */
export function parseTokenResponse(body: unknown): PollResponse {
  const obj = (body ?? {}) as Record<string, unknown>;
  if (typeof obj.access_token === "string") {
    return {
      kind: "token",
      token: {
        accessToken: obj.access_token,
        tokenType:
          typeof obj.token_type === "string" ? obj.token_type : "bearer",
        refreshToken:
          typeof obj.refresh_token === "string"
            ? obj.refresh_token
            : undefined,
        expiresIn:
          typeof obj.expires_in === "number" ? obj.expires_in : undefined,
        scope: typeof obj.scope === "string" ? obj.scope : undefined,
      },
    };
  }
  const error = typeof obj.error === "string" ? obj.error : "unknown";
  const code: DeviceFlowErrorCode =
    error === "authorization_pending" ||
    error === "slow_down" ||
    error === "access_denied" ||
    error === "expired_token"
      ? error
      : "unknown";
  return { kind: "error", code };
}

/** Parse a device-authorization JSON body. Pure; throws only on a malformed body (a bug-grade server response). */
export function parseDeviceAuthorization(body: unknown): DeviceAuthorization {
  const obj = (body ?? {}) as Record<string, unknown>;
  if (
    typeof obj.device_code !== "string" ||
    typeof obj.user_code !== "string" ||
    typeof obj.verification_uri !== "string"
  ) {
    throw new Error(
      "Malformed device authorization response: missing device_code/user_code/verification_uri",
    );
  }
  return {
    deviceCode: obj.device_code,
    userCode: obj.user_code,
    verificationUri: obj.verification_uri,
    verificationUriComplete:
      typeof obj.verification_uri_complete === "string"
        ? obj.verification_uri_complete
        : undefined,
    expiresIn:
      typeof obj.expires_in === "number" ? obj.expires_in : 900,
    interval:
      typeof obj.interval === "number"
        ? obj.interval
        : DEFAULT_POLL_INTERVAL_SECONDS,
  };
}

/**
 * Build the production {@link DeviceFlowIO} backed by `fetch`, real timers, and
 * a console presenter. The CLI command wires this; tests use a fake instead.
 */
/**
 * Read a response body as JSON, tolerating an empty or non-JSON body. Returns
 * `null` when the body is empty or unparseable instead of throwing a raw
 * `SyntaxError` from `res.json()` — so a wrong origin / proxy error page / 5xx
 * surfaces as a handled outcome, not a stack dump (the original login crash).
 */
async function readJsonSafe(res: Response): Promise<unknown> {
  const text = await res.text();
  if (text.trim() === "") return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function createHttpDeviceFlowIO(
  endpoints: DeviceFlowEndpoints,
  opts?: {
    fetchImpl?: typeof fetch;
    present?: (auth: DeviceAuthorization) => void;
  },
): DeviceFlowIO {
  const doFetch = opts?.fetchImpl ?? fetch;
  return {
    async requestDeviceAuthorization({ clientId, scope }) {
      const params = new URLSearchParams({ client_id: clientId });
      if (scope) params.set("scope", scope);
      const res = await doFetch(endpoints.deviceAuthorizationUrl, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });
      const body = await readJsonSafe(res);
      if (!res.ok || body === null) {
        // A clear, actionable error beats a raw JSON SyntaxError: name the URL
        // and status so a misconfigured origin is obvious.
        throw new Error(
          `device authorization request failed: HTTP ${res.status} from ` +
            `${endpoints.deviceAuthorizationUrl}` +
            (body === null
              ? " — empty or non-JSON response (is SHORTWIND_CLOUD_API pointing at the API origin?)"
              : ""),
        );
      }
      return parseDeviceAuthorization(body);
    },
    async pollToken({ clientId, deviceCode }) {
      const params = new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: deviceCode,
        client_id: clientId,
      });
      const res = await doFetch(endpoints.tokenUrl, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      });
      const body = await readJsonSafe(res);
      // An empty/non-JSON poll body is a transient blip (proxy hiccup / 5xx):
      // map to `unknown`, which the state machine treats as keep-polling-with-
      // backoff. The deadline still bounds the loop.
      if (body === null) return { kind: "error", code: "unknown" };
      return parseTokenResponse(body);
    },
    onUserCode:
      opts?.present ??
      ((auth) => {
        // Default presenter: the short code is the human-load-bearing part.
        const target = auth.verificationUriComplete ?? auth.verificationUri;
        // eslint-disable-next-line no-console
        console.log(
          `\nTo authorize this device, visit:\n  ${target}\n` +
            `and enter the code:\n  ${auth.userCode}\n`,
        );
      }),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
  };
}
