import { describe, expect, it } from "vitest";
import {
  bindDomain,
  runBindDomain,
  renderBindDomain,
  hasBindScope,
  StepUpDeniedError,
  InvalidHostnameError,
  BIND_SCOPE,
  type BindDomainContext,
  type StepUpOutcome,
} from "./bind-domain.js";
import {
  ApiError,
  type DomainBindResult,
  type DomainCapableClient,
} from "../api-client.js";

/**
 * bind-domain (CLOUD-41) — the step-up scope grant + the bind call against a
 * MOCKED api-client and a MOCKED step-up (no network, per CLOUD-04 carry-over).
 *
 * Behaviors covered:
 *   - without `domains:bind`: the step-up flow is INVOKED (not a flat failure),
 *     and on success the bind proceeds;
 *   - with the scope already granted: bindDomain is called, step-up is NOT;
 *   - a server 403 (forbidden ApiError) routes through the step-up retry path;
 *   - a denied/expired step-up surfaces a StepUpDeniedError (clean failure);
 *   - `--json` output is the stable verbatim bind-state shape.
 */

const PENDING_HUMAN: DomainBindResult = {
  state: "pending-human",
  hostname: "www.example.com",
  cloudflareHostnameId: null,
  pageId: "pg_1",
};

const ACTIVE: DomainBindResult = {
  state: "active",
  hostname: "www.example.com",
  cloudflareHostnameId: "cf_123",
  pageId: "pg_1",
};

/** A DomainCapableClient whose bindDomain returns the given result, counting calls. */
function clientReturning(
  result: DomainBindResult,
  onBind: (id: string, hostname: string) => void = () => {},
): DomainCapableClient {
  return baseClient({
    bindDomain: async (id, hostname) => {
      onBind(id, hostname);
      return result;
    },
  });
}

/** A DomainCapableClient whose bindDomain throws 403 the first N calls, then succeeds. */
function client403Then(
  succeedWith: DomainBindResult,
  forbiddenCount: number,
  onBind: (id: string, hostname: string) => void = () => {},
): DomainCapableClient {
  let calls = 0;
  return baseClient({
    bindDomain: async (id, hostname) => {
      onBind(id, hostname);
      calls += 1;
      if (calls <= forbiddenCount) {
        throw new ApiError({
          kind: "forbidden",
          status: 403,
          message: "token lacks domains:bind",
          code: "FORBIDDEN",
        });
      }
      return succeedWith;
    },
  });
}

function baseClient(over: Partial<DomainCapableClient>): DomainCapableClient {
  return {
    findPages: async () => ({ pages: [] }),
    getPage: async () => {
      throw new Error("unused");
    },
    publishPage: async () => {
      throw new Error("unused");
    },
    updatePage: async () => {
      throw new Error("unused");
    },
    bindDomain: async () => {
      throw new Error("unused");
    },
    ...over,
  } as DomainCapableClient;
}

/** A step-up that records its invocation and yields a fixed outcome. */
function fakeStepUp(outcome: StepUpOutcome, onCall: () => void = () => {}) {
  return async (): Promise<StepUpOutcome> => {
    onCall();
    return outcome;
  };
}

function ctx(over: Partial<BindDomainContext>): BindDomainContext {
  return {
    client: clientReturning(PENDING_HUMAN),
    readScopes: () => [BIND_SCOPE],
    stepUp: fakeStepUp({ ok: true, scopes: [BIND_SCOPE] }),
    ...over,
  };
}

describe("bindDomain — retained CLOUD-04 parse stub", () => {
  it("reports the parsed args (used by cli.test.ts parse-shape)", () => {
    expect(bindDomain("pg_1", "www.example.com", { json: true })).toEqual({
      verb: "bind-domain",
      implementedBy: "CLOUD-41",
      parsed: { id: "pg_1", hostname: "www.example.com", json: true },
    });
  });
});

describe("hasBindScope", () => {
  it("detects the domains:bind scope", () => {
    expect(hasBindScope(["pages:read", "pages:write"])).toBe(false);
    expect(hasBindScope(["pages:read", BIND_SCOPE])).toBe(true);
  });
});

describe("renderBindDomain — golden output", () => {
  it("human: one-line state summary", () => {
    expect(renderBindDomain(PENDING_HUMAN, false)).toBe(
      "bind www.example.com → pg_1: pending-human",
    );
  });

  it("human: appends the reason on a failed bind", () => {
    expect(
      renderBindDomain(
        { ...ACTIVE, state: "failed", reason: "cert failed" },
        false,
      ),
    ).toBe("bind www.example.com → pg_1: failed — cert failed");
  });

  it("--json: emits the bind state verbatim (stable contract)", () => {
    expect(JSON.parse(renderBindDomain(ACTIVE, true))).toEqual(ACTIVE);
  });
});

