import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sealArtifact } from "./r2_seal.js";
import { currentArtifactKey } from "./publish_core.js";

/**
 * #232 — the SEAL must leave NO live object for a quarantined page.
 *
 * A published page has two live R2 objects holding the same bytes: the immutable
 * `artifacts/<acct>/<page>/<hash>.html` (what the sealed copy is made from) and
 * the stable `artifacts/<acct>/<page>/current.html` the Worker streams. Before
 * #232 only the first existed; sealing it was the whole job. Now sealing only
 * that one would leave the second live and fetchable over the S3 API, which is
 * exactly the guarantee `r2_seal.ts` claims it upholds for a legal takedown.
 *
 * These tests drive `sealArtifact` against a stubbed `fetch`, asserting the S3
 * request TRACE: copy → delete hashed → delete current.html.
 *
 * Failure cases use 403, not 500: aws4fetch RETRIES 5xx/429 with backoff (its
 * default `retries: 10`), which is what we want in production but would make a
 * test take ~a minute. 403 is returned to the caller on the first try.
 */

const ENDPOINT = "https://acct.r2.cloudflarestorage.com";
const BUCKET = "shortwind-artifacts";
const ACCOUNT = "acct_1";
const PAGE = "page_1";
const LIVE = `artifacts/${ACCOUNT}/${PAGE}/deadbeef.html`;
const SEALED = `quarantine/${LIVE}`;
const STABLE = currentArtifactKey(ACCOUNT, PAGE);

interface Call {
  method: string;
  key: string;
}

/** Record every signed S3 request, replying with the queued status per key. */
function stubFetch(statusFor: (method: string, key: string) => number): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (input: Request | string) => {
    const req = typeof input === "string" ? new Request(input) : input;
    const key = decodeURIComponent(
      new URL(req.url).pathname.replace(`/${BUCKET}/`, ""),
    );
    calls.push({ method: req.method, key });
    return new Response("", { status: statusFor(req.method, key) });
  });
  return calls;
}

describe("sealArtifact leaves no live object at either #232 key", () => {
  beforeEach(() => {
    vi.stubEnv("R2_S3_ENDPOINT", ENDPOINT);
    vi.stubEnv("R2_ACCESS_KEY_ID", "ak");
    vi.stubEnv("R2_SECRET_ACCESS_KEY", "sk");
    vi.stubEnv("R2_BUCKET_NAME", BUCKET);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("copies the hashed object to the sealed key, then DELETES both live keys", async () => {
    const calls = stubFetch(() => 200);

    expect(await sealArtifact(LIVE, SEALED, STABLE)).toBe("sealed");

    expect(calls).toEqual([
      { method: "PUT", key: SEALED },
      { method: "DELETE", key: LIVE },
      { method: "DELETE", key: STABLE },
    ]);
    // The guarantee, stated as an invariant: every key that could serve the
    // material was DELETEd, and the only key written is the sealed one.
    const deleted = calls.filter((c) => c.method === "DELETE").map((c) => c.key);
    expect(deleted).toContain(LIVE);
    expect(deleted).toContain(STABLE);
    expect(calls.filter((c) => c.method === "PUT")).toEqual([
      { method: "PUT", key: SEALED },
    ]);
  });

  it("sends the S3 CopyObject header naming the hashed source", async () => {
    const headers: string[] = [];
    vi.stubGlobal("fetch", async (input: Request) => {
      const h = input.headers.get("x-amz-copy-source");
      if (h) headers.push(h);
      return new Response("", { status: 200 });
    });

    await sealArtifact(LIVE, SEALED, STABLE);

    expect(headers).toEqual([`/${BUCKET}/${LIVE}`]);
  });

  it("still deletes current.html when the hashed object is already sealed (retry)", async () => {
    // A re-run after a prior seal: the copy source is gone (404). The stable copy
    // may still be there if the first run died between the two deletes.
    const calls = stubFetch((method) => (method === "PUT" ? 404 : 200));

    expect(await sealArtifact(LIVE, SEALED, STABLE)).toBe("sealed");

    expect(calls).toEqual([
      { method: "PUT", key: SEALED },
      { method: "DELETE", key: STABLE },
    ]);
  });

  it("treats a 404 on the current.html delete as success (idempotent)", async () => {
    const calls = stubFetch((method, key) =>
      method === "DELETE" && key === STABLE ? 404 : 200,
    );

    expect(await sealArtifact(LIVE, SEALED, STABLE)).toBe("sealed");
    expect(calls).toHaveLength(3);
  });

  it("reports failed (never throws) when the current.html delete errors", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    stubFetch((method, key) =>
      method === "DELETE" && key === STABLE ? 403 : 200,
    );

    // The hashed key IS sealed; the leftover stable copy is a real gap, so the
    // status must be `failed` → #202 alerting pages an operator.
    expect(await sealArtifact(LIVE, SEALED, STABLE)).toBe("failed");
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it("deletes current.html even when the sealing copy hard-fails", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    // Copy failed ⇒ the hashed object is NOT deleted, so the material is still
    // preserved there. Removing the duplicate only shrinks the live footprint.
    const calls = stubFetch((method) => (method === "PUT" ? 403 : 200));

    expect(await sealArtifact(LIVE, SEALED, STABLE)).toBe("failed");
    expect(calls).toEqual([
      { method: "PUT", key: SEALED },
      { method: "DELETE", key: STABLE },
    ]);
    err.mockRestore();
  });

  it("omitting the stable key seals exactly as before (old in-flight job)", async () => {
    const calls = stubFetch(() => 200);

    expect(await sealArtifact(LIVE, SEALED)).toBe("sealed");

    expect(calls).toEqual([
      { method: "PUT", key: SEALED },
      { method: "DELETE", key: LIVE },
    ]);
  });

  it("skips entirely when R2 is unprovisioned (dev/test)", async () => {
    vi.stubEnv("R2_S3_ENDPOINT", "");
    const calls = stubFetch(() => 200);

    expect(await sealArtifact(LIVE, SEALED, STABLE)).toBe("skipped");
    expect(calls).toEqual([]);
  });
});
