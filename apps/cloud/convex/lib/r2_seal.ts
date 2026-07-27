/**
 * #198 item 4 — actually SEAL a quarantined R2 object (PRD §8.2 preserve-not-
 * delete). The lifecycle kill/quarantine path records a `preservedR2Key`
 * (`quarantine/<artifactKey>`) on the moderation case and evicts the KV route +
 * edge cache so the page stops serving — but the R2 OBJECT itself was never
 * moved. This module performs the real move: COPY the live artifact to the
 * sealed prefix, then DELETE the original live object. The material is preserved
 * (at the sealed key, held for the legal window) and can no longer be served
 * from — or fetched at — its original R2 key.
 *
 * #232 — a published page now has TWO live objects holding the same bytes: the
 * immutable `<expandedHash>.html` and the stable `current.html` the Worker
 * streams. BOTH must go, or the guarantee above is false for the second one (the
 * router refuses a quarantined page before any R2 read, but the object would
 * still be fetchable over the S3 API). The sealed copy is made from the hashed
 * key; `current.html` is then plainly DELETED (it is a duplicate, not evidence).
 *
 * Like the KV eviction (lib/edge_kv.ts), the R2 S3 calls are `fetch`es, so they
 * can ONLY run in an ACTION. The seal is SCHEDULED from the sealing mutation
 * (`ctx.scheduler.runAfter(0, …)`) via {@link scheduleArtifactSeal}.
 *
 * Fail-safe contract: a seal failure (missing R2 creds / network / S3 5xx) is
 * logged and SWALLOWED — it never throws out of the scheduled action (which
 * would retry forever). The DB case (`preservedR2Key` + lifecycle=quarantined)
 * and the KV/edge eviction are already the enforced source of truth; the worst
 * case of a missed move is the object lingering at its live key (unreachable —
 * the route is evicted and the page is find-excluded) until an operator retries.
 * Surfacing seal failures for follow-up is the alerting work in #202.
 */
import { v } from "convex/values";
import { internalAction } from "../_generated/server.js";
import { alertOps } from "./ops_alert.js";

/**
 * Minimal `process.env` accessor (this workspace types against
 * `@cloudflare/workers-types`, no Node `process`). Same R2 S3 creds the publish
 * write uses (convex/pages.ts `writeArtifactToR2`).
 */
declare const process: { env: Record<string, string | undefined> };