describe("runBindDomain — client-side hostname validation (#156)", () => {
  it("rejects a malformed hostname BEFORE any step-up or bind call", async () => {
    let steppedUp = false;
    let bindCalled = false;
    await expect(
      runBindDomain("pg_1", "not a host!", {}, {
        client: clientReturning(PENDING_HUMAN, () => {
          bindCalled = true;
        }),
        // No scope → would normally step up; the hostname check must short-circuit.
        readScopes: () => ["pages:read", "pages:write"],
        stepUp: fakeStepUp({ ok: true, scopes: [BIND_SCOPE] }, () => {
          steppedUp = true;
        }),
      }),
    ).rejects.toBeInstanceOf(InvalidHostnameError);
    expect(steppedUp).toBe(false);
    expect(bindCalled).toBe(false);
  });

  it("accepts a valid hostname and proceeds to bind", async () => {
    const out = await runBindDomain(
      "pg_1",
      "www.example.com",
      {},
      ctx({ client: clientReturning(ACTIVE) }),
    );
    expect(out).toBe("bind www.example.com → pg_1: active");
  });
});

describe("runBindDomain — step-up gating (PRD §7.2)", () => {
  it("WITHOUT domains:bind: invokes the step-up flow, then binds (not a flat failure)", async () => {
    let steppedUp = false;
    let bound: { id?: string; hostname?: string } = {};
    const out = await runBindDomain("pg_1", "www.example.com", { json: true }, {
      client: clientReturning(PENDING_HUMAN, (id, hostname) => {
        bound = { id, hostname };
      }),
      readScopes: () => ["pages:read", "pages:write"],
      stepUp: fakeStepUp({ ok: true, scopes: [BIND_SCOPE] }, () => {
        steppedUp = true;
      }),
    });
    expect(steppedUp).toBe(true);
    expect(bound).toEqual({ id: "pg_1", hostname: "www.example.com" });
    expect(JSON.parse(out)).toEqual(PENDING_HUMAN);
  });

  it("WITH domains:bind already: calls bindDomain and does NOT step up", async () => {
    let steppedUp = false;
    let bound: { id?: string; hostname?: string } = {};
    const out = await runBindDomain(
      "pg_1",
      "www.example.com",
      {},
      ctx({
        client: clientReturning(ACTIVE, (id, hostname) => {
          bound = { id, hostname };
        }),
        readScopes: () => ["pages:read", BIND_SCOPE],
        stepUp: fakeStepUp({ ok: true, scopes: [BIND_SCOPE] }, () => {
          steppedUp = true;
        }),
      }),
    );
    expect(steppedUp).toBe(false);
    expect(bound).toEqual({ id: "pg_1", hostname: "www.example.com" });
    expect(out).toBe("bind www.example.com → pg_1: active");
  });

  it("a denied step-up throws StepUpDeniedError and never calls bindDomain", async () => {
    let bindCalled = false;
    await expect(
      runBindDomain("pg_1", "www.example.com", {}, {
        client: clientReturning(ACTIVE, () => {
          bindCalled = true;
        }),
        readScopes: () => ["pages:read", "pages:write"],
        stepUp: fakeStepUp({ ok: false, reason: "denied" }),
      }),
    ).rejects.toBeInstanceOf(StepUpDeniedError);
    expect(bindCalled).toBe(false);
  });
});

describe("runBindDomain — server 403 maps to the needs-scope step-up retry", () => {
  it("a forbidden ApiError triggers one step-up, then retries the bind", async () => {
    let stepUps = 0;
    let bindCalls = 0;
    const out = await runBindDomain("pg_1", "www.example.com", {}, {
      // Local view thinks we have the scope, but the server says 403 once.
      client: client403Then(ACTIVE, 1, () => {
        bindCalls += 1;
      }),
      readScopes: () => [BIND_SCOPE],
      stepUp: fakeStepUp({ ok: true, scopes: [BIND_SCOPE] }, () => {
        stepUps += 1;
      }),
    });
    expect(stepUps).toBe(1);
    expect(bindCalls).toBe(2); // first 403, retry succeeds
    expect(out).toBe("bind www.example.com → pg_1: active");
  });

  it("a denied step-up after a 403 surfaces StepUpDeniedError", async () => {
    await expect(
      runBindDomain("pg_1", "www.example.com", {}, {
        client: client403Then(ACTIVE, 1),
        readScopes: () => [BIND_SCOPE],
        stepUp: fakeStepUp({ ok: false, reason: "expired" }),
      }),
    ).rejects.toBeInstanceOf(StepUpDeniedError);
  });

  it("a non-403 ApiError propagates unchanged (no step-up)", async () => {
    let stepUps = 0;
    const client = baseClient({
      bindDomain: async () => {
        throw new ApiError({ kind: "not_found", status: 404, message: "no page" });
      },
    });
    await expect(
      runBindDomain("pg_1", "www.example.com", {}, {
        client,
        readScopes: () => [BIND_SCOPE],
        stepUp: fakeStepUp({ ok: true, scopes: [BIND_SCOPE] }, () => {
          stepUps += 1;
        }),
      }),
    ).rejects.toMatchObject({ kind: "not_found" });
    expect(stepUps).toBe(0);
  });
});
