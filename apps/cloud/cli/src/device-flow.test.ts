import { describe, expect, it } from "vitest";
import {
  DEFAULT_POLL_INTERVAL_SECONDS,
  type DeviceAuthorization,
  type DeviceFlowIO,
  type PollResponse,
  type PollState,
  initialPollState,
  nextPollState,
  parseDeviceAuthorization,
  parseTokenResponse,
  runDeviceFlow,
  shouldKeepPolling,
} from "./device-flow.js";

const AUTH: DeviceAuthorization = {
  deviceCode: "dev-code-xyz",
  userCode: "WDJB-MJHT",
  verificationUri: "https://shortwind.dev/device",
  expiresIn: 600,
  interval: 5,
};

const PENDING: PollResponse = {
  kind: "error",
  code: "authorization_pending",
};
const SLOW_DOWN: PollResponse = { kind: "error", code: "slow_down" };
const TOKEN: PollResponse = {
  kind: "token",
  token: { accessToken: "tok_abc", tokenType: "bearer", refreshToken: "ref_1" },
};

describe("initialPollState", () => {
  it("seeds interval and deadline from the authorization", () => {
    const s = initialPollState(AUTH, 1_000);
    expect(s.status).toBe("pending");
    expect(s.intervalMs).toBe(5_000);
    expect(s.deadline).toBe(1_000 + 600_000);
  });

  it("falls back to the RFC default interval when none/invalid given", () => {
    const s = initialPollState({ ...AUTH, interval: 0 }, 0);
    expect(s.intervalMs).toBe(DEFAULT_POLL_INTERVAL_SECONDS * 1000);
  });
});

describe("nextPollState — the golden transition sequence", () => {
  // The acceptance path: pending -> slow_down -> authorized -> token.
  it("walks pending -> slow_down -> authorized capturing the token", () => {
    let s = initialPollState(AUTH, 0);
    expect(s.status).toBe("pending");

    s = nextPollState(s, PENDING, 1_000);
    expect(s.status).toBe("pending");
    expect(s.intervalMs).toBe(5_000);

    s = nextPollState(s, SLOW_DOWN, 2_000);
    expect(s.status).toBe("slow_down");
    expect(s.intervalMs).toBe(10_000); // +5s backoff

    // A subsequent pending keeps the grown interval.
    s = nextPollState(s, PENDING, 3_000);
    expect(s.status).toBe("pending");
    expect(s.intervalMs).toBe(10_000);

    s = nextPollState(s, TOKEN, 4_000);
    expect(s.status).toBe("authorized");
    expect(s.token?.accessToken).toBe("tok_abc");
    expect(s.token?.refreshToken).toBe("ref_1");
  });

  it("backs off cumulatively on repeated slow_down", () => {
    let s = initialPollState(AUTH, 0);
    s = nextPollState(s, SLOW_DOWN, 1_000);
    expect(s.intervalMs).toBe(10_000);
    s = nextPollState(s, SLOW_DOWN, 2_000);
    expect(s.intervalMs).toBe(15_000);
  });

  it("terminates on expired_token", () => {
    const s = nextPollState(
      initialPollState(AUTH, 0),
      { kind: "error", code: "expired_token" },
      1_000,
    );
    expect(s.status).toBe("expired");
  });

  it("terminates on access_denied", () => {
    const s = nextPollState(
      initialPollState(AUTH, 0),
      { kind: "error", code: "access_denied" },
      1_000,
    );
    expect(s.status).toBe("denied");
  });

  it("treats an unknown error as a hard stop (never spins forever)", () => {
    const s = nextPollState(
      initialPollState(AUTH, 0),
      { kind: "error", code: "unknown" },
      1_000,
    );
    expect(s.status).toBe("denied");
  });

  it("is terminal-stable: authorized never moves", () => {
    const authorized: PollState = {
      status: "authorized",
      intervalMs: 5_000,
      deadline: 100_000,
      token: { accessToken: "t", tokenType: "bearer" },
    };
    expect(nextPollState(authorized, PENDING, 1_000)).toBe(authorized);
  });
});