interface R2Creds {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

/** Read the R2 S3 creds, or null when unprovisioned (dev/test) → seal is skipped. */
function r2Creds(): R2Creds | null {
  const endpoint = process.env.R2_S3_ENDPOINT;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET_NAME ?? "shortwind-artifacts";
  if (!endpoint || !accessKeyId || !secretAccessKey) return null;
  return { endpoint, accessKeyId, secretAccessKey, bucket };
}

/** The outcome of a seal attempt (distinguishes unconfigured from a failure). */
export type SealStatus = "skipped" | "sealed" | "failed";

/**
 * COPY `liveKey` → `sealedKey`, then DELETE `liveKey`, via R2's S3-compatible
 * API (SigV4-signed with aws4fetch). Returns the {@link SealStatus}: `skipped`
 * when R2 is unprovisioned (dev/test — not an error), `sealed` on success,
 * `failed` on a real error (which the caller alerts on). Never throws.
 * Idempotent enough for a retry: a re-run whose live object is already gone (404
 * on copy-source) is treated as an already-sealed success.
 *
 * `stableKey` (#232) is the page's STABLE serve object
 * (`artifacts/<accountId>/<pageId>/current.html`) — a SECOND copy of the same
 * bytes the publish path writes so a republish is immediate. It holds no unique
 * material (the sealed key preserves the bytes), so it is a plain DELETE, not a
 * second copy. It is deleted even when the live copy is already gone (a retry),
 * so a partially-applied seal converges. A 404 is success; a real failure is
 * logged and reported as `failed` (never thrown).
 */
export async function sealArtifact(
  liveKey: string,
  sealedKey: string,
  stableKey?: string | null,
): Promise<SealStatus> {
  const creds = r2Creds();
  if (!creds) return "skipped"; // Un-provisioned (dev/test): nothing to seal.

  const { AwsClient } = await import("aws4fetch");
  const client = new AwsClient({
    accessKeyId: creds.accessKeyId,
    secretAccessKey: creds.secretAccessKey,
    service: "s3",
    region: "auto",
  });
  const base = creds.endpoint.replace(/\/+$/, "");
  const enc = (k: string) => k.split("/").map(encodeURIComponent).join("/");
  const sealedUrl = `${base}/${creds.bucket}/${enc(sealedKey)}`;

  /** DELETE one key. A 404 is success (already gone). Returns false on a real error. */
  const deleteKey = async (key: string, label: string): Promise<boolean> => {
    const del = await client.fetch(`${base}/${creds.bucket}/${enc(key)}`, {
      method: "DELETE",
    });
    if (del.ok || del.status === 404) return true;
    const detail = await del.text().catch(() => "");
    console.error(
      `[r2_seal] ${label} failed (${del.status}) ${key}: ${detail.slice(0, 200)}`,
    );
    return false;
  };

  try {
    let status: SealStatus = "sealed";
    // 1. COPY live → sealed. S3 CopyObject: PUT the destination with an
    //    `x-amz-copy-source` header naming `/{bucket}/{liveKey}`.
    const copy = await client.fetch(sealedUrl, {
      method: "PUT",
      headers: { "x-amz-copy-source": `/${creds.bucket}/${enc(liveKey)}` },
    });
    if (copy.status === 404) {
      // Already gone (a retry after a prior seal) ⇒ the hashed key is sealed;
      // fall through to the stable-copy delete so a partial seal converges.
    } else if (!copy.ok) {
      const detail = await copy.text().catch(() => "");
      console.error(
        `[r2_seal] copy failed (${copy.status}) ${liveKey} → ${sealedKey}: ${detail.slice(0, 200)}`,
      );
      status = "failed";
    } else {
      // 2. DELETE the original live object so it can no longer be served/fetched.
      //    The COPY succeeded, so the material IS preserved at the sealed key —
      //    the legal hold holds. A delete failure is reported so the caller/
      //    alerting knows the original wasn't removed (it is already unreachable
      //    via KV/find).
      if (!(await deleteKey(liveKey, "delete-original"))) status = "failed";
    }
    // 3. #232: DELETE the stable serve copy (`current.html`) — the same bytes at
    //    a second key. Attempted even when the copy hard-failed: the material is
    //    still at `liveKey` in that case, so removing this copy only ever shrinks
    //    the live footprint, never the preserved evidence.
    if (stableKey) {
      if (!(await deleteKey(stableKey, "delete-stable"))) status = "failed";
    }
    return status;
  } catch (err) {
    console.error(`[r2_seal] seal threw for ${liveKey} → ${sealedKey}:`, err);
    return "failed";
  }
}

/**
 * The internalAction that performs the R2 seal. Scheduled (not called inline) by
 * the sealing mutations so the S3 `fetch` runs in an action context. Fail-safe:
 * `sealArtifact` swallows + logs, so a Cloudflare/R2 failure never surfaces as a
 * forever-retrying scheduled job.
 */
export const sealArtifactAction = internalAction({
  args: {
    liveKey: v.string(),
    sealedKey: v.string(),
    // #232. Optional so an in-flight job scheduled by the PREVIOUS deploy (whose
    // args carry no `stableKey`) still runs — it just seals the hashed key.
    stableKey: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (_ctx, args) => {
    const status = await sealArtifact(
      args.liveKey,
      args.sealedKey,
      args.stableKey ?? null,
    );
    // #202 alerting: a FAILED seal (not merely unconfigured) is a legal-
    // preservation gap — the material may linger at its live key — so page an
    // operator rather than swallow silently.
    if (status === "failed") {
      await alertOps("r2_seal.failed", {
        liveKey: args.liveKey,
        sealedKey: args.sealedKey,
      });
    }
    return null;
  },
});

/**
 * The scheduler slice needed to schedule the seal (structural, so the moderation
 * ctx satisfies it without pulling Convex server generics). Mirrors
 * `lib/edge_kv.SchedulerCtx`.
 */
export interface SealSchedulerCtx {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  scheduler: { runAfter: (delayMs: number, ref: any, args: any) => Promise<any> };
}

/**
 * Schedule the R2 seal to run in an action right after the sealing mutation
 * commits (a mutation cannot `fetch`). Called by `applyLifecycle` on a sealing
 * transition that has a live artifact key.
 */
export async function scheduleArtifactSeal(
  ctx: SealSchedulerCtx,
  liveKey: string,
  sealedKey: string,
  stableKey?: string | null,
): Promise<void> {
  const { internal } = await import("../_generated/api.js");
  await ctx.scheduler.runAfter(0, internal.lib.r2_seal.sealArtifactAction, {
    liveKey,
    sealedKey,
    ...(stableKey ? { stableKey } : {}),
  });
}
