/**
 * R2 artifact store — write/read the frozen Tailwind HTML artifacts.
 *
 * On the hot path the router never expands and never touches the DB: it resolves
 * a route (see ./kv.ts) to a `PageVersion.artifactKey`, then streams the R2
 * object body straight to the response (PRD §6.1). R2 has zero egress fees,
 * which is why serving is all-static (PRD §6.4).
 *
 * Key convention
 * --------------
 * The R2 object key is the `PageVersion.artifactKey` field from
 * `@shortwind/cloud/shared` types. We build it deterministically from the
 * account, page, and the expanded-output content hash so that:
 *  - identical expansions for a page dedupe to the same key (idempotent
 *    re-publish, PRD §6.2), and
 *  - keys are namespaced per account/page for clean listing + quarantine.
 *
 *     artifacts/<accountId>/<pageId>/<expandedHash>.html
 *
 * The publish mutation (CLOUD-23) calls `artifactKey(...)`, writes the object
 * with `putArtifact`, and stores the returned key on the `PageVersion` record.
 */
import type { Env } from "./env.js";

/** Build the canonical R2 object key for a page version's frozen artifact. */
export function artifactKey(
  accountId: string,
  pageId: string,
  expandedHash: string,
): string {
  return `artifacts/${accountId}/${pageId}/${expandedHash}.html`;
}

/**
 * #232 — the STABLE serve key for a page: `artifacts/<accountId>/<pageId>/current.html`.
 *
 * The hashed key above changes on every republish, so anything that CACHES it
 * (the ROUTES KV record) goes stale by construction. Publish therefore writes the
 * assembled document TWICE: once at the immutable hashed key (history, rollback,
 * dedup) and once here, overwriting whatever was there. The router derives this
 * key from the route's `accountId` + `pageId` alone, so a republish invalidates
 * nothing cached — the very next request streams the new bytes.
 *
 * A second COPY rather than a pointer object: a pointer would cost two R2 reads
 * on every single view. R2 is strongly consistent for same-key overwrites, and
 * both sides of our path are direct bucket operations (the Worker binding here,
 * the S3 API on the publish side), so the custom-domain cache caveat does not
 * apply.
 */
export function currentArtifactKey(accountId: string, pageId: string): string {
  return `artifacts/${accountId}/${pageId}/current.html`;
}

/**
 * Custom metadata stored alongside an artifact object. Small, JSON-ish scalars
 * only (R2 caps custom metadata size). Lets the router set response headers and
 * lets ops trace an object back to its version without a DB read.
 */
export interface ArtifactMeta {
  /** Content hash of the expanded output (matches `PageVersion.expandedHash`). */
  expandedHash: string;
  /** Page version number this artifact was frozen for. */
  version: number;
  /** Owning account id (for quarantine/listing). */
  accountId: string;
  /** Owning page id. */
  pageId: string;
}

/** What `getArtifact` hands back: the streamable body plus parsed metadata. */
export interface ArtifactObject {
  /** The R2 object — `.body` is a ReadableStream the router streams to R2. */
  object: R2ObjectBody;
  /** Parsed custom metadata written at `putArtifact` time. */
  meta: ArtifactMeta;
}

/**
 * Write a frozen artifact to R2. `body` is the expanded HTML (string or bytes).
 * Metadata is stored as R2 customMetadata (string values only) plus a fixed
 * `text/html` content type so the served response needs no transform.
 */
export async function putArtifact(
  env: Env,
  key: string,
  body: string | ArrayBuffer | ArrayBufferView | ReadableStream,
  meta: ArtifactMeta,
): Promise<void> {
  await env.ARTIFACTS.put(key, body, {
    httpMetadata: { contentType: "text/html; charset=utf-8" },
    customMetadata: serializeMeta(meta),
  });
}

/**
 * Read a frozen artifact from R2. Returns the streamable object body + parsed
 * metadata, or `null` when the key is absent (router → 404 / cold fallback).
 */
export async function getArtifact(
  env: Env,
  key: string,
): Promise<ArtifactObject | null> {
  const object = await env.ARTIFACTS.get(key);
  if (object === null) return null;
  return { object, meta: deserializeMeta(object.customMetadata) };
}

// --- metadata (de)serialization ---------------------------------------------
// R2 customMetadata values must be strings; numbers round-trip via String/Number.

function serializeMeta(meta: ArtifactMeta): Record<string, string> {
  return {
    expandedHash: meta.expandedHash,
    version: String(meta.version),
    accountId: meta.accountId,
    pageId: meta.pageId,
  };
}

function deserializeMeta(raw: Record<string, string> | undefined): ArtifactMeta {
  const m = raw ?? {};
  return {
    expandedHash: m.expandedHash ?? "",
    version: Number(m.version ?? "0"),
    accountId: m.accountId ?? "",
    pageId: m.pageId ?? "",
  };
}