describe("shouldKeepPolling", () => {
  it("keeps polling while pending before the deadline", () => {
    const s = initialPollState(AUTH, 0);
    expect(shouldKeepPolling(s, 1_000)).toBe(true);
  });

  it("stops once the deadline passes even if still pending", () => {
    const s = initialPollState(AUTH, 0);
    expect(shouldKeepPolling(s, s.deadline + 1)).toBe(false);
  });

  it("stops in every terminal state", () => {
    for (const status of ["authorized", "denied", "expired"] as const) {
      expect(
        shouldKeepPolling(
          { status, intervalMs: 1, deadline: Number.MAX_SAFE_INTEGER },
          0,
        ),
      ).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Runner with a fully faked IO and fake clock.
// ---------------------------------------------------------------------------

interface FakeIOOptions {
  auth: DeviceAuthorization;
  /** Scripted poll responses, consumed in order. */
  responses: PollResponse[];
  startMs?: number;
}

function makeFakeIO(opts: FakeIOOptions): {
  io: DeviceFlowIO;
  log: { slept: number[]; codes: string[] };
} {
  let clock = opts.startMs ?? 0;
  let i = 0;
  const slept: number[] = [];
  const codes: string[] = [];
  const io: DeviceFlowIO = {
    async requestDeviceAuthorization() {
      return opts.auth;
    },
    async pollToken() {
      const r = opts.responses[i++] ?? {
        kind: "error",
        code: "authorization_pending",
      };
      return r;
    },
    onUserCode(a) {
      codes.push(a.userCode);
    },
    async sleep(ms) {
      slept.push(ms);
      clock += ms; // advancing the fake clock IS how time passes
    },
    now() {
      return clock;
    },
  };
  return { io, log: { slept, codes } };
}

describe("runDeviceFlow", () => {
  it("resolves with the token after pending -> slow_down -> authorized", async () => {
    const { io, log } = makeFakeIO({
      auth: AUTH,
      responses: [PENDING, SLOW_DOWN, TOKEN],
    });
    const result = await runDeviceFlow(io, { clientId: "shortwind-cli" });
    expect(result).toEqual({
      ok: true,
      token: {
        accessToken: "tok_abc",
        tokenType: "bearer",
        refreshToken: "ref_1",
      },
    });
    // Presented the short code once.
    expect(log.codes).toEqual(["WDJB-MJHT"]);
    // Slept the base interval twice, then the grown interval before the token.
    expect(log.slept).toEqual([5_000, 5_000, 10_000]);
  });

  it("resolves denied on access_denied", async () => {
    const { io } = makeFakeIO({
      auth: AUTH,
      responses: [PENDING, { kind: "error", code: "access_denied" }],
    });
    const result = await runDeviceFlow(io, { clientId: "shortwind-cli" });
    expect(result).toEqual({ ok: false, reason: "denied" });
  });

  it("resolves expired on expired_token", async () => {
    const { io } = makeFakeIO({
      auth: AUTH,
      responses: [{ kind: "error", code: "expired_token" }],
    });
    const result = await runDeviceFlow(io, { clientId: "shortwind-cli" });
    expect(result).toEqual({ ok: false, reason: "expired" });
  });

  it("resolves expired when the deadline lapses before authorization", async () => {
    // expires_in is tiny so the very first sleep crosses the deadline.
    const { io } = makeFakeIO({
      auth: { ...AUTH, expiresIn: 4, interval: 5 },
      responses: [PENDING, PENDING, PENDING],
    });
    const result = await runDeviceFlow(io, { clientId: "shortwind-cli" });
    expect(result).toEqual({ ok: false, reason: "expired" });
  });
});

// ---------------------------------------------------------------------------
// Wire-format parsing (pure, golden).
// ---------------------------------------------------------------------------

describe("parseTokenResponse", () => {
  it("maps a success body to a token", () => {
    expect(
      parseTokenResponse({
        access_token: "abc",
        token_type: "bearer",
        refresh_token: "r",
        expires_in: 3600,
        scope: "pages:read pages:write",
      }),
    ).toEqual({
      kind: "token",
      token: {
        accessToken: "abc",
        tokenType: "bearer",
        refreshToken: "r",
        expiresIn: 3600,
        scope: "pages:read pages:write",
      },
    });
  });

  it("maps each RFC error code", () => {
    for (const code of [
      "authorization_pending",
      "slow_down",
      "access_denied",
      "expired_token",
    ] as const) {
      expect(parseTokenResponse({ error: code })).toEqual({
        kind: "error",
        code,
      });
    }
  });

  it("maps an unrecognized/absent error to unknown", () => {
    expect(parseTokenResponse({ error: "teapot" })).toEqual({
      kind: "error",
      code: "unknown",
    });
    expect(parseTokenResponse({})).toEqual({ kind: "error", code: "unknown" });
  });
});

describe("parseDeviceAuthorization", () => {
  it("parses a full body with defaults", () => {
    expect(
      parseDeviceAuthorization({
        device_code: "d",
        user_code: "U-CODE",
        verification_uri: "https://x/device",
        verification_uri_complete: "https://x/device?code=U-CODE",
        expires_in: 300,
        interval: 7,
      }),
    ).toEqual({
      deviceCode: "d",
      userCode: "U-CODE",
      verificationUri: "https://x/device",
      verificationUriComplete: "https://x/device?code=U-CODE",
      expiresIn: 300,
      interval: 7,
    });
  });

  it("throws on a malformed body (missing required fields)", () => {
    expect(() => parseDeviceAuthorization({ user_code: "x" })).toThrow();
  });
});
